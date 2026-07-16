package com.edustride.app.ui.adapters

import android.view.LayoutInflater
import android.view.ViewGroup
import androidx.recyclerview.widget.RecyclerView
import com.edustride.app.data.models.ChatMessage
import com.edustride.app.databinding.ItemChatMessageReceivedBinding
import com.edustride.app.databinding.ItemChatMessageSentBinding

class ChatAdapter(
    private val myName: String,
    private val messages: MutableList<ChatMessage> = mutableListOf()
) : RecyclerView.Adapter<RecyclerView.ViewHolder>() {

    companion object {
        private const val VIEW_TYPE_SENT = 1
        private const val VIEW_TYPE_RECEIVED = 2
    }

    override fun getItemViewType(position: Int): Int {
        val message = messages[position]
        return if (message.sender_name.trim().lowercase() == myName.trim().lowercase()) {
            VIEW_TYPE_SENT
        } else {
            VIEW_TYPE_RECEIVED
        }
    }

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): RecyclerView.ViewHolder {
        val inflater = LayoutInflater.from(parent.context)
        return if (viewType == VIEW_TYPE_SENT) {
            val binding = ItemChatMessageSentBinding.inflate(inflater, parent, false)
            SentViewHolder(binding)
        } else {
            val binding = ItemChatMessageReceivedBinding.inflate(inflater, parent, false)
            ReceivedViewHolder(binding)
        }
    }

    override fun onBindViewHolder(holder: RecyclerView.ViewHolder, position: Int) {
        val message = messages[position]
        if (holder is SentViewHolder) {
            holder.binding.txtMessageContent.text = message.content
            holder.binding.txtTimestamp.text = formatTime(message.created_at)
        } else if (holder is ReceivedViewHolder) {
            holder.binding.txtSenderName.text = message.sender_name
            holder.binding.txtMessageContent.text = message.content
            holder.binding.txtTimestamp.text = formatTime(message.created_at)
        }
    }

    override fun getItemCount(): Int = messages.size

    fun appendMessage(message: ChatMessage) {
        messages.add(message)
        notifyItemInserted(messages.size - 1)
    }

    fun setData(newMessages: List<ChatMessage>) {
        messages.clear()
        messages.addAll(newMessages)
        notifyDataSetChanged()
    }

    private fun formatTime(timestampString: String?): String {
        if (timestampString == null) return ""
        // Extracts "HH:MM" time from ISO timestamp
        return try {
            if (timestampString.contains("T")) {
                val timePart = timestampString.split("T")[1]
                timePart.substring(0, 5) // "HH:MM"
            } else {
                timestampString
            }
        } catch (e: Exception) {
            ""
        }
    }

    class SentViewHolder(val binding: ItemChatMessageSentBinding) : RecyclerView.ViewHolder(binding.root)
    class ReceivedViewHolder(val binding: ItemChatMessageReceivedBinding) : RecyclerView.ViewHolder(binding.root)
}
