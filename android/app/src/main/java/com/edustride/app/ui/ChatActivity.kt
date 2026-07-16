package com.edustride.app.ui

import android.os.Bundle
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.recyclerview.widget.LinearLayoutManager
import com.edustride.app.data.models.ChatMessage
import com.edustride.app.data.models.PrefsManager
import com.edustride.app.data.socket.ChatSocketManager
import com.edustride.app.databinding.ActivityChatBinding
import com.edustride.app.ui.adapters.ChatAdapter

class ChatActivity : AppCompatActivity(), ChatSocketManager.ChatListener {

    private lateinit var binding: ActivityChatBinding
    private lateinit var prefsManager: PrefsManager
    private var socketManager: ChatSocketManager? = null
    private lateinit var chatAdapter: ChatAdapter

    private var classRoom = "VII" // Default chat room channel
    private var senderName = "Aether Member"

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        
        prefsManager = PrefsManager(this)
        binding = ActivityChatBinding.inflate(layoutInflater)
        setContentView(binding.root)

        // Read user data from preferences
        val user = prefsManager.user
        senderName = user?.studentProfile?.name ?: (if (user?.role == "SuperAdmin") "Admin" else "Teacher")
        classRoom = user?.studentProfile?.class_level ?: "VII"

        // Set Toolbar layout details
        binding.chatToolbar.title = "Class $classRoom Chatroom"
        binding.chatToolbar.setNavigationOnClickListener {
            onBackPressed()
        }

        setupRecyclerView()
        setupSocket()

        binding.btnSendMessage.setOnClickListener {
            sendMessage()
        }
    }

    private fun setupRecyclerView() {
        chatAdapter = ChatAdapter(senderName)
        binding.rvChatMessages.layoutManager = LinearLayoutManager(this)
        binding.rvChatMessages.adapter = chatAdapter
    }

    private fun setupSocket() {
        socketManager = ChatSocketManager()
        socketManager?.connect(classRoom, this)
    }

    private fun sendMessage() {
        val content = binding.edtMessage.text.toString().trim()
        if (content.isEmpty()) return

        // Emit message to Socket server
        socketManager?.sendMessage(classRoom, senderName, content)
        
        // Append locally to list immediately
        val localMsg = ChatMessage(
            _id = null,
            class_level = classRoom,
            sender_name = senderName,
            content = content,
            created_at = null
        )
        chatAdapter.appendMessage(localMsg)
        scrollToBottom()

        // Clear input box
        binding.edtMessage.text.clear()
    }

    private fun scrollToBottom() {
        if (chatAdapter.itemCount > 0) {
            binding.rvChatMessages.smoothScrollToPosition(chatAdapter.itemCount - 1)
        }
    }

    // Socket listeners implementations
    override fun onMessageReceived(message: ChatMessage) {
        // Discard my own messages since we already appended them locally on send
        if (message.sender_name.trim().lowercase() != senderName.trim().lowercase()) {
            runOnUiThread {
                chatAdapter.appendMessage(message)
                scrollToBottom()
            }
        }
    }

    override fun onConnectionStatusChanged(connected: Boolean) {
        runOnUiThread {
            if (!connected) {
                Toast.makeText(this@ChatActivity, "Chat disconnected. Retrying...", Toast.LENGTH_SHORT).show()
            }
        }
    }

    override fun onDestroy() {
        super.onDestroy()
        socketManager?.disconnect()
    }
}
