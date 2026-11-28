package com.edustride.app

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.util.Log
import androidx.core.app.ActivityCompat
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.app.ServiceCompat
import io.socket.client.IO
import io.socket.client.Socket
import org.json.JSONObject

class BackgroundSocketService : Service() {

    companion object {
        private const val TAG = "BackgroundService"
        private const val PREFS_NAME = "edustride_prefs"
        private const val CHANNEL_ID = "edustride_notifications"
        private const val SYNC_CHANNEL_ID = "edustride_sync_channel"
        private const val FOREGROUND_NOTIFICATION_ID = 1001
    }

    private val socketLock = Any()
    @Volatile private var socket: Socket? = null
    @Volatile private var currentSocketUrl: String? = null
    @Volatile private var currentClassRooms: String? = null
    @Volatile private var currentAuthToken: String? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        Log.d(TAG, "Service started as Foreground")

        if (!startForegroundServiceNotification()) {
            return START_NOT_STICKY
        }
        connectSocket()

        return START_NOT_STICKY
    }

    // Android 14 (API 34) timeout callback
    override fun onTimeout(startId: Int) {
        Log.w(TAG, "Foreground service timed out (startId=$startId). Stopping cleanly.")
        teardownSocket()
        stopSelf()
    }

    // Android 15 (API 35) dataSync 6-hour quota timeout callback (invoked via ART dispatch on API 35+)
    @Suppress("UNUSED_PARAMETER")
    fun onTimeout(startId: Int, fgsType: Int) {
        Log.w(TAG, "Foreground service dataSync quota reached (startId=$startId, fgsType=$fgsType). Stopping cleanly.")
        teardownSocket()
        stopSelf()
    }

    private fun startForegroundServiceNotification(): Boolean {
        return try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                val name = "EduStride Sync Service"
                val descriptionText = "Keeps real-time notifications active in the background"
                val importance = NotificationManager.IMPORTANCE_LOW
                val channel = NotificationChannel(SYNC_CHANNEL_ID, name, importance).apply {
                    description = descriptionText
                    setShowBadge(false)
                }
                val notificationManager =
                    getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
                notificationManager.createNotificationChannel(channel)
            }

            val intent = Intent(this, MainActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP
            }
            val pendingIntent = PendingIntent.getActivity(
                this,
                FOREGROUND_NOTIFICATION_ID,
                intent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )

            val notification = NotificationCompat.Builder(this, SYNC_CHANNEL_ID)
                .setSmallIcon(R.drawable.ic_stat_edustride)
                .setContentTitle("EduStride Live Sync Active")
                .setContentText("Listening for live class updates and announcements...")
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .setCategory(NotificationCompat.CATEGORY_SERVICE)
                .setContentIntent(pendingIntent)
                .setOngoing(true)
                .build()

            val fgsType = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC
            } else {
                0
            }
            ServiceCompat.startForeground(this, FOREGROUND_NOTIFICATION_ID, notification, fgsType)
            true
        } catch (e: Exception) {
            Log.e(TAG, "Unable to promote service to foreground; stopping cleanly", e)
            stopSelf()
            false
        }
    }

    private fun connectSocket() {
        val prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        val email = prefs.getString("user_email", "").orEmpty().trim()
        val classLevel = prefs.getString("user_class", "").orEmpty().trim()
        val name = prefs.getString("user_name", "").orEmpty().trim()
        val authToken = prefs.getString("auth_token", "").orEmpty().trim()
        val savedSocketUrl = prefs.getString("socket_url", "").orEmpty().trim()
        val webUrl = prefs.getString("web_url", "https://edustride.in").orEmpty().ifBlank { "https://edustride.in" }

        // Deriving socket API URL (never fall back to static Vercel frontend edustride.in with no Socket.IO server)
        val socketUrl = when {
            savedSocketUrl.isNotEmpty() -> savedSocketUrl
            webUrl.contains(":3000") -> webUrl.replace(":3000", ":5000")
            else -> ""
        }

        if (classLevel.isEmpty() || authToken.isEmpty() || socketUrl.isEmpty()) {
            Log.d(TAG, "No authenticated user session or backend socket URL registered yet. Stopping service.")
            stopSelf()
            return
        }

        // Skip redundant teardown/reconnect when config is unchanged and socket is already connecting/connected
        synchronized(socketLock) {
            if (socket != null &&
                currentSocketUrl == socketUrl &&
                currentClassRooms == classLevel &&
                currentAuthToken == authToken
            ) {
                return
            }
        }

        val roomList = classLevel.split(",").map { it.trim() }.filter { it.isNotEmpty() }
        val isStaffAll = roomList.any { it.equals("All", ignoreCase = true) }
        val ownUserId = roomList
            .firstOrNull { it.startsWith("USER_", ignoreCase = true) }
            ?.substring(5)
            .orEmpty()

        try {
            val opts = IO.Options().apply {
                transports = arrayOf("websocket", "polling")
                reconnection = true
                reconnectionDelay = 4000L
                reconnectionDelayMax = 20000L
                timeout = 15000L
                auth = mapOf("token" to authToken)
            }

            val createdSocket: Socket
            synchronized(socketLock) {
                teardownSocketLocked()
                currentSocketUrl = socketUrl
                currentClassRooms = classLevel
                currentAuthToken = authToken
                createdSocket = IO.socket(socketUrl, opts)
                socket = createdSocket
            }

            createdSocket.on(Socket.EVENT_CONNECT) {
                if (socket !== createdSocket) return@on
                Log.d(TAG, "Socket connected to $socketUrl")
                // Deduplicate room joins so each unique room is emitted once
                val uniqueRooms = linkedSetOf<String>()
                for (room in roomList) {
                    uniqueRooms.add(room)
                    if (!room.startsWith("BATCH_", ignoreCase = true) &&
                        !room.startsWith("USER_", ignoreCase = true)
                    ) {
                        uniqueRooms.add(room.uppercase())
                    }
                }
                uniqueRooms.add("ALL")
                for (room in uniqueRooms) {
                    createdSocket.emit("join_room", room)
                }
            }

            createdSocket.on(Socket.EVENT_CONNECT_ERROR) { args ->
                if (socket !== createdSocket) return@on
                val rawError = extractSocketErrorMessage(args)
                Log.w(TAG, "Socket connect_error: $rawError")
                if (rawError.contains("Authentication", ignoreCase = true) ||
                    rawError.contains("Invalid or expired", ignoreCase = true) ||
                    rawError.contains("Session invalidated", ignoreCase = true) ||
                    rawError.contains("User not found", ignoreCase = true)
                ) {
                    Log.w(TAG, "Authentication rejected by server. Clearing token and stopping service.")
                    synchronized(socketLock) {
                        if (socket !== createdSocket) return@on
                        teardownSocketLocked()
                    }
                    getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                        .edit()
                        .putString("auth_token", "")
                        .apply()
                    stopSelf()
                }
            }

            createdSocket.on("new_message") { args ->
                if (socket !== createdSocket || args.isEmpty()) return@on
                try {
                    val data = args[0] as? JSONObject ?: return@on
                    val msgClass = data.optString("class_level").trim()
                    val batchName = data.optString("batch_name").trim()
                    val senderName = data.optString("sender_name").trim()
                    val senderId = data.optString("sender_id").trim()
                    val messageText = data.optString("message_text")

                    val isSelf = (senderId.isNotEmpty() && ownUserId.isNotEmpty() && senderId == ownUserId) ||
                        (!isStaffAll && name.isNotEmpty() && senderName.equals(name, ignoreCase = true))
                    if (isSelf) return@on

                    val roomTitle = when {
                        msgClass.startsWith("BATCH_", ignoreCase = true) -> {
                            if (batchName.isNotEmpty()) "$batchName Chat" else "Special Batch Chat"
                        }
                        msgClass.isNotEmpty() -> "Class $msgClass Chat"
                        else -> "EduStride Chat"
                    }
                    val previewText = formatChatMessagePreview(messageText)
                    val displaySender = senderName.ifEmpty { "Someone" }

                    showNotification(
                        title = roomTitle,
                        message = "$displaySender: $previewText",
                        tag = "chat-$msgClass",
                        targetRoute = "/chats"
                    )
                } catch (e: Exception) {
                    Log.e(TAG, "Error parsing new_message", e)
                }
            }

            createdSocket.on("new_study_material") { args ->
                if (socket !== createdSocket || args.isEmpty()) return@on
                try {
                    val data = args[0] as? JSONObject ?: return@on
                    val batchId = data.optString("batchId").trim()
                    val batchName = data.optString("batch_name").trim()
                    val isSpecialBatch = data.optBoolean("isSpecialBatch", false) || batchId.isNotEmpty()
                    val title = data.optString("title").trim()
                    val chapterName = data.optString("chapter_name").trim()
                    val subject = data.optString("subject").trim()
                    val msgClass = data.optString("class_level").trim()

                    if (isSpecialBatch) {
                        val expectedRoom = "BATCH_$batchId"
                        if (!isStaffAll &&
                            batchId.isNotEmpty() &&
                            roomList.none { it.equals(expectedRoom, ignoreCase = true) }
                        ) {
                            return@on
                        }

                        val notifTitle = if (batchName.isNotEmpty()) {
                            "New Batch Notes: $batchName"
                        } else {
                            "New Special Batch Material"
                        }
                        val itemTitle = title.ifEmpty { chapterName.ifEmpty { "New study material uploaded" } }
                        val notifBody = if (subject.isNotEmpty()) {
                            "$subject - $itemTitle"
                        } else {
                            itemTitle
                        }

                        showNotification(
                            title = notifTitle,
                            message = notifBody,
                            tag = "batch-lms-${batchId.ifEmpty { System.currentTimeMillis().toString() }}",
                            targetRoute = if (isStaffAll) "/special-batches" else "/"
                        )
                    } else {
                        if (!isStaffAll &&
                            msgClass.isNotEmpty() &&
                            roomList.none { it.equals(msgClass, ignoreCase = true) }
                        ) {
                            return@on
                        }

                        val itemTitle = chapterName.ifEmpty { title.ifEmpty { "New study material" } }
                        val notifBody = if (subject.isNotEmpty()) {
                            "Subject: $subject - Title: $itemTitle"
                        } else {
                            itemTitle
                        }

                        showNotification(
                            title = if (msgClass.isNotEmpty()) "New Notes: Class $msgClass" else "New Study Material",
                            message = notifBody,
                            tag = "lms-$msgClass",
                            targetRoute = "/lms"
                        )
                    }
                } catch (e: Exception) {
                    Log.e(TAG, "Error parsing new_study_material", e)
                }
            }

            createdSocket.on("new_notice") { args ->
                if (socket !== createdSocket || args.isEmpty()) return@on
                try {
                    val data = args[0] as? JSONObject ?: return@on
                    val subject = data.optString("subject").trim()
                    val body = data.optString("body").trim()
                    val targetClass = data.optString("class_level").trim()

                    if (!isStaffAll &&
                        !targetClass.equals("All", ignoreCase = true) &&
                        !targetClass.equals("Personal", ignoreCase = true) &&
                        targetClass.isNotEmpty() &&
                        roomList.none { it.equals(targetClass, ignoreCase = true) }
                    ) {
                        return@on
                    }

                    showNotification(
                        title = if (subject.isNotEmpty()) "EduStride Notice: $subject" else "EduStride Notice",
                        message = body,
                        tag = "notice-${System.currentTimeMillis()}",
                        targetRoute = "/"
                    )
                } catch (e: Exception) {
                    Log.e(TAG, "Error parsing new_notice", e)
                }
            }

            createdSocket.on("incoming_call") { args ->
                if (socket !== createdSocket || args.isEmpty()) return@on
                try {
                    val data = args[0] as? JSONObject ?: return@on
                    val callClass = data.optString("class_level").trim()
                    val callerName = data.optString("caller_name").trim().ifEmpty { "Someone" }
                    val hostEmail = data.optString("hostEmail").trim()

                    // Suppress if this user initiated the call
                    if (hostEmail.isNotEmpty() && email.isNotEmpty() && hostEmail.equals(email, ignoreCase = true)) {
                        return@on
                    }

                    val roomLabel = when {
                        callClass.startsWith("BATCH_", ignoreCase = true) -> "Special Batch"
                        callClass.isNotEmpty() -> "Class $callClass"
                        else -> "EduStride"
                    }

                    showNotification(
                        title = "Incoming Voice Call",
                        message = "$callerName started a voice call in $roomLabel",
                        tag = "call-$callClass",
                        targetRoute = "/chats",
                        category = NotificationCompat.CATEGORY_CALL
                    )
                } catch (e: Exception) {
                    Log.e(TAG, "Error parsing incoming_call", e)
                }
            }

            createdSocket.on("call_ended") { args ->
                if (socket !== createdSocket || args.isEmpty()) return@on
                try {
                    val data = args[0] as? JSONObject ?: return@on
                    val callClass = data.optString("class_level").trim()
                    if (callClass.isNotEmpty()) {
                        NotificationManagerCompat.from(this@BackgroundSocketService).cancel("call-$callClass".hashCode())
                    }
                } catch (e: Exception) {
                    Log.e(TAG, "Error handling call_ended", e)
                }
            }

            createdSocket.connect()
        } catch (e: Exception) {
            Log.e(TAG, "Socket setup failed", e)
        }
    }

    private fun extractSocketErrorMessage(args: Array<Any>): String {
        val first = args.firstOrNull() ?: return ""
        return when (first) {
            is JSONObject -> first.optString("message").ifBlank { first.toString() }
            is Throwable -> first.message ?: first.toString()
            else -> first.toString()
        }
    }

    private fun formatChatMessagePreview(messageText: String): String {
        val trimmed = messageText.trim()
        if (trimmed.startsWith("{\"isAttachment\":true")) {
            return try {
                val obj = JSONObject(trimmed)
                val type = obj.optString("type").lowercase()
                val fileName = obj.optString("name").trim()
                val caption = obj.optString("caption").trim()
                when (type) {
                    "audio" -> "Sent a voice note"
                    "image" -> if (caption.isNotEmpty()) "Sent an image: $caption" else "Sent an image"
                    else -> {
                        val base = if (fileName.isNotEmpty()) "Sent a document: $fileName" else "Sent a document"
                        if (caption.isNotEmpty()) "$base - $caption" else base
                    }
                }
            } catch (_: Exception) {
                "Sent an attachment"
            }
        }
        return if (trimmed.length > 300) "${trimmed.take(297)}..." else trimmed
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

    private fun showNotification(
        title: String,
        message: String,
        tag: String,
        targetRoute: String = "/",
        category: String? = null
    ) {
        // If the mobile app is open on screen, suppress status bar notification panel alerts
        if (MainActivity.isAppInForeground) {
            Log.d(TAG, "App is currently open on screen. Suppressing notification popup for $tag")
            return
        }

        createNotificationChannel()
        val intent = Intent(this, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP
            putExtra(MainActivity.EXTRA_TARGET_ROUTE, targetRoute)
        }

        val pendingIntent = PendingIntent.getActivity(
            this,
            tag.hashCode(),
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val builder = NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_edustride)
            .setContentTitle(title)
            .setContentText(message)
            .setStyle(NotificationCompat.BigTextStyle().bigText(message))
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setDefaults(NotificationCompat.DEFAULT_ALL)
            .setContentIntent(pendingIntent)
            .setAutoCancel(true)

        if (!category.isNullOrEmpty()) {
            builder.setCategory(category)
        }

        with(NotificationManagerCompat.from(this)) {
            if (ActivityCompat.checkSelfPermission(
                    this@BackgroundSocketService,
                    Manifest.permission.POST_NOTIFICATIONS
                ) == PackageManager.PERMISSION_GRANTED || Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU
            ) {
                notify(tag.hashCode(), builder.build())
            }
        }
    }

    private fun teardownSocketLocked() {
        socket?.off()
        socket?.disconnect()
        socket = null
        currentSocketUrl = null
        currentClassRooms = null
        currentAuthToken = null
    }

    private fun teardownSocket() {
        synchronized(socketLock) {
            teardownSocketLocked()
        }
    }

    override fun onDestroy() {
        super.onDestroy()
        teardownSocket()
        Log.d(TAG, "Service destroyed")
    }
}
