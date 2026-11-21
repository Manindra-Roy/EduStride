import { Server } from 'socket.io';
import jwt from 'jsonwebtoken';
import ChatMessage from '../models/ChatMessage.js';
import User from '../models/User.js';

const activeCalls = new Map(); // class_level -> callDetails
const roomMembers = new Map(); // class_level -> Map of socket.id -> { sender_name, sender_role }
let ioInstance = null;

export const getIO = () => ioInstance;

export const initSocket = (server) => {
  const allowedOrigins = process.env.CORS_ORIGINS
    ? process.env.CORS_ORIGINS.split(',').map(o => o.trim()).filter(Boolean)
    : '*';

  const io = new Server(server, {
    cors: {
      origin: allowedOrigins,
      methods: ['GET', 'POST']
    }
  });
  ioInstance = io;

  // Enforce JWT authentication on every Socket.IO connection
  io.use(async (socket, next) => {
    try {
      const authHeader = socket.handshake.headers?.authorization;
      const bearerToken = authHeader && authHeader.startsWith('Bearer ')
        ? authHeader.slice(7).trim()
        : null;
      const token = socket.handshake.auth?.token || bearerToken || socket.handshake.query?.token;

      if (!token) {
        return next(new Error('Authentication required'));
      }

      const decoded = jwt.verify(String(token), process.env.JWT_SECRET || 'fallback_secret_key_123');
      const user = await User.findById(decoded.id).select('-password').populate('studentProfile', 'class_level name');
      if (!user) {
        return next(new Error('User not found'));
      }

      socket.user = user;
      next();
    } catch (err) {
      next(new Error('Invalid or expired authentication token'));
    }
  });

  const isStaffUser = (user) => user && (user.role === 'SuperAdmin' || user.role === 'Teacher');

  const canJoinRoom = (user, rawRoom) => {
    if (!user || !rawRoom) return false;
    const clean = String(rawRoom).trim();
    const upper = clean.toUpperCase();

    if (isStaffUser(user)) return true;

    // Restricted staff-only rooms
    if (upper === 'GATE_MONITOR') return false;

    // Personal student room: only the owning student may join
    if (upper.startsWith('USER_')) {
      const targetStudentId = clean.slice(5);
      const ownStudentId = user.studentProfile?._id?.toString() || user.studentProfile?.toString() || '';
      return Boolean(ownStudentId && targetStudentId === ownStudentId);
    }

    // Broadcast room, special batches, or the student's own class
    if (upper === 'ALL' || upper.startsWith('BATCH_')) return true;

    const ownClass = user.studentProfile?.class_level?.trim().toUpperCase();
    return Boolean(ownClass && upper === ownClass);
  };

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
        if (members.size === 0) {
          roomMembers.delete(class_level);
        }
      }
    }
  };

  io.on('connection', (socket) => {
    console.log(`Socket connected: ${socket.id} (${socket.user?.email} / ${socket.user?.role})`);

    // Listen for join_room (with strict RBAC authorization)
    socket.on('join_room', (class_level) => {
      if (!class_level) return;
      const cleanLevel = class_level.toString().trim();
      const upperLevel = cleanLevel.toUpperCase();

      if (!canJoinRoom(socket.user, cleanLevel)) {
        console.warn(`[Socket Auth] Blocked ${socket.user?.email} (${socket.user?.role}) from joining room: ${cleanLevel}`);
        return;
      }

      socket.join(cleanLevel);
      socket.join(upperLevel);
      if (upperLevel !== 'GATE_MONITOR' && !upperLevel.startsWith('USER_')) {
        socket.join('ALL');
      }
      console.log(`User ${socket.id} joined authorized room: ${cleanLevel}`);

      // Immediately notify the user if there is an active call in this room
      if (activeCalls.has(upperLevel) || activeCalls.has(cleanLevel)) {
        const callInfo = activeCalls.get(upperLevel) || activeCalls.get(cleanLevel);
        socket.emit('incoming_call', callInfo);
      }
    });

    // Listen for chat presence room joining
    socket.on('join_room_chat', (data) => {
      const { class_level, sender_name, sender_role, is_hidden } = data || {};
      if (!class_level || !canJoinRoom(socket.user, class_level)) {
        return;
      }
      socket.join(class_level);
      
      // Remove from any other rooms first
      removeUserFromRooms(socket.id);
      
      if (!is_hidden) {
        if (!roomMembers.has(class_level)) {
          roomMembers.set(class_level, new Map());
        }
        roomMembers.get(class_level).set(socket.id, {
          sender_name,
          sender_role: socket.user?.role || sender_role
        });
        console.log(`User ${sender_name} (${socket.user?.role || sender_role}) joined chat presence for room: ${class_level}`);
      } else {
        console.log(`User ${sender_name} (${socket.user?.role || sender_role}) joined in STEALTH (HIDDEN) mode for room: ${class_level}`);
      }
      
      sendMembersList(class_level);

      // Immediately notify active call
      const upperLevel = typeof class_level === 'string' ? class_level.trim().toUpperCase() : class_level;
      if (activeCalls.has(class_level) || activeCalls.has(upperLevel)) {
        socket.emit('incoming_call', activeCalls.get(class_level) || activeCalls.get(upperLevel));
      }
    });

    // Listen for toggle_incognito status changes
    socket.on('toggle_incognito', (data) => {
      const { class_level, sender_name, sender_role, is_hidden } = data || {};
      if (!class_level || !canJoinRoom(socket.user, class_level)) return;
      removeUserFromRooms(socket.id);

      if (!is_hidden) {
        if (!roomMembers.has(class_level)) {
          roomMembers.set(class_level, new Map());
        }
        roomMembers.get(class_level).set(socket.id, {
          sender_name,
          sender_role: socket.user?.role || sender_role
        });
        console.log(`User ${sender_name} toggled active status to VISIBLE in room: ${class_level}`);
      } else {
        console.log(`User ${sender_name} toggled active status to HIDDEN in room: ${class_level}`);
      }

      sendMembersList(class_level);
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
        const { class_level, sender_name, sender_role, message_text, reply_to } = data || {};
        if (!class_level || !canJoinRoom(socket.user, class_level)) return;

        // Save message to MongoDB
        let chatMsg = await ChatMessage.create({
          class_level,
          sender_name,
          sender_role: socket.user?.role || sender_role,
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
        const { message_id, class_level } = data || {};
        if (!message_id || !class_level || !canJoinRoom(socket.user, class_level)) return;

        // Only staff or the message sender may delete a message
        const existingMsg = await ChatMessage.findById(message_id);
        if (!existingMsg) return;
        const ownName = socket.user?.studentProfile?.name || socket.user?.email;
        if (!isStaffUser(socket.user) && existingMsg.sender_name !== ownName) {
          return;
        }

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
        const { class_level, caller_name, hostEmail } = data || {};
        if (!class_level || !canJoinRoom(socket.user, class_level)) return;
        const callData = { class_level, caller_name, hostEmail: socket.user?.email || hostEmail, hostSocketId: socket.id, startTime: Date.now() };
        activeCalls.set(class_level, callData);
        socket.to(class_level).emit('incoming_call', callData);
        console.log(`Incoming call notification sent in room ${class_level} from ${caller_name} (Host: ${callData.hostEmail})`);
      } catch (error) {
        console.error('Socket error in start_call:', error.message);
      }
    });

    // Listen for end_call
    socket.on('end_call', (data) => {
      try {
        const { class_level } = data || {};
        if (!class_level || !canJoinRoom(socket.user, class_level)) return;
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
