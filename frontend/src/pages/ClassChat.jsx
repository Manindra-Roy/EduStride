import React, { useEffect, useState, useRef } from 'react';
import io from 'socket.io-client';
import axios from 'axios';
import { useAuth } from '../context/AuthContext';
import { MessageSquare, Send, Calendar, ShieldCheck, GraduationCap } from 'lucide-react';

const ClassChat = () => {
  const { user } = useAuth();
  
  // Decide starting room based on student's class, default to empty string for Admin/Teacher
  const [currentRoom, setCurrentRoom] = useState(user.studentProfile?.class_level || '');
  const [messages, setMessages] = useState([]);
  const [typedMessage, setTypedMessage] = useState('');
  
  const socketRef = useRef(null);
  const scrollRef = useRef(null);

  const [rooms, setRooms] = useState([]);

  // Fetch rooms on mount
  useEffect(() => {
    const fetchRooms = async () => {
      try {
        const res = await axios.get('/api/classes');
        if (res.data.success && Array.isArray(res.data.data)) {
          setRooms(res.data.data);
          const studentClass = user.role === 'Student' ? user.studentProfile?.class_level : null;
          if (studentClass && res.data.data.includes(studentClass)) {
            setCurrentRoom(studentClass);
          } else if (res.data.data.length > 0) {
            setCurrentRoom(res.data.data[0]);
          }
        }
      } catch (err) {
        console.error('Failed to fetch chat rooms:', err);
      }
    };
    fetchRooms();
  }, [user]);

  // Fetch chat history from DB
  const fetchChatHistory = async (room) => {
    if (!room) return;
    try {
      const res = await axios.get(`/api/chats/${room}`);
      if (res.data.success) {
        setMessages(res.data.data);
      }
    } catch (err) {
      console.error('Failed to load chat history:', err);
    }
  };

  // Connect to Socket.io and join room
  useEffect(() => {
    if (!currentRoom) return;
    // Connect to backend root socket
    socketRef.current = io(import.meta.env.VITE_API_URL || 'http://localhost:5000');

    // Listener for incoming messages
    socketRef.current.on('new_message', (msg) => {
      // Only append if it belongs to the current room
      if (msg.class_level === currentRoom) {
        setMessages((prev) => [...prev, msg]);
      }
    });

    return () => {
      if (socketRef.current) {
        socketRef.current.disconnect();
      }
    };
  }, [currentRoom]);

  // Handle room changes
  useEffect(() => {
    if (!currentRoom) return;
    if (socketRef.current) {
      // Emit join_room to socket server
      socketRef.current.emit('join_room', currentRoom);
    }
    // Fetch historical messages from DB
    fetchChatHistory(currentRoom);
  }, [currentRoom]);

  // Scroll to bottom helper
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]);

  // Submit message
  const handleSendMessage = (e) => {
    e.preventDefault();
    if (!typedMessage.trim()) return;

    const messageData = {
      class_level: currentRoom,
      sender_name: user.studentProfile?.name || (user.role === 'SuperAdmin' ? 'Admin' : 'Teacher'),
      sender_role: user.role,
      message_text: typedMessage
    };

    // Emit to WebSocket
    if (socketRef.current) {
      socketRef.current.emit('send_message', messageData);
    }
    setTypedMessage('');
  };

  const getRoleBadge = (role) => {
    switch (role) {
      case 'SuperAdmin':
        return 'bg-rose-500/10 text-rose-400 border border-rose-500/20';
      case 'Teacher':
        return 'bg-amber-500/10 text-amber-400 border border-amber-500/20';
      case 'Student':
      default:
        return 'bg-primary-500/10 text-primary-400 border border-primary-500/20';
    }
  };

  return (
    <div className="glass-panel rounded-2xl border border-dark-800 flex h-[calc(100vh-8rem)] overflow-hidden shadow-2xl relative">
      {/* Sidebar - Chat Room selection */}
      <div className="w-64 border-r border-dark-800/80 flex flex-col justify-between hidden md:flex">
        <div>
          <div className="p-4 border-b border-dark-800/80 flex items-center gap-2">
            <MessageSquare className="text-primary-500" size={18} />
            <h3 className="text-sm font-bold text-white font-outfit">Grade Room channels</h3>
          </div>
          <div className="p-3 space-y-1">
            {rooms.map((room) => {
              const isDisabled = user.role === 'Student' && user.studentProfile?.class_level !== room;
              return (
                <button
                  key={room}
                  disabled={isDisabled}
                  onClick={() => setCurrentRoom(room)}
                  className={`
                    w-full text-left px-4 py-3 rounded-xl text-xs font-semibold tracking-wide flex items-center justify-between transition
                    ${currentRoom === room 
                      ? 'bg-primary-600/15 text-primary-400 border border-primary-500/35 glow-indigo font-bold' 
                      : 'text-slate-400 hover:bg-dark-900/60 hover:text-slate-200 border border-transparent'}
                    ${isDisabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}
                  `}
                >
                  <span>Class {room} Lounge</span>
                  {isDisabled && <span className="text-[9px] uppercase text-rose-400">Locked</span>}
                </button>
              );
            })}
          </div>
        </div>
        <div className="p-4 bg-dark-950/20 text-[10px] text-slate-500 border-t border-dark-800/80">
          * Chat channels are isolated by student grade boundaries.
        </div>
      </div>

      {/* Main chat interface */}
      <div className="flex-1 flex flex-col justify-between bg-dark-950/20">
        {/* Chat Header */}
        <div className="p-4 border-b border-dark-800/80 flex justify-between items-center bg-dark-900/10 backdrop-blur">
          <div>
            <h3 className="text-sm font-bold text-white font-outfit">
              {currentRoom ? `Class ${currentRoom} lounge channel` : 'Select a Chat Channel'}
            </h3>
            <span className="text-[10px] text-slate-400">WebSocket-backed real-time communication portal</span>
          </div>
          
          {/* Mobile room selectors */}
          <div className="md:hidden flex gap-1 bg-dark-900 p-1 rounded-lg border border-dark-850">
            {rooms.map(room => {
              const isDisabled = user.role === 'Student' && user.studentProfile?.class_level !== room;
              if (isDisabled) return null;
              return (
                <button
                  key={room}
                  onClick={() => setCurrentRoom(room)}
                  className={`px-2 py-1 rounded text-[10px] font-bold ${currentRoom === room ? 'bg-primary-600 text-white' : 'text-slate-400'}`}
                >
                  {room}
                </button>
              );
            })}
          </div>
        </div>

        {/* Message Stream */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {messages.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-slate-500 py-20 text-xs gap-2">
              <MessageSquare size={32} className="text-dark-800" />
              <span>No messages posted in this channel yet. Say hi!</span>
            </div>
          ) : (
            messages.map((msg, index) => {
              const isMe = msg.sender_name === (user.studentProfile?.name || (user.role === 'SuperAdmin' ? 'Admin' : 'Teacher'));
              return (
                <div key={index} className={`flex flex-col ${isMe ? 'items-end' : 'items-start'}`}>
                  {/* Sender details */}
                  <div className="flex items-center gap-1.5 mb-1 px-1 text-[10px]">
                    <span className="font-bold text-slate-300">{msg.sender_name}</span>
                    <span className={`px-1.5 py-0.2 rounded-full text-[8px] font-bold font-mono uppercase ${getRoleBadge(msg.sender_role)}`}>
                      {msg.sender_role === 'SuperAdmin' ? 'Admin' : msg.sender_role}
                    </span>
                    <span className="text-slate-500 font-mono">{new Date(msg.created_at || msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                  </div>

                  {/* Message Bubble */}
                  <div className={`
                    max-w-[70%] px-4 py-2.5 rounded-2xl text-xs leading-relaxed shadow-sm
                    ${isMe 
                      ? 'bg-primary-600 text-white rounded-tr-none' 
                      : 'bg-dark-900 border border-dark-850 text-slate-200 rounded-tl-none'}
                  `}>
                    {msg.message_text}
                  </div>
                </div>
              );
            })
          )}
          <div ref={scrollRef} />
        </div>

        <form onSubmit={handleSendMessage} className="p-4 border-t border-dark-800/80 bg-dark-900/20 flex gap-3 items-center">
          <input
            type="text"
            placeholder={currentRoom ? `Message Class ${currentRoom} Lounge...` : 'Select a channel to start messaging...'}
            disabled={!currentRoom}
            value={typedMessage}
            onChange={(e) => setTypedMessage(e.target.value)}
            className="flex-1 px-4 py-3 rounded-xl bg-dark-900 border border-dark-850 text-white placeholder-slate-500 outline-none text-xs focus:border-primary-500 disabled:opacity-60 disabled:cursor-not-allowed"
          />
          <button
            type="submit"
            disabled={!currentRoom}
            className="p-3 rounded-xl bg-primary-600 hover:bg-primary-500 disabled:opacity-40 disabled:hover:bg-primary-600 text-white transition shadow-lg shadow-primary-500/10 flex items-center justify-center shrink-0 disabled:cursor-not-allowed cursor-pointer"
          >
            <Send size={16} />
          </button>
        </form>
      </div>
    </div>
  );
};

export default ClassChat;
