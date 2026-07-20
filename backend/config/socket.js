import { Server } from 'socket.io';
import ChatMessage from '../models/ChatMessage.js';

const activeCalls = new Map(); // class_level -> callDetails
const roomMembers = new Map(); // class_level -> Map of socket.id -> { sender_name, sender_role }
let ioInstance = null;

export const getIO = () => ioInstance;

export const initSocket = (server) => {
  const io = new Server(server, {
    cors: {
      origin: '*', // Allow all origins for development
      methods: ['GET', 'POST']
    }
  });
  ioInstance = io;

  const sendMembersList = (class_level) => {
    const membersMap = roomMembers.get(class_level);
    const membersList = membersMap ? Array.from(membersMap.values()) : [];
    // De-duplicate members by sender_name
    const uniqueMembers = [];
    const seen = new Set();
    for (const m of membersList) {
      if (!seen.has(m.sender_name)) {
        seen.add(m.sender_name);
        uniqueMembers.push(m);
      }
    }
    io.to(class_level).emit('room_members', uniqueMembers);
  };

  const removeUserFromRooms = (socketId) => {
    for (const [class_level, members] of roomMembers.entries()) {
      if (members.has(socketId)) {
        members.delete(socketId);
        sendMembersList(class_level);
      }
    }
  };

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

    // Listen for chat presence room joining
    socket.on('join_room_chat', (data) => {
      const { class_level, sender_name, sender_role } = data;
      socket.join(class_level);
      
      // Remove from any other rooms first
      removeUserFromRooms(socket.id);
      
      if (!roomMembers.has(class_level)) {
        roomMembers.set(class_level, new Map());
      }
      roomMembers.get(class_level).set(socket.id, { sender_name, sender_role });
      
      console.log(`User ${sender_name} (${sender_role}) joined chat presence for room: ${class_level}`);
      sendMembersList(class_level);

      // Immediately notify active call
      if (activeCalls.has(class_level)) {
        socket.emit('incoming_call', activeCalls.get(class_level));
      }
    });

    // Listen for leaving chat room presence
    socket.on('leave_room_chat', () => {
      removeUserFromRooms(socket.id);
    });

    // Listen for typing indicators
    socket.on('typing_status', (data) => {
      const { class_level, sender_name, is_typing } = data;
      socket.to(class_level).emit('typing_status', { sender_name, is_typing });
    });

    // Listen for message reactions
    socket.on('add_reaction', async (data) => {
      try {
        const { message_id, class_level, emoji, sender_name } = data;
        
        // Find message
        const message = await ChatMessage.findById(message_id);
        if (!message) return;

        // If user already reacted with this emoji, toggle it off (remove it)
        const existingIndex = message.reactions.findIndex(
          (r) => r.emoji === emoji && r.sender_name === sender_name
        );

        if (existingIndex > -1) {
          // Remove reaction
          message.reactions.splice(existingIndex, 1);
        } else {
          // Add new reaction (and optionally remove any other reaction by this user on this message)
          message.reactions.push({ emoji, sender_name });
        }

        await message.save();

        // Broadcast update to all clients in the room
        io.to(class_level).emit('message_reaction_updated', {
          message_id,
          reactions: message.reactions
        });
      } catch (error) {
        console.error('Socket error in add_reaction:', error.message);
      }
    });

    // Listen for send_message
    socket.on('send_message', async (data) => {
      try {
        const { class_level, sender_name, sender_role, message_text, reply_to } = data;

        // Save message to MongoDB
        let chatMsg = await ChatMessage.create({
          class_level,
          sender_name,
          sender_role,
          message_text,
          reply_to: reply_to || null
        });

        if (reply_to) {
          chatMsg = await ChatMessage.findById(chatMsg._id).populate('reply_to');
        }

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
      removeUserFromRooms(socket.id);
      
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
