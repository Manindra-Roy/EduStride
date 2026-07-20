package com.edustride.app

import android.annotation.SuppressLint
import android.app.Activity
import android.content.Context
import android.content.Intent
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.net.Uri
import android.os.Bundle
import android.view.View
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.ProgressBar
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import androidx.swiperefreshlayout.widget.SwipeRefreshLayout
import com.edustride.app.databinding.ActivityMainBinding
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.os.Build
import android.webkit.JavascriptInterface
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import android.Manifest
import android.content.pm.PackageManager
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import android.util.Log

class MainActivity : AppCompatActivity() {

    private lateinit var binding: ActivityMainBinding
    private var fileCallback: ValueCallback<Array<Uri>>? = null

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

    // Set to hosted production URL (customizable via developer settings)
    private var APP_URL = "https://edustride.in"
    private var isPageLoading = true

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        val splashScreen = installSplashScreen()
        splashScreen.setKeepOnScreenCondition { isPageLoading }
        
        super.onCreate(savedInstanceState)
        
        val prefs = getSharedPreferences("edustride_prefs", Context.MODE_PRIVATE)
        APP_URL = prefs.getString("web_url", "https://edustride.in") ?: "https://edustride.in"

        binding = ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)

        createNotificationChannel()
        checkNotificationPermission()

        val registeredClass = prefs.getString("user_class", "") ?: ""
        if (registeredClass.isNotEmpty()) {
            val serviceIntent = Intent(this, BackgroundSocketService::class.java)
            startService(serviceIntent)
        }

        setupWebView()
        setupSwipeToRefresh()
        setupOfflineOverlay()
        setupSecretSettings()
        
        loadApp()
    }

    private fun setupWebView() {
        val webSettings = binding.webView.settings
        webSettings.javaScriptEnabled = true
        webSettings.domStorageEnabled = true
        webSettings.databaseEnabled = true
        webSettings.allowFileAccess = true
        webSettings.allowContentAccess = true
        webSettings.loadWithOverviewMode = true
        webSettings.useWideViewPort = true
        webSettings.mixedContentMode = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
        webSettings.userAgentString = webSettings.userAgentString + " EduStrideAndroidApp/1.0"

        binding.webView.addJavascriptInterface(WebAppInterface(this), "AndroidNotificationBridge")

        // Hide scrollbars from the WebView layout
        binding.webView.isVerticalScrollBarEnabled = false
        binding.webView.isHorizontalScrollBarEnabled = false

        // Set WebViewClient to handle transitions and loading failures
        binding.webView.webViewClient = object : WebViewClient() {
            override fun onPageStarted(view: WebView?, url: String?, favicon: android.graphics.Bitmap?) {
                binding.progressBar.visibility = View.VISIBLE
                binding.progressBar.progress = 10
            }

            override fun onPageFinished(view: WebView?, url: String?) {
                binding.progressBar.visibility = View.GONE
                binding.swipeRefresh.isRefreshing = false
                binding.offlineLayout.visibility = View.GONE
                isPageLoading = false // Smooth transition: dismiss splash screen when web content has finished rendering
            }

            override fun onReceivedError(
                view: WebView?,
                request: WebResourceRequest?,
                error: WebResourceError?
            ) {
                if (request?.isForMainFrame == true) {
                    showOfflineScreen()
                    isPageLoading = false // Dismiss splash screen on error so offline overlay is visible
                }
            }
        }

        // Set WebChromeClient for page loading progress & file uploads
        binding.webView.webChromeClient = object : WebChromeClient() {
            override fun onProgressChanged(view: WebView?, newProgress: Int) {
                binding.progressBar.progress = newProgress
                if (newProgress == 100) {
                    binding.progressBar.visibility = View.GONE
                }
            }

            override fun onShowFileChooser(
                webView: WebView?,
                filePathCallback: ValueCallback<Array<Uri>>?,
                fileChooserParams: FileChooserParams?
            ): Boolean {
                fileCallback?.onReceiveValue(null)
                fileCallback = filePathCallback

                val intent = fileChooserParams?.createIntent()
                try {
                    filePickerLauncher.launch(intent)
                } catch (e: Exception) {
                    fileCallback?.onReceiveValue(null)
                    fileCallback = null
                    return false
                }
                return true
            }
        }
    }

    private fun setupSwipeToRefresh() {
        binding.swipeRefresh.isEnabled = false // Disable pull-to-refresh container to avoid inner scroll conflicts
    }

    private fun setupOfflineOverlay() {
        binding.btnRetry.setOnClickListener {
            if (isNetworkAvailable()) {
                binding.offlineLayout.visibility = View.GONE
                loadApp()
            }
        }
    }

    private fun loadApp() {
        if (isNetworkAvailable()) {
            binding.webView.loadUrl(APP_URL)
        } else {
            showOfflineScreen()
        }
    }

    private fun showOfflineScreen() {
        binding.progressBar.visibility = View.GONE
        binding.swipeRefresh.isRefreshing = false
        binding.offlineLayout.visibility = View.VISIBLE
    }

    private fun isNetworkAvailable(): Boolean {
        val connectivityManager = getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
        val network = connectivityManager.activeNetwork ?: return false
        val activeNetwork = connectivityManager.getNetworkCapabilities(network) ?: return false
        return activeNetwork.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) ||
                activeNetwork.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) ||
                activeNetwork.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET)
    }

    private fun setupSecretSettings() {
        // Hidden debug helper: clicking the horizontal progress bar launches the config dialog
        binding.progressBar.setOnClickListener {
            showUrlConfigDialog()
        }
    }

    private fun showUrlConfigDialog() {
        val input = android.widget.EditText(this).apply {
            setText(APP_URL)
            setSingleLine(true)
            setPadding(50, 40, 50, 40)
        }

        androidx.appcompat.app.AlertDialog.Builder(this)
            .setTitle("Configure Target URL")
            .setMessage("Set the WebView target address (e.g. https://edustride.in or http://10.0.2.2:5173)")
            .setView(input)
            .setPositiveButton("Apply") { _, _ ->
                val newUrl = input.text.toString().trim()
                if (newUrl.isNotEmpty()) {
                    APP_URL = newUrl
                    getSharedPreferences("edustride_prefs", Context.MODE_PRIVATE)
                        .edit().putString("web_url", newUrl).apply()
                    loadApp()
                }
            }
            .setNegativeButton("Cancel", null)
            .show()
    }

    // Handle back button navigation inside WebView
    override fun onBackPressed() {
        if (binding.webView.canGoBack()) {
            binding.webView.goBack()
        } else {
            super.onBackPressed()
        }
    }

    private val CHANNEL_ID = "edustride_notifications"

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val name = "EduStride Notifications"
            val descriptionText = "Class updates and chat messages"
            val importance = NotificationManager.IMPORTANCE_DEFAULT
            val channel = NotificationChannel(CHANNEL_ID, name, importance).apply {
                description = descriptionText
            }
            val notificationManager: NotificationManager =
                getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            notificationManager.createNotificationChannel(channel)
        }
    }

    private val requestNotificationPermissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { isGranted ->
        // Handle runtime notification permission result
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

    inner class WebAppInterface(private val context: Context) {
        @JavascriptInterface
        fun showNotification(title: String, message: String, tag: String) {
            val intent = Intent(context, MainActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP
            }
            
            val pendingIntent: PendingIntent = PendingIntent.getActivity(
                context, 
                0, 
                intent, 
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )

            val builder = NotificationCompat.Builder(context, CHANNEL_ID)
                .setSmallIcon(R.mipmap.ic_launcher)
                .setContentTitle(title)
                .setContentText(message)
                .setPriority(NotificationCompat.PRIORITY_DEFAULT)
                .setContentIntent(pendingIntent)
                .setAutoCancel(true)

            with(NotificationManagerCompat.from(context)) {
                if (ActivityCompat.checkSelfPermission(
                        context,
                        Manifest.permission.POST_NOTIFICATIONS
                    ) == PackageManager.PERMISSION_GRANTED || Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU
                ) {
                    notify(tag.hashCode(), builder.build())
                }
            }
        }

        @JavascriptInterface
        fun registerUser(email: String, classLevel: String, name: String, socketUrl: String) {
            getSharedPreferences("edustride_prefs", Context.MODE_PRIVATE)
                .edit()
                .putString("user_email", email)
                .putString("user_class", classLevel)
                .putString("user_name", name)
                .putString("socket_url", socketUrl)
                .apply()

            // Start background service
            val serviceIntent = Intent(context, BackgroundSocketService::class.java)
            context.startService(serviceIntent)
            Log.d("MainActivity", "User registered: $name, starting background service to socket: $socketUrl")
        }

        @JavascriptInterface
        fun logoutUser() {
            getSharedPreferences("edustride_prefs", Context.MODE_PRIVATE)
                .edit()
                .putString("user_email", "")
                .putString("user_class", "")
                .putString("user_name", "")
                .apply()

            // Stop background service
            val serviceIntent = Intent(context, BackgroundSocketService::class.java)
            context.stopService(serviceIntent)
            Log.d("MainActivity", "User logged out, stopping background service")
        }
    }
}
