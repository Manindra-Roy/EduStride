import React, { useState, useEffect, useMemo, useCallback } from 'react';
import axios from 'axios';
import { useAuth } from '../context/AuthContext';
import { socket } from '../config/socket';
import {
  Fingerprint,
  Power,
  Wifi,
  WifiOff,
  CheckCircle2,
  XCircle,
  Clock,
  LogIn,
  LogOut,
  Users,
  Search,
  RefreshCw,
  UserPlus,
  Trash2,
  Key,
  Copy,
  Check,
  Mail,
  Bell,
  BellOff,
  MessageCircle,
  ShieldCheck,
  AlertCircle,
  Sliders,
  ChevronDown,
  ChevronUp,
  Cpu
} from 'lucide-react';

const getTodayIST = () => {
  const ist = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
  return ist.toISOString().split('T')[0];
};

const formatISTTime = (isoDate) => {
  if (!isoDate) return '-';
  try {
    return new Date(isoDate).toLocaleTimeString('en-IN', {
      timeZone: 'Asia/Kolkata',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: true
    });
  } catch {
    return '-';
  }
};

const formatDuration = (mins) => {
  if (mins === null || mins === undefined) return '-';
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
};

const BiometricGatePanel = () => {
  const { user } = useAuth();
  const isStaff = user?.role === 'SuperAdmin' || user?.role === 'Teacher';

  const [activeTab, setActiveTab] = useState('feed'); // 'feed' | 'enroll'
  const [devices, setDevices] = useState([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState('GATE-ESP32-01');
  const [loadingDevices, setLoadingDevices] = useState(isStaff);
  const [togglingSensing, setTogglingSensing] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);

  // Setup credentials drawer
  const [showCredentials, setShowCredentials] = useState(false);
  const [copiedField, setCopiedField] = useState('');

  // Live logs & stats
  const [selectedDate, setSelectedDate] = useState(getTodayIST());
  const [logs, setLogs] = useState([]);
  const [stats, setStats] = useState({ entries_today: 0, exits_today: 0, inside_now: 0, attendance_synced: 0 });
  const [loadingLogs, setLoadingLogs] = useState(true);
  const [classFilter, setClassFilter] = useState('All');
  const [eventFilter, setEventFilter] = useState('All');
  const [searchQuery, setSearchQuery] = useState('');
  const [classes, setClasses] = useState([]);

  // Enrollment state
  const [allStudents, setAllStudents] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [loadingEnrollData, setLoadingEnrollData] = useState(false);
  const [enrollClassFilter, setEnrollClassFilter] = useState('All');
  const [enrollSearch, setEnrollSearch] = useState('');
  const [liveCommand, setLiveCommand] = useState(null);

  // Feedback banners
  const [feedback, setFeedback] = useState({ type: '', text: '' });

  const activeDevice = useMemo(
    () => devices.find(d => d.device_id === selectedDeviceId) || devices[0] || null,
    [devices, selectedDeviceId]
  );

  const showToastBanner = (type, text) => {
    setFeedback({ type, text });
    setTimeout(() => {
      setFeedback(prev => (prev.text === text ? { type: '', text: '' } : prev));
    }, 5000);
  };

  const fetchDevices = useCallback(async (silent = false) => {
    if (!isStaff) return;
    if (!silent) setLoadingDevices(true);
    try {
      const res = await axios.get('/api/biometric/devices');
      if (res.data.success && Array.isArray(res.data.data)) {
        setDevices(res.data.data);
        if (res.data.data.length > 0 && !res.data.data.some(d => d.device_id === selectedDeviceId)) {
          setSelectedDeviceId(res.data.data[0].device_id);
        }
        const current = res.data.data.find(d => d.device_id === selectedDeviceId) || res.data.data[0];
        if (current?.pending_command && current.pending_command.action !== 'NONE') {
          setLiveCommand(current.pending_command);
        }
      }
    } catch (err) {
      if (!silent) showToastBanner('error', err.response?.data?.message || 'Failed to load gate scanner status');
    } finally {
      if (!silent) setLoadingDevices(false);
    }
  }, [isStaff, selectedDeviceId]);

  const fetchLogs = useCallback(async (silent = false) => {
    if (!silent) setLoadingLogs(true);
    try {
      const params = new URLSearchParams();
      if (selectedDate) params.append('date', selectedDate);
      if (isStaff && classFilter !== 'All') params.append('class_level', classFilter);
      if (isStaff && eventFilter !== 'All') params.append('event_type', eventFilter);
      if (isStaff && searchQuery.trim()) params.append('search', searchQuery.trim());

      const res = await axios.get(`/api/biometric/logs?${params.toString()}`);
      if (res.data.success) {
        setLogs(res.data.data || []);
        setStats(res.data.stats || { entries_today: 0, exits_today: 0, inside_now: 0, attendance_synced: 0 });
      }
    } catch (err) {
      console.error('Failed to fetch gate logs:', err);
    } finally {
      if (!silent) setLoadingLogs(false);
    }
  }, [selectedDate, classFilter, eventFilter, searchQuery, isStaff]);

  const fetchEnrollmentData = useCallback(async () => {
    if (!isStaff || !selectedDeviceId) return;
    setLoadingEnrollData(true);
    try {
      const [studentsRes, templatesRes] = await Promise.all([
        axios.get('/api/students?limit=1000'),
        axios.get(`/api/biometric/templates/${selectedDeviceId}`)
      ]);
      if (studentsRes.data.success) {
        setAllStudents((studentsRes.data.data || []).filter(s => s.status === 'Active'));
      }
      if (templatesRes.data.success) {
        setTemplates(templatesRes.data.data || []);
      }
    } catch (err) {
      console.error('Failed to load enrollment roster:', err);
    } finally {
      setLoadingEnrollData(false);
    }
  }, [isStaff, selectedDeviceId]);

  // Initial loads
  useEffect(() => {
    if (isStaff) {
      fetchDevices();
      axios.get('/api/classes').then(res => {
        if (res.data.success && Array.isArray(res.data.data)) {
          setClasses(res.data.data);
        }
      }).catch(() => {});
    }
  }, [isStaff, fetchDevices]);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  useEffect(() => {
    if (isStaff && activeTab === 'enroll') {
      fetchEnrollmentData();
    }
  }, [isStaff, activeTab, fetchEnrollmentData]);

  // Poll device heartbeat status every 6 seconds while panel is open
  useEffect(() => {
    if (!isStaff) return;
    const interval = setInterval(() => {
      fetchDevices(true);
    }, 6000);
    return () => clearInterval(interval);
  }, [isStaff, fetchDevices]);

  // Subscribe to Socket.IO for live scan, attendance & enrollment updates (Staff + Students)
  useEffect(() => {
    if (!user) return;
    if (!socket.connected) socket.connect();

    const joinLiveRooms = () => {
      if (isStaff) {
        socket.emit('join_room', 'GATE_MONITOR');
      } else {
        const sid = user.studentProfile?._id || (typeof user.studentProfile === 'string' ? user.studentProfile : null);
        if (sid) socket.emit('join_room', `USER_${sid}`);
      }
    };

    joinLiveRooms();

    const handleScanEvent = (newLog) => {
      if (!newLog) return;
      if (newLog.date === selectedDate) {
        setLogs(prev => {
          const withoutDup = prev.filter(item => item._id !== newLog._id);
          return [newLog, ...withoutDup];
        });
        fetchLogs(true);
      }
    };

    const handleDeviceUpdated = (updatedDev) => {
      if (!isStaff) return;
      setDevices(prev => prev.map(d => (d.device_id === updatedDev.device_id ? { ...d, ...updatedDev } : d)));
    };

    const handleCommandUpdate = (cmdData) => {
      if (!isStaff) return;
      setLiveCommand(cmdData);
      if (cmdData.status === 'COMPLETED' || cmdData.status === 'FAILED') {
        fetchDevices(true);
        if (activeTab === 'enroll') fetchEnrollmentData();
      }
    };

    socket.on('connect', joinLiveRooms);
    socket.on('gate_scan_event', handleScanEvent);
    socket.on('gate_device_updated', handleDeviceUpdated);
    socket.on('gate_command_update', handleCommandUpdate);

    return () => {
      socket.off('connect', joinLiveRooms);
      socket.off('gate_scan_event', handleScanEvent);
      socket.off('gate_device_updated', handleDeviceUpdated);
      socket.off('gate_command_update', handleCommandUpdate);
    };
  }, [user, isStaff, selectedDate, activeTab, fetchLogs, fetchDevices, fetchEnrollmentData]);

  // Toggle Fingerprint Sensing ON / OFF remotely
  const handleToggleSensing = async () => {
    if (!activeDevice || togglingSensing) return;
    setTogglingSensing(true);
    try {
      const nextState = !activeDevice.sensing_enabled;
      const res = await axios.put(`/api/biometric/devices/${activeDevice.device_id}/toggle`, {
        sensing_enabled: nextState
      });
      if (res.data.success) {
        setDevices(prev => prev.map(d => (d.device_id === activeDevice.device_id ? res.data.data : d)));
        showToastBanner(
          'success',
          nextState
            ? 'Fingerprint Sensing turned ON — ESP32 will resume scanning within 2 seconds.'
            : 'Fingerprint Sensing turned OFF — ESP32 will pause & switch off sensor LED within 2 seconds.'
        );
      }
    } catch (err) {
      showToastBanner('error', err.response?.data?.message || 'Failed to toggle fingerprint sensing');
    } finally {
      setTogglingSensing(false);
    }
  };

  // Toggle Auto-Mark Attendance or Cooldown setting
  const handleUpdateSetting = async (patch) => {
    if (!activeDevice || savingSettings) return;
    setSavingSettings(true);
    try {
      const res = await axios.put(`/api/biometric/devices/${activeDevice.device_id}/toggle`, patch);
      if (res.data.success) {
        setDevices(prev => prev.map(d => (d.device_id === activeDevice.device_id ? res.data.data : d)));
        showToastBanner('success', 'Scanner setting saved.');
      }
    } catch (err) {
      showToastBanner('error', err.response?.data?.message || 'Failed to update scanner setting');
    } finally {
      setSavingSettings(false);
    }
  };

  // Queue remote fingerprint enrollment on ESP32
  const handleStartEnroll = async (student) => {
    if (!activeDevice) return;
    try {
      const res = await axios.post(`/api/biometric/devices/${activeDevice.device_id}/enroll`, {
        student_id: student._id
      });
      if (res.data.success) {
        setLiveCommand(res.data.data.pending_command);
        showToastBanner('success', res.data.message);
      }
    } catch (err) {
      showToastBanner('error', err.response?.data?.message || 'Failed to queue fingerprint enrollment');
    }
  };

  // Delete student fingerprint from DB & ESP32 R307S
  const handleRemoveTemplate = async (student) => {
    if (!activeDevice) return;
    if (!window.confirm(`Remove fingerprint for ${student.name}? They will need to re-enroll to use the scanner.`)) {
      return;
    }
    try {
      const res = await axios.delete(`/api/biometric/devices/${activeDevice.device_id}/templates/${student._id}`);
      if (res.data.success) {
        showToastBanner('success', res.data.message);
        fetchEnrollmentData();
        fetchDevices(true);
      }
    } catch (err) {
      showToastBanner('error', err.response?.data?.message || 'Failed to remove fingerprint');
    }
  };

  const handleCancelCommand = async () => {
    if (!activeDevice) return;
    try {
      await axios.post(`/api/biometric/devices/${activeDevice.device_id}/cancel-command`);
      setLiveCommand(null);
      fetchDevices(true);
    } catch {
      // ignore
    }
  };

  const handleCopy = (label, value) => {
    if (!value) return;
    navigator.clipboard?.writeText(value);
    setCopiedField(label);
    setTimeout(() => setCopiedField(''), 2000);
  };

  // Map studentId -> template for Enrollment tab
  const templateByStudentId = useMemo(() => {
    const map = new Map();
    templates.forEach(t => {
      const sid = t.student?._id || t.student;
      if (sid) map.set(String(sid), t);
    });
    return map;
  }, [templates]);

  const filteredEnrollStudents = useMemo(() => {
    return allStudents.filter(s => {
      const matchClass = enrollClassFilter === 'All' || s.class_level === enrollClassFilter;
      const q = enrollSearch.trim().toLowerCase();
      const matchQuery = !q || s.name?.toLowerCase().includes(q) || s.roll_number?.toLowerCase().includes(q);
      return matchClass && matchQuery;
    });
  }, [allStudents, enrollClassFilter, enrollSearch]);

  const serverUrlForConfig = import.meta.env.VITE_API_URL || window.location.origin;

  return (
    <div className="space-y-6 animate-fadeIn">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="p-2.5 rounded-xl bg-primary-600/15 border border-primary-500/30 text-primary-400">
              <Fingerprint size={22} />
            </div>
            <div>
              <h1 className="text-xl sm:text-2xl font-bold text-white font-outfit tracking-tight">
                {isStaff ? 'Biometric Gate Scanner' : 'My Gate Entry & Exit Logs'}
              </h1>
              <p className="text-xs text-slate-400 mt-0.5">
                {isStaff
                  ? 'ESP32 R307S remote sensing control, automatic attendance sync & instant parent alerts'
                  : 'Your real-time campus arrival and departure timestamps'}
              </p>
            </div>
          </div>
        </div>

        <button
          onClick={() => {
            fetchLogs();
            if (isStaff) fetchDevices();
            if (isStaff && activeTab === 'enroll') fetchEnrollmentData();
          }}
          className="self-start sm:self-auto px-3.5 py-2 rounded-xl bg-dark-900 hover:bg-dark-800 border border-dark-800 text-xs font-semibold text-slate-200 transition flex items-center gap-2"
        >
          <RefreshCw size={14} />
          <span>Refresh</span>
        </button>
      </div>

      {/* Feedback Banner */}
      {feedback.text && (
        <div
          className={`p-3.5 rounded-xl border text-xs font-medium flex items-center gap-2.5 ${
            feedback.type === 'error'
              ? 'bg-rose-500/10 border-rose-500/30 text-rose-300'
              : 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
          }`}
        >
          {feedback.type === 'error' ? <AlertCircle size={16} className="shrink-0" /> : <CheckCircle2 size={16} className="shrink-0" />}
          <span>{feedback.text}</span>
        </div>
      )}

      {/* STAFF REMOTE CONTROL CARD */}
      {isStaff && (
        <div className="glass-panel p-4 sm:p-6 rounded-2xl border border-dark-800 space-y-5">
          {loadingDevices && !activeDevice ? (
            <div className="py-6 text-center text-xs text-slate-400">Loading ESP32 scanner status...</div>
          ) : activeDevice ? (
            <>
              <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                {/* Device Identity & Live Connection */}
                <div className="flex items-start sm:items-center gap-3.5">
                  <div
                    className={`w-12 h-12 rounded-2xl flex items-center justify-center border shrink-0 ${
                      activeDevice.sensing_enabled
                        ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-400'
                        : 'bg-rose-500/15 border-rose-500/30 text-rose-400'
                    }`}
                  >
                    <Cpu size={24} />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h2 className="text-base sm:text-lg font-bold text-white font-outfit">{activeDevice.name}</h2>
                      <span className="text-[10px] font-mono px-2 py-0.5 rounded-md bg-dark-900 border border-dark-800 text-slate-300">
                        {activeDevice.device_id}
                      </span>
                      <span
                        className={`inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider px-2.5 py-0.5 rounded-full border ${
                          activeDevice.is_online
                            ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                            : 'bg-slate-800/80 text-slate-400 border-dark-700'
                        }`}
                      >
                        {activeDevice.is_online ? <Wifi size={11} /> : <WifiOff size={11} />}
                        {activeDevice.is_online ? 'ESP32 Online' : 'ESP32 Offline'}
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-400 mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
                      <span>Enrolled Prints: <strong className="text-slate-200">{activeDevice.enrolled_count ?? 0} / 1000</strong></span>
                      {activeDevice.last_heartbeat && (
                        <span>Last Seen: <strong className="text-slate-200">{formatISTTime(activeDevice.last_heartbeat)}</strong></span>
                      )}
                      {activeDevice.ip_address && (
                        <span className="font-mono text-[10px] text-slate-500">IP: {activeDevice.ip_address}</span>
                      )}
                    </p>
                  </div>
                </div>

                {/* Big Thumb-Friendly Sensing ON / OFF Remote Switch */}
                <button
                  onClick={handleToggleSensing}
                  disabled={togglingSensing}
                  className={`w-full lg:w-auto px-5 py-3.5 rounded-2xl font-bold text-sm transition flex items-center justify-center gap-3 shadow-lg active:scale-[0.98] disabled:opacity-60 ${
                    activeDevice.sensing_enabled
                      ? 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-emerald-600/20 border border-emerald-400/30'
                      : 'bg-rose-600 hover:bg-rose-500 text-white shadow-rose-600/20 border border-rose-400/30'
                  }`}
                >
                  <Power size={18} />
                  <div className="text-left">
                    <span className="block leading-tight">
                      {togglingSensing
                        ? 'Updating ESP32...'
                        : activeDevice.sensing_enabled
                          ? 'Fingerprint Sensing: ON'
                          : 'Fingerprint Sensing: OFF'}
                    </span>
                    <span className="block text-[10px] font-medium opacity-85">
                      {activeDevice.sensing_enabled ? 'Tap to Pause / Turn Off Scanner' : 'Tap to Resume / Turn On Scanner'}
                    </span>
                  </div>
                </button>
              </div>

              {/* Quick Settings Row */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-3 border-t border-dark-800/80">
                {/* Auto-Mark Attendance Switch */}
                <div className="p-3.5 rounded-xl bg-dark-950/60 border border-dark-800/80 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 text-xs font-bold text-white">
                      <ShieldCheck size={14} className="text-primary-400 shrink-0" />
                      <span>Auto-Mark Attendance</span>
                    </div>
                    <p className="text-[11px] text-slate-400 mt-0.5">
                      Marks scanned students Present in ClassGrid automatically; manual edits still work.
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={savingSettings}
                    onClick={() => handleUpdateSetting({ auto_mark_attendance: !activeDevice.auto_mark_attendance })}
                    className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${
                      activeDevice.auto_mark_attendance ? 'bg-primary-600' : 'bg-dark-800'
                    }`}
                    aria-label="Toggle Auto-Mark Attendance"
                  >
                    <span
                      className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                        activeDevice.auto_mark_attendance ? 'translate-x-6' : 'translate-x-1'
                      }`}
                    />
                  </button>
                </div>

                {/* Pause / Resume Parent Entry & Exit Messages Switch */}
                <div className="p-3.5 rounded-xl bg-dark-950/60 border border-dark-800/80 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 text-xs font-bold text-white">
                      {activeDevice.parent_alerts_enabled !== false ? (
                        <Bell size={14} className="text-emerald-400 shrink-0" />
                      ) : (
                        <BellOff size={14} className="text-amber-400 shrink-0" />
                      )}
                      <span>
                        Parent Messages:{' '}
                        <span className={activeDevice.parent_alerts_enabled !== false ? 'text-emerald-400' : 'text-amber-400'}>
                          {activeDevice.parent_alerts_enabled !== false ? 'ON' : 'PAUSED'}
                        </span>
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-400 mt-0.5">
                      {activeDevice.parent_alerts_enabled !== false
                        ? 'Sends instant Entry/Exit email & app push alerts to parents.'
                        : 'Entry/Exit parent alerts are paused; scans & attendance still log.'}
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={savingSettings}
                    onClick={() =>
                      handleUpdateSetting({
                        parent_alerts_enabled: !(activeDevice.parent_alerts_enabled !== false)
                      })
                    }
                    className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${
                      activeDevice.parent_alerts_enabled !== false ? 'bg-emerald-600' : 'bg-amber-600/40 border border-amber-500/40'
                    }`}
                    aria-label="Toggle Parent Entry and Exit Messages"
                  >
                    <span
                      className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                        activeDevice.parent_alerts_enabled !== false ? 'translate-x-6' : 'translate-x-1'
                      }`}
                    />
                  </button>
                </div>

                {/* Cooldown Selector */}
                <div className="p-3.5 rounded-xl bg-dark-950/60 border border-dark-800/80 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 text-xs font-bold text-white">
                      <Sliders size={14} className="text-amber-400 shrink-0" />
                      <span>Double-Scan Cooldown</span>
                    </div>
                    <p className="text-[11px] text-slate-400 mt-0.5">
                      Minimum gap before Entry can flip to Exit (avoids accidental double scans).
                    </p>
                  </div>
                  <select
                    value={activeDevice.cooldown_seconds || 120}
                    disabled={savingSettings}
                    onChange={(e) => handleUpdateSetting({ cooldown_seconds: Number(e.target.value) })}
                    className="px-3 py-1.5 rounded-lg bg-dark-900 border border-dark-700 text-xs font-semibold text-white outline-none focus:border-primary-500 shrink-0"
                  >
                    <option value={15}>15 sec (Test)</option>
                    <option value={60}>1 min</option>
                    <option value={120}>2 min</option>
                    <option value={300}>5 min</option>
                    <option value={600}>10 min</option>
                  </select>
                </div>
              </div>

              {/* Collapsible ESP32 Firmware Setup Credentials */}
              <div className="rounded-xl bg-dark-950/70 border border-dark-800/80 overflow-hidden">
                <button
                  type="button"
                  onClick={() => setShowCredentials(prev => !prev)}
                  className="w-full px-4 py-2.5 flex items-center justify-between text-xs font-semibold text-slate-300 hover:text-white transition"
                >
                  <span className="flex items-center gap-2">
                    <Key size={13} className="text-primary-400" />
                    <span>ESP32 Setup Credentials (for firmware/edustride_esp32_gate/config.h)</span>
                  </span>
                  {showCredentials ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
                </button>

                {showCredentials && (
                  <div className="px-4 pb-4 pt-1 space-y-2.5 border-t border-dark-800/60 text-xs">
                    {[
                      { label: 'SERVER_BASE_URL', val: serverUrlForConfig },
                      { label: 'DEVICE_ID', val: activeDevice.device_id },
                      { label: 'DEVICE_API_KEY', val: activeDevice.api_key }
                    ].map(item => (
                      <div key={item.label} className="flex items-center justify-between gap-2 bg-dark-900/90 px-3 py-2 rounded-lg border border-dark-800">
                        <div className="min-w-0">
                          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 block">{item.label}</span>
                          <code className="text-[11px] text-primary-300 break-all">{item.val}</code>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleCopy(item.label, item.val)}
                          className="p-1.5 rounded-lg bg-dark-800 hover:bg-dark-700 text-slate-300 shrink-0"
                          title={`Copy ${item.label}`}
                        >
                          {copiedField === item.label ? <Check size={14} className="text-emerald-400" /> : <Copy size={14} />}
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          ) : null}
        </div>
      )}

      {/* LIVE ENROLLMENT / COMMAND STATUS BANNER */}
      {isStaff && liveCommand && liveCommand.status && liveCommand.status !== 'IDLE' && (
        <div
          className={`p-4 rounded-2xl border flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
            liveCommand.status === 'COMPLETED'
              ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-200'
              : liveCommand.status === 'FAILED'
                ? 'bg-rose-500/10 border-rose-500/30 text-rose-200'
                : 'bg-primary-500/10 border-primary-500/30 text-primary-200'
          }`}
        >
          <div className="flex items-start gap-3">
            <Fingerprint size={20} className="shrink-0 mt-0.5 animate-pulse" />
            <div className="text-xs">
              <p className="font-bold uppercase tracking-wider">
                {liveCommand.action !== 'NONE' ? liveCommand.action : 'Device Command'} &bull; {liveCommand.status}
                {liveCommand.slot_id ? ` (Slot #${liveCommand.slot_id})` : ''}
              </p>
              <p className="text-slate-200 mt-0.5">
                {liveCommand.message || `Processing command for ${liveCommand.student_name || 'student'}...`}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 self-end sm:self-auto">
            {(liveCommand.status === 'PENDING' || liveCommand.status === 'IN_PROGRESS') ? (
              <button
                onClick={handleCancelCommand}
                className="px-3 py-1.5 rounded-lg bg-dark-900/90 hover:bg-dark-800 border border-dark-700 text-[11px] font-semibold text-slate-200"
              >
                Cancel
              </button>
            ) : (
              <button
                onClick={() => setLiveCommand(null)}
                className="px-3 py-1.5 rounded-lg bg-dark-900/90 hover:bg-dark-800 border border-dark-700 text-[11px] font-semibold text-slate-200"
              >
                Dismiss
              </button>
            )}
          </div>
        </div>
      )}

      {/* KPI SUMMARY CARDS */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <div className="glass-panel p-4 rounded-2xl border border-dark-800">
          <div className="flex items-center justify-between text-slate-400 text-xs">
            <span>Entries ({selectedDate === getTodayIST() ? 'Today' : selectedDate})</span>
            <LogIn size={16} className="text-emerald-400" />
          </div>
          <p className="text-2xl font-extrabold text-white font-outfit mt-2">{stats.entries_today}</p>
        </div>

        <div className="glass-panel p-4 rounded-2xl border border-dark-800">
          <div className="flex items-center justify-between text-slate-400 text-xs">
            <span>Exits</span>
            <LogOut size={16} className="text-amber-400" />
          </div>
          <p className="text-2xl font-extrabold text-white font-outfit mt-2">{stats.exits_today}</p>
        </div>

        <div className="glass-panel p-4 rounded-2xl border border-dark-800">
          <div className="flex items-center justify-between text-slate-400 text-xs">
            <span>Currently Inside</span>
            <Users size={16} className="text-primary-400" />
          </div>
          <p className="text-2xl font-extrabold text-white font-outfit mt-2">{stats.inside_now}</p>
        </div>

        <div className="glass-panel p-4 rounded-2xl border border-dark-800">
          <div className="flex items-center justify-between text-slate-400 text-xs">
            <span>Auto-Marked Present</span>
            <CheckCircle2 size={16} className="text-cyan-400" />
          </div>
          <p className="text-2xl font-extrabold text-white font-outfit mt-2">{stats.attendance_synced}</p>
        </div>
      </div>

      {/* STAFF TABS */}
      {isStaff && (
        <div className="flex items-center gap-2 border-b border-dark-800 pb-2">
          <button
            onClick={() => setActiveTab('feed')}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition flex items-center gap-2 ${
              activeTab === 'feed'
                ? 'bg-primary-600 text-white shadow-md shadow-primary-600/20'
                : 'bg-dark-900/60 text-slate-400 hover:text-white border border-dark-800'
            }`}
          >
            <Clock size={14} />
            <span>Live Entry &amp; Exit Feed</span>
          </button>

          <button
            onClick={() => setActiveTab('enroll')}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition flex items-center gap-2 ${
              activeTab === 'enroll'
                ? 'bg-primary-600 text-white shadow-md shadow-primary-600/20'
                : 'bg-dark-900/60 text-slate-400 hover:text-white border border-dark-800'
            }`}
          >
            <UserPlus size={14} />
            <span>Enroll Fingerprints ({activeDevice?.enrolled_count ?? templates.length})</span>
          </button>
        </div>
      )}

      {/* TAB 1: LIVE ENTRY / EXIT FEED */}
      {(!isStaff || activeTab === 'feed') && (
        <div className="glass-panel p-4 sm:p-5 rounded-2xl border border-dark-800 space-y-4">
          {/* Filters */}
          <div className="flex flex-col sm:flex-row flex-wrap gap-3 items-stretch sm:items-center justify-between">
            <div className="flex flex-wrap items-center gap-2.5">
              <input
                type="date"
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                className="px-3 py-2 rounded-xl bg-dark-900 border border-dark-800 text-xs text-white outline-none focus:border-primary-500"
              />

              {isStaff && (
                <>
                  <select
                    value={classFilter}
                    onChange={(e) => setClassFilter(e.target.value)}
                    className="px-3 py-2 rounded-xl bg-dark-900 border border-dark-800 text-xs text-white outline-none focus:border-primary-500"
                  >
                    <option value="All">All Classes</option>
                    {classes.map(c => (
                      <option key={c} value={c}>Class {c}</option>
                    ))}
                  </select>

                  <select
                    value={eventFilter}
                    onChange={(e) => setEventFilter(e.target.value)}
                    className="px-3 py-2 rounded-xl bg-dark-900 border border-dark-800 text-xs text-white outline-none focus:border-primary-500"
                  >
                    <option value="All">Entry &amp; Exit</option>
                    <option value="ENTRY">Entry Only</option>
                    <option value="EXIT">Exit Only</option>
                  </select>
                </>
              )}
            </div>

            {isStaff && (
              <div className="relative flex-1 sm:max-w-xs">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                <input
                  type="text"
                  placeholder="Search student or roll..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 rounded-xl bg-dark-900 border border-dark-800 text-xs text-white placeholder-slate-500 outline-none focus:border-primary-500"
                />
              </div>
            )}
          </div>

          {/* Logs List */}
          {loadingLogs ? (
            <div className="py-12 text-center">
              <div className="animate-spin rounded-full h-7 w-7 border-t-2 border-primary-500 mx-auto"></div>
            </div>
          ) : logs.length === 0 ? (
            <div className="py-12 text-center text-xs text-slate-500 bg-dark-950/40 rounded-xl border border-dark-800/60">
              No biometric entry or exit scans recorded for {selectedDate}.
            </div>
          ) : (
            <div className="space-y-2.5">
              {logs.map(log => {
                const isEntry = log.event_type === 'ENTRY';
                return (
                  <div
                    key={log._id}
                    className="p-3.5 rounded-xl bg-dark-900/70 border border-dark-800/90 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                  >
                    <div className="flex items-start sm:items-center gap-3 min-w-0">
                      <div
                        className={`p-2.5 rounded-xl border shrink-0 ${
                          isEntry
                            ? 'bg-emerald-500/10 border-emerald-500/25 text-emerald-400'
                            : 'bg-amber-500/10 border-amber-500/25 text-amber-400'
                        }`}
                      >
                        {isEntry ? <LogIn size={16} /> : <LogOut size={16} />}
                      </div>

                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-bold text-white truncate">
                            {log.student?.name || 'Unknown Student'}
                          </span>
                          {log.student?.class_level && (
                            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-md bg-dark-950 border border-dark-800 text-slate-300">
                              Class {log.student.class_level} &bull; Roll {log.student.roll_number}
                            </span>
                          )}
                          <span
                            className={`text-[10px] font-extrabold uppercase tracking-wider px-2 py-0.5 rounded-full border ${
                              isEntry
                                ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
                                : 'bg-amber-500/15 text-amber-400 border-amber-500/30'
                            }`}
                          >
                            {log.event_type}
                          </span>
                        </div>

                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-400 mt-1">
                          <span className="font-mono text-slate-200 font-semibold">{formatISTTime(log.timestamp)}</span>
                          {!isEntry && log.duration_minutes !== null && (
                            <span>Duration: <strong className="text-slate-200">{formatDuration(log.duration_minutes)}</strong></span>
                          )}
                          {log.attendance_marked && (
                            <span className="inline-flex items-center gap-1 text-cyan-400 font-medium">
                              <CheckCircle2 size={11} />
                              Present ({log.attendance_session || 'Session 1'})
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Parent Notification Badges + 1-Tap WhatsApp */}
                    <div className="flex items-center gap-2 flex-wrap sm:justify-end shrink-0">
                      {log.notification?.paused ? (
                        <span
                          className="inline-flex items-center gap-1 text-[10px] font-semibold px-2.5 py-1 rounded-lg border bg-amber-500/10 text-amber-300 border-amber-500/25"
                          title="Parent Entry/Exit messages were paused during this scan"
                        >
                          <BellOff size={11} />
                          Alerts Paused
                        </span>
                      ) : (
                        <>
                          <span
                            className={`inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-1 rounded-lg border ${
                              log.notification?.push_sent
                                ? 'bg-indigo-500/10 text-indigo-300 border-indigo-500/20'
                                : 'bg-dark-950 text-slate-500 border-dark-800'
                            }`}
                            title="Mobile App Push Notification"
                          >
                            <Bell size={11} />
                            Push
                          </span>

                          <span
                            className={`inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-1 rounded-lg border ${
                              log.notification?.email_sent
                                ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/20'
                                : 'bg-dark-950 text-slate-500 border-dark-800'
                            }`}
                            title={log.notification?.email_sent ? `Emailed ${log.notification.email_to}` : (log.notification?.email_error || 'Email not sent')}
                          >
                            <Mail size={11} />
                            {log.notification?.email_sent ? 'Emailed' : 'No Email'}
                          </span>
                        </>
                      )}

                      {isStaff && log.notification?.whatsapp_link && (
                        <a
                          href={log.notification.whatsapp_link}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-[10px] font-bold px-2.5 py-1 rounded-lg bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 border border-emerald-500/30 transition"
                          title="Send WhatsApp alert to parent"
                        >
                          <MessageCircle size={11} />
                          WhatsApp
                        </a>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* TAB 2: FINGERPRINT ENROLLMENT MANAGER (Staff Only) */}
      {isStaff && activeTab === 'enroll' && (
        <div className="glass-panel p-4 sm:p-5 rounded-2xl border border-dark-800 space-y-4">
          <div className="p-3.5 rounded-xl bg-primary-500/5 border border-primary-500/20 text-xs text-slate-300">
            <strong className="text-primary-300">How Remote Enrollment Works:</strong> Make sure your ESP32 scanner is{' '}
            <strong className="text-emerald-400">Online</strong>, tap <strong>Enroll</strong> next to a student below,
            then have the student place their finger twice on the R307S sensor following the 0.96&quot; OLED prompts.
          </div>

          <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center justify-between">
            <select
              value={enrollClassFilter}
              onChange={(e) => setEnrollClassFilter(e.target.value)}
              className="px-3 py-2 rounded-xl bg-dark-900 border border-dark-800 text-xs text-white outline-none focus:border-primary-500"
            >
              <option value="All">All Classes</option>
              {classes.map(c => (
                <option key={c} value={c}>Class {c}</option>
              ))}
            </select>

            <div className="relative flex-1 sm:max-w-xs">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
              <input
                type="text"
                placeholder="Search student to enroll..."
                value={enrollSearch}
                onChange={(e) => setEnrollSearch(e.target.value)}
                className="w-full pl-9 pr-3 py-2 rounded-xl bg-dark-900 border border-dark-800 text-xs text-white placeholder-slate-500 outline-none focus:border-primary-500"
              />
            </div>
          </div>

          {loadingEnrollData ? (
            <div className="py-12 text-center">
              <div className="animate-spin rounded-full h-7 w-7 border-t-2 border-primary-500 mx-auto"></div>
            </div>
          ) : filteredEnrollStudents.length === 0 ? (
            <div className="py-10 text-center text-xs text-slate-500">No active students match your filter.</div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {filteredEnrollStudents.map(student => {
                const tmpl = templateByStudentId.get(String(student._id));
                return (
                  <div
                    key={student._id}
                    className="p-3.5 rounded-xl bg-dark-900/70 border border-dark-800/90 flex items-center justify-between gap-3"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-bold text-white truncate">{student.name}</p>
                      <div className="flex items-center gap-2 mt-1 flex-wrap">
                        <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-dark-950 border border-dark-800 text-slate-300">
                          Class {student.class_level} &bull; Roll {student.roll_number}
                        </span>
                        {tmpl ? (
                          <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                            <CheckCircle2 size={10} />
                            Enrolled (Slot #{tmpl.slot_id})
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-dark-950 text-slate-500 border border-dark-800">
                            <XCircle size={10} />
                            Not Enrolled
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => handleStartEnroll(student)}
                        className="px-3 py-1.5 rounded-xl bg-primary-600 hover:bg-primary-500 text-white text-xs font-bold transition flex items-center gap-1.5"
                      >
                        <Fingerprint size={13} />
                        <span>{tmpl ? 'Re-Enroll' : 'Enroll'}</span>
                      </button>

                      {tmpl && (
                        <button
                          type="button"
                          onClick={() => handleRemoveTemplate(student)}
                          className="p-2 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/20 transition"
                          title="Remove fingerprint from sensor"
                        >
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default BiometricGatePanel;
