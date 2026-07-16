import mongoose from 'mongoose';

const chatMessageSchema = new mongoose.Schema({
  class_level: {
    type: String,
    required: true
  },
  sender_name: {
    type: String,
    required: true
  },
  sender_role: {
    type: String,
    enum: ['SuperAdmin', 'Teacher', 'Student'],
    required: true
  },
  message_text: {
    type: String,
    required: true
  },
  reactions: [
    {
      emoji: String,
      sender_name: String
    }
  ],
  created_at: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
});

export default mongoose.model('ChatMessage', chatMessageSchema);
