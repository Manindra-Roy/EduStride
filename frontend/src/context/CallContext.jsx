import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';
import axios from 'axios';
import { useLocation, useNavigate } from 'react-router-dom';
import { socket } from '../config/socket';
import { useAuth } from './AuthContext';
import { getDisplayName } from '../utils/istDate';
import { Phone, Mic, MicOff, PhoneOff, Maximize2, Radio, MessageSquare, BookOpen, Bell, X } from 'lucide-react';

const CallContext = createContext(null);

const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' }
];

const RemoteAudioPlayer = ({ stream }) => {
  const audioRef = useRef(null);

  useEffect(() => {
    const el = audioRef.current;
    if (!el || !stream) return;
    el.srcObject = stream;
    const playPromise = el.play();
    if (playPromise && typeof playPromise.catch === 'function') {
      playPromise.catch(() => {});
    }
    return () => {
      if (el) el.srcObject = null;
    };
  }, [stream]);

  return <audio ref={audioRef} autoPlay playsInline className="hidden" />;
};

export const CallProvider = ({ children }) => {
  const { user, loading: authLoading, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  const [activeCall, setActiveCall] = useState(null); // { stream: MediaStream, room: string }
  const [isMuted, setIsMuted] = useState(false);
  const [callDuration, setCallDuration] = useState(0);
  const [incomingCall, setIncomingCall] = useState(null); // { caller_name, class_level, hostEmail }
  const [activeRoomCall, setActiveRoomCall] = useState(null); // { caller_name, class_level, hostEmail }
  const [isCallHost, setIsCallHost] = useState(false);
  const [currentRoom, setCurrentRoom] = useState('');
  const [remoteStreams, setRemoteStreams] = useState([]); // [{ socketId, name, role, stream }]

  const callTimerRef = useRef(null);
  const activeCallRef = useRef(null);
  const activeCallRoomRef = useRef('');
  const activeRoomCallRef = useRef(null);
  const isCallHostRef = useRef(false);
  const currentRoomRef = useRef('');
  const pathnameRef = useRef(location.pathname);
  const audioCtxRef = useRef(null);
  const toastTimersRef = useRef(new Map());
  const userRef = useRef(user);
  const peerConnectionsRef = useRef(new Map()); // Map<socketId, RTCPeerConnection>
  const pendingIceCandidatesRef = useRef(new Map()); // Map<socketId, RTCIceCandidateInit[]>
  const startingCallRef = useRef(false);

  useEffect(() => {
    userRef.current = user;
  }, [user]);

  useEffect(() => {
    pathnameRef.current = location.pathname;
  }, [location.pathname]);

  useEffect(() => {
    activeCallRef.current = activeCall;
  }, [activeCall]);

  useEffect(() => {
    activeRoomCallRef.current = activeRoomCall;
  }, [activeRoomCall]);

  useEffect(() => {
    isCallHostRef.current = isCallHost;
  }, [isCallHost]);

  const closePeerConnection = useCallback((socketId, { preservePendingIce = false } = {}) => {
    const pc = peerConnectionsRef.current.get(socketId);
    if (pc) {
      try {
        pc.ontrack = null;
        pc.onicecandidate = null;
        pc.onconnectionstatechange = null;
        pc.close();
      } catch {
        // ignore
      }
      peerConnectionsRef.current.delete(socketId);
    }
    if (!preservePendingIce) {
      pendingIceCandidatesRef.current.delete(socketId);
    }
    setRemoteStreams(prev => prev.filter(s => s.socketId !== socketId));
  }, []);

  const closeAllPeerConnections = useCallback(() => {
    peerConnectionsRef.current.forEach((pc) => {
      try {
        pc.ontrack = null;
        pc.onicecandidate = null;
        pc.onconnectionstatechange = null;
        pc.close();
      } catch {
        // ignore
      }
    });
    peerConnectionsRef.current.clear();
    pendingIceCandidatesRef.current.clear();
    setRemoteStreams([]);
  }, []);

  const createPeerConnection = useCallback((targetSocketId, peerMeta, room) => {
    closePeerConnection(targetSocketId, { preservePendingIce: true });

    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });

    const localStream = activeCallRef.current?.stream;
    if (localStream) {
      localStream.getTracks().forEach(track => {
        pc.addTrack(track, localStream);
      });
    }

    pc.onicecandidate = (event) => {
      if (event.candidate && socket.connected) {
        socket.emit('webrtc_ice_candidate', {
          class_level: room,
          targetSocketId,
          candidate: event.candidate
        });
      }
    };

    pc.ontrack = (event) => {
      const remoteStream = event.streams?.[0];
      if (!remoteStream) return;
      setRemoteStreams(prev => {
        const exists = prev.some(item => item.socketId === targetSocketId);
        if (exists) {
          return prev.map(item =>
            item.socketId === targetSocketId
              ? {
                  ...item,
                  stream: remoteStream,
                  name: peerMeta?.name || item.name,
                  role: peerMeta?.role || item.role
                }
              : item
          );
        }
        return [
          ...prev,
          {
            socketId: targetSocketId,
            name: peerMeta?.name || 'Participant',
            role: peerMeta?.role || '',
            stream: remoteStream
          }
        ];
      });
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
        closePeerConnection(targetSocketId);
      }
    };

    peerConnectionsRef.current.set(targetSocketId, pc);
    return pc;
  }, [closePeerConnection]);

  const handleEndCall = useCallback((terminateForAll = false) => {
    const callRoom = activeCallRoomRef.current || currentRoomRef.current;

    closeAllPeerConnections();

    if (activeCallRef.current && activeCallRef.current.stream) {
      activeCallRef.current.stream.getTracks().forEach(track => track.stop());
    }
    if (callTimerRef.current) {
      clearInterval(callTimerRef.current);
      callTimerRef.current = null;
    }

    if (socket.connected && activeCallRef.current && callRoom) {
      if (terminateForAll && isCallHostRef.current) {
        socket.emit('end_call', { class_level: callRoom });
        setActiveRoomCall(null);
      } else {
        socket.emit('leave_call', { class_level: callRoom });
      }
    }

    activeCallRef.current = null;
    activeCallRoomRef.current = '';
    isCallHostRef.current = false;
    setActiveCall(null);
    setCallDuration(0);
    setIsCallHost(false);
    setIsMuted(false);
  }, [closeAllPeerConnections]);

  useEffect(() => {
    return () => {
      toastTimersRef.current.forEach((timerId) => clearTimeout(timerId));
      toastTimersRef.current.clear();
      if (callTimerRef.current) clearInterval(callTimerRef.current);
      closeAllPeerConnections();
      if (activeCallRef.current && activeCallRef.current.stream) {
        activeCallRef.current.stream.getTracks().forEach(track => track.stop());
      }
      if (audioCtxRef.current && audioCtxRef.current.state !== 'closed') {
        audioCtxRef.current.close().catch(() => {});
      }
    };
  }, [closeAllPeerConnections]);

  useEffect(() => {
    currentRoomRef.current = currentRoom;
    if (activeCallRef.current && activeCallRoomRef.current && currentRoom && activeCallRoomRef.current !== currentRoom) {
      handleEndCall(false);
    }
    setIncomingCall(prev => (prev && currentRoom && prev.class_level !== currentRoom ? null : prev));
    setActiveRoomCall(prev => (prev && currentRoom && prev.class_level !== currentRoom ? null : prev));
  }, [currentRoom, handleEndCall]);

  const [toasts, setToasts] = useState([]);
  const [allowOnScreenToasts, setAllowOnScreenToasts] = useState(() => localStorage.getItem('edustride_onscreen_toasts') !== 'false');
  const allowOnScreenToastsRef = useRef(allowOnScreenToasts);

  useEffect(() => {
    allowOnScreenToastsRef.current = allowOnScreenToasts;
  }, [allowOnScreenToasts]);

  const toggleOnScreenToasts = useCallback(() => {
    setAllowOnScreenToasts(prev => {
      const nextVal = !prev;
      allowOnScreenToastsRef.current = nextVal;
      localStorage.setItem('edustride_onscreen_toasts', nextVal.toString());
      return nextVal;
    });
  }, []);

  const playNotificationSound = useCallback(() => {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      if (!audioCtxRef.current || audioCtxRef.current.state === 'closed') {
        audioCtxRef.current = new AudioCtx();
      }
      const ctx = audioCtxRef.current;
      if (ctx.state === 'suspended') {
        ctx.resume().catch(() => {});
      }
      const osc1 = ctx.createOscillator();
      const osc2 = ctx.createOscillator();
      const gain = ctx.createGain();

      // Triad Chime: D5 (587Hz) -> A5 (880Hz)
      osc1.type = 'sine';
      osc1.frequency.setValueAtTime(587.33, ctx.currentTime);
      osc1.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.15);

      osc2.type = 'sine';
      osc2.frequency.setValueAtTime(739.99, ctx.currentTime + 0.05); // F#5
      osc2.frequency.exponentialRampToValueAtTime(1174.66, ctx.currentTime + 0.22); // D6

      gain.gain.setValueAtTime(0.14, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.32);

      osc1.connect(gain);
      osc2.connect(gain);
      gain.connect(ctx.destination);

      osc1.start();
      osc2.start(ctx.currentTime + 0.05);
      osc1.stop(ctx.currentTime + 0.32);
      osc2.stop(ctx.currentTime + 0.32);
    } catch {
      // Audio autoplay policy catch
    }
  }, []);

  const clearAllToasts = useCallback(() => {
    toastTimersRef.current.forEach((timerId) => clearTimeout(timerId));
    toastTimersRef.current.clear();
    setToasts([]);
  }, []);

  const removeToast = useCallback((id) => {
    setToasts(prev => {
      const target = prev.find(t => t.id === id);
      if (target && target.timerKey && toastTimersRef.current.has(target.timerKey)) {
        clearTimeout(toastTimersRef.current.get(target.timerKey));
        toastTimersRef.current.delete(target.timerKey);
      }
      return prev.filter(t => t.id !== id);
    });
  }, []);

  const addToast = useCallback(({ id, title, description, type, link, class_level }) => {
    if (!allowOnScreenToastsRef.current) return;
    playNotificationSound();

    const isCoalescedChat = type === 'chat' && Boolean(class_level);
    const generatedId = isCoalescedChat
      ? `chat-${class_level}`
      : (id || `toast-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
    const timerKey = generatedId;
    const now = Date.now();

    setToasts(prev => {
      if (isCoalescedChat) {
        const existingIndex = prev.findIndex(t => t.type === 'chat' && t.class_level === class_level);
        if (existingIndex > -1) {
          const existing = prev[existingIndex];
          const count = (existing.count || 1) + 1;
          const updated = {
            ...existing,
            title: `${count} New Messages in Class ${class_level}`,
            description,
            count,
            timerKey,
            createdAt: now
          };
          const copy = [...prev];
          copy[existingIndex] = updated;
          return copy;
        }
      }

      const filtered = prev.filter(t => t.id !== generatedId);
      return [...filtered, { id: generatedId, timerKey, title, description, type, link, class_level, count: 1, createdAt: now }].slice(-2);
    });

    if (toastTimersRef.current.has(timerKey)) {
      clearTimeout(toastTimersRef.current.get(timerKey));
    }
    const timerHandle = setTimeout(() => {
      toastTimersRef.current.delete(timerKey);
      setToasts(prev => prev.filter(t => t.timerKey !== timerKey));
    }, 4500);
    toastTimersRef.current.set(timerKey, timerHandle);
  }, [playNotificationSound]);

  const sendBrowserNotification = useCallback((title, body, tag, icon, link) => {
    if (window.AndroidNotificationBridge && typeof window.AndroidNotificationBridge.showNotification === 'function') {
      try {
        window.AndroidNotificationBridge.showNotification(title, body, tag || '');
        return;
      } catch (err) {
        console.error('Failed to trigger Android notification bridge:', err);
      }
    }

    if ('Notification' in window && Notification.permission === 'granted') {
      try {
        const notif = new Notification(title, {
          body,
          tag,
          icon: icon || '/favicon.jpg',
          renotify: true
        });
        notif.onclick = () => {
          window.focus();
          if (link) {
            if (tag && tag.startsWith('chat-')) {
              const roomName = tag.slice(5);
              if (roomName) setCurrentRoom(roomName);
            }
            navigate(link);
          }
          notif.close();
        };
      } catch (err) {
        console.error('Failed to trigger Notification:', err);
      }
    }
  }, [navigate]);

  const userId = user?.id || user?._id || null;
  const userRole = user?.role || null;
  const studentProfileId = user?.studentProfile?._id || (typeof user?.studentProfile === 'string' ? user.studentProfile : null);
  const studentClassLevel = user?.studentProfile?.class_level || null;

  // Global socket calling, WebRTC signaling & notification events listener
  useEffect(() => {
    // Wait until initial /api/auth/me resolves so page reload never wipes Android background sync session
    if (authLoading) return;

    if (!userId) {
      handleEndCall(false);
      setIncomingCall(null);
      setActiveRoomCall(null);
      setCurrentRoom('');
      clearAllToasts();

      if (socket.connected) {
        socket.disconnect();
      }
      if (window.AndroidNotificationBridge && typeof window.AndroidNotificationBridge.logoutUser === 'function') {
        try {
          window.AndroidNotificationBridge.logoutUser();
        } catch (err) {
          console.error('Failed to logout native user:', err);
        }
      }
      return;
    }

    let effectCancelled = false;

    const syncNativeBridge = (roomsList) => {
      if (effectCancelled) return;
      const currentUser = userRef.current;
      if (window.AndroidNotificationBridge && currentUser) {
        try {
          const myName = getDisplayName(currentUser);
          const roomValue = roomsList.length > 0 ? roomsList.join(',') : (currentUser.studentProfile?.class_level || 'All');
          const socketUrl = import.meta.env.VITE_API_URL || window.location.origin;
          const authToken = localStorage.getItem('token') || '';
          if (typeof window.AndroidNotificationBridge.registerUserWithToken === 'function') {
            window.AndroidNotificationBridge.registerUserWithToken(currentUser.email, roomValue, myName, socketUrl, authToken);
          } else if (typeof window.AndroidNotificationBridge.registerUser === 'function') {
            window.AndroidNotificationBridge.registerUser(currentUser.email, roomValue, myName, socketUrl);
          }
        } catch (err) {
          console.error('Failed to register native user:', err);
        }
      }
    };

    const joinClassrooms = async () => {
      if (effectCancelled || !socket.connected) return;
      const joinedRooms = new Set();
      if (userRole === 'Student') {
        if (studentClassLevel) {
          socket.emit('join_room', studentClassLevel);
          socket.emit('join_room', studentClassLevel.trim().toUpperCase());
          joinedRooms.add(studentClassLevel.trim());
        }
        if (studentProfileId) {
          socket.emit('join_room', `USER_${studentProfileId}`);
          joinedRooms.add(`USER_${studentProfileId}`);
        }
        try {
          const batchRes = await axios.get('/api/special-batches');
          if (effectCancelled) return;
          if (batchRes.data.success && Array.isArray(batchRes.data.data)) {
            batchRes.data.data.forEach(b => {
              const bRoom = `BATCH_${b._id}`;
              socket.emit('join_room', bRoom);
              joinedRooms.add(bRoom);
            });
          }
        } catch {
          // Non-fatal: student still receives class notifications
        }
        if (effectCancelled) return;
        socket.emit('join_room', 'ALL');
      } else {
        socket.emit('join_room', 'ALL');
        joinedRooms.add('All');
        try {
          const res = await axios.get('/api/classes');
          if (effectCancelled) return;
          if (res.data.success && Array.isArray(res.data.data)) {
            res.data.data.forEach(room => {
              socket.emit('join_room', room);
              socket.emit('join_room', room.trim().toUpperCase());
              joinedRooms.add(room.trim());
            });
          } else {
            ['VII', 'VIII', 'IX', 'X'].forEach(room => {
              socket.emit('join_room', room);
              joinedRooms.add(room);
            });
          }
        } catch {
          if (effectCancelled) return;
          ['VII', 'VIII', 'IX', 'X'].forEach(room => {
            socket.emit('join_room', room);
            joinedRooms.add(room);
          });
        }
        try {
          const batchRes = await axios.get('/api/special-batches');
          if (effectCancelled) return;
          if (batchRes.data.success && Array.isArray(batchRes.data.data)) {
            batchRes.data.data.forEach(b => {
              const bRoom = `BATCH_${b._id}`;
              socket.emit('join_room', bRoom);
              joinedRooms.add(bRoom);
            });
          }
        } catch {
          // Non-fatal
        }
      }
      if (!effectCancelled) {
        syncNativeBridge(Array.from(joinedRooms));
      }
    };

    if (socket.connected) {
      joinClassrooms();
    } else {
      socket.connect();
    }

    const handleGlobalIncomingCall = (data) => {
      if (!data) return;
      playNotificationSound();
      if (pathnameRef.current !== '/chats' || currentRoomRef.current !== data.class_level) {
        setIncomingCall(data);
      }
      setActiveRoomCall(data);
    };

    const handleGlobalCallEnded = (data) => {
      if (!data) return;
      setIncomingCall(prev => (prev && prev.class_level === data.class_level ? null : prev));
      setActiveRoomCall(prev => (prev && prev.class_level === data.class_level ? null : prev));

      if (activeCallRef.current && (activeCallRoomRef.current === data.class_level || currentRoomRef.current === data.class_level)) {
        handleEndCall(false);
      }
    };

    const handleCallPeers = async (data) => {
      if (!activeCallRef.current || !data || !Array.isArray(data.peers)) return;
      const room = data.class_level || activeCallRoomRef.current || currentRoomRef.current;
      for (const peer of data.peers) {
        const targetId = peer?.socketId;
        if (!targetId || targetId === socket.id) continue;
        try {
          const pc = createPeerConnection(targetId, peer, room);
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          socket.emit('webrtc_offer', {
            class_level: room,
            targetSocketId: targetId,
            offer
          });
        } catch (err) {
          console.error('Failed to initiate WebRTC offer:', err);
        }
      }
    };

    const handleWebRtcOffer = async (data) => {
      if (!activeCallRef.current || !data?.fromSocketId || !data?.offer) return;
      const room = data.class_level || activeCallRoomRef.current || currentRoomRef.current;
      try {
        const pc = createPeerConnection(
          data.fromSocketId,
          { name: data.fromName, role: data.fromRole },
          room
        );
        await pc.setRemoteDescription(new RTCSessionDescription(data.offer));

        const queued = pendingIceCandidatesRef.current.get(data.fromSocketId) || [];
        for (const cand of queued) {
          await pc.addIceCandidate(new RTCIceCandidate(cand)).catch(() => {});
        }
        pendingIceCandidatesRef.current.delete(data.fromSocketId);

        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        socket.emit('webrtc_answer', {
          class_level: room,
          targetSocketId: data.fromSocketId,
          answer
        });
      } catch (err) {
        console.error('Failed to handle WebRTC offer:', err);
      }
    };

    const handleWebRtcAnswer = async (data) => {
      if (!data?.fromSocketId || !data?.answer) return;
      const pc = peerConnectionsRef.current.get(data.fromSocketId);
      if (!pc) return;
      try {
        await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
        const queued = pendingIceCandidatesRef.current.get(data.fromSocketId) || [];
        for (const cand of queued) {
          await pc.addIceCandidate(new RTCIceCandidate(cand)).catch(() => {});
        }
        pendingIceCandidatesRef.current.delete(data.fromSocketId);
      } catch (err) {
        console.error('Failed to handle WebRTC answer:', err);
      }
    };

    const handleWebRtcIceCandidate = async (data) => {
      if (!data?.fromSocketId || !data?.candidate) return;
      const pc = peerConnectionsRef.current.get(data.fromSocketId);
      if (pc && pc.remoteDescription) {
        await pc.addIceCandidate(new RTCIceCandidate(data.candidate)).catch(() => {});
      } else {
        const queued = pendingIceCandidatesRef.current.get(data.fromSocketId) || [];
        queued.push(data.candidate);
        pendingIceCandidatesRef.current.set(data.fromSocketId, queued);
      }
    };

    const handleCallPeerLeft = (data) => {
      if (data?.socketId) {
        closePeerConnection(data.socketId);
      }
    };

    const handleNewMessageGlobal = (msg) => {
      const currentUser = userRef.current;
      if (!currentUser || !msg) return;
      const currentUserId = currentUser.id || currentUser._id;
      const isSelf =
        (msg.sender_id && currentUserId && String(msg.sender_id) === String(currentUserId)) ||
        (!msg.sender_id && msg.sender_name === getDisplayName(currentUser));
      if (isSelf) return;

      const isChatPage = pathnameRef.current === '/chats';
      const isCurrentRoom = msg.class_level === currentRoomRef.current;
      const isTabVisible = !document.hidden;

      const shouldShowInAppToast = !isChatPage || !isCurrentRoom;
      const shouldShowBrowserNotification = !isTabVisible || !isChatPage || !isCurrentRoom;

      const previewText =
        typeof msg.message_text === 'string' && msg.message_text.startsWith('{"isAttachment":true')
          ? '📎 Sent an attachment'
          : msg.message_text;

      if (shouldShowInAppToast) {
        addToast({
          id: `chat-${msg._id}-${Date.now()}`,
          title: `New Message in Class ${msg.class_level}`,
          description: `${msg.sender_name}: ${previewText}`,
          type: 'chat',
          link: '/chats',
          class_level: msg.class_level
        });
      }

      if (shouldShowBrowserNotification) {
        sendBrowserNotification(
          `Class ${msg.class_level} Chat`,
          `${msg.sender_name}: ${previewText}`,
          `chat-${msg.class_level}`,
          null,
          '/chats'
        );
      }
    };

    const handleNewStudyMaterialGlobal = (data) => {
      const currentUser = userRef.current;
      if (!currentUser || !data) return;

      const isSpecialBatch = Boolean(data.isSpecialBatch || data.batchId);

      if (!isSpecialBatch && currentUser.role === 'Student') {
        const studentClass = currentUser.studentProfile?.class_level;
        if (studentClass && data.class_level && studentClass.trim().toUpperCase() !== data.class_level.trim().toUpperCase()) {
          return;
        }
      }

      const targetLink = isSpecialBatch
        ? (currentUser.role === 'Student' ? '/' : '/special-batches')
        : '/lms';
      const isOnTargetPage = pathnameRef.current === targetLink;
      const isTabVisible = !document.hidden;

      const shouldShowInAppToast = !isOnTargetPage;
      const shouldShowBrowserNotification = !isTabVisible || !isOnTargetPage;

      const batchLabel = data.batch_name || 'Special Batch';
      const itemTitle = data.chapter_name || data.title || 'New Handout';
      const subjectLabel = data.subject || 'General';

      if (shouldShowInAppToast) {
        addToast({
          id: `lms-${data.material?._id || data.batchId || Date.now()}`,
          title: isSpecialBatch
            ? `New Material: ${batchLabel}`
            : `New Study Material for Class ${data.class_level}`,
          description: `Subject: ${subjectLabel} - ${itemTitle}`,
          type: 'lms',
          link: targetLink
        });
      }

      if (shouldShowBrowserNotification) {
        sendBrowserNotification(
          isSpecialBatch ? `New Notes: ${batchLabel}` : `New Notes: Class ${data.class_level}`,
          `Subject: ${subjectLabel}\nTitle: ${itemTitle}`,
          `lms-${isSpecialBatch ? (data.batchId || 'batch') : (data.class_level || 'all')}`,
          null,
          targetLink
        );
      }
    };

    const handleNewNoticeGlobal = (data) => {
      const currentUser = userRef.current;
      if (!currentUser || !data) return;
      addToast({
        id: `notice-${Date.now()}`,
        title: `Academic Announcement: ${data.subject}`,
        description: data.body,
        type: 'notice',
        link: currentUser.role === 'SuperAdmin' ? '/automations' : '/'
      });
      sendBrowserNotification(
        `EduStride Notice: ${data.subject}`,
        data.body,
        `notice-${Date.now()}`,
        null,
        '/'
      );
    };

    const handleConnect = () => {
      console.log('Global Socket connected successfully:', socket.id);
      joinClassrooms();
    };

    const handleConnectError = (err) => {
      const msg = err?.message || '';
      console.error('Global Socket connection error:', msg);
      if (/invalid|expired|invalidated|authentication required|user not found/i.test(msg)) {
        socket.disconnect();
        logout();
      }
    };

    const handleDisconnect = (reason) => {
      console.warn('Global Socket disconnected:', reason);
    };

    socket.on('connect', handleConnect);
    socket.on('connect_error', handleConnectError);
    socket.on('disconnect', handleDisconnect);
    socket.on('incoming_call', handleGlobalIncomingCall);
    socket.on('call_ended', handleGlobalCallEnded);
    socket.on('call_peers', handleCallPeers);
    socket.on('webrtc_offer', handleWebRtcOffer);
    socket.on('webrtc_answer', handleWebRtcAnswer);
    socket.on('webrtc_ice_candidate', handleWebRtcIceCandidate);
    socket.on('call_peer_left', handleCallPeerLeft);
    socket.on('new_message', handleNewMessageGlobal);
    socket.on('new_study_material', handleNewStudyMaterialGlobal);
    socket.on('new_notice', handleNewNoticeGlobal);

    return () => {
      effectCancelled = true;
      socket.off('connect', handleConnect);
      socket.off('connect_error', handleConnectError);
      socket.off('disconnect', handleDisconnect);
      socket.off('incoming_call', handleGlobalIncomingCall);
      socket.off('call_ended', handleGlobalCallEnded);
      socket.off('call_peers', handleCallPeers);
      socket.off('webrtc_offer', handleWebRtcOffer);
      socket.off('webrtc_answer', handleWebRtcAnswer);
      socket.off('webrtc_ice_candidate', handleWebRtcIceCandidate);
      socket.off('call_peer_left', handleCallPeerLeft);
      socket.off('new_message', handleNewMessageGlobal);
      socket.off('new_study_material', handleNewStudyMaterialGlobal);
      socket.off('new_notice', handleNewNoticeGlobal);
    };
  }, [
    authLoading,
    userId,
    userRole,
    studentProfileId,
    studentClassLevel,
    logout,
    addToast,
    clearAllToasts,
    sendBrowserNotification,
    playNotificationSound,
    createPeerConnection,
    closePeerConnection,
    handleEndCall
  ]);

  const handleStartCall = useCallback(async (isHost = false, roomOverride = null) => {
    if (startingCallRef.current || activeCallRef.current) return;
    const targetRoom = roomOverride || currentRoomRef.current;
    const currentUser = userRef.current;
    if (!targetRoom || !currentUser) return;
    if (!socket.connected) {
      alert('Cannot start or join a call while disconnected. Please wait for reconnection.');
      return;
    }

    startingCallRef.current = true;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: false,
        audio: true
      });

      // Guard against logout, disconnect, or another call starting while permission dialog was open
      if (!userRef.current || !socket.connected || activeCallRef.current) {
        stream.getTracks().forEach(track => track.stop());
        return;
      }

      const callObj = { stream, room: targetRoom };
      activeCallRef.current = callObj;
      activeCallRoomRef.current = targetRoom;
      setActiveCall(callObj);
      setIsMuted(false);
      setCallDuration(0);

      const currentRoomCall = activeRoomCallRef.current;
      const isActuallyHost =
        Boolean(isHost) ||
        Boolean(currentRoomCall && currentRoomCall.class_level === targetRoom && currentRoomCall.hostEmail === currentUser.email);
      isCallHostRef.current = isActuallyHost;
      setIsCallHost(isActuallyHost);

      const callerName = getDisplayName(currentUser);

      if (isActuallyHost) {
        socket.emit('start_call', {
          class_level: targetRoom,
          caller_name: callerName,
          hostEmail: currentUser.email
        });
        setActiveRoomCall({
          class_level: targetRoom,
          caller_name: callerName,
          hostEmail: currentUser.email
        });
      } else {
        socket.emit('join_call', { class_level: targetRoom });
      }

      if (callTimerRef.current) clearInterval(callTimerRef.current);
      callTimerRef.current = setInterval(() => {
        setCallDuration(prev => prev + 1);
      }, 1000);
    } catch (err) {
      console.error('Failed to get media devices:', err);
      alert('Could not access microphone. Please check system permissions.');
    } finally {
      startingCallRef.current = false;
    }
  }, []);

  const joinCallInRoom = useCallback((room) => {
    if (!room) return;
    setCurrentRoom(room);
    currentRoomRef.current = room;
    return handleStartCall(false, room);
  }, [handleStartCall]);

  const toggleMute = useCallback(() => {
    if (activeCallRef.current && activeCallRef.current.stream) {
      const audioTracks = activeCallRef.current.stream.getAudioTracks();
      audioTracks.forEach(track => {
        track.enabled = !track.enabled;
      });
      setIsMuted(prev => !prev);
    }
  }, []);

  const formatCallDuration = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <CallContext.Provider value={{
      activeCall,
      isMuted,
      callDuration,
      incomingCall,
      setIncomingCall,
      activeRoomCall,
      setActiveRoomCall,
      isCallHost,
      currentRoom,
      setCurrentRoom,
      remoteStreams,
      remoteParticipants: remoteStreams.length,
      handleStartCall,
      joinCallInRoom,
      handleEndCall,
      toggleMute,
      formatCallDuration,
      addToast,
      removeToast,
      toasts,
      allowOnScreenToasts,
      toggleOnScreenToasts
    }}>
      {children}

      {/* Hidden WebRTC Remote Audio Streams */}
      {remoteStreams.map((rs) => (
        <RemoteAudioPlayer key={rs.socketId} stream={rs.stream} />
      ))}

      {/* Unified Top-Right Notification Stack (Incoming Call Banner + Toasts) */}
      <div className="fixed top-4 sm:top-5 right-4 sm:right-6 z-[200] flex flex-col gap-2.5 max-w-xs sm:max-w-sm w-[calc(100%-2rem)] sm:w-80 pointer-events-none">
        {/* Global Incoming Call Notification Banner */}
        {incomingCall && location.pathname !== '/chats' && !activeCall && (
          <div className="pointer-events-auto w-full bg-dark-900/95 backdrop-blur-md border border-emerald-500/30 p-3.5 sm:p-4 rounded-2xl flex items-center justify-between gap-3 sm:gap-4 shadow-2xl animate-scaleUp text-slate-100 select-none">
            <div className="flex items-center gap-3 min-w-0">
              <div className="p-3 sm:p-3.5 rounded-xl bg-emerald-600/10 text-emerald-400 border border-emerald-500/10 relative shrink-0">
                <span className="absolute -top-0.5 -right-0.5 flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-450 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                </span>
                <Phone size={18} />
              </div>
              <div className="min-w-0">
                <h4 className="text-xs font-bold text-white font-outfit truncate">Active Voice Call</h4>
                <p className="text-[10px] text-slate-400 mt-0.5 leading-snug line-clamp-2">
                  {incomingCall.caller_name} is broadcasting in Class {incomingCall.class_level} Lounge.
                </p>
              </div>
            </div>
            <div className="flex flex-col gap-1.5 shrink-0">
              <button
                onClick={() => {
                  const targetRoom = incomingCall.class_level;
                  setIncomingCall(null);
                  navigate('/chats', {
                    state: { targetRoom, autoJoinCall: true }
                  });
                }}
                className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-555 text-[10px] font-bold text-white transition cursor-pointer text-center active:scale-95"
              >
                Join Call
              </button>
              <button
                onClick={() => setIncomingCall(null)}
                className="px-3 py-1.5 rounded-lg bg-dark-955/60 border border-dark-800 hover:bg-dark-800 text-[10px] font-semibold text-slate-400 hover:text-white transition cursor-pointer text-center active:scale-95"
              >
                Dismiss
              </button>
            </div>
          </div>
        )}

        {/* Toast Notifications Queue */}
        {toasts.length > 1 && (
          <div className="flex justify-end pointer-events-auto">
            <button
              onClick={clearAllToasts}
              className="text-[9px] font-bold font-mono uppercase tracking-wider px-2 py-0.5 rounded-full bg-dark-900/90 border border-dark-800 text-slate-400 hover:text-white transition cursor-pointer shadow-md backdrop-blur-md"
            >
              Clear All ({toasts.length})
            </button>
          </div>
        )}
        {toasts.map((toast) => {
          const Icon = toast.type === 'chat' ? MessageSquare : toast.type === 'notice' ? Bell : BookOpen;
          const categoryLabel = toast.type === 'chat' ? 'CHAT' : toast.type === 'notice' ? 'ANNOUNCEMENT' : 'LIBRARY';
          const iconBg = toast.type === 'chat' 
            ? 'bg-primary-500/10 text-primary-400 border-primary-500/20' 
            : toast.type === 'notice' 
              ? 'bg-amber-500/10 text-amber-400 border-amber-500/20' 
              : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20';

          return (
            <div 
              key={toast.id} 
              className="pointer-events-auto w-full bg-dark-900/95 backdrop-blur-xl border border-dark-800 p-3 rounded-2xl flex flex-col gap-2 shadow-xl shadow-black/70 animate-scaleUp text-slate-100 select-none cursor-pointer hover:border-slate-700/80 transition-all duration-200 relative overflow-hidden group"
              onClick={() => {
                if (toast.link) {
                  if (toast.type === 'chat' && toast.class_level) {
                    setCurrentRoom(toast.class_level);
                  }
                  navigate(toast.link);
                }
                removeToast(toast.id);
              }}
            >
              <div className="flex items-start justify-between gap-2.5">
                <div className="flex items-start gap-2.5 overflow-hidden">
                  <div className={`p-2 rounded-xl ${iconBg} border shrink-0 shadow-sm mt-0.5`}>
                    <Icon size={14} />
                  </div>
                  <div className="overflow-hidden">
                    <div className="flex items-center gap-1.5 mb-0.5">
                      <span className={`text-[8px] font-mono font-extrabold uppercase px-1.5 py-0.5 rounded border ${iconBg}`}>
                        {categoryLabel}
                      </span>
                      <span className="text-[9px] font-mono text-slate-500">Just now</span>
                    </div>
                    <h4 className="text-xs font-bold text-white font-outfit truncate leading-tight group-hover:text-primary-300 transition-colors">
                      {toast.title}
                    </h4>
                    <p className="text-[10px] text-slate-400 mt-0.5 leading-snug line-clamp-1">
                      {toast.description}
                    </p>
                  </div>
                </div>
                
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    removeToast(toast.id);
                  }}
                  className="p-1 rounded-lg bg-dark-950/60 border border-dark-850 hover:bg-dark-800 hover:text-white text-slate-400 transition cursor-pointer shrink-0"
                  title="Dismiss notification"
                >
                  <X size={12} />
                </button>
              </div>

              {/* CSS-animated progress bar countdown indicator line */}
              <div className="w-full h-0.5 bg-dark-950 rounded-full overflow-hidden relative">
                <div
                  key={`${toast.id}-${toast.createdAt}`}
                  className={`h-full ${
                    toast.type === 'chat' ? 'bg-primary-500' : toast.type === 'notice' ? 'bg-amber-500' : 'bg-emerald-500'
                  } rounded-full animate-toast-progress`}
                />
              </div>
            </div>
          );
        })}
      </div>

      {/* Floating Call Control Widget (When active call and not on chat page) */}
      {activeCall && location.pathname !== '/chats' && (
        <div className="fixed bottom-4 sm:bottom-5 right-4 sm:right-5 z-[200] bg-dark-900/90 backdrop-blur-md border border-emerald-500/30 p-3 sm:p-3.5 rounded-2xl flex items-center justify-between sm:justify-start gap-3 sm:gap-4 shadow-2xl animate-scaleUp text-slate-100 select-none max-w-[calc(100vw-2rem)] sm:max-w-sm">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-gradient-to-tr from-emerald-600 to-teal-500 flex items-center justify-center text-white relative shrink-0 shadow-lg shadow-emerald-950/20">
              <span className="absolute -top-0.5 -right-0.5 flex h-2.5 w-2.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
              </span>
              <Radio size={16} className="animate-pulse sm:hidden" />
              <Radio size={18} className="animate-pulse hidden sm:block" />
            </div>
            <div className="min-w-0">
              <h4 className="text-xs font-bold text-white font-outfit truncate">Lounge Call Active</h4>
              <p className="text-[10px] text-slate-400 font-medium font-mono mt-0.5 truncate">
                ⏱ {formatCallDuration(callDuration)} • {remoteStreams.length + 1} in call • Class {activeCall.room || currentRoom}
              </p>
            </div>
          </div>
          
          <div className="h-6 w-[1px] bg-dark-800 shrink-0 hidden sm:block" />
          
          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            <button
              onClick={toggleMute}
              className={`p-2 rounded-lg border transition active:scale-95 cursor-pointer ${
                isMuted 
                  ? 'bg-rose-500/15 border-rose-500/30 text-rose-400' 
                  : 'bg-dark-955 border border-dark-850 hover:bg-dark-850 text-slate-350 hover:text-white'
              }`}
              title={isMuted ? 'Unmute microphone' : 'Mute microphone'}
            >
              {isMuted ? <MicOff size={14} /> : <Mic size={14} />}
            </button>
            
            <button
              onClick={() => navigate('/chats', { state: { targetRoom: activeCall.room || currentRoom } })}
              className="p-2 rounded-lg bg-dark-955 border border-dark-850 hover:bg-dark-850 text-slate-350 hover:text-white transition active:scale-95 cursor-pointer"
              title="Maximize call"
            >
              <Maximize2 size={14} />
            </button>
            
            <button
              onClick={() => handleEndCall(false)}
              className="p-2 rounded-lg bg-rose-600 hover:bg-rose-500 text-white shadow-md shadow-rose-950/20 transition active:scale-95 cursor-pointer"
              title="Leave call"
            >
              <PhoneOff size={14} />
            </button>
          </div>
        </div>
      )}
    </CallContext.Provider>
  );
};

export const useCall = () => useContext(CallContext);
