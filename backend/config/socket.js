import { Server } from 'socket.io';
import jwt from 'jsonwebtoken';
import ChatMessage from '../models/ChatMessage.js';
import User from '../models/User.js';
import SpecialBatch from '../models/SpecialBatch.js';

const activeCalls = new Map(); // normalizedRoom -> callDetails
const callParticipants = new Map(); // normalizedRoom -> Map<socketId, { socketId, name, role, userId }>
const roomMembers = new Map(); // normalizedRoom -> Map<socketId, { sender_id, sender_name, sender_role }>
let ioInstance = null;

export const getIO = () => ioInstance;

export const disconnectUserSockets = (userId) => {
  try {
    if (!ioInstance || !userId) return;
    ioInstance.in(`AUTH_USER_${String(userId)}`).disconnectSockets(true);
  } catch (err) {
    console.error('[Socket Disconnect User Error]:', err.message);
  }
};

const MAX_PLAIN_MESSAGE_LEN = 4000;
const MAX_ATTACHMENT_MESSAGE_LEN = 6.5 * 1024 * 1024;
const MAX_EMOJI_LEN = 16;
const MAX_REACTIONS_PER_MESSAGE = 200;

const allowSocketEvent = (socket, bucket, limit, windowMs) => {
  if (!socket.data.rateBuckets) socket.data.rateBuckets = new Map();
  const now = Date.now();
  const cutoff = now - windowMs;
  const recent = (socket.data.rateBuckets.get(bucket) || []).filter(ts => ts > cutoff);
  if (recent.length >= limit) {
    socket.data.rateBuckets.set(bucket, recent);
    return false;
  }
  recent.push(now);
  socket.data.rateBuckets.set(bucket, recent);
  return true;
};

const normalizeRoom = (rawRoom) => {
  if (rawRoom === null || rawRoom === undefined) return '';
  const trimmed = String(rawRoom).trim();
  if (!trimmed) return '';
  if (/^batch_[0-9a-fA-F]{24}$/i.test(trimmed)) {
    return `BATCH_${trimmed.slice(6)}`;
  }
  if (/^user_[0-9a-fA-F]{24}$/i.test(trimmed)) {
    return `USER_${trimmed.slice(5)}`;
  }
  return trimmed.toUpperCase();
};

const isStaffUser = (user) => Boolean(user && (user.role === 'SuperAdmin' || user.role === 'Teacher'));

const getSocketSender = (user) => ({
  sender_id: String(user._id),
  sender_role: user.role,
  sender_name:
    user.studentProfile?.name ||
    (user.role === 'SuperAdmin' ? 'Admin' : (user.email ? user.email.split('@')[0] : 'Teacher'))
});

