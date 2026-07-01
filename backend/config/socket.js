import { Server } from 'socket.io';
import ChatMessage from '../models/ChatMessage.js';

const activeCalls = new Map(); // class_level -> callDetails

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
      socket.join(class_level);
      console.log(`User ${socket.id} joined class room: ${class_level}`);

      // Immediately notify the user if there is an active call in this room
      if (activeCalls.has(class_level)) {
        socket.emit('incoming_call', activeCalls.get(class_level));
      }
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

    // Listen for delete_message
    socket.on('delete_message', async (data) => {
      try {
        const { message_id, class_level } = data;

        // Delete from MongoDB
        await ChatMessage.findByIdAndDelete(message_id);

        // Broadcast deletion event to class room
        io.to(class_level).emit('message_deleted', message_id);
        console.log(`Message ${message_id} deleted in Class ${class_level}`);
      } catch (error) {
        console.error('Socket error in delete_message:', error.message);
      }
    });

    // Listen for start_call
    socket.on('start_call', (data) => {
      try {
        const { class_level, caller_name, hostEmail } = data;
        const callData = { class_level, caller_name, hostEmail, hostSocketId: socket.id, startTime: Date.now() };
        activeCalls.set(class_level, callData);
        socket.to(class_level).emit('incoming_call', callData);
        console.log(`Incoming call notification sent in room ${class_level} from ${caller_name} (Host: ${hostEmail})`);
      } catch (error) {
        console.error('Socket error in start_call:', error.message);
      }
    });

    // Listen for end_call
    socket.on('end_call', (data) => {
      try {
        const { class_level } = data;
        activeCalls.delete(class_level);
        socket.to(class_level).emit('call_ended', { class_level });
        console.log(`Call end broadcasted in room ${class_level}`);
      } catch (error) {
        console.error('Socket error in end_call:', error.message);
      }
    });

    socket.on('disconnect', () => {
      console.log(`Socket disconnected: ${socket.id}`);
      // Terminate any calls hosted by this socket after a 5-second grace period
      for (const [class_level, callData] of activeCalls.entries()) {
        if (callData.hostSocketId === socket.id) {
          setTimeout(() => {
            const currentCall = activeCalls.get(class_level);
            if (currentCall && currentCall.hostSocketId === socket.id) {
              activeCalls.delete(class_level);
              io.to(class_level).emit('call_ended', { class_level });
              console.log(`Grace period expired. Host disconnected, active call ended in room ${class_level}`);
            }
          }, 5000);
        }
      }
    });
  });

  return io;
};
