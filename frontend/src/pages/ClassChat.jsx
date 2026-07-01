import React, { useEffect, useState, useRef } from 'react';
import axios from 'axios';
import { useAuth } from '../context/AuthContext';
import { socket } from '../config/socket';
import { useCall } from '../context/CallContext';
import Logo from '../components/Logo';
import { 
  MessageSquare, 
  Send, 
  Smile, 
  Paperclip, 
  Mic, 
  ArrowLeft, 
  Phone, 
  MoreVertical, 
  CheckCheck, 
  Search,
  Lock,
  Sparkles,
  X,
  Play,
  Pause,
  Download,
  FileText,
  Image as ImageIcon,
  Trash2,
  GraduationCap,
  PhoneOff,
  MicOff
} from 'lucide-react';

// Custom Voice Message Audio Player Component (EduStride Styling)
const VoicePlayer = ({ src }) => {
  const [playing, setPlaying] = useState(false);
  const audioRef = useRef(null);

  const togglePlay = () => {
    if (audioRef.current) {
      if (playing) {
        audioRef.current.pause();
      } else {
        audioRef.current.play();
      }
      setPlaying(!playing);
    }
  };

  useEffect(() => {
    const audio = audioRef.current;
    if (audio) {
      const handleEnded = () => setPlaying(false);
      audio.addEventListener('ended', handleEnded);
      return () => {
        audio.removeEventListener('ended', handleEnded);
      };
    }
  }, [src]);

  return (
    <div className="flex items-center gap-3 bg-dark-950/70 backdrop-blur p-3 rounded-xl border border-dark-800 w-52 sm:w-60 mt-1 select-none shadow-md">
      <audio ref={audioRef} src={src} className="hidden" />
      <button 
        type="button" 
        onClick={togglePlay}
        className="w-8 h-8 rounded-xl bg-primary-600 text-white flex items-center justify-center hover:bg-primary-500 transition shrink-0 shadow-md shadow-primary-500/20 cursor-pointer active:scale-90"
      >
        {playing ? <Pause size={12} fill="currentColor" /> : <Play size={12} className="ml-0.5" fill="currentColor" />}
      </button>
      
      {/* Waveform graphic */}
      <div className="flex-1 flex items-center gap-0.5 h-6 justify-center">
        {[2, 3, 1, 4, 2, 3, 1, 4, 2, 3].map((val, idx) => {
          const heights = ['h-1.5', 'h-2.5', 'h-3.5', 'h-5'];
          return (
            <span 
              key={idx}
              className={`w-0.5 rounded-full bg-slate-700 transition-all duration-300 ${
                playing 
                  ? `animate-pulse ${heights[val - 1]} bg-primary-400` 
                  : `${heights[val % 2 ? 0 : 1]} bg-slate-600`
              }`} 
            />
          );
        })}
      </div>
      
      <span className="text-[9px] text-slate-500 font-bold uppercase tracking-wider font-outfit shrink-0">Voice</span>
    </div>
  );
};

