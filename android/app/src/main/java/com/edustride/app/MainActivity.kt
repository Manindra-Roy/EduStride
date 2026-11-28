package com.edustride.app

import android.Manifest
import android.annotation.SuppressLint
import android.app.Activity
import android.app.DownloadManager
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.ContentValues
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.media.MediaScannerConnection
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.os.Handler
import android.os.Looper
import android.provider.MediaStore
import android.util.Base64
import android.util.Log
import android.view.View
import android.view.ViewGroup
import android.webkit.CookieManager
import android.webkit.JavascriptInterface
import android.webkit.MimeTypeMap
import android.webkit.PermissionRequest
import android.webkit.RenderProcessGoneDetail
import android.webkit.URLUtil
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.EditText
import android.widget.Toast
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ActivityCompat
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import com.edustride.app.databinding.ActivityMainBinding
import java.io.File
import java.io.FileOutputStream
import java.net.URLDecoder
import java.nio.charset.StandardCharsets
import java.util.concurrent.Executors

class MainActivity : AppCompatActivity() {

    companion object {
        private const val TAG = "MainActivity"
        private const val DEFAULT_APP_URL = "https://edustride.in"
        private const val PREFS_NAME = "edustride_prefs"
        private const val CHANNEL_ID = "edustride_notifications"
        private const val SPLASH_TIMEOUT_MS = 6000L
        const val EXTRA_TARGET_ROUTE = "target_route"

        @Volatile
        var isAppInForeground: Boolean = false
    }

    private lateinit var binding: ActivityMainBinding
    private var fileCallback: ValueCallback<Array<Uri>>? = null
    private var pendingWebPermissionRequest: PermissionRequest? = null
    private var pendingStorageAction: (() -> Unit)? = null

    private var currentWebUrl: String = DEFAULT_APP_URL
    private var isPageLoading: Boolean = true
    private var hasMainFrameError: Boolean = false

    private val mainHandler = Handler(Looper.getMainLooper())
    private val splashTimeoutRunnable = Runnable { isPageLoading = false }
    private val downloadExecutor = Executors.newSingleThreadExecutor()

    // Modern file chooser activity launcher for photo/handout file picking
    private val filePickerLauncher = registerForActivityResult(
        ActivityResultContracts.StartActivityForResult()
    ) { result ->
        if (result.resultCode == Activity.RESULT_OK) {
            val data: Intent? = result.data
            val results = WebChromeClient.FileChooserParams.parseResult(result.resultCode, data)
            fileCallback?.onReceiveValue(results)
        } else {
            fileCallback?.onReceiveValue(null)
        }
        fileCallback = null
    }

    private val requestNotificationPermissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { _ ->
        // Runtime notification permission handled
    }

    private val requestAudioPermissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { isGranted ->
        val request = pendingWebPermissionRequest
        pendingWebPermissionRequest = null
        if (request != null) {
            try {
                if (isGranted) {
                    request.grant(arrayOf(PermissionRequest.RESOURCE_AUDIO_CAPTURE))
                } else {
                    request.deny()
                }
            } catch (e: Exception) {
                Log.e(TAG, "Failed to resolve pending WebView audio permission request", e)
            }
        }
    }

