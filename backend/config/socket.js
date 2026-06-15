import { Server } from 'socket.io';
import ChatMessage from '../models/ChatMessage.js';

export const initSocket = (server) => {
  const io = new Server(server, {
    cors: {
      origin: '*', // Allow all origins for development
      methods: ['GET', 'POST']
    }
  });

  io.on('connection', (socket) => {
    console.log(`Socket connected: ${socket.id}`);

    // Listen for join_room
    socket.on('join_room', (class_level) => {
      // Leave other class rooms first to avoid cross-chatter
      const rooms = Array.from(socket.rooms);
      rooms.forEach(room => {
        if (room !== socket.id) {
          socket.leave(room);
        }
      });
      
      socket.join(class_level);
      console.log(`User ${socket.id} joined class room: ${class_level}`);
    });

    // Listen for send_message
    socket.on('send_message', async (data) => {
      try {
        const { class_level, sender_name, sender_role, message_text } = data;

        // Save message to MongoDB
        const chatMsg = await ChatMessage.create({
          class_level,
          sender_name,
          sender_role,
          message_text
        });

        // Broadcast back to all clients in the class room
        io.to(class_level).emit('new_message', chatMsg);
        console.log(`Message broadcasted to Class ${class_level} from ${sender_name}: "${message_text}"`);
      } catch (error) {
        console.error('Socket error in send_message:', error.message);
      }
    });

    socket.on('disconnect', () => {
      console.log(`Socket disconnected: ${socket.id}`);
    });
  });

  return io;
};