export const initSocket = (server) => {
  const allowedOrigins = process.env.CORS_ORIGINS
    ? process.env.CORS_ORIGINS.split(',').map(o => o.trim()).filter(Boolean)
    : '*';

  const io = new Server(server, {
    maxHttpBufferSize: 8 * 1024 * 1024, // 8 MB for chat/attachment payloads
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
      const token = socket.handshake.auth?.token || bearerToken;

      if (!token) {
        return next(new Error('Authentication required'));
      }

      const decoded = jwt.verify(String(token), process.env.JWT_SECRET);
      const user = await User.findById(decoded.id).select('-password').populate('studentProfile', 'class_level name');
      if (!user) {
        return next(new Error('User not found'));
      }
      if ((decoded.tv ?? 0) !== (user.tokenVersion || 0)) {
        return next(new Error('Session invalidated'));
      }

      socket.user = user;
      next();
    } catch (err) {
      next(new Error('Invalid or expired authentication token'));
    }
  });

  const canJoinRoom = async (user, rawRoom) => {
    if (!user || !rawRoom) return false;
    const room = normalizeRoom(rawRoom);
    if (!room) return false;

    if (isStaffUser(user)) return true;

    // Restricted staff-only rooms
    if (room === 'GATE_MONITOR') return false;

    const ownStudentId = user.studentProfile?._id?.toString() || user.studentProfile?.toString() || '';

    // Personal student room: only the owning student may join
    if (room.startsWith('USER_')) {
      const targetStudentId = room.slice(5);
      return Boolean(ownStudentId && targetStudentId === ownStudentId);
    }

    // Broadcast room
    if (room === 'ALL') return true;

    // Special batch room: verify student enrollment in SpecialBatch
    if (room.startsWith('BATCH_')) {
      const batchId = room.slice(6);
      if (!ownStudentId || !/^[0-9a-fA-F]{24}$/.test(batchId)) {
        return false;
      }
      const enrolled = await SpecialBatch.exists({ _id: batchId, students: ownStudentId });
      return Boolean(enrolled);
    }

    // Standard class room: only the student's own class
    const ownClass = user.studentProfile?.class_level?.trim().toUpperCase();
    return Boolean(ownClass && room === ownClass);
  };

  const sendMembersList = (room) => {
    const membersMap = roomMembers.get(room);
    const membersList = membersMap ? Array.from(membersMap.values()) : [];
    // De-duplicate members by sender_id
    const uniqueMembers = [];
    const seen = new Set();
    for (const m of membersList) {
      if (!seen.has(m.sender_id)) {
        seen.add(m.sender_id);
        uniqueMembers.push(m);
      }
    }
    io.to(room).emit('room_members', { class_level: room, members: uniqueMembers });
  };

  const removeUserFromRooms = (socketId) => {
    for (const [room, members] of roomMembers.entries()) {
      if (members.has(socketId)) {
        members.delete(socketId);
        sendMembersList(room);
        if (members.size === 0) {
          roomMembers.delete(room);
        }
      }
    }
  };

  const removeSocketFromCall = (room, socketId) => {
    const participants = callParticipants.get(room);
    if (!participants || !participants.has(socketId)) return;
    participants.delete(socketId);
    for (const peer of participants.values()) {
      io.to(peer.socketId).emit('call_peer_left', {
        class_level: room,
        socketId
      });
    }
    if (participants.size === 0) {
      callParticipants.delete(room);
    }
  };

  io.on('connection', (socket) => {
    console.log(`Socket connected: ${socket.id} (${socket.user?.email} / ${socket.user?.role})`);
    if (socket.user?._id) {
      socket.join(`AUTH_USER_${String(socket.user._id)}`);
    }

    // Listen for join_room (with strict RBAC authorization)
    socket.on('join_room', async (class_level) => {
      try {
        const room = normalizeRoom(class_level);
        if (!room) return;

        if (!(await canJoinRoom(socket.user, room))) {
          console.warn(`[Socket Auth] Blocked ${socket.user?.email} (${socket.user?.role}) from joining room: ${room}`);
          return;
        }

        socket.join(room);
        if (room !== 'GATE_MONITOR' && !room.startsWith('USER_')) {
          socket.join('ALL');
        }
        console.log(`User ${socket.id} joined authorized room: ${room}`);

        // Immediately notify the user if there is an active call in this room
        if (activeCalls.has(room)) {
          socket.emit('incoming_call', activeCalls.get(room));
        }
      } catch (error) {
        console.error('Socket error in join_room:', error.message);
      }
    });

    // Listen for chat presence room joining
    socket.on('join_room_chat', async (data) => {
      try {
        const { class_level, is_hidden } = data || {};
        const room = normalizeRoom(class_level);
        if (!room || !(await canJoinRoom(socket.user, room))) {
          return;
        }

        const sender = getSocketSender(socket.user);
        const hidden = isStaffUser(socket.user) && Boolean(is_hidden);

        socket.join(room);
        removeUserFromRooms(socket.id);

        if (!hidden) {
          if (!roomMembers.has(room)) {
            roomMembers.set(room, new Map());
          }
          roomMembers.get(room).set(socket.id, sender);
          console.log(`User ${sender.sender_name} (${sender.sender_role}) joined chat presence for room: ${room}`);
        } else {
          console.log(`User ${sender.sender_name} (${sender.sender_role}) joined in STEALTH (HIDDEN) mode for room: ${room}`);
        }

        sendMembersList(room);

        if (activeCalls.has(room)) {
          socket.emit('incoming_call', activeCalls.get(room));
        }
      } catch (error) {
        console.error('Socket error in join_room_chat:', error.message);
      }
    });

    // Listen for toggle_incognito status changes
    socket.on('toggle_incognito', async (data) => {
      try {
        const { class_level, is_hidden } = data || {};
        const room = normalizeRoom(class_level);
        if (!room || !(await canJoinRoom(socket.user, room))) return;

        const sender = getSocketSender(socket.user);
        const hidden = isStaffUser(socket.user) && Boolean(is_hidden);

        removeUserFromRooms(socket.id);

        if (!hidden) {
          if (!roomMembers.has(room)) {
            roomMembers.set(room, new Map());
          }
          roomMembers.get(room).set(socket.id, sender);
          console.log(`User ${sender.sender_name} toggled active status to VISIBLE in room: ${room}`);
        } else {
          console.log(`User ${sender.sender_name} toggled active status to HIDDEN in room: ${room}`);
        }

        sendMembersList(room);
      } catch (error) {
        console.error('Socket error in toggle_incognito:', error.message);
      }
    });

    // Listen for leaving chat room presence
    socket.on('leave_room_chat', () => {
      removeUserFromRooms(socket.id);
    });

    // Listen for typing indicators
    socket.on('typing_status', async (data) => {
      try {
        const { class_level, is_typing } = data || {};
        const room = normalizeRoom(class_level);
        if (!room || !(await canJoinRoom(socket.user, room))) return;

        const sender = getSocketSender(socket.user);
        socket.to(room).emit('typing_status', {
          class_level: room,
          sender_id: sender.sender_id,
          sender_name: sender.sender_name,
          is_typing: Boolean(is_typing)
        });
      } catch (error) {
        console.error('Socket error in typing_status:', error.message);
      }
    });

    // Listen for message reactions (bounded emoji/count + per-socket rate limit + VersionError retry)
    socket.on('add_reaction', async (data) => {
      try {
        if (!allowSocketEvent(socket, 'reaction', 30, 10000)) return;
        const { message_id, class_level, emoji } = data || {};
        const room = normalizeRoom(class_level);
        if (!message_id || !room || typeof emoji !== 'string' || !emoji.trim()) return;
        const cleanEmoji = emoji.trim();
        if (cleanEmoji.length > MAX_EMOJI_LEN) return;
        if (!(await canJoinRoom(socket.user, room))) return;

        const sender = getSocketSender(socket.user);
        for (let attempt = 0; attempt < 3; attempt++) {
          const message = await ChatMessage.findById(message_id);
          if (!message) return;
          if (normalizeRoom(message.class_level) !== room) return;

          const existingIndex = message.reactions.findIndex((r) => {
            if (r.emoji !== cleanEmoji) return false;
            if (r.sender_id) return r.sender_id === sender.sender_id;
            return r.sender_name === sender.sender_name;
          });

          if (existingIndex > -1) {
            message.reactions.splice(existingIndex, 1);
          } else {
            if (message.reactions.length >= MAX_REACTIONS_PER_MESSAGE) return;
            message.reactions.push({
              emoji: cleanEmoji,
              sender_name: sender.sender_name,
              sender_id: sender.sender_id
            });
          }

          try {
            await message.save();
            io.to(room).emit('message_reaction_updated', {
              class_level: room,
              message_id,
              reactions: message.reactions
            });
            return;
          } catch (saveErr) {
            if (saveErr?.name === 'VersionError' && attempt < 2) continue;
            throw saveErr;
          }
        }
      } catch (error) {
        console.error('Socket error in add_reaction:', error.message);
      }
    });

    // Listen for send_message (same-room reply_to validation + size caps + per-socket rate limit)
    socket.on('send_message', async (data) => {
      try {
        if (!allowSocketEvent(socket, 'message', 20, 10000)) return;
        const { class_level, message_text, reply_to } = data || {};
        const room = normalizeRoom(class_level);
        if (!room || !(await canJoinRoom(socket.user, room))) return;

        // Block students from posting to global broadcast room
        if (room === 'ALL' && !isStaffUser(socket.user)) {
          return;
        }

        if (typeof message_text !== 'string' || message_text.trim().length === 0) {
          return;
        }

        let isAttachmentPayload = false;
        if (message_text.startsWith('{') && message_text.includes('"isAttachment":true')) {
          try {
            const parsed = JSON.parse(message_text);
            if (parsed && parsed.isAttachment === true && typeof parsed.content === 'string') {
              isAttachmentPayload = true;
            }
          } catch (_) {
            isAttachmentPayload = false;
          }
        }

        if (isAttachmentPayload) {
          if (!allowSocketEvent(socket, 'attachment', 4, 10000)) return;
          if (message_text.length > MAX_ATTACHMENT_MESSAGE_LEN) return;
        } else if (message_text.length > MAX_PLAIN_MESSAGE_LEN) {
          return;
        }

        // Prevent cross-room IDOR: only allow reply_to targeting a message inside the exact same room
        let validReplyTo = null;
        if (reply_to && /^[0-9a-fA-F]{24}$/.test(String(reply_to))) {
          const replyTarget = await ChatMessage.findById(reply_to).select('class_level').lean();
          if (replyTarget && normalizeRoom(replyTarget.class_level) === room) {
            validReplyTo = replyTarget._id;
          }
        }

        const sender = getSocketSender(socket.user);

        let chatMsg = await ChatMessage.create({
          class_level: room,
          sender_id: socket.user._id,
          sender_name: sender.sender_name,
          sender_role: sender.sender_role,
          message_text,
          reply_to: validReplyTo
        });

        if (validReplyTo) {
          chatMsg = await ChatMessage.findById(chatMsg._id).populate('reply_to');
        }

        io.to(room).emit('new_message', chatMsg);
      } catch (error) {
        console.error('Socket error in send_message:', error.message);
      }
    });

    // Listen for delete_message
    socket.on('delete_message', async (data) => {
      try {
        const { message_id, class_level } = data || {};
        const room = normalizeRoom(class_level);
        if (!message_id || !room || !(await canJoinRoom(socket.user, room))) return;

        const existingMsg = await ChatMessage.findById(message_id);
        if (!existingMsg) return;
        if (normalizeRoom(existingMsg.class_level) !== room) return;

        const sender = getSocketSender(socket.user);
        const canDelete =
          isStaffUser(socket.user) ||
          (existingMsg.sender_id && String(existingMsg.sender_id) === String(socket.user._id)) ||
          (!existingMsg.sender_id && existingMsg.sender_name === sender.sender_name);

        if (!canDelete) return;

        await ChatMessage.findByIdAndDelete(message_id);

        io.to(room).emit('message_deleted', message_id);
      } catch (error) {
        console.error('Socket error in delete_message:', error.message);
      }
    });

    // =========================================================================
    // Real WebRTC Voice Call Signaling
    // =========================================================================

    // Start a call (staff only)
    socket.on('start_call', async (data) => {
      try {
        if (!isStaffUser(socket.user)) return;
        const { class_level } = data || {};
        const room = normalizeRoom(class_level);
        if (!room || !(await canJoinRoom(socket.user, room))) return;

        const sender = getSocketSender(socket.user);
        const callData = {
          class_level: room,
          caller_name: sender.sender_name,
          hostEmail: socket.user?.email || '',
          hostSocketId: socket.id,
          startTime: Date.now()
        };

        activeCalls.set(room, callData);

        if (!callParticipants.has(room)) {
          callParticipants.set(room, new Map());
        }
        callParticipants.get(room).set(socket.id, {
          socketId: socket.id,
          name: sender.sender_name,
          role: sender.sender_role,
          userId: sender.sender_id
        });

        socket.to(room).emit('incoming_call', callData);
        console.log(`Incoming call notification sent in room ${room} from ${sender.sender_name} (Host: ${callData.hostEmail})`);
      } catch (error) {
        console.error('Socket error in start_call:', error.message);
      }
    });

    // Join an active voice call
    socket.on('join_call', async (data) => {
      try {
        const { class_level } = data || {};
        const room = normalizeRoom(class_level);
        if (!room || !(await canJoinRoom(socket.user, room))) return;
        if (!activeCalls.has(room)) return;

        const sender = getSocketSender(socket.user);
        if (!callParticipants.has(room)) {
          callParticipants.set(room, new Map());
        }
        const participantsMap = callParticipants.get(room);
        const existingPeers = Array.from(participantsMap.values()).filter(p => p.socketId !== socket.id);

        const joiner = {
          socketId: socket.id,
          name: sender.sender_name,
          role: sender.sender_role,
          userId: sender.sender_id
        };

        participantsMap.set(socket.id, joiner);

        // Send existing participants to joiner so they can initiate peer connections
        socket.emit('call_peers', {
          class_level: room,
          peers: existingPeers
        });

        // Notify existing participants about the newly joined peer
        for (const peer of existingPeers) {
          io.to(peer.socketId).emit('call_peer_joined', {
            class_level: room,
            peer: joiner
          });
        }
      } catch (error) {
        console.error('Socket error in join_call:', error.message);
      }
    });

    // Leave an active voice call
    socket.on('leave_call', (data) => {
      try {
        const { class_level } = data || {};
        const room = normalizeRoom(class_level);
        if (!room) return;
        removeSocketFromCall(room, socket.id);
      } catch (error) {
        console.error('Socket error in leave_call:', error.message);
      }
    });

    // Forward WebRTC SDP offer
    socket.on('webrtc_offer', (data) => {
      try {
        const { class_level, targetSocketId, offer } = data || {};
        const room = normalizeRoom(class_level);
        if (!room || !targetSocketId || !offer) return;

        const participants = callParticipants.get(room);
        if (!participants || !participants.has(socket.id) || !participants.has(targetSocketId)) return;

        const sender = getSocketSender(socket.user);
        io.to(targetSocketId).emit('webrtc_offer', {
          class_level: room,
          fromSocketId: socket.id,
          fromName: sender.sender_name,
          fromRole: sender.sender_role,
          offer
        });
      } catch (error) {
        console.error('Socket error in webrtc_offer:', error.message);
      }
    });

    // Forward WebRTC SDP answer
    socket.on('webrtc_answer', (data) => {
      try {
        const { class_level, targetSocketId, answer } = data || {};
        const room = normalizeRoom(class_level);
        if (!room || !targetSocketId || !answer) return;

        const participants = callParticipants.get(room);
        if (!participants || !participants.has(socket.id) || !participants.has(targetSocketId)) return;

        const sender = getSocketSender(socket.user);
        io.to(targetSocketId).emit('webrtc_answer', {
          class_level: room,
          fromSocketId: socket.id,
          fromName: sender.sender_name,
          fromRole: sender.sender_role,
          answer
        });
      } catch (error) {
        console.error('Socket error in webrtc_answer:', error.message);
      }
    });

    // Forward WebRTC ICE candidate
    socket.on('webrtc_ice_candidate', (data) => {
      try {
        const { class_level, targetSocketId, candidate } = data || {};
        const room = normalizeRoom(class_level);
        if (!room || !targetSocketId || !candidate) return;

        const participants = callParticipants.get(room);
        if (!participants || !participants.has(socket.id) || !participants.has(targetSocketId)) return;

        const sender = getSocketSender(socket.user);
        io.to(targetSocketId).emit('webrtc_ice_candidate', {
          class_level: room,
          fromSocketId: socket.id,
          fromName: sender.sender_name,
          fromRole: sender.sender_role,
          candidate
        });
      } catch (error) {
        console.error('Socket error in webrtc_ice_candidate:', error.message);
      }
    });

    // End call (staff or call host only)
    socket.on('end_call', async (data) => {
      try {
        const { class_level } = data || {};
        const room = normalizeRoom(class_level);
        if (!room || !(await canJoinRoom(socket.user, room))) return;

        const currentCall = activeCalls.get(room);
        const canEnd = isStaffUser(socket.user) || (currentCall && currentCall.hostSocketId === socket.id);
        if (!canEnd) return;

        activeCalls.delete(room);
        callParticipants.delete(room);
        io.to(room).emit('call_ended', { class_level: room });
        console.log(`Call end broadcasted in room ${room}`);
      } catch (error) {
        console.error('Socket error in end_call:', error.message);
      }
    });

    socket.on('disconnect', () => {
      console.log(`Socket disconnected: ${socket.id}`);
      removeUserFromRooms(socket.id);

      // Remove socket from any active call participant rosters
      for (const room of Array.from(callParticipants.keys())) {
        removeSocketFromCall(room, socket.id);
      }

      // Terminate any calls hosted by this socket after a 5-second grace period
      for (const [room, callData] of activeCalls.entries()) {
        if (callData.hostSocketId === socket.id) {
          setTimeout(() => {
            const currentCall = activeCalls.get(room);
            if (currentCall && currentCall.hostSocketId === socket.id) {
              activeCalls.delete(room);
              callParticipants.delete(room);
              io.to(room).emit('call_ended', { class_level: room });
              console.log(`Grace period expired. Host disconnected, active call ended in room ${room}`);
            }
          }, 5000);
        }
      }
    });
  });

  return io;
};