    private val requestStoragePermissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { isGranted ->
        val action = pendingStorageAction
        pendingStorageAction = null
        if (isGranted) {
            action?.invoke()
        } else {
            Toast.makeText(this, "Storage permission is required to save files", Toast.LENGTH_SHORT).show()
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        val splashScreen = installSplashScreen()
        splashScreen.setKeepOnScreenCondition { isPageLoading }

        super.onCreate(savedInstanceState)

        // Prevent splash screen lockup on captive portals or hung connections
        mainHandler.postDelayed(splashTimeoutRunnable, SPLASH_TIMEOUT_MS)

        val prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        currentWebUrl = if (BuildConfig.DEBUG) {
            val saved = prefs.getString("web_url", DEFAULT_APP_URL)?.trim().orEmpty()
            if (isValidConfiguredUrl(saved)) saved else DEFAULT_APP_URL
        } else {
            DEFAULT_APP_URL
        }

        binding = ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)

        createNotificationChannel()
        checkNotificationPermission()

        val registeredClass = prefs.getString("user_class", "").orEmpty()
        val authToken = prefs.getString("auth_token", "").orEmpty()
        if (registeredClass.isNotEmpty() && authToken.isNotEmpty()) {
            startBackgroundSyncService()
        }

        setupWebView()
        setupSwipeToRefresh()
        setupOfflineOverlay()
        setupBackNavigation()
        if (BuildConfig.DEBUG) {
            setupSecretSettings()
        }

        val initialRoute = intent?.getStringExtra(EXTRA_TARGET_ROUTE)
        loadApp(initialRoute)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        val targetRoute = intent.getStringExtra(EXTRA_TARGET_ROUTE)
        if (!targetRoute.isNullOrBlank()) {
            loadApp(targetRoute)
        }
    }

