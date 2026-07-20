package com.edustride.app

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.IBinder
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import io.socket.client.IO
import io.socket.client.Socket
import org.json.JSONObject
import android.Manifest
import android.content.pm.PackageManager
import androidx.core.app.ActivityCompat

class BackgroundSocketService : Service() {

    private var socket: Socket? = null
    private val CHANNEL_ID = "edustride_notifications"

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        Log.d("BackgroundService", "Service started")
        
        // Start connection
        connectSocket()

        return START_STICKY
    }

    private fun connectSocket() {
        val prefs = getSharedPreferences("edustride_prefs", Context.MODE_PRIVATE)
        val email = prefs.getString("user_email", "") ?: ""
        val classLevel = prefs.getString("user_class", "") ?: ""
        val name = prefs.getString("user_name", "") ?: ""
        val savedSocketUrl = prefs.getString("socket_url", "") ?: ""
        val webUrl = prefs.getString("web_url", "https://edustride.in") ?: "https://edustride.in"

        // Deriving socket API URL (if localhost/local IP on 3000, redirect to 5000)
        val socketUrl = when {
            savedSocketUrl.isNotEmpty() -> savedSocketUrl
            webUrl.contains(":3000") -> webUrl.replace(":3000", ":5000")
            else -> webUrl
        }

        if (classLevel.isEmpty()) {
            Log.d("BackgroundService", "No class registered yet. Stopping.")
            return
        }

        try {
            if (socket?.connected() == true) {
                socket?.disconnect()
            }

            val opts = IO.Options().apply {
                transports = arrayOf("polling", "websocket")
                reconnection = true
            }
            socket = IO.socket(socketUrl, opts)

            socket?.on(Socket.EVENT_CONNECT) {
                Log.d("BackgroundService", "Socket connected to $socketUrl")
                // Join class room
                socket?.emit("join_room", classLevel)
            }

            socket?.on("new_message") { args ->
                if (args.isNotEmpty()) {
                    try {
                        val data = args[0] as JSONObject
                        val msgClass = data.optString("class_level")
                        val senderName = data.optString("sender_name")
                        val messageText = data.optString("message_text")

                        // Skip if it's from the user themselves
                        if (senderName != name) {
                            showNotification(
                                "Class $msgClass Chat",
                                "$senderName: $messageText",
                                "chat-$msgClass"
                            )
                        }
                    } catch (e: Exception) {
                        Log.e("BackgroundService", "Error parsing new_message", e)
                    }
                }
            }

            socket?.on("new_study_material") { args ->
                if (args.isNotEmpty()) {
                    try {
                        val data = args[0] as JSONObject
                        val msgClass = data.optString("class_level")
                        val subject = data.optString("subject")
                        val chapterName = data.optString("chapter_name")

                        // If student, filter by class
                        if (classLevel != "All" && classLevel != msgClass) {
                            return@on
                        }

                        showNotification(
                            "New Notes: Class $msgClass",
                            "Subject: $subject - Title: $chapterName",
                            "lms-$msgClass"
                        )
                    } catch (e: Exception) {
                        Log.e("BackgroundService", "Error parsing new_study_material", e)
                    }
                }
            }

            socket?.connect()
        } catch (e: Exception) {
            Log.e("BackgroundService", "Socket setup failed", e)
        }
    }

    private fun showNotification(title: String, message: String, tag: String) {
        val intent = Intent(this, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP
        }
        
        val pendingIntent: PendingIntent = PendingIntent.getActivity(
            this, 
            0, 
            intent, 
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val builder = NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle(title)
            .setContentText(message)
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
            .setContentIntent(pendingIntent)
            .setAutoCancel(true)

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

    override fun onDestroy() {
        super.onDestroy()
        socket?.disconnect()
        socket?.off()
        socket = null
        Log.d("BackgroundService", "Service destroyed")
    }
}
