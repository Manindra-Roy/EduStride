import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import axios from 'axios';
import { useLocation, useNavigate } from 'react-router-dom';
import { socket } from '../config/socket';
import { useAuth } from './AuthContext';
import { Phone, Mic, MicOff, PhoneOff, Maximize2, Radio } from 'lucide-react';

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
      return;
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

    socket.on('incoming_call', handleGlobalIncomingCall);
    socket.on('call_ended', handleGlobalCallEnded);

    return () => {
      socket.off('incoming_call', handleGlobalIncomingCall);
      socket.off('call_ended', handleGlobalCallEnded);
    };
  }, [user, location.pathname]);

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
      formatCallDuration
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
