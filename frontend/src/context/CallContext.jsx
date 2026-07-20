import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import axios from 'axios';
import { useLocation, useNavigate } from 'react-router-dom';
import { socket } from '../config/socket';
import { useAuth } from './AuthContext';
import { Phone, Mic, MicOff, PhoneOff, Maximize2, Radio, MessageSquare, BookOpen, Bell, X } from 'lucide-react';

const CallContext = createContext(null);

export const CallProvider = ({ children }) => {
  const { user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  const [activeCall, setActiveCall] = useState(null); // { stream: MediaStream }
  const [isMuted, setIsMuted] = useState(false);
  const [callDuration, setCallDuration] = useState(0);
  const [incomingCall, setIncomingCall] = useState(null); // { caller_name, class_level }
  const [activeRoomCall, setActiveRoomCall] = useState(null); // { caller_name, class_level, hostEmail }
  const [isCallHost, setIsCallHost] = useState(false);
  const [currentRoom, setCurrentRoom] = useState('');

  const callTimerRef = useRef(null);
  const activeCallRef = useRef(null);
  const isCallHostRef = useRef(false);
  const currentRoomRef = useRef('');

  useEffect(() => {
    activeCallRef.current = activeCall;
  }, [activeCall]);

  useEffect(() => {
    isCallHostRef.current = isCallHost;
  }, [isCallHost]);

  useEffect(() => {
    currentRoomRef.current = currentRoom;
    // Clear any active calls or call alerts if lounge room changes
    if (activeCallRef.current) {
      handleEndCall(false);
    }
    setIncomingCall(null);
    setActiveRoomCall(null);
  }, [currentRoom]);

  const [toasts, setToasts] = useState([]);

  // Auto request notification permission on mount
  useEffect(() => {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
  }, []);

  const addToast = React.useCallback(({ id, title, description, type, link, class_level }) => {
    const toastId = id || `toast-${Date.now()}`;
    setToasts(prev => {
      const filtered = prev.filter(t => t.id !== toastId);
      return [...filtered, { id: toastId, title, description, type, link, class_level }].slice(-3);
    });

    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== toastId));
    }, 6000);
  }, []);

  const removeToast = React.useCallback((id) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  const sendBrowserNotification = React.useCallback((title, body, tag, icon, link) => {
    if ('Notification' in window && Notification.permission === 'granted') {
      try {
        const notif = new Notification(title, {
          body,
          tag,
          icon: icon || '/favicon.ico',
          renotify: true
        });
        notif.onclick = () => {
          window.focus();
          if (link) {
            if (tag.startsWith('chat-') && tag.split('-')[1]) {
              setCurrentRoom(tag.split('-')[1]);
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

  // Clean up timers and call streams on provider unmount (e.g. logout)
  useEffect(() => {
    return () => {
      if (callTimerRef.current) clearInterval(callTimerRef.current);
      if (activeCallRef.current && activeCallRef.current.stream) {
        activeCallRef.current.stream.getTracks().forEach(track => track.stop());
      }
    };
  }, []);

  // Global socket calling events listener
  useEffect(() => {
    if (!user) {
      if (socket.connected) {
        socket.disconnect();
      }
      // Logout background service if Android bridge is available
      if (window.AndroidNotificationBridge && typeof window.AndroidNotificationBridge.logoutUser === 'function') {
        try {
          window.AndroidNotificationBridge.logoutUser();
        } catch (err) {
          console.error('Failed to logout native user:', err);
        }
      }
      return;
    }

    // Register user to native background service if Android bridge is available
    if (window.AndroidNotificationBridge && typeof window.AndroidNotificationBridge.registerUser === 'function') {
      try {
        const myName = user.studentProfile?.name || (user.role === 'SuperAdmin' ? 'Admin' : 'Teacher');
        const myClass = user.studentProfile?.class_level || 'All';
        const socketUrl = import.meta.env.VITE_API_URL || window.location.origin;
        window.AndroidNotificationBridge.registerUser(user.email, myClass, myName, socketUrl);
      } catch (err) {
        console.error('Failed to register native user:', err);
      }
    }

    // Connect global socket singleton
    if (!socket.connected) {
      socket.connect();
    }

    // Join room(s)
    const joinClassrooms = async () => {
      if (user.role === 'Student') {
        const classLevel = user.studentProfile?.class_level;
        if (classLevel) {
          socket.emit('join_room', classLevel);
        }
      } else {
        // Teachers and Admins join all active classrooms dynamically to monitor call activations
        try {
          const res = await axios.get('/api/classes');
          if (res.data.success && Array.isArray(res.data.data)) {
            res.data.data.forEach(room => socket.emit('join_room', room));
          } else {
            const fallbackRooms = ['VII', 'VIII', 'IX', 'X'];
            fallbackRooms.forEach(room => socket.emit('join_room', room));
          }
        } catch (err) {
          console.error('Failed to dynamically fetch classrooms for socket joining:', err);
          const fallbackRooms = ['VII', 'VIII', 'IX', 'X'];
          fallbackRooms.forEach(room => socket.emit('join_room', room));
        }
      }
    };

    joinClassrooms();

    const handleGlobalIncomingCall = (data) => {
      if (location.pathname !== '/chats') {
        setIncomingCall(data);
      }
      setActiveRoomCall(data);
    };

    const handleGlobalCallEnded = (data) => {
      // Check if ended call matches active room call or incoming call
      setIncomingCall(prev => (prev && prev.class_level === data.class_level ? null : prev));
      setActiveRoomCall(prev => (prev && prev.class_level === data.class_level ? null : prev));
      
      // If we are currently in this call, terminate it locally
      if (activeCallRef.current && currentRoomRef.current === data.class_level) {
        handleEndCall(false);
      }
    };

    const handleNewMessageGlobal = (msg) => {
      // Don't notify if the message is from the user themselves
      const myName = user.studentProfile?.name || (user.role === 'SuperAdmin' ? 'Admin' : 'Teacher');
      if (msg.sender_name === myName) return;

      // Check if user is looking at this chat room right now and window is active
      const isChatPage = location.pathname === '/chats';
      const isCurrentRoom = msg.class_level === currentRoomRef.current;
      const isTabVisible = !document.hidden;

      const shouldShowInAppToast = !isChatPage || !isCurrentRoom;
      const shouldShowBrowserNotification = !isTabVisible || !isChatPage || !isCurrentRoom;

      if (shouldShowInAppToast) {
        addToast({
          id: `chat-${msg._id}-${Date.now()}`,
          title: `New Message in Class ${msg.class_level}`,
          description: `${msg.sender_name}: ${msg.message_text}`,
          type: 'chat',
          link: '/chats',
          class_level: msg.class_level
        });
      }

      if (shouldShowBrowserNotification) {
        sendBrowserNotification(
          `Class ${msg.class_level} Chat`,
          `${msg.sender_name}: ${msg.message_text}`,
          `chat-${msg.class_level}`,
          user.profile_pic,
          '/chats'
        );
      }
    };

    const handleNewStudyMaterialGlobal = (data) => {
      // Notify only if it's targeted for user's class level (if user is a Student)
      if (user.role === 'Student') {
        const studentClass = user.studentProfile?.class_level;
        if (studentClass && studentClass !== data.class_level) return;
      }

      // Check if user is looking at the lms page
      const isLmsPage = location.pathname === '/lms';
      const isTabVisible = !document.hidden;

      const shouldShowInAppToast = !isLmsPage;
      const shouldShowBrowserNotification = !isTabVisible || !isLmsPage;

      if (shouldShowInAppToast) {
        addToast({
          id: `lms-${data.material._id}-${Date.now()}`,
          title: `New Study Material for Class ${data.class_level}`,
          description: `Subject: ${data.subject} - Title: ${data.chapter_name}`,
          type: 'lms',
          link: '/lms'
        });
      }

      if (shouldShowBrowserNotification) {
        sendBrowserNotification(
          `New Notes: Class ${data.class_level}`,
          `Subject: ${data.subject}\nChapter: ${data.chapter_name}`,
          `lms-${data.class_level}`,
          null,
          '/lms'
        );
      }
    };

    const handleConnect = () => {
      console.log('Global Socket connected successfully:', socket.id);
    };

    const handleConnectError = (err) => {
      console.error('Global Socket connection error:', err.message);
    };

    const handleDisconnect = (reason) => {
      console.warn('Global Socket disconnected:', reason);
    };

    socket.on('connect', handleConnect);
    socket.on('connect_error', handleConnectError);
    socket.on('disconnect', handleDisconnect);
    socket.on('incoming_call', handleGlobalIncomingCall);
    socket.on('call_ended', handleGlobalCallEnded);
    socket.on('new_message', handleNewMessageGlobal);
    socket.on('new_study_material', handleNewStudyMaterialGlobal);

    return () => {
      socket.off('connect', handleConnect);
      socket.off('connect_error', handleConnectError);
      socket.off('disconnect', handleDisconnect);
      socket.off('incoming_call', handleGlobalIncomingCall);
      socket.off('call_ended', handleGlobalCallEnded);
      socket.off('new_message', handleNewMessageGlobal);
      socket.off('new_study_material', handleNewStudyMaterialGlobal);
    };
  }, [user, location.pathname, addToast, sendBrowserNotification]);

  const handleStartCall = async (isHost = false) => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: false,
        audio: true
      });
      
      setActiveCall({ stream });
      setIsMuted(false);
      setCallDuration(0);
      
      // Auto-detect if we are the host of the active call (if rejoining)
      const isActuallyHost = isHost || (activeRoomCall && activeRoomCall.hostEmail === user.email);
      setIsCallHost(isActuallyHost);

      // Emit calling state to room ONLY if host
      if (isActuallyHost && socket.connected) {
        socket.emit('start_call', {
          class_level: currentRoomRef.current,
          caller_name: user.studentProfile?.name || (user.role === 'SuperAdmin' ? 'Admin' : 'Teacher'),
          hostEmail: user.email
        });
        setActiveRoomCall({
          class_level: currentRoomRef.current,
          caller_name: user.studentProfile?.name || (user.role === 'SuperAdmin' ? 'Admin' : 'Teacher'),
          hostEmail: user.email
        });
      }

      // Start duration timer
      if (callTimerRef.current) clearInterval(callTimerRef.current);
      callTimerRef.current = setInterval(() => {
        setCallDuration(prev => prev + 1);
      }, 1000);
    } catch (err) {
      console.error('Failed to get media devices:', err);
      alert('Could not access microphone. Please check system permissions.');
    }
  };

  const handleEndCall = (terminateForAll = false) => {
    if (activeCallRef.current && activeCallRef.current.stream) {
      activeCallRef.current.stream.getTracks().forEach(track => track.stop());
    }
    if (callTimerRef.current) {
      clearInterval(callTimerRef.current);
      callTimerRef.current = null;
    }
    // Emit call end state to room ONLY if requested and they are the call host!
    if (terminateForAll && socket.connected && activeCallRef.current && isCallHostRef.current) {
      socket.emit('end_call', { class_level: currentRoomRef.current });
      setActiveRoomCall(null);
    }
    setActiveCall(null);
    setCallDuration(0);
    setIsCallHost(false);
  };

  const toggleMute = () => {
    if (activeCall && activeCall.stream) {
      const audioTracks = activeCall.stream.getAudioTracks();
      audioTracks.forEach(track => {
        track.enabled = !track.enabled;
      });
      setIsMuted(!isMuted);
    }
  };

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
      handleStartCall,
      handleEndCall,
      toggleMute,
      formatCallDuration,
      addToast,
      removeToast,
      toasts
    }}>
      {children}
      
      {/* Global Call Notification Toast */}
      {incomingCall && location.pathname !== '/chats' && !activeCall && (
        <div className="fixed top-5 right-5 z-[200] max-w-sm w-full bg-dark-900/90 backdrop-blur-md border border-emerald-500/30 p-4 rounded-2xl flex items-center justify-between gap-4 shadow-2xl animate-scaleUp text-slate-100 select-none">
          <div className="flex items-center gap-3">
            <div className="p-3.5 rounded-xl bg-emerald-600/10 text-emerald-400 border border-emerald-500/10 relative shrink-0">
              <span className="absolute -top-0.5 -right-0.5 flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-450 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
              </span>
              <Phone size={18} />
            </div>
            <div>
              <h4 className="text-xs font-bold text-white font-outfit">Active Voice Call</h4>
              <p className="text-[10px] text-slate-400 mt-1 leading-snug">
                {incomingCall.caller_name} is broadcasting in Class {incomingCall.class_level} Lounge.
              </p>
            </div>
          </div>
          <div className="flex flex-col gap-1.5 shrink-0">
            <button
              onClick={() => {
                localStorage.setItem('autoJoinCall', 'true');
                navigate('/chats');
                setIncomingCall(null);
              }}
              className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-555 text-[10px] font-bold text-white transition cursor-pointer text-center"
            >
              Join Call
            </button>
            <button
              onClick={() => setIncomingCall(null)}
              className="px-3 py-1.5 rounded-lg bg-dark-955/60 border border-dark-800 hover:bg-dark-800 text-[10px] font-semibold text-slate-400 hover:text-white transition cursor-pointer text-center"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {/* Toast Notifications Queue */}
      <div className="fixed top-24 right-5 z-[200] flex flex-col gap-3 max-w-sm w-full pointer-events-none">
        {toasts.map((toast) => {
          const Icon = toast.type === 'chat' ? MessageSquare : BookOpen;
          const accentColor = toast.type === 'chat' ? 'border-primary-500/30' : 'border-indigo-500/30';
          const iconBg = toast.type === 'chat' ? 'bg-primary-600/10 text-primary-400 font-bold' : 'bg-indigo-600/10 text-indigo-400 font-bold';

          return (
            <div 
              key={toast.id} 
              className="pointer-events-auto w-full bg-dark-900/90 backdrop-blur-md border border-dark-800/80 p-3.5 rounded-2xl flex items-center justify-between gap-3 shadow-2xl animate-scaleUp text-slate-100 select-none cursor-pointer hover:border-slate-700/50 transition-all duration-200"
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
              <div className="flex items-center gap-3 overflow-hidden animate-fadeIn">
                <div className={`p-2.5 rounded-xl ${iconBg} border border-dark-800 shrink-0`}>
                  <Icon size={16} />
                </div>
                <div className="overflow-hidden">
                  <h4 className="text-xs font-bold text-white font-outfit truncate">{toast.title}</h4>
                  <p className="text-[10px] text-slate-400 mt-0.5 leading-snug truncate">
                    {toast.description}
                  </p>
                </div>
              </div>
              
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  removeToast(toast.id);
                }}
                className="p-1 rounded-lg bg-dark-955/40 border border-dark-850 hover:bg-dark-800 hover:text-white text-slate-500 transition cursor-pointer shrink-0"
              >
                <X size={12} />
              </button>
            </div>
          );
        })}
      </div>

      {/* Floating Call Control Widget (When active call and not on chat page) */}
      {activeCall && location.pathname !== '/chats' && (
        <div className="fixed bottom-5 right-5 z-[200] bg-dark-900/90 backdrop-blur-md border border-emerald-500/30 p-3.5 rounded-2xl flex items-center gap-4 shadow-2xl animate-scaleUp text-slate-100 select-none max-w-sm">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-emerald-600 to-teal-500 flex items-center justify-center text-white relative shrink-0 shadow-lg shadow-emerald-950/20">
              <span className="absolute -top-0.5 -right-0.5 flex h-2.5 w-2.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
              </span>
              <Radio size={18} className="animate-pulse" />
            </div>
            <div>
              <h4 className="text-xs font-bold text-white font-outfit">Lounge Call Active</h4>
              <p className="text-[10px] text-slate-400 font-medium font-mono mt-0.5">
                ⏱ {formatCallDuration(callDuration)} • Class {currentRoom}
              </p>
            </div>
          </div>
          
          <div className="h-6 w-[1px] bg-dark-800 shrink-0" />
          
          <div className="flex items-center gap-2 shrink-0">
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
              onClick={() => navigate('/chats')}
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