const ClassChat = () => {
  const { user } = useAuth();
  const {
    activeCall,
    isMuted,
    callDuration,
    incomingCall,
    setIncomingCall,
    activeRoomCall,
    isCallHost,
    currentRoom: callContextRoom,
    setCurrentRoom: setCallContextRoom,
    handleStartCall,
    handleEndCall,
    toggleMute,
    formatCallDuration
  } = useCall();
  
  const [currentRoom, setCurrentRoom] = useState(callContextRoom || user.studentProfile?.class_level || '');

  // Sync current room level with global CallContext
  useEffect(() => {
    setCallContextRoom(currentRoom);
  }, [currentRoom]);
  const [messages, setMessages] = useState([]);
  const [typedMessage, setTypedMessage] = useState('');
  const [rooms, setRooms] = useState([]);
  const [showSidebarOnMobile, setShowSidebarOnMobile] = useState(user.role !== 'Student');
  const [searchFilter, setSearchFilter] = useState('');

  // Voice recording states
  const [isRecording, setIsRecording] = useState(false);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const recordingTimerRef = useRef(null);

  // File Upload states
  const [selectedAttachment, setSelectedAttachment] = useState(null); // { name, type, size, base64 }
  const [attachmentCaption, setAttachmentCaption] = useState('');
  const [showAttachmentPreview, setShowAttachmentPreview] = useState(false);
  const fileInputRef = useRef(null);

  // Image Lightbox preview states
  const [activeLightboxImg, setActiveLightboxImg] = useState(null);

  // Delete Confirmation state
  const [deleteConfirmMsgId, setDeleteConfirmMsgId] = useState(null);

  // Chat message search filter states
  const [showSearchInChat, setShowSearchInChat] = useState(false);
  const [chatSearchQuery, setChatSearchQuery] = useState('');

  // Emoji Tray states
  const [showEmojiTray, setShowEmojiTray] = useState(false);
  const emojis = ['😀', '😂', '😍', '👍', '🙏', '🔥', '🎉', '👏', '💔', '😢', '💯', '🤔', '😎', '💡', '✅', '❌', '👀', '📌', '🚀', '⭐'];
  
  const socketRef = useRef(null);
  const scrollRef = useRef(null);

  const roomPreviews = {
    'VII': { text: 'Class teacher: Remember to submit the math assignment by Monday.', time: '08:02 AM' },
    'VIII': { text: 'English quiz scores are now visible in your student portals.', time: 'Yesterday' },
    'IX': { text: 'System: Attendance warning alerts generated for low ratios.', time: '18/06/2026' },
    'X': { text: 'Admin: Mock board registration forms have been distributed.', time: '15/06/2026' }
  };

  const parseMessage = (text) => {
    if (text && text.startsWith('{"isAttachment":true')) {
      try {
        return JSON.parse(text);
      } catch (e) {
        return { isAttachment: false, text };
      }
    }
    return { isAttachment: false, text };
  };

  const getLastMessagePreview = (roomName) => {
    if (roomName === currentRoom && messages.length > 0) {
      const lastMsg = messages[messages.length - 1];
      const parsed = parseMessage(lastMsg.message_text);
      
      let msgSummary = '';
      if (parsed.isAttachment) {
        if (parsed.type === 'image') msgSummary = '📷 Photo';
        else if (parsed.type === 'audio') msgSummary = '🎤 Voice Note';
        else msgSummary = '📄 File: ' + parsed.name;
        
        if (parsed.caption) {
          msgSummary += ` - ${parsed.caption}`;
        }
      } else {
        msgSummary = parsed.text;
      }
      return `${lastMsg.sender_name}: ${msgSummary}`;
    }
    return roomPreviews[roomName]?.text || 'No messages in this lounge yet.';
  };

  const getLastMessageTime = (roomName) => {
    if (roomName === currentRoom && messages.length > 0) {
      const lastMsg = messages[messages.length - 1];
      const date = new Date(lastMsg.created_at || lastMsg.timestamp || Date.now());
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    return roomPreviews[roomName]?.time || '00:00';
  };

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
            setShowSidebarOnMobile(false);
          } else if (res.data.data.length > 0 && !currentRoom) {
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

  // Reference the global socket singleton
  useEffect(() => {
    if (!socket.connected) {
      socket.connect();
    }
    socketRef.current = socket;
  }, []);

  // Handle room switching, join events, and state listeners
  useEffect(() => {
    if (!currentRoom || !socketRef.current) return;
    const socket = socketRef.current;

    // Join room
    socket.emit('join_room', currentRoom);

    // Message stream listener
    const handleNewMessage = (msg) => {
      if (msg.class_level === currentRoom) {
        setMessages((prev) => [...prev, msg]);
      }
    };

    // Message deletion listener
    const handleMessageDeleted = (msgId) => {
      setMessages((prev) => prev.filter((msg) => msg._id !== msgId));
    };

    socket.on('new_message', handleNewMessage);
    socket.on('message_deleted', handleMessageDeleted);

    // Reset page view states and pull lounge messages
    setChatSearchQuery('');
    setShowSearchInChat(false);
    fetchChatHistory(currentRoom);

    return () => {
      socket.off('new_message', handleNewMessage);
      socket.off('message_deleted', handleMessageDeleted);
    };
  }, [currentRoom]);

  // Scroll to bottom helper
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]);

  // Clean recording timers on unmount
  useEffect(() => {
    return () => {
      if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
    };
  }, []);

  const handleSendMessage = (e) => {
    e.preventDefault();
    if (!typedMessage.trim()) return;

    const messageData = {
      class_level: currentRoom,
      sender_name: user.studentProfile?.name || (user.role === 'SuperAdmin' ? 'Admin' : 'Teacher'),
      sender_role: user.role,
      message_text: typedMessage
    };

    if (socketRef.current) {
      socketRef.current.emit('send_message', messageData);
    }
    setTypedMessage('');
    setShowEmojiTray(false);
  };

  const handleDeleteMessage = (messageId) => {
    setDeleteConfirmMsgId(messageId);
  };

  // Voice Recording Functions
  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioChunksRef.current = [];
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      
      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        const reader = new FileReader();
        reader.readAsDataURL(audioBlob);
        reader.onloadend = () => {
          const base64Audio = reader.result;
          const msgPayload = JSON.stringify({
            isAttachment: true,
            type: 'audio',
            name: `VoiceNote-${Date.now()}.webm`,
            content: base64Audio
          });
          
          const messageData = {
            class_level: currentRoom,
            sender_name: user.studentProfile?.name || (user.role === 'SuperAdmin' ? 'Admin' : 'Teacher'),
            sender_role: user.role,
            message_text: msgPayload
          };

          if (socketRef.current) {
            socketRef.current.emit('send_message', messageData);
          }
        };
        
        stream.getTracks().forEach(track => track.stop());
      };

      mediaRecorder.start();
      setIsRecording(true);
      setRecordingDuration(0);
      recordingTimerRef.current = setInterval(() => {
        setRecordingDuration(prev => prev + 1);
      }, 1000);
    } catch (err) {
      console.error('Microphone access denied:', err);
      alert('Microphone access is required to record voice notes.');
    }
  };

  const stopRecording = (shouldSend = true) => {
    if (mediaRecorderRef.current && isRecording) {
      clearInterval(recordingTimerRef.current);
      setIsRecording(false);
      
      if (shouldSend) {
        mediaRecorderRef.current.stop();
      } else {
        // Cancel recording, discard tracks
        mediaRecorderRef.current.onstop = null;
        mediaRecorderRef.current.stop();
        const stream = mediaRecorderRef.current.stream;
        if (stream) {
          stream.getTracks().forEach(track => track.stop());
        }
      }
    }
  };

  const formatDuration = (sec) => {
    const min = Math.floor(sec / 60);
    const remaining = sec % 60;
    return `${min}:${remaining < 10 ? '0' : ''}${remaining}`;
  };

  // Attachment File handlers
  const handleAttachmentClick = () => {
    if (fileInputRef.current) {
      fileInputRef.current.click();
    }
  };

  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    if (file.size > 5 * 1024 * 1024) {
      alert('File size exceeds the 5MB limit for chat attachments.');
      return;
    }

    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onloadend = () => {
      setSelectedAttachment({
        name: file.name,
        type: file.type.startsWith('image/') ? 'image' : 'document',
        rawType: file.type,
        size: file.size,
        base64: reader.result
      });
      setAttachmentCaption('');
      setShowAttachmentPreview(true);
    };

    e.target.value = '';
  };

  const sendAttachment = () => {
    if (!selectedAttachment) return;

    const payload = JSON.stringify({
      isAttachment: true,
      type: selectedAttachment.type,
      name: selectedAttachment.name,
      content: selectedAttachment.base64,
      caption: attachmentCaption.trim()
    });

    const messageData = {
      class_level: currentRoom,
      sender_name: user.studentProfile?.name || (user.role === 'SuperAdmin' ? 'Admin' : 'Teacher'),
      sender_role: user.role,
      message_text: payload
    };

    if (socketRef.current) {
      socketRef.current.emit('send_message', messageData);
    }

    setSelectedAttachment(null);
    setShowAttachmentPreview(false);
  };

  const handleEmojiClick = (emoji) => {
    setTypedMessage(prev => prev + emoji);
  };

  const getNameColor = (name) => {
    const colors = [
      'text-[#818cf8]', // Indigo
      'text-[#a78bfa]', // Violet
      'text-[#60a5fa]', // Blue
      'text-[#f472b6]', // Pink
      'text-[#34d399]', // Emerald
      'text-[#fbbf24]', // Amber
      'text-[#22d3ee]', // Cyan
      'text-[#fb7185]'  // Rose
    ];
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
      hash += name.charCodeAt(i);
    }
    return colors[hash % colors.length];
  };

  const filteredRooms = rooms.filter(room => 
    `Class ${room} Lounge`.toLowerCase().includes(searchFilter.toLowerCase())
  );

  // Search filter for chat messages stream
  const searchedMessages = messages.filter(msg => {
    if (!chatSearchQuery) return true;
    const parsed = parseMessage(msg.message_text);
    const content = parsed.isAttachment 
      ? `${parsed.caption || ''} ${parsed.name || ''}` 
      : (parsed.text || '');
    return content.toLowerCase().includes(chatSearchQuery.toLowerCase());
  });

  return (
    <div className="glass-panel rounded-none md:rounded-2xl border-t md:border border-dark-800/80 flex h-full overflow-hidden shadow-2xl relative">
      {/* Hidden File Input */}
      <input 
        type="file" 
        ref={fileInputRef} 
        onChange={handleFileChange} 
        className="hidden" 
      />

      {/* Sidebar - Chat Room selection */}
      <div className={`w-full md:w-80 flex-col bg-dark-950/80 border-r border-dark-800/80 ${
        showSidebarOnMobile ? 'flex' : 'hidden md:flex'
      }`}>
        {/* Sidebar Header */}
        <div className="p-4 bg-dark-900/40 border-b border-dark-800/80 flex justify-between items-center text-slate-100 shrink-0">
          <div className="flex items-center gap-3">
            {user?.profile_pic ? (
              <img 
                src={user.profile_pic} 
                alt="Avatar" 
                className="w-10 h-10 rounded-xl object-cover border border-primary-500/20 shadow-sm"
              />
            ) : (
              <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-primary-600 to-indigo-500 flex items-center justify-center font-bold text-white text-base shadow-sm">
                {user?.email[0].toUpperCase()}
              </div>
            )}
            <div>
              <h3 className="text-sm font-bold font-outfit">{user?.role === 'SuperAdmin' ? 'System Admin' : user?.role}</h3>
              <span className="text-[10px] text-slate-400 font-medium leading-none block mt-0.5">My Chats</span>
            </div>
          </div>
          <div className="flex items-center gap-1.5 text-slate-400">
            <button className="p-1.5 rounded-xl hover:bg-dark-900/60 transition animate-pulse-slow cursor-pointer" title="Notifications Lounge Channel">
              <Sparkles size={16} />
            </button>
            <button className="p-1.5 rounded-xl hover:bg-dark-900/60 transition cursor-pointer">
              <MoreVertical size={16} />
            </button>
          </div>
        </div>

        {/* Search Bar */}
        <div className="p-2.5 bg-dark-950/20 border-b border-dark-800/80 flex items-center shrink-0">
          <div className="bg-dark-900/40 w-full rounded-xl px-3 py-1.5 flex items-center gap-3 border border-dark-800/60 focus-within:border-primary-500/40">
            <Search size={14} className="text-slate-500" />
            <input 
              type="text" 
              placeholder="Search or start new chat" 
              value={searchFilter}
              onChange={(e) => setSearchFilter(e.target.value)}
              className="bg-transparent border-none outline-none w-full text-xs text-slate-200 placeholder-slate-550"
            />
          </div>
        </div>

        {/* Rooms List */}
        <div className="flex-1 overflow-y-auto p-3 space-y-1.5">
          {filteredRooms.map((room) => {
            const isDisabled = user.role === 'Student' && user.studentProfile?.class_level !== room;
            const isSelected = currentRoom === room;
            
            return (
              <div
                key={room}
                onClick={() => {
                  if (!isDisabled) {
                    setCurrentRoom(room);
                    setShowSidebarOnMobile(false);
                  }
                }}
                className={`
                  p-3 flex items-center gap-3.5 cursor-pointer transition-all duration-200 select-none border-l-4 rounded-xl
                  ${isSelected 
                    ? 'bg-primary-600/10 text-primary-400 border-primary-500 font-semibold shadow-inner' 
                    : 'text-slate-400 hover:bg-dark-900/40 hover:text-slate-200 border-transparent'}
                  ${isDisabled ? 'opacity-40 cursor-not-allowed' : ''}
                `}
              >
                {/* Avatar */}
                <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-primary-600 to-indigo-500 flex items-center justify-center text-white shrink-0 shadow-md shadow-primary-500/10">
                  <GraduationCap size={18} />
                </div>

                {/* Details */}
                <div className="flex-1 overflow-hidden">
                  <div className="flex justify-between items-baseline">
                    <h4 className="text-xs font-bold text-white truncate font-outfit">Class {room} Lounge</h4>
                    <span className="text-[9px] text-slate-500 font-mono shrink-0">{getLastMessageTime(room)}</span>
                  </div>
                  <div className="flex justify-between items-center mt-1">
                    <p className="text-[11px] text-slate-400 truncate flex-1 pr-2">
                      {getLastMessagePreview(room)}
                    </p>
                    {isDisabled && (
                      <span className="text-[7px] tracking-wider uppercase bg-rose-950/40 text-rose-400 border border-rose-900/30 px-1 py-0.5 rounded font-extrabold flex items-center gap-0.5 shrink-0">
                        <Lock size={8} /> Locked
                      </span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
          {filteredRooms.length === 0 && (
            <div className="p-8 text-center text-xs text-slate-500">
              No channels found
            </div>
          )}
        </div>
      </div>

      {/* Main chat interface */}
      <div className={`flex-1 flex-col bg-dark-950/40 overflow-hidden ${
        !showSidebarOnMobile ? 'flex' : 'hidden md:flex'
      }`}>
        {currentRoom ? (
          <>
            {/* Chat Header */}
            <div className="p-3.5 bg-dark-900/40 border-b border-dark-800/80 flex justify-between items-center text-slate-100 shrink-0 z-20 backdrop-blur-md">
              <div className="flex items-center gap-3">
                {/* Back button for mobile */}
                {user.role !== 'Student' && (
                  <button 
                    onClick={() => setShowSidebarOnMobile(true)}
                    className="p-1.5 rounded-xl hover:bg-dark-900/60 text-slate-400 transition md:hidden mr-1 cursor-pointer"
                    title="Back to Chats"
                  >
                    <ArrowLeft size={18} />
                  </button>
                )}
                
                {/* Active chat avatar */}
                <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-primary-600 to-indigo-500 flex items-center justify-center text-white shrink-0 shadow-md shadow-primary-500/10">
                  <GraduationCap size={18} />
                </div>
                
                <div>
                  <h3 className="text-xs font-bold text-white font-outfit">Class {currentRoom} Lounge</h3>
                  <span className="text-[10px] text-primary-405 flex items-center gap-1.5 mt-0.5 font-medium leading-none">
                    <span className="relative flex h-1.5 w-1.5">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500"></span>
                    </span>
                    <span>active institutional lounge</span>
                  </span>
                </div>
              </div>
              
              <div className="flex items-center gap-1.5 text-slate-400">
                <button 
                  onClick={() => {
                    setShowSearchInChat(!showSearchInChat);
                    setChatSearchQuery('');
                  }}
                  className={`p-2 rounded-xl hover:bg-dark-900/60 transition cursor-pointer ${showSearchInChat ? 'bg-primary-600/10 text-primary-400' : ''}`} 
                  title="Search message history"
                >
                  <Search size={16} />
                </button>
                {/* Voice Call button */}
                {activeRoomCall ? (
                  <button 
                    onClick={() => handleStartCall(false)}
                    className="p-2 rounded-xl bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 hover:text-emerald-300 transition cursor-pointer relative animate-pulse"
                    title="Join active voice call"
                  >
                    <Phone size={16} />
                    <span className="absolute top-1 right-1 flex h-1.5 w-1.5">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500"></span>
                    </span>
                  </button>
                ) : (
                  <button 
                    onClick={() => handleStartCall(true)}
                    className="p-2 rounded-xl hover:bg-dark-900/60 text-slate-400 hover:text-white transition cursor-pointer" 
                    title="Start voice call"
                  >
                    <Phone size={16} />
                  </button>
                )}
                <button className="p-2 rounded-xl hover:bg-dark-900/60 transition cursor-pointer">
                  <MoreVertical size={16} />
                </button>
              </div>
            </div>

            {/* Inline Message Search Bar */}
            {showSearchInChat && (
              <div className="p-2.5 bg-dark-900/60 border-b border-dark-800/80 flex items-center gap-2 shrink-0 animate-fadeIn">
                <div className="bg-dark-950 flex-1 rounded-xl px-3 py-1 flex items-center gap-2.5 border border-dark-850 focus-within:border-primary-500/40">
                  <Search size={12} className="text-slate-500" />
                  <input
                    type="text"
                    placeholder="Search messages in this channel..."
                    value={chatSearchQuery}
                    onChange={(e) => setChatSearchQuery(e.target.value)}
                    className="bg-transparent border-none outline-none w-full text-xs text-slate-200 placeholder-slate-600 py-1"
                  />
                  {chatSearchQuery && (
                    <button onClick={() => setChatSearchQuery('')} className="text-slate-500 hover:text-white cursor-pointer">
                      <X size={14} />
                    </button>
                  )}
                </div>
                <button 
                  onClick={() => {
                    setShowSearchInChat(false);
                    setChatSearchQuery('');
                  }}
                  className="text-xs text-slate-400 hover:text-white px-2 py-1 cursor-pointer font-semibold"
                >
                  Close
                </button>
              </div>
            )}

            {/* Incoming Call Notification Banner */}
            {incomingCall && !activeCall && (
              <div className="mx-4 mt-3 bg-dark-900/90 backdrop-blur-md border border-primary-500/30 p-4 rounded-2xl flex items-center justify-between gap-4 animate-scaleUp z-30 shadow-2xl shadow-primary-950/20">
                <div className="flex items-center gap-3">
                  <div className="p-3.5 rounded-xl bg-primary-600/10 text-primary-400 border border-primary-500/10 relative">
                    <span className="absolute -top-0.5 -right-0.5 flex h-2 w-2">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                    </span>
                    <Phone size={20} />
                  </div>
                  <div>
                    <h4 className="text-xs font-bold text-white font-outfit">Active Voice Call</h4>
                    <p className="text-[11px] text-slate-400 mt-0.5 font-medium leading-none">
                      {incomingCall.caller_name} is broadcasting in this Lounge.
                    </p>
                  </div>
                </div>
                
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setIncomingCall(null)}
                    className="px-3 py-1.5 rounded-lg bg-transparent hover:bg-dark-950 text-xs font-semibold text-slate-400 hover:text-white border border-dark-850 transition cursor-pointer"
                  >
                    Dismiss
                  </button>
                  <button
                    onClick={() => {
                      handleStartCall(false);
                      setIncomingCall(null);
                    }}
                    className="px-3.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-xs font-bold text-white flex items-center gap-1.5 shadow-md shadow-emerald-950/20 transition cursor-pointer"
                  >
                    Join Call
                  </button>
                </div>
              </div>
            )}

            {/* Message Stream with Wallpaper */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3.5 edustride-chat-bg flex flex-col">
              <div className="self-center bg-dark-900/80 backdrop-blur border border-dark-800 text-slate-400 text-[10px] font-medium px-3.5 py-1 rounded-full shadow-sm mb-3 select-none flex items-center gap-1.5 font-outfit">
                <Lock size={10} className="text-primary-400" />
                <span>End-to-end institutional encrypted</span>
              </div>

              {searchedMessages.length === 0 ? (
                <div className="flex-1 flex flex-col items-center justify-center text-slate-500 py-20 text-xs gap-2 select-none">
                  <MessageSquare size={36} className="text-dark-800" />
                  <span>
                    {chatSearchQuery 
                      ? 'No matching messages found in history.' 
                      : 'No messages posted in this lounge yet. Say hello!'}
                  </span>
                </div>
              ) : (
                searchedMessages.map((msg, index) => {
                  const isMe = msg.sender_name === (user.studentProfile?.name || (user.role === 'SuperAdmin' ? 'Admin' : 'Teacher'));
                  const time = new Date(msg.created_at || msg.timestamp || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                  const parsed = parseMessage(msg.message_text);
                  const canDelete = isMe || user.role === 'SuperAdmin' || user.role === 'Teacher';

                  return (
                    <div 
                      key={index} 
                      className={`flex flex-col ${isMe ? 'items-end' : 'items-start'} max-w-[85%] sm:max-w-[70%] ${
                        isMe ? 'self-end' : 'self-start'
                      }`}
                    >
                      {/* Message Bubble */}
                      <div className={`
                        px-3.5 py-2 rounded-2xl text-xs leading-relaxed shadow-sm relative flex flex-col
                        ${isMe 
                          ? 'bg-gradient-to-tr from-primary-600/90 to-indigo-650/90 text-white rounded-tr-none border border-primary-500/20 shadow-lg shadow-primary-650/5' 
                          : 'bg-dark-900/90 text-slate-100 rounded-tl-none border border-dark-800/80'}
                      `}>
                        {/* Sender name for other users */}
                        {!isMe && (
                          <span className={`text-[10px] font-extrabold mb-1.5 flex items-center gap-1.5 leading-none ${getNameColor(msg.sender_name)}`}>
                            {msg.sender_name} 
                            <span className={`text-[8px] font-extrabold px-1.5 py-0.5 rounded uppercase font-mono tracking-wider ${
                              msg.sender_role === 'SuperAdmin' || msg.sender_role === 'Admin'
                                ? 'bg-indigo-500/10 text-indigo-400 border border-indigo-550/20'
                                : msg.sender_role === 'Teacher'
                                  ? 'bg-amber-500/10 text-amber-400 border border-amber-550/20'
                                  : 'bg-primary-500/10 text-primary-400 border border-primary-550/20'
                            }`}>
                              {msg.sender_role === 'SuperAdmin' ? 'Admin' : msg.sender_role}
                            </span>
                          </span>
                        )}
                        
                        {/* Rich Content Renderers */}
                        {parsed.isAttachment ? (
                          <div className="space-y-1.5 pt-0.5 pb-3">
                            {parsed.type === 'image' && (
                              <div className="relative group cursor-zoom-in rounded-lg overflow-hidden border border-dark-800 max-w-full">
                                <img 
                                  src={parsed.content} 
                                  alt={parsed.name} 
                                  onClick={() => setActiveLightboxImg(parsed.content)}
                                  className="max-h-60 max-w-full object-cover hover:scale-[1.02] transition-transform duration-250"
                                />
                              </div>
                            )}

                            {parsed.type === 'audio' && (
                              <VoicePlayer src={parsed.content} />
                            )}

                            {parsed.type === 'document' && (
                              <div className="flex items-center gap-3 p-3 rounded-xl bg-dark-950/70 border border-dark-800 w-52 sm:w-60">
                                <div className="p-2 rounded bg-rose-600/20 text-rose-450 border border-rose-500/10 shrink-0">
                                  <FileText size={18} />
                                </div>
                                <div className="flex-1 overflow-hidden">
                                  <p className="text-xs font-bold text-white truncate leading-snug font-outfit">{parsed.name}</p>
                                  <span className="text-[9px] text-slate-500 uppercase tracking-wider font-bold">Document</span>
                                </div>
                                <a 
                                  href={parsed.content} 
                                  download={parsed.name}
                                  className="p-1.5 rounded-lg bg-dark-900 border border-dark-800 hover:bg-dark-850 text-primary-400 transition cursor-pointer"
                                  title="Download handout file"
                                >
                                  <Download size={12} />
                                </a>
                              </div>
                            )}

                            {/* Caption if exists */}
                            {parsed.caption && (
                              <p className="whitespace-pre-wrap text-[12px] pt-1">{parsed.caption}</p>
                            )}
                          </div>
                        ) : (
                          /* Text Content */
                          <p className="whitespace-pre-wrap pr-12 break-words text-[12px] pb-3">{parsed.text}</p>
                        )}
                        
                        {/* Time & status checks */}
                        <div className="absolute bottom-1 right-2 flex items-center gap-1.5 text-[8px] text-slate-400/80 font-mono select-none">
                          {canDelete && msg._id && (
                            <button
                              type="button"
                              onClick={() => handleDeleteMessage(msg._id)}
                              className="text-slate-400 hover:text-rose-400 transition mr-0.5 cursor-pointer"
                              title="Delete message"
                            >
                              <Trash2 size={10} />
                            </button>
                          )}
                          <span>{time}</span>
                          {isMe && <CheckCheck size={12} className="text-primary-400" />}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
              <div ref={scrollRef} />
            </div>

            {/* Input Bar */}
            <div className="relative shrink-0">
              {/* Emoji Tray Overlay */}
              {showEmojiTray && (
                <div className="absolute bottom-full left-3 bg-dark-900/95 border border-dark-800 backdrop-blur-lg p-3 rounded-2xl shadow-2xl w-64 z-40 grid grid-cols-5 gap-2 animate-scaleUp mb-2">
                  <div className="col-span-5 flex justify-between items-center pb-1.5 border-b border-dark-800 mb-1.5">
                    <span className="text-[10px] uppercase font-bold text-slate-400 font-outfit">Popular Emojis</span>
                    <button onClick={() => setShowEmojiTray(false)} className="text-slate-500 hover:text-white cursor-pointer">
                      <X size={12} />
                    </button>
                  </div>
                  {emojis.map(e => (
                    <button 
                      key={e} 
                      type="button" 
                      onClick={() => handleEmojiClick(e)}
                      className="text-lg p-1 hover:bg-dark-800 rounded-lg transition active:scale-90 cursor-pointer"
                    >
                      {e}
                    </button>
                  ))}
                </div>
              )}

              {/* Main controls form */}
              <form 
                onSubmit={handleSendMessage} 
                className="p-3 bg-dark-900/40 border-t border-dark-800/80 flex gap-2.5 items-center"
              >
                {isRecording ? (
                  /* Audio recording active control bar */
                  <div className="flex-1 bg-dark-950 border border-red-500/20 rounded-xl px-4 py-2 flex justify-between items-center gap-3 animate-fadeIn">
                    <div className="flex items-center gap-2">
                      <span className="w-2 h-2 bg-red-550 rounded-full animate-ping shrink-0" />
                      <span className="text-xs font-bold text-red-500 font-mono">Recording {formatDuration(recordingDuration)}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <button 
                        type="button" 
                        onClick={() => stopRecording(false)}
                        className="px-3.5 py-1.5 rounded-xl bg-dark-900 border border-dark-800 hover:bg-dark-850 text-slate-400 hover:text-white text-xs font-semibold transition active:scale-95 cursor-pointer"
                      >
                        Cancel
                      </button>
                      <button 
                        type="button" 
                        onClick={() => stopRecording(true)}
                        className="px-3.5 py-1.5 rounded-xl bg-primary-600 hover:bg-primary-500 text-white font-bold text-xs transition active:scale-95 flex items-center gap-1.5 cursor-pointer shadow-md shadow-primary-500/15"
                      >
                        <Send size={10} fill="currentColor" /> Send Voice
                      </button>
                    </div>
                  </div>
                ) : (
                  /* Standard Input Bar controls */
                  <>
                    <div className="flex-1 bg-dark-950/85 border border-dark-850 rounded-xl px-3 py-1 flex items-center gap-2.5 focus-within:border-primary-500/40 transition">
                      <button 
                        type="button" 
                        onClick={() => setShowEmojiTray(!showEmojiTray)}
                        className={`p-1.5 rounded-lg hover:bg-dark-900/60 transition cursor-pointer ${showEmojiTray ? 'text-primary-400 bg-primary-500/10' : 'text-slate-400 hover:text-slate-200'}`} 
                        title="Toggle emoji selector tray"
                      >
                        <Smile size={18} />
                      </button>
                      <button 
                        type="button" 
                        onClick={handleAttachmentClick}
                        className="p-1.5 rounded-lg hover:bg-dark-900/60 text-slate-400 hover:text-slate-200 transition cursor-pointer" 
                        title="Upload file handout or photo"
                      >
                        <Paperclip size={18} />
                      </button>
                      <input
                        type="text"
                        placeholder="Type a secure message..."
                        value={typedMessage}
                        onChange={(e) => setTypedMessage(e.target.value)}
                        className="flex-1 bg-transparent border-none outline-none py-2 text-xs text-slate-100 placeholder-slate-550"
                      />
                    </div>
                    
                    {/* Voice/Send Morph button */}
                    {typedMessage.trim() ? (
                      <button
                        type="submit"
                        className="w-10 h-10 rounded-xl bg-primary-600 hover:bg-primary-500 text-white transition flex items-center justify-center shrink-0 shadow-lg shadow-primary-500/15 active:scale-95 cursor-pointer"
                        title="Send text message"
                      >
                        <Send size={16} />
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={startRecording}
                        className="w-10 h-10 rounded-xl bg-primary-600 hover:bg-primary-500 text-white transition flex items-center justify-center shrink-0 shadow-lg shadow-primary-500/15 active:scale-95 cursor-pointer"
                        title="Press to record voice message"
                      >
                        <Mic size={16} />
                      </button>
                    )}
                  </>
                )}
              </form>
            </div>
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center p-8 text-center select-none relative overflow-hidden bg-dark-900/10">
            {/* Ambient Background Glow */}
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-72 h-72 rounded-full bg-primary-650/5 blur-[120px] pointer-events-none" />
            
            <div className="glass-card p-8 rounded-2xl max-w-sm border border-dark-800/80 shadow-2xl relative overflow-hidden flex flex-col items-center glow-indigo animate-scaleUp">
              <Logo className="border border-primary-500/25 rounded-xl bg-dark-950/40 glow-indigo mb-4 p-1.5" size={44} />
              
              <h3 className="text-base font-bold text-white font-outfit tracking-tight">
                EduStride Lounge Channels
              </h3>
              <p className="text-[11px] leading-relaxed text-slate-400 mt-2">
                Audit and participate in real-time encrypted conversations. Select a classroom channel from the roster list to begin.
              </p>
              
              {/* Feature highlights list */}
              <div className="w-full mt-6 pt-4 border-t border-dark-800/60 space-y-2.5 text-[10px] text-left">
                <div className="flex items-center gap-2 text-slate-350">
                  <span className="w-1.5 h-1.5 rounded bg-primary-500 shrink-0" />
                  <span>Secure E2E Encrypted Lounge Channels</span>
                </div>
                <div className="flex items-center gap-2 text-slate-350">
                  <span className="w-1.5 h-1.5 rounded bg-primary-500 shrink-0" />
                  <span>Real-Time Voice Notes & Waveform Players</span>
                </div>
                <div className="flex items-center gap-2 text-slate-350">
                  <span className="w-1.5 h-1.5 rounded bg-primary-500 shrink-0" />
                  <span>Interactive Handout & Attachment Previews</span>
                </div>
                <div className="flex items-center gap-2 text-slate-350">
                  <span className="w-1.5 h-1.5 rounded bg-primary-500 shrink-0" />
                  <span>Message Delete & Recall Broadcasts</span>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* --- ATTACHMENT PREVIEW MODAL --- */}
      {showAttachmentPreview && selectedAttachment && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm px-4">
          <div className="glass-panel w-full max-w-md rounded-2xl overflow-hidden shadow-2xl relative animate-scaleUp border border-dark-800/80 bg-dark-900/95">
            <div className="p-6 border-b border-dark-800 flex justify-between items-center text-white">
              <h3 className="text-base font-bold font-outfit">Send Attachment</h3>
              <button 
                onClick={() => {
                  setSelectedAttachment(null);
                  setShowAttachmentPreview(false);
                }} 
                className="text-slate-500 hover:text-white transition cursor-pointer"
              >
                <X size={20} />
              </button>
            </div>
            
            <div className="p-6 flex flex-col items-center gap-4">
              {selectedAttachment.type === 'image' ? (
                <img 
                  src={selectedAttachment.base64} 
                  alt="Attachment preview" 
                  className="max-h-56 max-w-full rounded-xl object-contain border border-dark-800" 
                />
              ) : (
                <div className="p-4 rounded-xl bg-dark-950 border border-dark-850 flex items-center gap-3 w-full">
                  <div className="p-3 rounded bg-rose-600/20 text-rose-450 border border-rose-500/10 shrink-0">
                    <FileText size={28} />
                  </div>
                  <div className="overflow-hidden flex-1">
                    <p className="text-sm font-bold text-white truncate font-outfit">{selectedAttachment.name}</p>
                    <span className="text-xs text-slate-500 font-mono">{(selectedAttachment.size / 1024).toFixed(1)} KB</span>
                  </div>
                </div>
              )}

              {/* Caption Input */}
              <div className="w-full">
                <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5 font-outfit">Add a caption (optional)</label>
                <input 
                  type="text"
                  placeholder="Type caption message..."
                  value={attachmentCaption}
                  onChange={(e) => setAttachmentCaption(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-dark-900 border border-dark-850 text-white placeholder-slate-550 outline-none text-xs focus:border-primary-500 transition"
                />
              </div>
            </div>

            <div className="p-4 bg-dark-950 border-t border-dark-800/80 flex justify-end gap-2.5">
              <button
                onClick={() => {
                  setSelectedAttachment(null);
                  setShowAttachmentPreview(false);
                }}
                className="px-4 py-2 text-xs font-semibold rounded-xl bg-transparent hover:bg-dark-900 border border-dark-850 text-slate-400 hover:text-white transition cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={sendAttachment}
                className="px-4 py-2 text-xs font-bold rounded-xl bg-primary-600 hover:bg-primary-500 text-white transition cursor-pointer shadow-md shadow-primary-500/10"
              >
                Send File
              </button>
            </div>
          </div>
        </div>
      )}

      {/* --- IMAGE LIGHTBOX FULLSCREEN OVERLAY --- */}
      {activeLightboxImg && (
        <div 
          onClick={() => setActiveLightboxImg(null)}
          className="fixed inset-0 z-[100] bg-black/95 backdrop-blur-md flex flex-col justify-between p-4 cursor-zoom-out select-none animate-fadeIn"
        >
          <div className="flex justify-end pt-2 pr-2">
            <button 
              onClick={() => setActiveLightboxImg(null)}
              className="p-2 rounded-full bg-dark-900/60 hover:bg-dark-800 text-white transition pointer-events-auto cursor-pointer"
            >
              <X size={24} />
            </button>
          </div>
          <div className="flex-1 flex items-center justify-center p-4">
            <img 
              src={activeLightboxImg} 
              alt="Fullscreen preview" 
              className="max-w-full max-h-[85vh] rounded-lg object-contain shadow-2xl" 
            />
          </div>
          <div className="text-center text-[10px] text-slate-500 font-mono pb-2">
            Tap anywhere to return to class chat
          </div>
        </div>
      )}

      {/* --- CUSTOM DELETE CONFIRMATION MODAL --- */}
      {deleteConfirmMsgId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4">
          <div className="glass-panel w-full max-w-sm rounded-2xl overflow-hidden shadow-2xl relative animate-scaleUp border border-dark-800/80 bg-dark-900/95 p-6">
            <div className="flex flex-col items-center text-center gap-4">
              <div className="p-3.5 rounded-xl bg-rose-600/10 text-rose-500 border border-rose-500/10 shadow-inner">
                <Trash2 size={24} />
              </div>
              <div>
                <h3 className="text-sm font-bold text-white font-outfit">Delete message?</h3>
                <p className="text-xs text-slate-400 mt-2 leading-relaxed">
                  Are you sure you want to delete this message? This action is permanent and cannot be undone.
                </p>
              </div>
            </div>
            <div className="flex gap-2.5 mt-6 justify-end">
              <button
                onClick={() => setDeleteConfirmMsgId(null)}
                className="px-4 py-2 text-xs font-semibold rounded-xl bg-transparent hover:bg-dark-900 border border-dark-850 text-slate-400 hover:text-white transition cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  if (socketRef.current) {
                    socketRef.current.emit('delete_message', {
                      message_id: deleteConfirmMsgId,
                      class_level: currentRoom
                    });
                  }
                  setDeleteConfirmMsgId(null);
                }}
                className="px-4 py-2 text-xs font-bold rounded-xl bg-rose-600 hover:bg-rose-500 text-white transition cursor-pointer shadow-md shadow-rose-500/10"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* --- PREMIUM CALLING OVERLAY SCREEN --- */}
      {activeCall && (
        <div className="fixed inset-0 z-[120] bg-dark-950/98 backdrop-blur-lg flex flex-col justify-between p-6 animate-fadeIn text-slate-100 select-none">
          {/* Ambient Background Glow */}
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 rounded-full bg-primary-650/10 blur-[150px] pointer-events-none z-0" />

          {/* Call Header */}
          <div className="flex justify-between items-center z-10">
            <div className="flex items-center gap-2 bg-dark-900/80 border border-dark-800 px-3.5 py-2 rounded-xl text-[10px] text-emerald-400 font-extrabold tracking-wide font-outfit">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
              </span>
              🔒 SECURE INSTITUTIONAL AUDIO STREAM
            </div>
            
            <div className="flex items-center gap-2 bg-dark-900/80 border border-dark-800 px-3.5 py-1.5 rounded-xl text-xs font-mono font-bold text-slate-350">
              ⏱  {formatCallDuration(callDuration)}
            </div>
          </div>

          {/* Call Central Window */}
          <div className="flex-1 flex items-center justify-center z-10 my-8 relative">
            {/* Voice call display */}
            <div className="flex flex-col items-center justify-center gap-6">
              <div className="relative flex items-center justify-center">
                <span className="animate-ping absolute inline-flex h-36 w-36 rounded-full bg-primary-500/10 opacity-75"></span>
                <span className="animate-pulse absolute inline-flex h-28 w-28 rounded-full bg-primary-500/20 opacity-90"></span>
                <div className="w-24 h-24 rounded-2xl bg-gradient-to-tr from-primary-600 to-indigo-500 flex items-center justify-center font-bold text-white text-2xl shadow-xl relative z-10 border border-primary-500/30">
                  <GraduationCap size={40} />
                </div>
              </div>
              
              <div className="text-center">
                <h2 className="text-base font-bold text-white font-outfit">Class {currentRoom} Lounge Call</h2>
                <p className="text-xs text-primary-400 font-semibold mt-1.5">Connected • Joining students lounge...</p>
              </div>
            </div>
          </div>

          {/* Call Controls Bar */}
          <div className="flex justify-center items-center gap-4 z-10">
            <button
              onClick={toggleMute}
              className={`w-12 h-12 rounded-xl flex items-center justify-center border transition active:scale-95 cursor-pointer ${
                isMuted 
                  ? 'bg-rose-500/15 border-rose-500/30 text-rose-400' 
                  : 'bg-dark-900/80 border-dark-800 text-slate-300 hover:bg-dark-855 hover:text-white'
              }`}
              title={isMuted ? 'Unmute microphone' : 'Mute microphone'}
            >
              {isMuted ? <MicOff size={18} /> : <Mic size={18} />}
            </button>

            {isCallHost ? (
              <div className="flex items-center gap-3">
                <button
                  onClick={() => handleEndCall(false)}
                  className="px-4 py-2 rounded-xl bg-dark-900 border border-dark-800 hover:bg-dark-850 hover:text-white text-slate-300 font-semibold text-xs transition active:scale-95 cursor-pointer flex items-center gap-1.5 h-12"
                  title="Leave call locally"
                >
                  <PhoneOff size={16} /> Leave
                </button>
                <button
                  onClick={() => handleEndCall(true)}
                  className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs transition active:scale-95 cursor-pointer shadow-lg shadow-rose-500/20 flex items-center gap-1.5 h-12"
                  title="Terminate call for everyone"
                >
                  <X size={16} /> End for All
                </button>
              </div>
            ) : (
              <button
                onClick={() => handleEndCall(false)}
                className="w-12 h-12 rounded-xl bg-rose-600 hover:bg-rose-500 text-white flex items-center justify-center shadow-lg shadow-rose-500/20 transition active:scale-95 cursor-pointer"
                title="Hang up call"
              >
                <PhoneOff size={20} />
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default ClassChat;