    private fun setupBackNavigation() {
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (binding.offlineLayout.visibility != View.VISIBLE && binding.webView.canGoBack()) {
                    binding.webView.goBack()
                } else {
                    isEnabled = false
                    onBackPressedDispatcher.onBackPressed()
                    // Re-enable immediately so Android 12+ task resume keeps WebView Back navigation working!
                    isEnabled = true
                }
            }
        })
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun setupWebView() {
        val webSettings = binding.webView.settings
        webSettings.javaScriptEnabled = true
        webSettings.domStorageEnabled = true
        webSettings.databaseEnabled = true
        webSettings.allowFileAccess = false
        webSettings.allowContentAccess = true
        webSettings.loadWithOverviewMode = true
        webSettings.useWideViewPort = true
        webSettings.mediaPlaybackRequiresUserGesture = false
        webSettings.mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
        webSettings.userAgentString = "${webSettings.userAgentString} EduStrideAndroidApp/${resolveAppVersionName()}"

        binding.webView.addJavascriptInterface(WebAppInterface(this), "AndroidNotificationBridge")

        // Hide scrollbars from the WebView layout
        binding.webView.isVerticalScrollBarEnabled = false
        binding.webView.isHorizontalScrollBarEnabled = false

        // Set WebViewClient to enforce trusted origins and handle loading states
        binding.webView.webViewClient = object : WebViewClient() {
            override fun onRenderProcessGone(
                view: WebView?,
                detail: RenderProcessGoneDetail?
            ): Boolean {
                Log.e(TAG, "WebView renderer process gone (didCrash=${detail?.didCrash()}); reloading cleanly.")
                runOnUiThread {
                    if (!isFinishing && !isDestroyed) {
                        Toast.makeText(
                            this@MainActivity,
                            "Session refreshed after low memory.",
                            Toast.LENGTH_SHORT
                        ).show()
                        recreate()
                    }
                }
                return true
            }

            override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
                val uri = request?.url ?: return false
                if (uri.toString().equals("about:blank", ignoreCase = true)) {
                    return false
                }
                if (isTrustedWebUrl(uri)) {
                    return false
                }
                openExternalUri(uri)
                return true
            }

            override fun onPageStarted(view: WebView?, url: String?, favicon: Bitmap?) {
                hasMainFrameError = false
                binding.progressBar.visibility = View.VISIBLE
                binding.progressBar.progress = 10
            }

            override fun onPageFinished(view: WebView?, url: String?) {
                binding.progressBar.visibility = View.GONE
                binding.swipeRefresh.isRefreshing = false
                if (!hasMainFrameError) {
                    binding.offlineLayout.visibility = View.GONE
                }
                isPageLoading = false
            }

            override fun onReceivedError(
                view: WebView?,
                request: WebResourceRequest?,
                error: WebResourceError?
            ) {
                if (request?.isForMainFrame == true) {
                    hasMainFrameError = true
                    showOfflineScreen()
                    isPageLoading = false
                }
            }
        }

        // Set WebChromeClient for page loading progress, file uploads, and WebRTC audio permissions
        binding.webView.webChromeClient = object : WebChromeClient() {
            override fun onProgressChanged(view: WebView?, newProgress: Int) {
                binding.progressBar.progress = newProgress
                if (newProgress == 100) {
                    binding.progressBar.visibility = View.GONE
                }
            }

            override fun onPermissionRequest(request: PermissionRequest?) {
                if (request == null) return
                runOnUiThread {
                    if (!isTrustedWebUrl(request.origin)) {
                        Log.w(TAG, "Denied WebView permission request from untrusted origin: ${request.origin}")
                        request.deny()
                        return@runOnUiThread
                    }

                    val requestedResources = request.resources ?: emptyArray()
                    if (requestedResources.contains(PermissionRequest.RESOURCE_AUDIO_CAPTURE)) {
                        if (ContextCompat.checkSelfPermission(
                                this@MainActivity,
                                Manifest.permission.RECORD_AUDIO
                            ) == PackageManager.PERMISSION_GRANTED
                        ) {
                            request.grant(arrayOf(PermissionRequest.RESOURCE_AUDIO_CAPTURE))
                        } else {
                            pendingWebPermissionRequest?.deny()
                            pendingWebPermissionRequest = request
                            requestAudioPermissionLauncher.launch(Manifest.permission.RECORD_AUDIO)
                        }
                    } else {
                        request.deny()
                    }
                }
            }

            override fun onPermissionRequestCanceled(request: PermissionRequest?) {
                runOnUiThread {
                    if (pendingWebPermissionRequest == request) {
                        pendingWebPermissionRequest = null
                    }
                }
            }

            override fun onShowFileChooser(
                webView: WebView?,
                filePathCallback: ValueCallback<Array<Uri>>?,
                fileChooserParams: FileChooserParams?
            ): Boolean {
                fileCallback?.onReceiveValue(null)
                fileCallback = filePathCallback

                val mimeTypes = linkedSetOf<String>()
                fileChooserParams?.acceptTypes?.forEach { rawEntry ->
                    rawEntry.split(",").forEach { token ->
                        val cleaned = token.trim().lowercase()
                        if (cleaned.isEmpty()) return@forEach
                        if (cleaned.contains("/")) {
                            mimeTypes.add(cleaned)
                        } else if (cleaned.startsWith(".")) {
                            val ext = cleaned.removePrefix(".")
                            val mapped = MimeTypeMap.getSingleton().getMimeTypeFromExtension(ext)
                            if (!mapped.isNullOrBlank()) {
                                mimeTypes.add(mapped)
                            }
                        }
                    }
                }

                val intent = Intent(Intent.ACTION_GET_CONTENT).apply {
                    addCategory(Intent.CATEGORY_OPENABLE)
                    type = if (mimeTypes.size == 1) mimeTypes.first() else "*/*"
                    if (mimeTypes.size > 1) {
                        putExtra(Intent.EXTRA_MIME_TYPES, mimeTypes.toTypedArray())
                    }
                    if (fileChooserParams?.mode == FileChooserParams.MODE_OPEN_MULTIPLE) {
                        putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true)
                    }
                }

                try {
                    filePickerLauncher.launch(Intent.createChooser(intent, "Select file"))
                } catch (e: Exception) {
                    fileCallback?.onReceiveValue(null)
                    fileCallback = null
                    return false
                }
                return true
            }
        }

        // Handle file downloads (LMS handouts, PDFs, base64 chat attachments, APK) cleanly
        binding.webView.setDownloadListener { url, userAgent, contentDisposition, mimeType, _ ->
            handleDownload(url, userAgent, contentDisposition, mimeType)
        }
    }

    private fun handleDownload(
        url: String?,
        userAgent: String?,
        contentDisposition: String?,
        mimeType: String?
    ) {
        if (url.isNullOrBlank()) return

        if (url.startsWith("data:", ignoreCase = true)) {
            runWithLegacyStoragePermission {
                saveDataUriDownload(url, contentDisposition, mimeType)
            }
            return
        }

        if (url.startsWith("http://", ignoreCase = true) || url.startsWith("https://", ignoreCase = true)) {
            runWithLegacyStoragePermission {
                enqueueHttpDownload(url, userAgent, contentDisposition, mimeType)
            }
            return
        }

        openExternalUri(Uri.parse(url))
    }

    private fun runWithLegacyStoragePermission(action: () -> Unit) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q ||
            ContextCompat.checkSelfPermission(
                this,
                Manifest.permission.WRITE_EXTERNAL_STORAGE
            ) == PackageManager.PERMISSION_GRANTED
        ) {
            action()
        } else {
            pendingStorageAction = action
            requestStoragePermissionLauncher.launch(Manifest.permission.WRITE_EXTERNAL_STORAGE)
        }
    }

    private fun enqueueHttpDownload(
        url: String,
        userAgent: String?,
        contentDisposition: String?,
        mimeType: String?
    ) {
        try {
            val fileName = sanitizeFileName(URLUtil.guessFileName(url, contentDisposition, mimeType))
            val request = DownloadManager.Request(Uri.parse(url)).apply {
                if (!mimeType.isNullOrBlank()) {
                    setMimeType(mimeType)
                }
                val cookies = CookieManager.getInstance().getCookie(url)
                if (!cookies.isNullOrEmpty()) {
                    addRequestHeader("Cookie", cookies)
                }
                if (!userAgent.isNullOrBlank()) {
                    addRequestHeader("User-Agent", userAgent)
                }
                setTitle(fileName)
                setDescription("Downloading EduStride file...")
                setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
                setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, fileName)
            }
            val dm = getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager
            dm.enqueue(request)
            Toast.makeText(this, "Downloading $fileName...", Toast.LENGTH_SHORT).show()
        } catch (e: Exception) {
            Log.e(TAG, "Failed to start download for $url", e)
            Toast.makeText(this, "Unable to download file", Toast.LENGTH_SHORT).show()
        }
    }

    private fun saveDataUriDownload(
        dataUrl: String,
        contentDisposition: String?,
        fallbackMimeType: String?
    ) {
        downloadExecutor.execute {
            try {
                val commaIndex = dataUrl.indexOf(',')
                if (commaIndex <= 4) {
                    throw IllegalArgumentException("Malformed data URI")
                }

                val metadata = dataUrl.substring(5, commaIndex)
                val payload = dataUrl.substring(commaIndex + 1)
                val isBase64 = metadata.contains(";base64", ignoreCase = true)
                val extractedMime = metadata.substringBefore(';').trim()
                val resolvedMime = when {
                    extractedMime.isNotEmpty() -> extractedMime
                    !fallbackMimeType.isNullOrBlank() -> fallbackMimeType
                    else -> "application/octet-stream"
                }

                val bytes = if (isBase64) {
                    Base64.decode(payload, Base64.DEFAULT)
                } else {
                    URLDecoder.decode(payload, StandardCharsets.UTF_8.name())
                        .toByteArray(StandardCharsets.UTF_8)
                }

                val fileName = resolveDataDownloadFileName(contentDisposition, resolvedMime)

                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    val values = ContentValues().apply {
                        put(MediaStore.Downloads.DISPLAY_NAME, fileName)
                        put(MediaStore.Downloads.MIME_TYPE, resolvedMime)
                        put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS)
                        put(MediaStore.Downloads.IS_PENDING, 1)
                    }
                    val resolver = applicationContext.contentResolver
                    val uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values)
                        ?: throw IllegalStateException("Failed to create MediaStore download entry")
                    try {
                        resolver.openOutputStream(uri)?.use { out ->
                            out.write(bytes)
                        } ?: throw IllegalStateException("Failed to open output stream")
                        values.clear()
                        values.put(MediaStore.Downloads.IS_PENDING, 0)
                        resolver.update(uri, values, null, null)
                    } catch (writeErr: Exception) {
                        resolver.delete(uri, null, null)
                        throw writeErr
                    }
                } else {
                    @Suppress("DEPRECATION")
                    val downloadsDir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS)
                    if (!downloadsDir.exists()) {
                        downloadsDir.mkdirs()
                    }
                    val outFile = File(downloadsDir, fileName)
                    FileOutputStream(outFile).use { out ->
                        out.write(bytes)
                    }
                    MediaScannerConnection.scanFile(
                        applicationContext,
                        arrayOf(outFile.absolutePath),
                        arrayOf(resolvedMime),
                        null
                    )
                }

                runOnUiThread {
                    if (!isFinishing && !isDestroyed) {
                        Toast.makeText(this, "Saved $fileName to Downloads", Toast.LENGTH_SHORT).show()
                    }
                }
            } catch (e: Exception) {
                Log.e(TAG, "Failed to save data URI download", e)
                runOnUiThread {
                    if (!isFinishing && !isDestroyed) {
                        Toast.makeText(this, "Unable to save attachment", Toast.LENGTH_SHORT).show()
                    }
                }
            }
        }
    }

    private fun resolveDataDownloadFileName(contentDisposition: String?, mimeType: String): String {
        val guessed = if (!contentDisposition.isNullOrBlank()) {
            URLUtil.guessFileName("https://edustride.in/download", contentDisposition, mimeType)
        } else {
            ""
        }
        val extension = MimeTypeMap.getSingleton().getExtensionFromMimeType(mimeType)
            ?: when (mimeType.lowercase()) {
                "audio/webm" -> "webm"
                "audio/ogg" -> "ogg"
                "audio/mpeg" -> "mp3"
                "image/webp" -> "webp"
                "application/pdf" -> "pdf"
                else -> "bin"
            }
        val rawName = if (guessed.isNotBlank() && guessed != "downloadfile.bin") {
            guessed
        } else {
            "EduStride_${System.currentTimeMillis()}.$extension"
        }
        return sanitizeFileName(rawName)
    }

    private fun sanitizeFileName(name: String): String {
        val cleaned = name.replace(Regex("[\\\\/:*?\"<>|]"), "_").trim()
        return cleaned.ifEmpty { "EduStride_${System.currentTimeMillis()}" }
    }

    private fun resolveAppVersionName(): String {
        return try {
            val pkgInfo = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                packageManager.getPackageInfo(packageName, PackageManager.PackageInfoFlags.of(0))
            } else {
                @Suppress("DEPRECATION")
                packageManager.getPackageInfo(packageName, 0)
            }
            pkgInfo.versionName ?: BuildConfig.VERSION_NAME
        } catch (_: Exception) {
            BuildConfig.VERSION_NAME
        }
    }

    private fun isAllowedEduStrideHost(host: String?): Boolean {
        val normalizedHost = host?.lowercase()?.trim() ?: return false
        if (normalizedHost == "edustride.in" || normalizedHost == "www.edustride.in") {
            return true
        }
        val configuredHost = Uri.parse(currentWebUrl).host?.lowercase()?.trim()
        return !configuredHost.isNullOrEmpty() && normalizedHost == configuredHost
    }

    private fun isTrustedWebUrl(uri: Uri?): Boolean {
        if (uri == null) return false
        val scheme = uri.scheme?.lowercase() ?: return false
        val schemeAllowed = scheme == "https" || (BuildConfig.DEBUG && scheme == "http")
        return schemeAllowed && isAllowedEduStrideHost(uri.host)
    }

    private fun isValidConfiguredUrl(url: String): Boolean {
        if (url.isBlank()) return false
        val uri = try {
            Uri.parse(url)
        } catch (_: Exception) {
            return false
        }
        val scheme = uri.scheme?.lowercase()
        val schemeAllowed = scheme == "https" || (BuildConfig.DEBUG && scheme == "http")
        return schemeAllowed && !uri.host.isNullOrBlank()
    }

    private fun isTrustedSocketUrl(url: String): Boolean {
        if (!isValidConfiguredUrl(url)) return false
        if (BuildConfig.DEBUG) return true
        val host = try {
            Uri.parse(url).host?.lowercase()?.trim()
        } catch (_: Exception) {
            null
        } ?: return false
        return host == "edustride.in" ||
            host.endsWith(".edustride.in") ||
            host.endsWith(".onrender.com") ||
            isAllowedEduStrideHost(host)
    }

    private fun openExternalUri(uri: Uri) {
        try {
            val viewIntent = Intent(Intent.ACTION_VIEW, uri).apply {
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            startActivity(viewIntent)
        } catch (e: Exception) {
            Log.w(TAG, "No external app found to open URI: $uri", e)
            Toast.makeText(this, "No app available to open this link", Toast.LENGTH_SHORT).show()
        }
    }

    private fun buildTargetUrl(targetRoute: String?): String {
        val base = currentWebUrl.trimEnd('/')
        val cleanRoute = targetRoute?.trim().orEmpty()
        if (cleanRoute.isEmpty() || !cleanRoute.startsWith("/") || cleanRoute.startsWith("//")) {
            return currentWebUrl
        }
        return "$base$cleanRoute"
    }

    private fun setupSwipeToRefresh() {
        binding.swipeRefresh.isEnabled = false // Disable pull-to-refresh container to avoid inner scroll conflicts
    }

    private fun setupOfflineOverlay() {
        binding.btnRetry.setOnClickListener {
            if (isNetworkAvailable()) {
                binding.offlineLayout.visibility = View.GONE
                val loadedUri = binding.webView.url?.let {
                    try { Uri.parse(it) } catch (_: Exception) { null }
                }
                if (isTrustedWebUrl(loadedUri)) {
                    binding.webView.reload()
                } else {
                    loadApp()
                }
            } else {
                Toast.makeText(this, "Still offline — please check your internet connection.", Toast.LENGTH_SHORT).show()
            }
        }
    }

    private fun loadApp(targetRoute: String? = null) {
        if (isNetworkAvailable()) {
            hasMainFrameError = false
            binding.webView.loadUrl(buildTargetUrl(targetRoute))
        } else {
            showOfflineScreen()
        }
    }

    private fun showOfflineScreen() {
        isPageLoading = false
        binding.progressBar.visibility = View.GONE
        binding.swipeRefresh.isRefreshing = false
        binding.offlineLayout.visibility = View.VISIBLE
    }

    private fun isNetworkAvailable(): Boolean {
        val connectivityManager = getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
        val network = connectivityManager.activeNetwork ?: return false
        val capabilities = connectivityManager.getNetworkCapabilities(network) ?: return false
        if (!capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)) {
            return false
        }
        return capabilities.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) ||
            capabilities.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) ||
            capabilities.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET) ||
            capabilities.hasTransport(NetworkCapabilities.TRANSPORT_VPN)
    }

    private fun setupSecretSettings() {
        // Debug-only helper: clicking the horizontal progress bar launches the target URL config dialog
        binding.progressBar.setOnClickListener {
            showUrlConfigDialog()
        }
    }

    private fun showUrlConfigDialog() {
        val input = EditText(this).apply {
            setText(currentWebUrl)
            setSingleLine(true)
            setPadding(50, 40, 50, 40)
        }

        AlertDialog.Builder(this)
            .setTitle("Configure Target URL")
            .setMessage("Set the WebView target address (e.g. https://edustride.in or http://10.0.2.2:3000)")
            .setView(input)
            .setPositiveButton("Apply") { _, _ ->
                val newUrl = input.text.toString().trim()
                if (isValidConfiguredUrl(newUrl)) {
                    currentWebUrl = newUrl
                    getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                        .edit()
                        .putString("web_url", newUrl)
                        .apply()
                    loadApp()
                } else {
                    Toast.makeText(
                        this,
                        "Enter a valid https:// or http:// URL",
                        Toast.LENGTH_SHORT
                    ).show()
                }
            }
            .setNegativeButton("Cancel", null)
            .show()
    }

    private fun startBackgroundSyncService() {
        val serviceIntent = Intent(this, BackgroundSocketService::class.java)
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                startForegroundService(serviceIntent)
            } else {
                startService(serviceIntent)
            }
        } catch (e: Exception) {
            Log.e(TAG, "Failed to start BackgroundSocketService", e)
        }
    }

    // Battery Optimization & In-Memory Foreground tracking
    override fun onPause() {
        super.onPause()
        isAppInForeground = false
        try {
            binding.webView.onPause()
            Log.d(TAG, "App minimized (Foreground=false). WebView paused.")
        } catch (e: Exception) {
            Log.e(TAG, "Error pausing WebView", e)
        }
    }

    override fun onResume() {
        super.onResume()
        isAppInForeground = true
        try {
            binding.webView.onResume()
            Log.d(TAG, "App open on screen (Foreground=true). WebView resumed.")
        } catch (e: Exception) {
            Log.e(TAG, "Error resuming WebView", e)
        }
    }

    override fun onDestroy() {
        mainHandler.removeCallbacks(splashTimeoutRunnable)
        try {
            pendingWebPermissionRequest?.deny()
        } catch (_: Exception) {
            // Request may have already been canceled or resolved by WebView
        }
        pendingWebPermissionRequest = null
        fileCallback?.onReceiveValue(null)
        fileCallback = null
        pendingStorageAction = null
        downloadExecutor.shutdown()
        try {
            binding.webView.removeJavascriptInterface("AndroidNotificationBridge")
            binding.webView.stopLoading()
            binding.webView.webChromeClient = null
            binding.webView.webViewClient = WebViewClient()
            (binding.webView.parent as? ViewGroup)?.removeView(binding.webView)
            binding.webView.destroy()
        } catch (e: Exception) {
            Log.e(TAG, "Error cleaning up WebView", e)
        }
        super.onDestroy()
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val name = "EduStride Notifications"
            val descriptionText = "Class updates, study materials, and chat notifications"
            val importance = NotificationManager.IMPORTANCE_HIGH
            val channel = NotificationChannel(CHANNEL_ID, name, importance).apply {
                description = descriptionText
                enableVibration(true)
            }
            val notificationManager =
                getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            notificationManager.createNotificationChannel(channel)
        }
    }

    private fun checkNotificationPermission() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            if (ContextCompat.checkSelfPermission(
                    this,
                    Manifest.permission.POST_NOTIFICATIONS
                ) != PackageManager.PERMISSION_GRANTED
            ) {
                requestNotificationPermissionLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
            }
        }
    }

    private fun runIfTrustedBridgeOrigin(action: () -> Unit) {
        runOnUiThread {
            if (isFinishing || isDestroyed) return@runOnUiThread
            val currentUri = binding.webView.url?.let {
                try {
                    Uri.parse(it)
                } catch (_: Exception) {
                    null
                }
            }
            if (!isTrustedWebUrl(currentUri)) {
                Log.w(TAG, "Blocked AndroidNotificationBridge call from untrusted origin: $currentUri")
                return@runOnUiThread
            }
            action()
        }
    }

    inner class WebAppInterface(private val context: Context) {

        @JavascriptInterface
        fun showNotification(title: String?, message: String?, tag: String?) {
            val safeTitle = title.orEmpty().ifBlank { "EduStride" }
            val safeMessage = message.orEmpty()
            val safeTag = tag.orEmpty().ifBlank { "edustride-${System.currentTimeMillis()}" }

            runIfTrustedBridgeOrigin {
                val intent = Intent(context, MainActivity::class.java).apply {
                    flags = Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP
                }

                val pendingIntent = PendingIntent.getActivity(
                    context,
                    safeTag.hashCode(),
                    intent,
                    PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
                )

                val builder = NotificationCompat.Builder(context, CHANNEL_ID)
                    .setSmallIcon(R.drawable.ic_stat_edustride)
                    .setContentTitle(safeTitle)
                    .setContentText(safeMessage)
                    .setStyle(NotificationCompat.BigTextStyle().bigText(safeMessage))
                    .setPriority(NotificationCompat.PRIORITY_HIGH)
                    .setDefaults(NotificationCompat.DEFAULT_ALL)
                    .setContentIntent(pendingIntent)
                    .setAutoCancel(true)

                with(NotificationManagerCompat.from(context)) {
                    if (ActivityCompat.checkSelfPermission(
                            context,
                            Manifest.permission.POST_NOTIFICATIONS
                        ) == PackageManager.PERMISSION_GRANTED || Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU
                    ) {
                        notify(safeTag.hashCode(), builder.build())
                    }
                }
            }
        }

        @JavascriptInterface
        fun registerUser(email: String?, classLevel: String?, name: String?, socketUrl: String?) {
            registerUserWithToken(email, classLevel, name, socketUrl, "")
        }

        @JavascriptInterface
        fun saveBase64Attachment(dataUri: String?, filename: String?, mimeType: String?) {
            val safeUri = dataUri.orEmpty().trim()
            if (!safeUri.startsWith("data:", ignoreCase = true)) return
            val safeName = filename.orEmpty()
                .replace(Regex("[\\\\/:*?\"<>|\\r\\n]"), "_")
                .trim()
                .ifEmpty { "attachment" }
            val contentDisposition = "attachment; filename=\"$safeName\""

            runIfTrustedBridgeOrigin {
                runWithLegacyStoragePermission {
                    saveDataUriDownload(safeUri, contentDisposition, mimeType)
                }
            }
        }

        @JavascriptInterface
        fun registerUserWithToken(
            email: String?,
            classLevel: String?,
            name: String?,
            socketUrl: String?,
            authToken: String?
        ) {
            val safeEmail = email.orEmpty().trim()
            val safeClass = classLevel.orEmpty().trim()
            val safeName = name.orEmpty().trim()
            val rawSocketUrl = socketUrl.orEmpty().trim()
            val safeSocketUrl = if (isTrustedSocketUrl(rawSocketUrl)) rawSocketUrl else ""
            val safeToken = authToken.orEmpty().trim()

            runIfTrustedBridgeOrigin {
                getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                    .edit()
                    .putString("user_email", safeEmail)
                    .putString("user_class", safeClass)
                    .putString("user_name", safeName)
                    .putString("socket_url", safeSocketUrl)
                    .putString("auth_token", safeToken)
                    .apply()

                if (safeClass.isNotEmpty() && safeToken.isNotEmpty()) {
                    startBackgroundSyncService()
                    Log.d(TAG, "User registered: $safeName, starting background service")
                }
            }
        }

        @JavascriptInterface
        fun logoutUser() {
            runIfTrustedBridgeOrigin {
                getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                    .edit()
                    .putString("user_email", "")
                    .putString("user_class", "")
                    .putString("user_name", "")
                    .putString("auth_token", "")
                    .apply()

                val serviceIntent = Intent(context, BackgroundSocketService::class.java)
                context.stopService(serviceIntent)
                Log.d(TAG, "User logged out, stopping background service")
            }
        }
    }
}
