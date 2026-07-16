package com.edustride.app.data.socket

import android.util.Log
import com.edustride.app.data.models.ChatMessage
import com.google.gson.Gson
import io.socket.client.IO
import io.socket.client.Socket
import org.json.JSONObject
import java.net.URISyntaxException

class ChatSocketManager(private val socketUrl: String = "http://10.0.2.2:5000") {
    private var socket: Socket? = null
    private val gson = Gson()

    interface ChatListener {
        fun onMessageReceived(message: ChatMessage)
        fun onConnectionStatusChanged(connected: Boolean)
    }

    fun connect(classLevel: String, listener: ChatListener) {
        try {
            val opts = IO.Options().apply {
                transports = arrayOf("websocket")
            }
            socket = IO.socket(socketUrl, opts)
            
            socket?.on(Socket.EVENT_CONNECT) {
                Log.d("SocketManager", "Connected to WebSocket Server")
                listener.onConnectionStatusChanged(true)
                // Join the designated class room immediately on connection
                socket?.emit("join_room", classLevel)
            }

            socket?.on(Socket.EVENT_DISCONNECT) {
                Log.d("SocketManager", "Disconnected from WebSocket Server")
                listener.onConnectionStatusChanged(false)
            }

            socket?.on("message") { args ->
                if (args.isNotEmpty()) {
                    val data = args[0]
                    Log.d("SocketManager", "Received raw message: $data")
                    try {
                        val messageJson = data.toString()
                        val message = gson.fromJson(messageJson, ChatMessage::class.java)
                        listener.onMessageReceived(message)
                    } catch (e: Exception) {
                        Log.e("SocketManager", "Failed to parse message json", e)
                    }
                }
            }

            socket?.connect()
        } catch (e: URISyntaxException) {
            Log.e("SocketManager", "Invalid WebSocket URL syntax", e)
        }
    }

    fun sendMessage(classLevel: String, senderName: String, content: String) {
        val payload = JSONObject().apply {
            put("class_level", classLevel)
            put("sender_name", senderName)
            put("content", content)
        }
        socket?.emit("send_message", payload)
    }

    fun disconnect() {
        socket?.disconnect()
        socket?.off()
        socket = null
    }
}
