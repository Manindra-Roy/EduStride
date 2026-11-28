import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import axios from 'axios';
import { useAuth } from '../context/AuthContext';
import { socket } from '../config/socket';
import { getTodayIST } from '../utils/istDate';
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
  Cpu,
  Plus,
  RotateCcw,
  Bookmark,
  AlertTriangle,
  ArrowRight,
  Sparkles,
  X,
  Activity,
  Radio
} from 'lucide-react';

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
  const isSuperAdmin = user?.role === 'SuperAdmin';

  const [activeTab, setActiveTab] = useState('feed'); // 'feed' | 'enroll'
  const [devices, setDevices] = useState([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState('GATE-ESP32-01');
  const [loadingDevices, setLoadingDevices] = useState(isStaff);
  const [togglingSensing, setTogglingSensing] = useState(false);
  const [togglingPower, setTogglingPower] = useState(false);
  const [rebootingDevice, setRebootingDevice] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);
  const enrollingRef = useRef(false);

  // Setup credentials drawer & device management
  const [showSettingsDrawer, setShowSettingsDrawer] = useState(false);
  const [showTrayControls, setShowTrayControls] = useState(false);
  const [showCredentials, setShowCredentials] = useState(false);
  const [copiedField, setCopiedField] = useState('');
  const [pinnedSessionInput, setPinnedSessionInput] = useState('');
  const [trayForm, setTrayForm] = useState({
    enabled: true,
    mode: 'LIMIT_360',
    invert_direction: false,
    speed_pct: 80,
    stop_us: 1500,
    open_ms: 1060,
    close_ms: 1060,
    closed_angle: 10,
    open_angle: 110,
    sweep_speed_dps: 120,
    max_run_ms: 4500,
    auto_home_on_boot: false
  });
  const [showTrayAdvanced, setShowTrayAdvanced] = useState(false);
  const [trayNudgeMs, setTrayNudgeMs] = useState(200);
  const [sendingTrayCmd, setSendingTrayCmd] = useState('');
  const [showAddDeviceModal, setShowAddDeviceModal] = useState(false);
  const [newDeviceId, setNewDeviceId] = useState('');
  const [newDeviceName, setNewDeviceName] = useState('');
  const [creatingDevice, setCreatingDevice] = useState(false);
  const [clearingAll, setClearingAll] = useState(false);

  // Live logs & stats
  const [selectedDate, setSelectedDate] = useState(getTodayIST());
  const [logs, setLogs] = useState([]);
  const [stats, setStats] = useState({ entries_today: 0, exits_today: 0, inside_now: 0, attendance_synced: 0 });
  const [loadingLogs, setLoadingLogs] = useState(true);
  const [classFilter, setClassFilter] = useState('All');
  const [eventFilter, setEventFilter] = useState('All');
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState('');
  const [classes, setClasses] = useState([]);
  const liveLogSyncTimerRef = useRef(null);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearchQuery(searchQuery.trim()), 300);
    return () => clearTimeout(t);
  }, [searchQuery]);

  // Enrollment state
  const [allStudents, setAllStudents] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [loadingEnrollData, setLoadingEnrollData] = useState(false);
  const [enrollClassFilter, setEnrollClassFilter] = useState('All');
  const [enrollStatusFilter, setEnrollStatusFilter] = useState('all'); // 'all' | 'unenrolled' | 'enrolled'
  const [enrollSearch, setEnrollSearch] = useState('');
  const [liveCommand, setLiveCommand] = useState(null);
  const [enrollWizardStudent, setEnrollWizardStudent] = useState(null);
  const [enrollWizardFingerIndex, setEnrollWizardFingerIndex] = useState(1);
  const [showEnrollWizard, setShowEnrollWizard] = useState(false);
  const [syncingSlots, setSyncingSlots] = useState(false);

  // Feedback banners
  const [feedback, setFeedback] = useState({ type: '', text: '' });
  const feedbackTimerRef = useRef(null);
  const copyTimerRef = useRef(null);

  useEffect(() => {
    return () => {
      if (feedbackTimerRef.current) clearTimeout(feedbackTimerRef.current);
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    };
  }, []);

  const activeDevice = useMemo(
    () => devices.find(d => d.device_id === selectedDeviceId) || devices[0] || null,
    [devices, selectedDeviceId]
  );

  useEffect(() => {
    setPinnedSessionInput(activeDevice?.pinned_session_name || '');
  }, [activeDevice?.device_id, activeDevice?.pinned_session_name]);

  const activeTrayConfigKey = JSON.stringify(activeDevice?.tray_config || null);
  useEffect(() => {
    if (!activeDevice?.tray_config) return;
    const tc = activeDevice.tray_config;
    setTrayForm({
      enabled: tc.enabled !== false,
      mode: tc.mode || 'LIMIT_360',
      invert_direction: Boolean(tc.invert_direction),
      speed_pct: tc.speed_pct ?? 80,
      stop_us: tc.stop_us ?? 1500,
      open_ms: tc.open_ms ?? 1060,
      close_ms: tc.close_ms ?? 1060,
      closed_angle: tc.closed_angle ?? 10,
      open_angle: tc.open_angle ?? 110,
      sweep_speed_dps: tc.sweep_speed_dps ?? 120,
      max_run_ms: tc.max_run_ms ?? 4500,
      auto_home_on_boot: Boolean(tc.auto_home_on_boot)
    });
  }, [activeDevice?.device_id, activeTrayConfigKey]);

  // Reset live command when switching gate scanner device
  useEffect(() => {
    setLiveCommand(null);
  }, [selectedDeviceId]);

  const showToastBanner = (type, text) => {
    setFeedback({ type, text });
    if (feedbackTimerRef.current) clearTimeout(feedbackTimerRef.current);
    feedbackTimerRef.current = setTimeout(() => {
      feedbackTimerRef.current = null;
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
        if (current?.pending_command) {
          const pCmd = current.pending_command;
          setLiveCommand(prev => {
            // Sync active commands OR final COMPLETED/FAILED transitions for the currently tracked command_id
            // (prevents UI staying stuck on "Waiting for ESP32" if a Socket.IO event was missed!)
            if (pCmd.action && pCmd.action !== 'NONE') return pCmd;
            if (prev?.command_id && pCmd.command_id === prev.command_id && (pCmd.status === 'COMPLETED' || pCmd.status === 'FAILED')) {
              return { ...prev, ...pCmd, action: prev.action };
            }
            return prev;
          });
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
      if (isStaff && debouncedSearchQuery) params.append('search', debouncedSearchQuery);

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
  }, [selectedDate, classFilter, eventFilter, debouncedSearchQuery, isStaff]);

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

  // Adaptive polling: fast 2s fallback while an enrollment/sync is in-flight so UI never gets stuck;
  // calm 12s heartbeat refresh when idle (paused while tab is hidden).
  const isCommandInFlight = liveCommand?.status === 'PENDING' || liveCommand?.status === 'IN_PROGRESS';
  useEffect(() => {
    if (!isStaff) return;
    const pollMs = isCommandInFlight ? 2000 : 12000;
    const interval = setInterval(() => {
      if (!document.hidden) fetchDevices(true);
    }, pollMs);
    const handleVisibility = () => {
      if (!document.hidden) fetchDevices(true);
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [isStaff, isCommandInFlight, fetchDevices]);

  // Keep filter & callback refs up to date so Socket.IO listeners never tear down on search keystrokes
  const selectedDateRef = useRef(selectedDate);
  const classFilterRef = useRef(classFilter);
  const eventFilterRef = useRef(eventFilter);
  const searchQueryRef = useRef(searchQuery);
  const activeTabRef = useRef(activeTab);
  const selectedDeviceIdRef = useRef(selectedDeviceId);
  const fetchLogsRef = useRef(fetchLogs);
  const fetchDevicesRef = useRef(fetchDevices);
  const fetchEnrollmentDataRef = useRef(fetchEnrollmentData);

  useEffect(() => { selectedDateRef.current = selectedDate; }, [selectedDate]);
  useEffect(() => { classFilterRef.current = classFilter; }, [classFilter]);
  useEffect(() => { eventFilterRef.current = eventFilter; }, [eventFilter]);
  useEffect(() => { searchQueryRef.current = searchQuery; }, [searchQuery]);
  useEffect(() => { activeTabRef.current = activeTab; }, [activeTab]);
  useEffect(() => { selectedDeviceIdRef.current = selectedDeviceId; }, [selectedDeviceId]);
  useEffect(() => { fetchLogsRef.current = fetchLogs; }, [fetchLogs]);
  useEffect(() => { fetchDevicesRef.current = fetchDevices; }, [fetchDevices]);
  useEffect(() => { fetchEnrollmentDataRef.current = fetchEnrollmentData; }, [fetchEnrollmentData]);

  const userId = user?.id || user?._id || null;
  const studentProfileId = user?.studentProfile?._id || (typeof user?.studentProfile === 'string' ? user.studentProfile : null);

  // Subscribe to Socket.IO for live scan, attendance & enrollment updates (Staff + Students)
  useEffect(() => {
    if (!userId) return;
    if (!socket.connected) socket.connect();

    const joinLiveRooms = () => {
      if (isStaff) {
        socket.emit('join_room', 'GATE_MONITOR');
      } else if (studentProfileId) {
        socket.emit('join_room', `USER_${studentProfileId}`);
      }
    };

    joinLiveRooms();

    const handleScanEvent = (newLog) => {
      if (!newLog) return;
      if (newLog.date === selectedDateRef.current) {
        const curClassFilter = classFilterRef.current;
        const curEventFilter = eventFilterRef.current;
        const q = searchQueryRef.current.trim().toLowerCase();
        const matchesClass = !isStaff || curClassFilter === 'All' ||
          newLog.student?.class_level?.toUpperCase() === curClassFilter.trim().toUpperCase();
        const matchesEvent = !isStaff || curEventFilter === 'All' || newLog.event_type === curEventFilter;
        const matchesSearch = !isStaff || !q ||
          newLog.student?.name?.toLowerCase().includes(q) ||
          newLog.student?.roll_number?.toLowerCase().includes(q);

        if (matchesClass && matchesEvent && matchesSearch) {
          setLogs(prev => {
            const withoutDup = prev.filter(item => item._id !== newLog._id);
            return [newLog, ...withoutDup];
          });
        }
        // Debounce KPI stats sync so rush-hour burst scans coalesce into 1 REST call instead of N
        if (liveLogSyncTimerRef.current) clearTimeout(liveLogSyncTimerRef.current);
        liveLogSyncTimerRef.current = setTimeout(() => {
          liveLogSyncTimerRef.current = null;
          fetchLogsRef.current(true);
        }, 1200);
      }
    };

    const handleDeviceUpdated = (updatedDev) => {
      if (!isStaff) return;
      setDevices(prev => prev.map(d => (d.device_id === updatedDev.device_id ? { ...d, ...updatedDev } : d)));
    };

    const handleCommandUpdate = (cmdData) => {
      if (!isStaff || !cmdData) return;
      if (cmdData.device_id && cmdData.device_id !== selectedDeviceIdRef.current) return;
      if (cmdData.status === 'IDLE') {
        setLiveCommand(null);
      } else {
        setLiveCommand(cmdData);
      }
      if (cmdData.status === 'COMPLETED' || cmdData.status === 'FAILED' || cmdData.status === 'IDLE') {
        fetchDevicesRef.current(true);
        if (activeTabRef.current === 'enroll') fetchEnrollmentDataRef.current();
      }
    };

    socket.on('connect', joinLiveRooms);
    socket.on('gate_scan_event', handleScanEvent);
    socket.on('gate_device_updated', handleDeviceUpdated);
    socket.on('gate_command_update', handleCommandUpdate);

    return () => {
      if (liveLogSyncTimerRef.current) {
        clearTimeout(liveLogSyncTimerRef.current);
        liveLogSyncTimerRef.current = null;
      }
      socket.off('connect', joinLiveRooms);
      socket.off('gate_scan_event', handleScanEvent);
      socket.off('gate_device_updated', handleDeviceUpdated);
      socket.off('gate_command_update', handleCommandUpdate);
    };
  }, [userId, studentProfileId, isStaff]);

  // Toggle Device Power ON / Standby (OFF) remotely
  const handleToggleDevicePower = async () => {
    if (!activeDevice || togglingPower) return;
    const isCurrentlyOn = activeDevice.device_power_on !== false;
    const nextPowerOn = !isCurrentlyOn;
    setTogglingPower(true);
    try {
      const res = await axios.put(`/api/biometric/devices/${activeDevice.device_id}/toggle`, {
        device_power_on: nextPowerOn
      });
      if (res.data.success) {
        setDevices(prev => prev.map(d => (d.device_id === activeDevice.device_id ? res.data.data : d)));
        showToastBanner(
          'success',
          nextPowerOn
            ? 'Power ON sent — ESP32 will wake up within ~12 seconds, turn OLED ON, and extend the tray.'
            : 'Power OFF (Standby) sent — ESP32 will retract tray into cabinet, turn OLED OFF, and enter low-power Wi-Fi.'
        );
      }
    } catch (err) {
      showToastBanner('error', err.response?.data?.message || 'Failed to switch device power state');
    } finally {
      setTogglingPower(false);
    }
  };

  // Remotely restart the ESP32 controller
  const handleRebootDevice = async () => {
    if (!activeDevice || rebootingDevice) return;
    const confirmed = window.confirm(
      `Reboot "${activeDevice.name}" (${activeDevice.device_id}) now?\n\nThe ESP32 will restart and reconnect to Wi-Fi in ~15 seconds.`
    );
    if (!confirmed) return;

    setRebootingDevice(true);
    try {
      const res = await axios.post(`/api/biometric/devices/${activeDevice.device_id}/reboot`);
      if (res.data.success) {
        const nextCmd = res.data.data?.pending_command || res.data.command;
        if (nextCmd) setLiveCommand(nextCmd);
        showToastBanner('success', res.data.message || 'Reboot queued — ESP32 will restart shortly.');
      }
    } catch (err) {
      showToastBanner('error', err.response?.data?.message || 'Failed to queue remote reboot');
    } finally {
      setRebootingDevice(false);
    }
  };

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
            ? 'Fingerprint Sensing turned ON — ESP32 will resume scanning within a few seconds.'
            : 'Fingerprint Sensing turned OFF — ESP32 will enter sleepy paused mode within a few seconds.'
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

  // Queue remote fingerprint enrollment on ESP32 (fingerIndex: 1=Primary, 2=Backup) & open interactive wizard
  const handleStartEnroll = async (student, fingerIndex = 1) => {
    if (!activeDevice || !student || enrollingRef.current) return;
    enrollingRef.current = true;
    const fingerLabel = fingerIndex === 2 ? 'Backup Finger' : 'Primary Finger';
    setEnrollWizardStudent(student);
    setEnrollWizardFingerIndex(fingerIndex);
    // Reset to a clean PENDING placeholder before opening / retrying so stale COMPLETED/FAILED never flashes
    setLiveCommand({
      action: 'ENROLL',
      status: 'PENDING',
      step: '',
      progress: 12,
      device_id: activeDevice.device_id,
      student_id: student._id,
      student_name: student.name,
      finger_index: fingerIndex,
      finger_label: fingerLabel,
      message: 'Sending enrollment command to ESP32 scanner...'
    });
    try {
      const res = await axios.post(`/api/biometric/devices/${activeDevice.device_id}/enroll`, {
        student_id: student._id,
        finger_index: fingerIndex,
        finger_label: fingerLabel
      });
      if (res.data.success) {
        if (res.data.data?.pending_command) {
          setLiveCommand(res.data.data.pending_command);
        }
        if (!res.data.data?.queued) {
          setShowEnrollWizard(true);
        } else {
          setShowEnrollWizard(false);
        }
        showToastBanner('success', res.data.message);
      }
    } catch (err) {
      if (err.response?.status !== 409) {
        setLiveCommand(null);
        setShowEnrollWizard(false);
      }
      showToastBanner('error', err.response?.data?.message || 'Failed to queue fingerprint enrollment');
    } finally {
      enrollingRef.current = false;
    }
  };

  // Delete one specific finger template (or all fingers if template omitted) from DB & ESP32 R307S
  const handleRemoveTemplate = async (student, tmpl = null) => {
    if (!activeDevice) return;
    const label = tmpl ? `${tmpl.finger_label || (tmpl.finger_index === 2 ? 'Backup Finger' : 'Primary Finger')} (Slot #${tmpl.slot_id})` : 'all fingerprints';
    if (!window.confirm(`Remove ${label} for ${student.name}?`)) {
      return;
    }
    try {
      const qs = tmpl?.slot_id ? `?slot_id=${tmpl.slot_id}` : '';
      const res = await axios.delete(`/api/biometric/devices/${activeDevice.device_id}/templates/${student._id}${qs}`);
      if (res.data.success) {
        showToastBanner('success', res.data.message);
        fetchEnrollmentData();
        fetchDevices(true);
      }
    } catch (err) {
      showToastBanner('error', err.response?.data?.message || 'Failed to remove fingerprint');
    }
  };

  // Trigger hardware-to-DB 1000-slot audit & repair (erases orphan R307S prints & cleans ghost DB records)
  const handleSyncSensorSlots = async () => {
    if (!activeDevice || syncingSlots) return;
    setSyncingSlots(true);
    try {
      const res = await axios.post(`/api/biometric/devices/${activeDevice.device_id}/sync-slots`);
      if (res.data.success) {
        setLiveCommand(res.data.data?.pending_command || null);
        showToastBanner('success', res.data.message);
      }
    } catch (err) {
      showToastBanner('error', err.response?.data?.message || 'Failed to start Sensor Sync & Repair');
    } finally {
      setSyncingSlots(false);
    }
  };

  const handleCancelCommand = async () => {
    if (!activeDevice) return;
    try {
      await axios.post(`/api/biometric/devices/${activeDevice.device_id}/cancel-command`);
      setLiveCommand(null);
      setShowEnrollWizard(false);
      fetchDevices(true);
    } catch {
      // ignore
    }
  };

  const isTrayConfigDirty = useMemo(() => {
    const tc = activeDevice?.tray_config;
    if (!tc) return false;
    return (
      Boolean(trayForm.enabled) !== (tc.enabled !== false) ||
      String(trayForm.mode || 'LIMIT_360') !== String(tc.mode || 'LIMIT_360') ||
      Boolean(trayForm.invert_direction) !== Boolean(tc.invert_direction) ||
      Number(trayForm.speed_pct) !== (tc.speed_pct ?? 80) ||
      Number(trayForm.stop_us) !== (tc.stop_us ?? 1500) ||
      Number(trayForm.open_ms) !== (tc.open_ms ?? 1060) ||
      Number(trayForm.close_ms) !== (tc.close_ms ?? 1060) ||
      Number(trayForm.closed_angle) !== (tc.closed_angle ?? 10) ||
      Number(trayForm.open_angle) !== (tc.open_angle ?? 110) ||
      Number(trayForm.sweep_speed_dps) !== (tc.sweep_speed_dps ?? 120) ||
      Number(trayForm.max_run_ms) !== (tc.max_run_ms ?? 4500) ||
      Boolean(trayForm.auto_home_on_boot) !== Boolean(tc.auto_home_on_boot)
    );
  }, [activeDevice?.tray_config, trayForm]);

  const adjustTrayMs = (field, delta) => {
    setTrayForm(prev => {
      const cur = Number(prev[field]);
      const base = Number.isFinite(cur) ? cur : 1060;
      const next = Math.max(100, Math.min(8000, Math.round(base + delta)));
      return { ...prev, [field]: next };
    });
  };

  // Save tuned Motorized Tray v3.0 settings (persisted in DB & synced to ESP32 NVS on next ~5.5s heartbeat)
  const handleSaveTrayConfig = async (customOverride = null, { silentSuccess = false } = {}) => {
    if (!activeDevice) return false;
    const cfg = customOverride || trayForm;
    const numericFields = [
      { key: 'speed_pct', label: 'Motor Speed (%)', min: 20, max: 100 },
      { key: 'stop_us', label: 'Stop Neutral (µs)', min: 1350, max: 1650 },
      { key: 'open_ms', label: 'Open Time (ms)', min: 100, max: 8000 },
      { key: 'close_ms', label: 'Close Time (ms)', min: 100, max: 8000 },
      { key: 'closed_angle', label: 'Closed Angle (°)', min: 0, max: 180 },
      { key: 'open_angle', label: 'Open Angle (°)', min: 0, max: 180 },
      { key: 'sweep_speed_dps', label: 'Sweep Speed (°/s)', min: 30, max: 360 },
      { key: 'max_run_ms', label: 'Max Safety Cutoff (ms)', min: 500, max: 15000 }
    ];
    const parsed = {};
    for (const f of numericFields) {
      const raw = cfg[f.key];
      if (raw === '' || raw === null || raw === undefined || !Number.isFinite(Number(raw))) {
        showToastBanner('error', `Please enter a valid number for ${f.label} (${f.min}–${f.max}).`);
        return false;
      }
      const num = Math.round(Number(raw));
      if (num < f.min || num > f.max) {
        showToastBanner('error', `${f.label} must be between ${f.min} and ${f.max}.`);
        return false;
      }
      parsed[f.key] = num;
    }

    setSavingSettings(true);
    try {
      const res = await axios.put(`/api/biometric/devices/${activeDevice.device_id}/toggle`, {
        tray_config: {
          enabled: Boolean(cfg.enabled),
          mode: cfg.mode || 'LIMIT_360',
          invert_direction: Boolean(cfg.invert_direction),
          auto_home_on_boot: Boolean(cfg.auto_home_on_boot),
          ...parsed
        }
      });
      if (res.data.success) {
        setDevices(prev => prev.map(d => (d.device_id === activeDevice.device_id ? res.data.data : d)));
        if (!silentSuccess) {
          showToastBanner('success', 'Motorized tray defaults saved & syncing to ESP32 (~5s).');
        }
        return true;
      }
      return false;
    } catch (err) {
      showToastBanner('error', err.response?.data?.message || 'Failed to save tray settings');
      return false;
    } finally {
      setSavingSettings(false);
    }
  };

  // Queue a live motorized tray action to ESP32 (auto-saves unsaved edits first!)
  const handleTrayCommand = async (action, durationMs = null) => {
    if (!activeDevice || sendingTrayCmd || savingSettings) return;
    setSendingTrayCmd(action);
    try {
      const isMotionCmd = ['TRAY_OPEN', 'TRAY_CLOSE', 'TRAY_HOME', 'TRAY_NUDGE_OPEN', 'TRAY_NUDGE_CLOSE'].includes(action);
      if (isMotionCmd && isTrayConfigDirty) {
        const savedOk = await handleSaveTrayConfig(null, { silentSuccess: true });
        if (!savedOk) return;
      }
      const payload = { action };
      if (durationMs !== null) payload.duration_ms = Number(durationMs);
      const res = await axios.post(`/api/biometric/devices/${activeDevice.device_id}/tray-command`, payload);
      if (res.data.success) {
        if (res.data.data?.pending_command) {
          setLiveCommand(res.data.data.pending_command);
        }
        showToastBanner('success', res.data.message);
      }
    } catch (err) {
      showToastBanner('error', err.response?.data?.message || 'Failed to send tray command');
    } finally {
      setSendingTrayCmd('');
    }
  };

  const handleCreateDevice = async (e) => {
    e.preventDefault();
    if (!newDeviceId.trim() || creatingDevice) return;
    setCreatingDevice(true);
    try {
      const res = await axios.post('/api/biometric/devices', {
        device_id: newDeviceId.trim(),
        name: newDeviceName.trim()
      });
      if (res.data.success && res.data.data) {
        setDevices(prev => [...prev, res.data.data]);
        setSelectedDeviceId(res.data.data.device_id);
        setNewDeviceId('');
        setNewDeviceName('');
        setShowAddDeviceModal(false);
        setShowCredentials(true);
        showToastBanner('success', `Device ${res.data.data.device_id} registered! Copy its credentials into config.h.`);
      }
    } catch (err) {
      showToastBanner('error', err.response?.data?.message || 'Failed to register new gate scanner');
    } finally {
      setCreatingDevice(false);
    }
  };

  const handleRegenerateKey = async () => {
    if (!activeDevice || !isSuperAdmin || savingSettings) return;
    if (!window.confirm(`Regenerate API key for ${activeDevice.device_id}? The ESP32 will disconnect until you flash the new key in config.h.`)) {
      return;
    }
    await handleUpdateSetting({ regenerate_key: true });
  };

  const handleClearAllTemplates = async () => {
    if (!activeDevice || !isSuperAdmin || clearingAll) return;
    const confirmed = window.prompt(
      `DANGER: This will erase ALL fingerprints from ${activeDevice.device_id} (${activeDevice.enrolled_count ?? templates.length} enrolled) and reset its R307S flash memory.\n\nType CLEAR to confirm:`
    );
    if (confirmed !== 'CLEAR') return;

    setClearingAll(true);
    try {
      const res = await axios.post(`/api/biometric/devices/${activeDevice.device_id}/clear-all`);
      if (res.data.success) {
        setLiveCommand(res.data.data?.pending_command || null);
        showToastBanner('success', res.data.message);
        fetchEnrollmentData();
        fetchDevices(true);
      }
    } catch (err) {
      showToastBanner('error', err.response?.data?.message || 'Failed to queue CLEAR_ALL command');
    } finally {
      setClearingAll(false);
    }
  };

  const handleCopy = (label, value) => {
    if (!value) return;
    navigator.clipboard?.writeText(value);
    setCopiedField(label);
    if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    copyTimerRef.current = setTimeout(() => {
      copyTimerRef.current = null;
      setCopiedField('');
    }, 2000);
  };

  // Map studentId -> array of enrolled templates (Primary=1, Backup=2) for Multi-Finger support
  const templatesByStudentId = useMemo(() => {
    const map = new Map();
    templates.forEach(t => {
      const sid = t.student?._id || t.student;
      if (!sid) return;
      const key = String(sid);
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(t);
    });
    map.forEach(list => list.sort((a, b) => (a.finger_index || 1) - (b.finger_index || 1)));
    return map;
  }, [templates]);

  const filteredEnrollStudents = useMemo(() => {
    return allStudents.filter(s => {
      const matchClass = enrollClassFilter === 'All' || s.class_level === enrollClassFilter;
      const isEnrolled = (templatesByStudentId.get(String(s._id))?.length || 0) > 0;
      const matchStatus = enrollStatusFilter === 'all'
        || (enrollStatusFilter === 'enrolled' && isEnrolled)
        || (enrollStatusFilter === 'unenrolled' && !isEnrolled);
      const q = enrollSearch.trim().toLowerCase();
      const matchQuery = !q || s.name?.toLowerCase().includes(q) || s.roll_number?.toLowerCase().includes(q);
      return matchClass && matchStatus && matchQuery;
    });
  }, [allStudents, enrollClassFilter, enrollStatusFilter, enrollSearch, templatesByStudentId]);

  const enrollProgressStats = useMemo(() => {
    const classScoped = enrollClassFilter === 'All'
      ? allStudents
      : allStudents.filter(s => s.class_level === enrollClassFilter);
    const total = classScoped.length;
    const enrolled = classScoped.filter(s => (templatesByStudentId.get(String(s._id))?.length || 0) > 0).length;
    const withBackup = classScoped.filter(s => (templatesByStudentId.get(String(s._id))?.length || 0) >= 2).length;
    const pct = total > 0 ? Math.round((enrolled / total) * 100) : 0;
    return { total, enrolled, withBackup, pct };
  }, [allStudents, enrollClassFilter, templatesByStudentId]);

  const nextUnenrolledStudent = useMemo(() => {
    const classScoped = enrollClassFilter === 'All'
      ? allStudents
      : allStudents.filter(s => s.class_level === enrollClassFilter);
    const currentId = enrollWizardStudent?._id ? String(enrollWizardStudent._id) : '';
    return classScoped.find(s => (templatesByStudentId.get(String(s._id))?.length || 0) === 0 && String(s._id) !== currentId) || null;
  }, [allStudents, enrollClassFilter, templatesByStudentId, enrollWizardStudent]);

  const firstUnenrolledInScope = useMemo(() => {
    const classScoped = enrollClassFilter === 'All'
      ? allStudents
      : allStudents.filter(s => s.class_level === enrollClassFilter);
    return classScoped.find(s => (templatesByStudentId.get(String(s._id))?.length || 0) === 0) || null;
  }, [allStudents, enrollClassFilter, templatesByStudentId]);

  const sensorDriftDetected = Boolean(
    activeDevice?.is_online &&
    typeof activeDevice.total_templates === 'number' &&
    typeof activeDevice.enrolled_count === 'number' &&
    activeDevice.total_templates !== activeDevice.enrolled_count
  );

  // Derive visual 4-stage stepper index from ESP32 liveCommand step/status
  const enrollStageInfo = useMemo(() => {
    const status = liveCommand?.status || 'PENDING';
    const step = liveCommand?.step || '';
    const msg = (liveCommand?.message || '').toLowerCase();
    const rawPct = typeof liveCommand?.progress === 'number' ? liveCommand.progress : null;

    if (status === 'COMPLETED') return { stage: 4, pct: 100 };
    if (status === 'FAILED') return { stage: -1, pct: 0 };
    if (step === 'SCAN_2' || msg.includes('step 2') || msg.includes('same finger')) return { stage: 3, pct: rawPct ?? 75 };
    if (step === 'LIFT_FINGER' || msg.includes('lift finger')) return { stage: 2.5, pct: rawPct ?? 52 };
    if (step === 'SCAN_1' || status === 'IN_PROGRESS' || msg.includes('step 1')) return { stage: 2, pct: rawPct ?? 28 };
    return { stage: 1, pct: rawPct ?? 12 };
  }, [liveCommand]);

  const serverUrlForConfig = import.meta.env.VITE_API_URL || window.location.origin;

  const getInitials = (name = '') => {
    const parts = String(name).trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return '?';
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  };

  const getYesterdayIST = () => {
    const ist = new Date(Date.now() + 5.5 * 60 * 60 * 1000 - 86400000);
    return ist.toISOString().split('T')[0];
  };

  const formatCooldownShort = (sec = 120) => (sec < 60 ? `${sec}s` : `${Math.round(sec / 60)}m`);

  return (
    <div className="space-y-5 sm:space-y-6 animate-fadeIn">
      {/* HEADER BAR */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3.5">
        <div className="flex items-center gap-3">
          <div className="relative p-2.5 sm:p-3 rounded-2xl bg-gradient-to-br from-primary-500/20 to-indigo-600/10 border border-primary-500/30 text-primary-400 shadow-lg shadow-primary-500/10">
            <Fingerprint size={22} />
            {isStaff && activeDevice?.is_online && (
              <span className="absolute -top-1 -right-1 flex h-3 w-3">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500 border-2 border-dark-950" />
              </span>
            )}
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-xl sm:text-2xl font-extrabold text-white font-outfit tracking-tight">
                {isStaff ? 'Biometric Gate Control' : 'My Campus Gate Logs'}
              </h1>
              {isStaff && (
                <span className="hidden sm:inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full bg-primary-500/10 text-primary-300 border border-primary-500/25">
                  <Radio size={10} className="animate-pulse" />
                  Live
                </span>
              )}
            </div>
            <p className="text-xs text-slate-400 mt-0.5">
              {isStaff
                ? 'ESP32 R307S remote gate scanner, auto-attendance sync & parent alerts'
                : 'Your verified campus entry & exit timestamps in IST'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 self-start sm:self-auto flex-wrap">
          {isStaff && devices.length > 1 && (
            <select
              value={selectedDeviceId}
              onChange={(e) => setSelectedDeviceId(e.target.value)}
              className="px-3 py-2 rounded-xl bg-dark-900/90 border border-dark-800 hover:border-dark-700 text-xs font-semibold text-white transition"
            >
              {devices.map(d => (
                <option key={d.device_id} value={d.device_id}>
                  {d.name} ({d.device_id})
                </option>
              ))}
            </select>
          )}

          {isSuperAdmin && (
            <button
              type="button"
              onClick={() => setShowAddDeviceModal(true)}
              className="px-3.5 py-2 rounded-xl bg-primary-600 hover:bg-primary-500 active:scale-[0.98] text-xs font-bold text-white transition flex items-center gap-1.5 shadow-lg shadow-primary-600/20"
            >
              <Plus size={14} />
              <span>Add Scanner</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => {
              fetchLogs();
              if (isStaff) fetchDevices();
              if (isStaff && activeTab === 'enroll') fetchEnrollmentData();
            }}
            className="px-3.5 py-2 rounded-xl bg-dark-900/90 hover:bg-dark-800 active:scale-[0.98] border border-dark-800 text-xs font-semibold text-slate-200 transition flex items-center gap-1.5"
          >
            <RefreshCw size={13} className={loadingLogs || loadingDevices ? 'animate-spin' : ''} />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {/* TOAST FEEDBACK BANNER */}
      {feedback.text && (
        <div
          className={`p-3.5 rounded-2xl border text-xs font-medium flex items-center justify-between gap-3 animate-slideUp shadow-lg ${
            feedback.type === 'error'
              ? 'bg-rose-500/10 border-rose-500/30 text-rose-200'
              : 'bg-emerald-500/10 border-emerald-500/30 text-emerald-200'
          }`}
        >
          <div className="flex items-center gap-2.5 min-w-0">
            {feedback.type === 'error' ? <AlertCircle size={16} className="text-rose-400 shrink-0" /> : <CheckCircle2 size={16} className="text-emerald-400 shrink-0" />}
            <span className="leading-snug">{feedback.text}</span>
          </div>
          <button
            type="button"
            onClick={() => setFeedback({ type: '', text: '' })}
            className="p-1 rounded-lg hover:bg-white/10 text-slate-400 hover:text-white transition shrink-0"
            aria-label="Dismiss notification"
          >
            <X size={14} />
          </button>
        </div>
      )}

      {/* HERO HARDWARE COMMAND CARD (Staff Only) */}
      {isStaff && (
        <div className="relative overflow-hidden glass-panel rounded-2xl border border-white/[0.08] shadow-xl">
          {/* Subtle Ambient Status Glow */}
          <div
            className={`pointer-events-none absolute -top-24 -right-24 w-72 h-72 rounded-full blur-3xl opacity-20 transition-colors duration-500 ${
              !activeDevice?.is_online
                ? 'bg-slate-500'
                : activeDevice?.device_power_on === false
                  ? 'bg-amber-500'
                  : activeDevice?.sensing_enabled
                    ? 'bg-emerald-500'
                    : 'bg-rose-500'
            }`}
          />

          <div className="relative p-4 sm:p-5 space-y-4">
            {loadingDevices && !activeDevice ? (
              <div className="flex items-center gap-4 animate-pulse py-2">
                <div className="w-12 h-12 rounded-2xl bg-dark-800/80" />
                <div className="flex-1 space-y-2">
                  <div className="h-4 w-48 rounded bg-dark-800/80" />
                  <div className="h-3 w-72 rounded bg-dark-800/60" />
                </div>
              </div>
            ) : activeDevice ? (
              <>
                <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                  {/* Left: Hardware Identity + Telemetry Pills */}
                  <div className="flex items-start sm:items-center gap-3.5 min-w-0">
                    <div
                      className={`w-12 h-12 sm:w-14 sm:h-14 rounded-2xl flex items-center justify-center border shrink-0 transition-all ${
                        activeDevice.device_power_on === false
                          ? 'bg-gradient-to-br from-amber-500/20 to-slate-800/20 border-amber-500/35 text-amber-300 shadow-lg shadow-amber-500/10'
                          : activeDevice.sensing_enabled
                            ? 'bg-gradient-to-br from-emerald-500/20 to-teal-500/5 border-emerald-500/35 text-emerald-400 shadow-lg shadow-emerald-500/10'
                            : 'bg-gradient-to-br from-rose-500/20 to-orange-500/5 border-rose-500/35 text-rose-400 shadow-lg shadow-rose-500/10'
                      }`}
                    >
                      <Cpu size={24} />
                    </div>

                    <div className="min-w-0 space-y-1.5">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h2 className="text-base sm:text-lg font-bold text-white font-outfit truncate">
                          {activeDevice.name}
                        </h2>
                        <span className="text-[10px] font-mono font-semibold px-2 py-0.5 rounded-md bg-dark-950/80 border border-dark-800 text-slate-300">
                          {activeDevice.device_id}
                        </span>
                        <span
                          className={`inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider px-2.5 py-0.5 rounded-full border ${
                            activeDevice.is_online
                              ? 'badge-glow-emerald'
                              : 'bg-dark-900/90 text-slate-400 border-dark-700'
                          }`}
                        >
                          {activeDevice.is_online ? <Wifi size={11} /> : <WifiOff size={11} />}
                          {activeDevice.is_online ? 'Online' : 'Offline'}
                        </span>
                        {activeDevice.device_power_on === false && (
                          <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-2.5 py-0.5 rounded-full badge-glow-amber">
                            <Power size={10} />
                            Standby (OFF)
                          </span>
                        )}
                        {sensorDriftDetected && (
                          <button
                            type="button"
                            onClick={() => { setActiveTab('enroll'); handleSyncSensorSlots(); }}
                            className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full badge-glow-amber hover:brightness-110 transition"
                            title="R307S flash count differs from database — tap to sync"
                          >
                            <AlertCircle size={10} />
                            Sync Needed
                          </button>
                        )}
                      </div>

                      {/* Compact Telemetry Row */}
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-400">
                        <span className="inline-flex items-center gap-1">
                          <Fingerprint size={11} className="text-primary-400" />
                          <strong className="text-slate-200 tabular-nums">{activeDevice.enrolled_count ?? 0}</strong>
                          <span className="text-slate-500">/ 1000 prints</span>
                        </span>
                        {activeDevice.last_heartbeat && (
                          <span className="inline-flex items-center gap-1">
                            <Activity size={11} className="text-emerald-400" />
                            <strong className="text-slate-200 font-mono text-[10px]">{formatISTTime(activeDevice.last_heartbeat)}</strong>
                          </span>
                        )}
                        {activeDevice.ip_address && (
                          <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-dark-950/70 border border-dark-800/80 text-slate-400">
                            {activeDevice.ip_address}
                          </span>
                        )}
                        {activeDevice.firmware_version && (
                          <span className="font-mono text-[10px] text-slate-500">
                            v{activeDevice.firmware_version}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Right: Device Power Switch + Scanner Sensing Switch + Settings Toggle */}
                  <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5 shrink-0">
                    <button
                      type="button"
                      onClick={handleToggleDevicePower}
                      disabled={togglingPower}
                      className={`px-4 py-3 rounded-2xl font-bold text-xs sm:text-sm transition-all flex items-center justify-center gap-2.5 shadow-lg active:scale-[0.98] disabled:opacity-60 ${
                        activeDevice.device_power_on === false
                          ? 'bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-500 hover:to-orange-500 text-white shadow-amber-600/25 border border-amber-400/35'
                          : 'bg-dark-950/90 hover:bg-dark-900 text-slate-100 border border-dark-700 hover:border-amber-500/40'
                      }`}
                      title={
                        activeDevice.device_power_on === false
                          ? 'Wake ESP32 from Standby (turns OLED ON & extends tray)'
                          : 'Put ESP32 into Power OFF Standby (retracts tray, OLED OFF, low-power Wi-Fi)'
                      }
                    >
                      <div
                        className={`p-1.5 rounded-xl ${
                          activeDevice.device_power_on === false
                            ? 'bg-white/20 text-white'
                            : 'bg-amber-500/15 text-amber-300'
                        }`}
                      >
                        <Power size={15} />
                      </div>
                      <div className="text-left">
                        <span className="block leading-tight">
                          {togglingPower
                            ? 'Switching...'
                            : activeDevice.device_power_on === false
                              ? 'Power OFF'
                              : 'Power ON'}
                        </span>
                        <span
                          className={`block text-[10px] font-medium ${
                            activeDevice.device_power_on === false ? 'text-white/85' : 'text-slate-400'
                          }`}
                        >
                          {activeDevice.device_power_on === false ? 'Tap to wake (~12s)' : 'Tap for Standby'}
                        </span>
                      </div>
                    </button>

                    <button
                      type="button"
                      onClick={handleToggleSensing}
                      disabled={togglingSensing || activeDevice.device_power_on === false}
                      className={`px-5 py-3 rounded-2xl font-bold text-xs sm:text-sm transition-all flex items-center justify-center gap-3 shadow-lg active:scale-[0.98] disabled:opacity-50 ${
                        activeDevice.device_power_on === false
                          ? 'bg-dark-900/90 text-slate-400 border border-dark-800 shadow-none cursor-not-allowed'
                          : activeDevice.sensing_enabled
                            ? 'bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white shadow-emerald-600/25 border border-emerald-400/30'
                            : 'bg-gradient-to-r from-rose-600 to-pink-600 hover:from-rose-500 hover:to-pink-500 text-white shadow-rose-600/25 border border-rose-400/30'
                      }`}
                    >
                      <div className="p-1.5 rounded-xl bg-white/15">
                        <Fingerprint size={16} />
                      </div>
                      <div className="text-left">
                        <span className="block leading-tight">
                          {togglingSensing
                            ? 'Updating ESP32...'
                            : activeDevice.device_power_on === false
                              ? 'Scanner Asleep'
                              : activeDevice.sensing_enabled
                                ? 'Scanner Active'
                                : 'Scanner Paused'}
                        </span>
                        <span className="block text-[10px] font-medium text-white/80">
                          {activeDevice.device_power_on === false
                            ? 'Wake device first'
                            : activeDevice.sensing_enabled
                              ? 'Tap to pause sensing'
                              : 'Tap to resume sensing'}
                        </span>
                      </div>
                    </button>

                    <button
                      type="button"
                      onClick={() => setShowSettingsDrawer(prev => !prev)}
                      className={`px-3.5 py-3 rounded-2xl text-xs font-bold border transition flex items-center justify-center gap-2 ${
                        showSettingsDrawer
                          ? 'bg-primary-600/20 border-primary-500/40 text-primary-200'
                          : 'bg-dark-950/70 hover:bg-dark-900 border-dark-800 text-slate-300 hover:text-white'
                      }`}
                    >
                      <Sliders size={14} />
                      <span>Settings</span>
                      {showSettingsDrawer ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                    </button>
                  </div>
                </div>

                {/* Compact Active Policy Summary Chips (visible when settings drawer is collapsed) */}
                {!showSettingsDrawer && (
                  <div className="flex flex-wrap items-center gap-2 pt-3 border-t border-white/[0.06] text-[11px]">
                    <button
                      type="button"
                      onClick={() => setShowSettingsDrawer(true)}
                      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border transition hover:brightness-110 ${
                        activeDevice.auto_mark_attendance
                          ? 'bg-primary-500/10 border-primary-500/25 text-primary-300'
                          : 'bg-dark-950/60 border-dark-800 text-slate-400'
                      }`}
                    >
                      <ShieldCheck size={12} />
                      <span>Auto-Attendance: <strong>{activeDevice.auto_mark_attendance ? 'ON' : 'OFF'}</strong></span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setShowSettingsDrawer(true)}
                      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border transition hover:brightness-110 ${
                        activeDevice.parent_alerts_enabled !== false
                          ? 'bg-emerald-500/10 border-emerald-500/25 text-emerald-300'
                          : 'bg-amber-500/10 border-amber-500/25 text-amber-300'
                      }`}
                    >
                      {activeDevice.parent_alerts_enabled !== false ? <Bell size={12} /> : <BellOff size={12} />}
                      <span>Parent Alerts: <strong>{activeDevice.parent_alerts_enabled !== false ? 'ON' : 'PAUSED'}</strong></span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setShowSettingsDrawer(true)}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-dark-950/60 border border-dark-800 text-slate-300 hover:border-dark-700 transition"
                    >
                      <Clock size={12} className="text-amber-400" />
                      <span>Cooldown: <strong className="font-mono">{formatCooldownShort(activeDevice.cooldown_seconds)}</strong></span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setShowSettingsDrawer(true)}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-dark-950/60 border border-dark-800 text-slate-300 hover:border-dark-700 transition"
                    >
                      <Bookmark size={12} className="text-cyan-400" />
                      <span>Session: <strong>{activeDevice.pinned_session_name || 'Auto Timetable'}</strong></span>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setShowSettingsDrawer(true);
                        setShowTrayControls(true);
                      }}
                      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border transition hover:brightness-110 ${
                        activeDevice.tray_state === 'FAULT'
                          ? 'bg-rose-500/15 border-rose-500/40 text-rose-300'
                          : activeDevice.tray_state === 'OPEN'
                            ? 'bg-cyan-500/10 border-cyan-500/30 text-cyan-300'
                            : 'bg-dark-950/60 border-dark-800 text-slate-300 hover:border-dark-700'
                      }`}
                    >
                      <Sliders size={12} className={activeDevice.tray_state === 'FAULT' ? 'text-rose-400' : 'text-cyan-400'} />
                      <span>
                        Tray: <strong>{activeDevice.tray_state || 'UNKNOWN'}</strong>{' '}
                        <span className="font-mono text-[10px] text-slate-400">
                          ({activeDevice.tray_config?.mode === 'LIMIT_360'
                            ? 'Mouse SW'
                            : activeDevice.tray_config?.mode === 'ANGLE_180'
                              ? `${activeDevice.tray_config?.closed_angle ?? 10}°-${activeDevice.tray_config?.open_angle ?? 110}°`
                              : `${activeDevice.tray_config?.open_ms ?? 1060}/${activeDevice.tray_config?.close_ms ?? 1060}ms`})
                        </span>
                      </span>
                    </button>
                  </div>
                )}

                {/* Collapsible Scanner Settings & Firmware Credentials Drawer */}
                {showSettingsDrawer && (
                  <div className="space-y-3.5 pt-3.5 border-t border-white/[0.06] animate-fadeIn">
                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
                      {/* Auto-Mark Attendance Switch */}
                      <div className="p-3.5 rounded-xl bg-dark-950/70 border border-dark-800/90 flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5 text-xs font-bold text-white">
                            <ShieldCheck size={14} className="text-primary-400 shrink-0" />
                            <span>Auto-Mark Attendance</span>
                          </div>
                          <p className="text-[11px] text-slate-400 mt-0.5 leading-snug">
                            Auto-marks Present in ClassGrid on entry; manual edits stay preserved.
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

                      {/* Parent Messages Switch */}
                      <div className="p-3.5 rounded-xl bg-dark-950/70 border border-dark-800/90 flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5 text-xs font-bold text-white">
                            {activeDevice.parent_alerts_enabled !== false ? (
                              <Bell size={14} className="text-emerald-400 shrink-0" />
                            ) : (
                              <BellOff size={14} className="text-amber-400 shrink-0" />
                            )}
                            <span>
                              Parent Alerts:{' '}
                              <span className={activeDevice.parent_alerts_enabled !== false ? 'text-emerald-400' : 'text-amber-400'}>
                                {activeDevice.parent_alerts_enabled !== false ? 'ON' : 'PAUSED'}
                              </span>
                            </span>
                          </div>
                          <p className="text-[11px] text-slate-400 mt-0.5 leading-snug">
                            {activeDevice.parent_alerts_enabled !== false
                              ? 'Sends instant Entry/Exit email & app push alerts.'
                              : 'Alerts paused; gate logs & attendance continue.'}
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
                      <div className="p-3.5 rounded-xl bg-dark-950/70 border border-dark-800/90 flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5 text-xs font-bold text-white">
                            <Clock size={14} className="text-amber-400 shrink-0" />
                            <span>Double-Scan Gap</span>
                          </div>
                          <p className="text-[11px] text-slate-400 mt-0.5 leading-snug">
                            Min wait before Entry flips to Exit.
                          </p>
                        </div>
                        <select
                          value={activeDevice.cooldown_seconds || 120}
                          disabled={savingSettings}
                          onChange={(e) => handleUpdateSetting({ cooldown_seconds: Number(e.target.value) })}
                          className="px-2.5 py-1.5 rounded-lg bg-dark-900 border border-dark-700 text-xs font-semibold text-white shrink-0"
                        >
                          <option value={15}>15s (Test)</option>
                          <option value={60}>1 min</option>
                          <option value={120}>2 min</option>
                          <option value={300}>5 min</option>
                          <option value={600}>10 min</option>
                        </select>
                      </div>

                      {/* Pinned Session Name Override */}
                      <div className="p-3.5 rounded-xl bg-dark-950/70 border border-dark-800/90 flex flex-col justify-between gap-2">
                        <div className="flex items-center gap-1.5 text-xs font-bold text-white">
                          <Bookmark size={14} className="text-cyan-400 shrink-0" />
                          <span>Pinned Session</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <input
                            type="text"
                            value={pinnedSessionInput}
                            onChange={(e) => setPinnedSessionInput(e.target.value)}
                            placeholder="Auto (timetable)"
                            className="flex-1 min-w-0 px-2.5 py-1.5 rounded-lg bg-dark-900 border border-dark-700 text-xs text-white placeholder-slate-500"
                          />
                          <button
                            type="button"
                            disabled={savingSettings || pinnedSessionInput.trim() === (activeDevice.pinned_session_name || '')}
                            onClick={() => handleUpdateSetting({ pinned_session_name: pinnedSessionInput.trim() })}
                            className="px-2.5 py-1.5 rounded-lg bg-primary-600 hover:bg-primary-500 disabled:opacity-40 text-[11px] font-bold text-white transition shrink-0"
                          >
                            Save
                          </button>
                        </div>
                      </div>
                    </div>

                    {/* Collapsible Motorized Tray v3.0 (3-Mode Actuator + Live Mouse Switch Panel) */}
                    <div className="rounded-xl bg-dark-950/75 border border-dark-800/90 overflow-hidden">
                      <button
                        type="button"
                        onClick={() => setShowTrayControls(prev => !prev)}
                        className="w-full px-4 py-2.5 flex items-center justify-between text-xs font-semibold text-slate-300 hover:text-white transition"
                      >
                        <span className="flex items-center gap-2 flex-wrap">
                          <Sliders size={13} className="text-cyan-400" />
                          <span>Motorized Cabinet Tray (v3.0)</span>
                          <span
                            className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border ${
                              activeDevice.tray_state === 'FAULT'
                                ? 'bg-rose-500/15 text-rose-300 border-rose-500/40'
                                : activeDevice.tray_state === 'OPEN'
                                  ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30'
                                  : activeDevice.tray_state === 'CLOSED'
                                    ? 'bg-slate-500/10 text-slate-300 border-slate-500/30'
                                    : 'bg-amber-500/10 text-amber-300 border-amber-500/30'
                            }`}
                          >
                            {activeDevice.tray_state || 'UNKNOWN'}
                          </span>
                          <span className="text-[10px] font-mono px-2 py-0.5 rounded-md bg-dark-900 border border-dark-800 text-cyan-300">
                            {trayForm.mode === 'LIMIT_360'
                              ? '360° + Mouse Switches'
                              : trayForm.mode === 'ANGLE_180'
                                ? '180° Positional'
                                : '360° Timed'}
                          </span>
                        </span>
                        {showTrayControls ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
                      </button>

                      {showTrayControls && (
                        <div className="px-4 pb-4 pt-3 space-y-4 border-t border-dark-800/70 text-xs">
                          {/* FAULT Alert Banner */}
                          {activeDevice.tray_state === 'FAULT' && (
                            <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/35 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-rose-200">
                              <div className="flex items-center gap-2 text-[11px]">
                                <AlertTriangle size={15} className="text-rose-400 shrink-0" />
                                <span>
                                  <strong>Tray Safety Fault:</strong> {activeDevice.tray_fault || 'Limit switch was not triggered before safety timeout.'}
                                </span>
                              </div>
                              <button
                                type="button"
                                disabled={Boolean(sendingTrayCmd) || !activeDevice.is_online}
                                onClick={() => handleTrayCommand('TRAY_HOME')}
                                className="px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-[11px] font-bold text-white shrink-0 transition disabled:opacity-40"
                              >
                                Home &amp; Clear Fault
                              </button>
                            </div>
                          )}

                          {/* Live Mouse Switch Status Strip (works in ALL modes for instant wiring verification!) */}
                          <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 rounded-xl bg-dark-900/80 border border-dark-800">
                            <span className="text-[11px] font-bold text-slate-300 flex items-center gap-1.5">
                              <Activity size={13} className="text-cyan-400" />
                              <span>Live Mouse Limit Switches</span>
                            </span>
                            <div className="flex items-center gap-2 text-[11px]">
                              <span
                                className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full font-mono font-bold border ${
                                  activeDevice.tray_switches?.closed
                                    ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300'
                                    : 'bg-dark-950 border-dark-800 text-slate-400'
                                }`}
                              >
                                <span className={`w-1.5 h-1.5 rounded-full ${activeDevice.tray_switches?.closed ? 'bg-emerald-400 animate-pulse' : 'bg-slate-600'}`} />
                                CLOSED (GPIO 26): {activeDevice.tray_switches?.closed ? 'CLICKED' : 'OPEN'}
                              </span>
                              <span
                                className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full font-mono font-bold border ${
                                  activeDevice.tray_switches?.open
                                    ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300'
                                    : 'bg-dark-950 border-dark-800 text-slate-400'
                                }`}
                              >
                                <span className={`w-1.5 h-1.5 rounded-full ${activeDevice.tray_switches?.open ? 'bg-emerald-400 animate-pulse' : 'bg-slate-600'}`} />
                                OPEN (GPIO 27): {activeDevice.tray_switches?.open ? 'CLICKED' : 'OPEN'}
                              </span>
                            </div>
                          </div>

                          {/* 3-Mode Actuator Selector */}
                          <div className="space-y-1.5">
                            <span className="block text-[11px] font-bold uppercase tracking-wider text-slate-400">
                              Actuator Control Mode
                            </span>
                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                              {[
                                {
                                  id: 'LIMIT_360',
                                  title: '360° + Mouse Switches',
                                  badge: 'Recommended',
                                  desc: 'Zero-drift exact stops via GPIO 26/27 microswitches + jam cutoff.'
                                },
                                {
                                  id: 'TIMED_360',
                                  title: '360° Timed Only',
                                  badge: 'Bench Test',
                                  desc: 'Independent Open/Close ms timing with NVS position memory.'
                                },
                                {
                                  id: 'ANGLE_180',
                                  title: '180° Positional Servo',
                                  badge: 'MG90S / SG90',
                                  desc: 'Smooth angular sweep between exact Closed & Open degrees.'
                                }
                              ].map(m => (
                                <button
                                  key={m.id}
                                  type="button"
                                  onClick={() => setTrayForm(prev => ({ ...prev, mode: m.id }))}
                                  className={`p-3 rounded-xl border text-left transition ${
                                    trayForm.mode === m.id
                                      ? 'bg-primary-600/15 border-primary-500/50 text-white shadow-md shadow-primary-600/10'
                                      : 'bg-dark-900/70 border-dark-800 text-slate-300 hover:border-dark-700'
                                  }`}
                                >
                                  <div className="flex items-center justify-between gap-1.5">
                                    <span className="font-bold text-xs">{m.title}</span>
                                    <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded-full ${
                                      trayForm.mode === m.id
                                        ? 'bg-primary-500/25 text-primary-200'
                                        : 'bg-dark-800 text-slate-400'
                                    }`}>
                                      {m.badge}
                                    </span>
                                  </div>
                                  <p className="text-[10px] text-slate-400 mt-1 leading-snug">{m.desc}</p>
                                </button>
                              ))}
                            </div>
                          </div>

                          {/* Live Remote Action Buttons */}
                          <div className="space-y-2">
                            <div className="flex items-center justify-between flex-wrap gap-2">
                              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                                Live Remote Controls
                              </span>
                              {trayForm.mode !== 'ANGLE_180' && (
                                <div className="flex items-center gap-1.5 text-[11px] text-slate-400">
                                  <span>Nudge:</span>
                                  {[100, 200, 400].map(ms => (
                                    <button
                                      key={ms}
                                      type="button"
                                      onClick={() => setTrayNudgeMs(ms)}
                                      className={`px-2 py-0.5 rounded-md font-mono font-semibold border transition ${
                                        trayNudgeMs === ms
                                          ? 'bg-cyan-500/20 border-cyan-500/40 text-cyan-200'
                                          : 'bg-dark-900 border-dark-800 text-slate-400 hover:text-white'
                                      }`}
                                    >
                                      {ms}ms
                                    </button>
                                  ))}
                                </div>
                              )}
                            </div>

                            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2">
                              <button
                                type="button"
                                disabled={Boolean(sendingTrayCmd) || savingSettings || !activeDevice.is_online || activeDevice.device_power_on === false}
                                onClick={() => handleTrayCommand('TRAY_OPEN')}
                                className="px-3 py-2 rounded-xl bg-emerald-600/20 hover:bg-emerald-600/30 border border-emerald-500/35 text-emerald-200 font-bold text-[11px] transition disabled:opacity-40"
                              >
                                {sendingTrayCmd === 'TRAY_OPEN' ? 'Sending...' : 'Test Extend'}
                              </button>
                              <button
                                type="button"
                                disabled={Boolean(sendingTrayCmd) || savingSettings || !activeDevice.is_online || activeDevice.device_power_on === false}
                                onClick={() => handleTrayCommand('TRAY_CLOSE')}
                                className="px-3 py-2 rounded-xl bg-rose-600/20 hover:bg-rose-600/30 border border-rose-500/35 text-rose-200 font-bold text-[11px] transition disabled:opacity-40"
                              >
                                {sendingTrayCmd === 'TRAY_CLOSE' ? 'Sending...' : 'Test Retract'}
                              </button>
                              <button
                                type="button"
                                disabled={Boolean(sendingTrayCmd) || savingSettings || !activeDevice.is_online}
                                onClick={() => handleTrayCommand('TRAY_STOP')}
                                className="px-3 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-extrabold text-[11px] transition disabled:opacity-40 shadow-md shadow-rose-600/20"
                              >
                                {sendingTrayCmd === 'TRAY_STOP' ? 'Stopping...' : 'STOP'}
                              </button>
                              {trayForm.mode === 'LIMIT_360' && (
                                <button
                                  type="button"
                                  disabled={Boolean(sendingTrayCmd) || savingSettings || !activeDevice.is_online || activeDevice.device_power_on === false}
                                  onClick={() => handleTrayCommand('TRAY_HOME')}
                                  className="px-3 py-2 rounded-xl bg-indigo-600/20 hover:bg-indigo-600/30 border border-indigo-500/35 text-indigo-200 font-bold text-[11px] transition disabled:opacity-40"
                                >
                                  {sendingTrayCmd === 'TRAY_HOME' ? 'Homing...' : 'Home (Closed)'}
                                </button>
                              )}
                              {trayForm.mode !== 'ANGLE_180' && (
                                <>
                                  <button
                                    type="button"
                                    disabled={Boolean(sendingTrayCmd) || savingSettings || !activeDevice.is_online || activeDevice.device_power_on === false}
                                    onClick={() => handleTrayCommand('TRAY_NUDGE_OPEN', trayNudgeMs)}
                                    className="px-3 py-2 rounded-xl bg-cyan-600/15 hover:bg-cyan-600/25 border border-cyan-500/30 text-cyan-200 font-semibold text-[11px] transition disabled:opacity-40"
                                  >
                                    {sendingTrayCmd === 'TRAY_NUDGE_OPEN' ? 'Nudging...' : 'Nudge Out'}
                                  </button>
                                  <button
                                    type="button"
                                    disabled={Boolean(sendingTrayCmd) || savingSettings || !activeDevice.is_online || activeDevice.device_power_on === false}
                                    onClick={() => handleTrayCommand('TRAY_NUDGE_CLOSE', trayNudgeMs)}
                                    className="px-3 py-2 rounded-xl bg-amber-600/15 hover:bg-amber-600/25 border border-amber-500/30 text-amber-200 font-semibold text-[11px] transition disabled:opacity-40"
                                  >
                                    {sendingTrayCmd === 'TRAY_NUDGE_CLOSE' ? 'Nudging...' : 'Nudge In'}
                                  </button>
                                </>
                              )}
                              <button
                                type="button"
                                disabled={Boolean(sendingTrayCmd) || savingSettings || !activeDevice.is_online || activeDevice.device_power_on === false}
                                onClick={() => handleTrayCommand('TRAY_SET_CLOSED')}
                                className="px-3 py-2 rounded-xl bg-dark-900 hover:bg-dark-800 border border-dark-700 text-slate-200 font-semibold text-[11px] transition disabled:opacity-40"
                                title="Tell ESP32 the tray is currently CLOSED without spinning motor"
                              >
                                Mark Closed
                              </button>
                              {trayForm.mode === 'TIMED_360' && (
                                <button
                                  type="button"
                                  disabled={Boolean(sendingTrayCmd) || savingSettings || !activeDevice.is_online || activeDevice.device_power_on === false}
                                  onClick={() => handleTrayCommand('TRAY_SET_OPEN')}
                                  className="px-3 py-2 rounded-xl bg-dark-900 hover:bg-dark-800 border border-dark-700 text-slate-200 font-semibold text-[11px] transition disabled:opacity-40"
                                  title="Tell ESP32 the tray is currently OPEN without spinning motor"
                                >
                                  Mark Open
                                </button>
                              )}
                            </div>
                          </div>

                          {/* MODE-SPECIFIC PARAMETERS */}
                          {trayForm.mode === 'LIMIT_360' && (
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                              <div className="p-3 rounded-xl bg-dark-900/70 border border-dark-800">
                                <div className="flex items-center justify-between mb-1.5">
                                  <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                                    Motor Speed (%)
                                  </label>
                                  <span className="text-xs font-mono font-bold text-cyan-300">{trayForm.speed_pct}%</span>
                                </div>
                                <input
                                  type="range"
                                  min={20}
                                  max={100}
                                  step={5}
                                  value={trayForm.speed_pct}
                                  onChange={(e) => setTrayForm(prev => ({ ...prev, speed_pct: Number(e.target.value) }))}
                                  className="w-full accent-primary-500"
                                />
                                <p className="text-[10px] text-slate-500 mt-1">
                                  70–85% gives smooth torque while protecting SG90 plastic gears.
                                </p>
                              </div>
                              <div className="p-3 rounded-xl bg-dark-900/70 border border-dark-800">
                                <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">
                                  Jam Safety Cutoff (ms)
                                </label>
                                <input
                                  type="number"
                                  min={500}
                                  max={15000}
                                  step={250}
                                  value={trayForm.max_run_ms}
                                  onChange={(e) => setTrayForm(prev => ({ ...prev, max_run_ms: e.target.value }))}
                                  className="w-full px-2.5 py-1.5 rounded-lg bg-dark-950 border border-dark-700 text-xs font-mono text-white"
                                />
                                <p className="text-[10px] text-slate-500 mt-1">
                                  Cuts power &amp; triggers FAULT if mouse switch doesn&apos;t click in time.
                                </p>
                              </div>
                            </div>
                          )}

                          {trayForm.mode === 'TIMED_360' && (
                            <div className="space-y-3 pt-1">
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                                  Quick Round Presets
                                </span>
                                <div className="flex flex-wrap items-center gap-1.5">
                                  {[
                                    { label: '1 Round (~360°)', ms: 530 },
                                    { label: '2 Rounds (~720°)', ms: 1060 },
                                    { label: '3 Rounds (~1080°)', ms: 1590 }
                                  ].map(preset => (
                                    <button
                                      key={preset.ms}
                                      type="button"
                                      onClick={() => setTrayForm(prev => ({ ...prev, open_ms: preset.ms, close_ms: preset.ms }))}
                                      className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold border transition ${
                                        Number(trayForm.open_ms) === preset.ms && Number(trayForm.close_ms) === preset.ms
                                          ? 'bg-primary-500/20 border-primary-500/40 text-primary-200'
                                          : 'bg-dark-900 border-dark-800 text-slate-300 hover:border-dark-700 hover:text-white'
                                      }`}
                                    >
                                      {preset.label}
                                    </button>
                                  ))}
                                </div>
                              </div>

                              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                                <div>
                                  <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">
                                    Open Time (ms)
                                  </label>
                                  <input
                                    type="number"
                                    min={100}
                                    max={8000}
                                    step={20}
                                    value={trayForm.open_ms}
                                    onChange={(e) => setTrayForm(prev => ({ ...prev, open_ms: e.target.value }))}
                                    className="w-full px-2.5 py-1.5 rounded-lg bg-dark-900 border border-dark-700 text-xs font-mono text-white"
                                  />
                                  <div className="grid grid-cols-4 gap-1 mt-1">
                                    {[-50, -20, 20, 50].map(d => (
                                      <button
                                        key={d}
                                        type="button"
                                        onClick={() => adjustTrayMs('open_ms', d)}
                                        className="py-0.5 rounded bg-dark-900 hover:bg-dark-800 border border-dark-800 text-[10px] font-mono text-slate-300 transition"
                                      >
                                        {d > 0 ? `+${d}` : d}
                                      </button>
                                    ))}
                                  </div>
                                </div>
                                <div>
                                  <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">
                                    Close Time (ms)
                                  </label>
                                  <input
                                    type="number"
                                    min={100}
                                    max={8000}
                                    step={20}
                                    value={trayForm.close_ms}
                                    onChange={(e) => setTrayForm(prev => ({ ...prev, close_ms: e.target.value }))}
                                    className="w-full px-2.5 py-1.5 rounded-lg bg-dark-900 border border-dark-700 text-xs font-mono text-white"
                                  />
                                  <div className="grid grid-cols-4 gap-1 mt-1">
                                    {[-50, -20, 20, 50].map(d => (
                                      <button
                                        key={d}
                                        type="button"
                                        onClick={() => adjustTrayMs('close_ms', d)}
                                        className="py-0.5 rounded bg-dark-900 hover:bg-dark-800 border border-dark-800 text-[10px] font-mono text-slate-300 transition"
                                      >
                                        {d > 0 ? `+${d}` : d}
                                      </button>
                                    ))}
                                  </div>
                                </div>
                                <div className="p-2.5 rounded-xl bg-dark-900/70 border border-dark-800">
                                  <div className="flex items-center justify-between mb-1">
                                    <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                                      Speed (%)
                                    </label>
                                    <span className="text-xs font-mono font-bold text-cyan-300">{trayForm.speed_pct}%</span>
                                  </div>
                                  <input
                                    type="range"
                                    min={20}
                                    max={100}
                                    step={5}
                                    value={trayForm.speed_pct}
                                    onChange={(e) => setTrayForm(prev => ({ ...prev, speed_pct: Number(e.target.value) }))}
                                    className="w-full accent-primary-500"
                                  />
                                </div>
                              </div>
                            </div>
                          )}

                          {trayForm.mode === 'ANGLE_180' && (
                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1">
                              <div className="p-3 rounded-xl bg-dark-900/70 border border-dark-800">
                                <div className="flex items-center justify-between mb-1">
                                  <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                                    Closed Angle
                                  </label>
                                  <span className="text-xs font-mono font-bold text-slate-200">{trayForm.closed_angle}°</span>
                                </div>
                                <input
                                  type="range"
                                  min={0}
                                  max={180}
                                  step={1}
                                  value={trayForm.closed_angle}
                                  onChange={(e) => setTrayForm(prev => ({ ...prev, closed_angle: Number(e.target.value) }))}
                                  className="w-full accent-primary-500"
                                />
                              </div>
                              <div className="p-3 rounded-xl bg-dark-900/70 border border-dark-800">
                                <div className="flex items-center justify-between mb-1">
                                  <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                                    Open Angle
                                  </label>
                                  <span className="text-xs font-mono font-bold text-emerald-300">{trayForm.open_angle}°</span>
                                </div>
                                <input
                                  type="range"
                                  min={0}
                                  max={180}
                                  step={1}
                                  value={trayForm.open_angle}
                                  onChange={(e) => setTrayForm(prev => ({ ...prev, open_angle: Number(e.target.value) }))}
                                  className="w-full accent-emerald-500"
                                />
                              </div>
                              <div className="p-3 rounded-xl bg-dark-900/70 border border-dark-800">
                                <div className="flex items-center justify-between mb-1">
                                  <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                                    Sweep Speed
                                  </label>
                                  <span className="text-xs font-mono font-bold text-cyan-300">{trayForm.sweep_speed_dps}°/s</span>
                                </div>
                                <input
                                  type="range"
                                  min={30}
                                  max={360}
                                  step={10}
                                  value={trayForm.sweep_speed_dps}
                                  onChange={(e) => setTrayForm(prev => ({ ...prev, sweep_speed_dps: Number(e.target.value) }))}
                                  className="w-full accent-cyan-500"
                                />
                              </div>
                            </div>
                          )}

                          {/* Toggles + Collapsible Advanced Trim + Save Row */}
                          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-1">
                            <div className="flex flex-wrap items-center gap-4">
                              <label className="inline-flex items-center gap-2 cursor-pointer text-[11px] text-slate-300">
                                <input
                                  type="checkbox"
                                  checked={trayForm.enabled}
                                  onChange={(e) => setTrayForm(prev => ({ ...prev, enabled: e.target.checked }))}
                                  className="rounded border-dark-700 bg-dark-900 text-primary-500"
                                />
                                <span>Tray Enabled</span>
                              </label>
                              {trayForm.mode !== 'ANGLE_180' && (
                                <label className="inline-flex items-center gap-2 cursor-pointer text-[11px] text-slate-300">
                                  <input
                                    type="checkbox"
                                    checked={trayForm.invert_direction}
                                    onChange={(e) => setTrayForm(prev => ({ ...prev, invert_direction: e.target.checked }))}
                                    className="rounded border-dark-700 bg-dark-900 text-primary-500"
                                  />
                                  <span>Invert Direction</span>
                                </label>
                              )}
                              {trayForm.mode === 'LIMIT_360' && (
                                <label className="inline-flex items-center gap-2 cursor-pointer text-[11px] text-slate-300">
                                  <input
                                    type="checkbox"
                                    checked={trayForm.auto_home_on_boot}
                                    onChange={(e) => setTrayForm(prev => ({ ...prev, auto_home_on_boot: e.target.checked }))}
                                    className="rounded border-dark-700 bg-dark-900 text-primary-500"
                                  />
                                  <span>Auto-Home on Boot</span>
                                </label>
                              )}
                              {trayForm.mode !== 'ANGLE_180' && (
                                <button
                                  type="button"
                                  onClick={() => setShowTrayAdvanced(prev => !prev)}
                                  className="text-[11px] text-cyan-400 hover:text-cyan-300 underline underline-offset-2"
                                >
                                  {showTrayAdvanced ? 'Hide Neutral Trim' : 'Advanced Neutral Trim'}
                                </button>
                              )}
                            </div>

                            <div className="flex items-center gap-2 flex-wrap">
                              {isTrayConfigDirty && (
                                <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-300 border border-amber-500/30">
                                  Unsaved
                                </span>
                              )}
                              <button
                                type="button"
                                disabled={savingSettings}
                                onClick={() => {
                                  const defaults = {
                                    enabled: true,
                                    mode: 'LIMIT_360',
                                    invert_direction: false,
                                    speed_pct: 80,
                                    stop_us: 1500,
                                    open_ms: 1060,
                                    close_ms: 1060,
                                    closed_angle: 10,
                                    open_angle: 110,
                                    sweep_speed_dps: 120,
                                    max_run_ms: 4500,
                                    auto_home_on_boot: false
                                  };
                                  setTrayForm(defaults);
                                  handleSaveTrayConfig(defaults);
                                }}
                                className="px-3 py-1.5 rounded-lg bg-dark-900 hover:bg-dark-800 border border-dark-700 text-[11px] font-semibold text-slate-300 transition disabled:opacity-40"
                              >
                                Reset Factory Default
                              </button>
                              <button
                                type="button"
                                disabled={savingSettings}
                                onClick={() => handleSaveTrayConfig()}
                                className="px-3.5 py-1.5 rounded-lg bg-primary-600 hover:bg-primary-500 text-[11px] font-bold text-white transition disabled:opacity-40 shadow-md shadow-primary-600/20"
                              >
                                {savingSettings ? 'Syncing...' : 'Save Default & Sync ESP32'}
                              </button>
                            </div>
                          </div>

                          {/* Optional Advanced Neutral Trim (hidden by default to keep UI super clean!) */}
                          {showTrayAdvanced && trayForm.mode !== 'ANGLE_180' && (
                            <div className="p-3 rounded-xl bg-dark-900/70 border border-dark-800 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                              <div>
                                <span className="text-[11px] font-bold text-white block">Stop Neutral Trim (µs)</span>
                                <span className="text-[10px] text-slate-400">
                                  Only adjust (1350–1650 µs) if your 360° SG90 creeps slightly during braking.
                                </span>
                              </div>
                              <input
                                type="number"
                                min={1350}
                                max={1650}
                                step={5}
                                value={trayForm.stop_us}
                                onChange={(e) => setTrayForm(prev => ({ ...prev, stop_us: e.target.value }))}
                                className="w-28 px-2.5 py-1.5 rounded-lg bg-dark-950 border border-dark-700 text-xs font-mono text-white shrink-0"
                              />
                            </div>
                          )}

                          <p className="text-[11px] text-slate-400 leading-relaxed bg-dark-900/70 border border-dark-800/80 rounded-lg px-3 py-2">
                            <strong className="text-cyan-300">Mouse Switch Wiring:</strong> Wire each 3-pin mouse microswitch with <strong>Pin 1 (under button = COM) → GND</strong> and <strong>Pin 2 (middle = NO) → GPIO 26 (CLOSED) / GPIO 27 (OPEN)</strong>. Click each switch by hand and watch the live badges above turn green before testing!
                          </p>
                        </div>
                      )}
                    </div>

                    {/* Remote Power & ESP32 Maintenance Bar */}
                    <div className="p-3.5 rounded-xl bg-dark-950/75 border border-dark-800/90 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 text-xs font-bold text-white">
                          <Power size={14} className={activeDevice.device_power_on === false ? 'text-amber-400' : 'text-emerald-400'} />
                          <span>
                            Device Power &amp; Maintenance:{' '}
                            <span className={activeDevice.device_power_on === false ? 'text-amber-400' : 'text-emerald-400'}>
                              {activeDevice.device_power_on === false ? 'STANDBY (OFF)' : 'POWERED ON'}
                            </span>
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-400 mt-0.5 leading-snug">
                          {activeDevice.device_power_on === false
                            ? 'OLED display is OFF, cabinet tray is closed, and Wi-Fi is in low-power standby (wakes in ~12s).'
                            : 'Put hardware into low-power Standby (OLED OFF + tray retracted) or remotely reboot ESP32.'}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0 flex-wrap">
                        <button
                          type="button"
                          disabled={togglingPower}
                          onClick={handleToggleDevicePower}
                          className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-bold border transition disabled:opacity-40 ${
                            activeDevice.device_power_on === false
                              ? 'bg-emerald-600 hover:bg-emerald-500 text-white border-emerald-400/30'
                              : 'bg-amber-500/15 hover:bg-amber-500/25 text-amber-200 border-amber-500/35'
                          }`}
                        >
                          <Power size={12} />
                          <span>
                            {togglingPower
                              ? 'Switching...'
                              : activeDevice.device_power_on === false
                                ? 'Wake Device (Power ON)'
                                : 'Power OFF (Standby)'}
                          </span>
                        </button>
                        <button
                          type="button"
                          disabled={rebootingDevice || !activeDevice.is_online}
                          onClick={handleRebootDevice}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 border border-rose-500/30 text-[11px] font-bold transition disabled:opacity-40"
                          title="Remotely restart ESP32 (reconnects in ~15 seconds)"
                        >
                          <RotateCcw size={12} className={rebootingDevice ? 'animate-spin' : ''} />
                          <span>{rebootingDevice ? 'Rebooting...' : 'Reboot ESP32'}</span>
                        </button>
                      </div>
                    </div>

                    {/* Collapsible ESP32 Firmware Setup Credentials (SuperAdmin Only) */}
                    {isSuperAdmin && (
                      <div className="rounded-xl bg-dark-950/75 border border-dark-800/90 overflow-hidden">
                        <button
                          type="button"
                          onClick={() => setShowCredentials(prev => !prev)}
                          className="w-full px-4 py-2.5 flex items-center justify-between text-xs font-semibold text-slate-300 hover:text-white transition"
                        >
                          <span className="flex items-center gap-2">
                            <Key size={13} className="text-primary-400" />
                            <span>ESP32 Setup Credentials (config.h)</span>
                          </span>
                          {showCredentials ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
                        </button>

                        {showCredentials && (
                          <div className="px-4 pb-4 pt-2 space-y-2.5 border-t border-dark-800/70 text-xs">
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
                                  className="p-1.5 rounded-lg bg-dark-800 hover:bg-dark-700 text-slate-300 shrink-0 transition"
                                  title={`Copy ${item.label}`}
                                >
                                  {copiedField === item.label ? <Check size={14} className="text-emerald-400" /> : <Copy size={14} />}
                                </button>
                              </div>
                            ))}

                            <div className="flex items-center justify-end pt-1">
                              <button
                                type="button"
                                disabled={savingSettings}
                                onClick={handleRegenerateKey}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 border border-amber-500/30 text-[11px] font-semibold transition"
                              >
                                <RotateCcw size={12} />
                                <span>Regenerate Device API Key</span>
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </>
            ) : null}
          </div>
        </div>
      )}

      {/* LIVE COMMAND / SYNC STATUS BANNER */}
      {isStaff && liveCommand && liveCommand.status && liveCommand.status !== 'IDLE' && (
        <div
          className={`p-3.5 sm:p-4 rounded-2xl border flex flex-col sm:flex-row sm:items-center justify-between gap-3 animate-slideUp shadow-lg ${
            liveCommand.status === 'COMPLETED'
              ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-200'
              : liveCommand.status === 'FAILED'
                ? 'bg-rose-500/10 border-rose-500/30 text-rose-200'
                : 'bg-primary-500/10 border-primary-500/30 text-primary-200'
          }`}
        >
          <div className="flex items-start gap-3 min-w-0">
            <div className="p-2 rounded-xl bg-white/5 border border-white/10 shrink-0">
              <Fingerprint size={18} className={isCommandInFlight ? 'animate-pulse' : ''} />
            </div>
            <div className="text-xs min-w-0">
              <p className="font-bold uppercase tracking-wider flex items-center gap-2 flex-wrap">
                <span>{liveCommand.action && liveCommand.action !== 'NONE' ? String(liveCommand.action).replaceAll('_', ' ') : 'Device Command'}</span>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-black/25 border border-white/10">
                  {liveCommand.status}
                </span>
                {liveCommand.slot_id ? <span className="font-mono text-[11px] opacity-85">Slot #{liveCommand.slot_id}</span> : null}
                {(liveCommand.queue_length > 0 || activeDevice?.queue_length > 0) && (
                  <span className="px-1.5 py-0.5 rounded bg-dark-900/80 border border-dark-700 text-[10px] text-slate-300">
                    +{liveCommand.queue_length ?? activeDevice?.queue_length} queued
                  </span>
                )}
              </p>
              <p className="text-slate-200 mt-1 leading-snug">
                {liveCommand.message || `Processing command for ${liveCommand.student_name || 'device'}...`}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 self-end sm:self-auto shrink-0">
            {liveCommand.action === 'ENROLL' && !showEnrollWizard && (
              <button
                type="button"
                onClick={() => {
                  if (liveCommand?.student_id) {
                    const matched = allStudents.find(s => String(s._id) === String(liveCommand.student_id));
                    if (matched) setEnrollWizardStudent(matched);
                  }
                  if (liveCommand?.finger_index) {
                    setEnrollWizardFingerIndex(liveCommand.finger_index);
                  }
                  setShowEnrollWizard(true);
                }}
                className="px-3 py-1.5 rounded-xl bg-primary-600 hover:bg-primary-500 text-[11px] font-bold text-white transition"
              >
                Open Wizard
              </button>
            )}
            {isCommandInFlight ? (
              <button
                type="button"
                onClick={handleCancelCommand}
                className="px-3 py-1.5 rounded-xl bg-dark-950/80 hover:bg-dark-900 border border-dark-700 text-[11px] font-semibold text-slate-200 transition"
              >
                Cancel
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setLiveCommand(null)}
                className="px-3 py-1.5 rounded-xl bg-dark-950/80 hover:bg-dark-900 border border-dark-700 text-[11px] font-semibold text-slate-200 transition"
              >
                Dismiss
              </button>
            )}
          </div>
        </div>
      )}

      {/* KPI SUMMARY STRIP */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        {[
          {
            label: `Entries (${selectedDate === getTodayIST() ? 'Today' : selectedDate})`,
            value: stats.entries_today,
            icon: LogIn,
            accent: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/25',
            bar: 'from-emerald-500/70 to-teal-500/10'
          },
          {
            label: 'Exits',
            value: stats.exits_today,
            icon: LogOut,
            accent: 'text-amber-400 bg-amber-500/10 border-amber-500/25',
            bar: 'from-amber-500/70 to-orange-500/10'
          },
          {
            label: 'On Campus Now',
            value: stats.inside_now,
            icon: Users,
            accent: 'text-primary-400 bg-primary-500/10 border-primary-500/25',
            bar: 'from-primary-500/70 to-indigo-500/10'
          },
          {
            label: 'Auto-Marked Present',
            value: stats.attendance_synced,
            icon: CheckCircle2,
            accent: 'text-cyan-400 bg-cyan-500/10 border-cyan-500/25',
            bar: 'from-cyan-500/70 to-sky-500/10'
          }
        ].map(kpi => {
          const IconComp = kpi.icon;
          return (
            <div key={kpi.label} className="glass-card-hover relative overflow-hidden p-4 rounded-2xl">
              <div className={`absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r ${kpi.bar}`} />
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-medium text-slate-400 truncate">{kpi.label}</span>
                <div className={`p-2 rounded-xl border shrink-0 ${kpi.accent}`}>
                  <IconComp size={15} />
                </div>
              </div>
              <p className="text-2xl sm:text-3xl font-extrabold text-white font-outfit tabular-nums mt-2.5">
                {kpi.value}
              </p>
            </div>
          );
        })}
      </div>

      {/* SEGMENTED STAFF TABS */}
      {isStaff && (
        <div className="inline-flex items-center gap-1.5 p-1 rounded-2xl bg-dark-900/80 border border-dark-800/90 backdrop-blur-md">
          <button
            type="button"
            onClick={() => setActiveTab('feed')}
            className={`px-4 py-2.5 rounded-xl text-xs font-bold transition-all flex items-center gap-2 ${
              activeTab === 'feed'
                ? 'bg-primary-600 text-white shadow-lg shadow-primary-600/25'
                : 'text-slate-400 hover:text-white hover:bg-white/[0.04]'
            }`}
          >
            <Clock size={14} />
            <span>Live Entry &amp; Exit Feed</span>
            <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded-md ${activeTab === 'feed' ? 'bg-white/20 text-white' : 'bg-dark-950 text-slate-400'}`}>
              {logs.length}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('enroll')}
            className={`px-4 py-2.5 rounded-xl text-xs font-bold transition-all flex items-center gap-2 ${
              activeTab === 'enroll'
                ? 'bg-primary-600 text-white shadow-lg shadow-primary-600/25'
                : 'text-slate-400 hover:text-white hover:bg-white/[0.04]'
            }`}
          >
            <UserPlus size={14} />
            <span>Enroll Fingerprints</span>
            <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded-md ${activeTab === 'enroll' ? 'bg-white/20 text-white' : 'bg-dark-950 text-slate-400'}`}>
              {activeDevice?.enrolled_count ?? templates.length}
            </span>
          </button>
        </div>
      )}

      {/* TAB 1: LIVE ENTRY / EXIT FEED */}
      {(!isStaff || activeTab === 'feed') && (
        <div className="glass-panel p-4 sm:p-5 rounded-2xl border border-white/[0.07] space-y-4">
          {/* Filters Toolbar */}
          <div className="flex flex-col lg:flex-row gap-3 items-stretch lg:items-center justify-between">
            <div className="flex flex-wrap items-center gap-2">
              <div className="inline-flex items-center gap-1 p-1 rounded-xl bg-dark-950/70 border border-dark-800">
                <button
                  type="button"
                  onClick={() => setSelectedDate(getTodayIST())}
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition ${
                    selectedDate === getTodayIST() ? 'bg-primary-600 text-white' : 'text-slate-400 hover:text-white'
                  }`}
                >
                  Today
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedDate(getYesterdayIST())}
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition ${
                    selectedDate === getYesterdayIST() ? 'bg-primary-600 text-white' : 'text-slate-400 hover:text-white'
                  }`}
                >
                  Yesterday
                </button>
              </div>

              <input
                type="date"
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                className="px-3 py-2 rounded-xl bg-dark-900/90 border border-dark-800 hover:border-dark-700 text-xs text-white transition"
              />

              {isStaff && (
                <>
                  <select
                    value={classFilter}
                    onChange={(e) => setClassFilter(e.target.value)}
                    className="px-3 py-2 rounded-xl bg-dark-900/90 border border-dark-800 hover:border-dark-700 text-xs text-white transition"
                  >
                    <option value="All">All Classes</option>
                    {classes.map(c => (
                      <option key={c} value={c}>Class {c}</option>
                    ))}
                  </select>

                  <select
                    value={eventFilter}
                    onChange={(e) => setEventFilter(e.target.value)}
                    className="px-3 py-2 rounded-xl bg-dark-900/90 border border-dark-800 hover:border-dark-700 text-xs text-white transition"
                  >
                    <option value="All">Entry &amp; Exit</option>
                    <option value="ENTRY">Entry Only</option>
                    <option value="EXIT">Exit Only</option>
                  </select>
                </>
              )}
            </div>

            {isStaff && (
              <div className="relative flex-1 lg:max-w-xs">
                <Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500" />
                <input
                  type="text"
                  placeholder="Search student or roll..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-9 pr-8 py-2 rounded-xl bg-dark-900/90 border border-dark-800 focus:border-primary-500 text-xs text-white placeholder-slate-500 transition"
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery('')}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white"
                  >
                    <X size={13} />
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Logs List */}
          {loadingLogs ? (
            <div className="space-y-2.5">
              {[1, 2, 3].map(i => (
                <div key={i} className="p-4 rounded-xl bg-dark-900/50 border border-dark-800/70 flex items-center gap-3 animate-pulse">
                  <div className="w-10 h-10 rounded-xl bg-dark-800" />
                  <div className="flex-1 space-y-2">
                    <div className="h-3.5 w-44 rounded bg-dark-800" />
                    <div className="h-2.5 w-60 rounded bg-dark-800/70" />
                  </div>
                </div>
              ))}
            </div>
          ) : logs.length === 0 ? (
            <div className="py-14 px-4 text-center bg-dark-950/45 rounded-2xl border border-dashed border-dark-800 space-y-2">
              <div className="w-12 h-12 rounded-2xl bg-dark-900 border border-dark-800 text-slate-500 flex items-center justify-center mx-auto">
                <Fingerprint size={22} />
              </div>
              <p className="text-sm font-bold text-slate-300 font-outfit">No scans recorded for {selectedDate}</p>
              <p className="text-xs text-slate-500 max-w-sm mx-auto">
                Student arrivals and departures will appear here instantaneously when scanned on the ESP32 gate terminal.
              </p>
            </div>
          ) : (
            <div className="space-y-2.5">
              {logs.map(log => {
                const isEntry = log.event_type === 'ENTRY';
                return (
                  <div
                    key={log._id}
                    className="group relative overflow-hidden p-3.5 sm:p-4 rounded-xl bg-dark-900/70 hover:bg-dark-900/95 border border-dark-800/90 hover:border-primary-500/25 transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                  >
                    {/* Left Event Accent Stripe */}
                    <div className={`absolute inset-y-0 left-0 w-1 ${isEntry ? 'bg-emerald-500' : 'bg-amber-500'}`} />

                    <div className="flex items-start sm:items-center gap-3 min-w-0 pl-1.5">
                      <div
                        className={`w-10 h-10 rounded-xl border flex items-center justify-center font-bold text-xs shrink-0 ${
                          isEntry
                            ? 'bg-emerald-500/12 border-emerald-500/30 text-emerald-300'
                            : 'bg-amber-500/12 border-amber-500/30 text-amber-300'
                        }`}
                      >
                        {getInitials(log.student?.name)}
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
                            className={`inline-flex items-center gap-1 text-[10px] font-extrabold uppercase tracking-wider px-2 py-0.5 rounded-full border ${
                              isEntry ? 'badge-glow-emerald' : 'badge-glow-amber'
                            }`}
                          >
                            {isEntry ? <LogIn size={10} /> : <LogOut size={10} />}
                            {log.event_type}
                          </span>
                        </div>

                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-400 mt-1.5">
                          <span className="font-mono text-slate-100 font-semibold">{formatISTTime(log.timestamp)}</span>
                          {!isEntry && log.duration_minutes !== null && (
                            <span className="px-2 py-0.5 rounded-md bg-dark-950/70 border border-dark-800 text-slate-300">
                              Stay: <strong className="text-white">{formatDuration(log.duration_minutes)}</strong>
                            </span>
                          )}
                          {log.attendance_marked && (
                            <span className="inline-flex items-center gap-1 text-cyan-300 font-medium">
                              <CheckCircle2 size={11} />
                              Present ({log.attendance_session || 'Session 1'})
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Parent Notification Badges + 1-Tap WhatsApp */}
                    <div className="flex items-center gap-1.5 flex-wrap sm:justify-end shrink-0 pl-1.5 sm:pl-0">
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
                                ? 'bg-indigo-500/10 text-indigo-300 border-indigo-500/25'
                                : 'bg-dark-950/70 text-slate-500 border-dark-800'
                            }`}
                            title="Mobile App Push Notification"
                          >
                            <Bell size={11} />
                            Push
                          </span>

                          <span
                            className={`inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-1 rounded-lg border ${
                              log.notification?.email_sent
                                ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/25'
                                : 'bg-dark-950/70 text-slate-500 border-dark-800'
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
                          className="inline-flex items-center gap-1 text-[10px] font-bold px-2.5 py-1 rounded-lg bg-emerald-600/20 hover:bg-emerald-600/35 text-emerald-300 border border-emerald-500/35 transition"
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

      {/* TAB 2: MULTI-FINGER ENROLLMENT MANAGER (Staff Only) */}
      {isStaff && activeTab === 'enroll' && (
        <div className="glass-panel p-4 sm:p-5 rounded-2xl border border-white/[0.07] space-y-4">
          {/* Unified Enrollment Progress & Action Header */}
          <div className="p-4 rounded-2xl bg-gradient-to-br from-dark-950/90 to-dark-900/70 border border-dark-800/90 space-y-3.5">
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
              <div className="space-y-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="text-sm font-bold text-white font-outfit">
                    {enrollClassFilter === 'All' ? 'Campus' : `Class ${enrollClassFilter}`} Fingerprint Coverage
                  </h3>
                  <span className="text-xs font-mono font-bold text-primary-300">
                    {enrollProgressStats.enrolled}/{enrollProgressStats.total} ({enrollProgressStats.pct}%)
                  </span>
                  {enrollProgressStats.withBackup > 0 && (
                    <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-cyan-500/10 text-cyan-300 border border-cyan-500/25">
                      {enrollProgressStats.withBackup} with Backup
                    </span>
                  )}
                </div>

                {activeDevice && (
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-400">
                    <span>DB Slots: <strong className="text-slate-200 tabular-nums">{activeDevice.enrolled_count ?? templates.length}</strong></span>
                    <span>R307S Flash: <strong className={`tabular-nums ${sensorDriftDetected ? 'text-amber-400' : 'text-emerald-400'}`}>{activeDevice.total_templates ?? 0}</strong></span>
                    {sensorDriftDetected && (
                      <span className="inline-flex items-center gap-1 text-amber-300 font-semibold">
                        <AlertCircle size={11} />
                        Hardware &amp; DB out of sync
                      </span>
                    )}
                  </div>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-2 shrink-0">
                {firstUnenrolledInScope && (
                  <button
                    type="button"
                    onClick={() => handleStartEnroll(firstUnenrolledInScope, 1)}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 active:scale-[0.98] text-white text-xs font-bold transition shadow-lg shadow-emerald-600/20"
                  >
                    <Sparkles size={13} />
                    <span>Start Class Enrollment</span>
                  </button>
                )}

                <button
                  type="button"
                  disabled={syncingSlots}
                  onClick={handleSyncSensorSlots}
                  className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold transition disabled:opacity-50 border ${
                    sensorDriftDetected
                      ? 'bg-amber-500/20 hover:bg-amber-500/30 text-amber-200 border-amber-400/40 animate-pulse'
                      : 'bg-dark-900 hover:bg-dark-800 text-cyan-300 border-cyan-500/30'
                  }`}
                  title="Audit all 1000 R307S slots, erase orphan sensor prints, and remove stale DB records"
                >
                  <RefreshCw size={13} className={syncingSlots ? 'animate-spin' : ''} />
                  <span>{syncingSlots ? 'Syncing...' : 'Sync Sensor'}</span>
                </button>

                {isSuperAdmin && (
                  <button
                    type="button"
                    disabled={clearingAll}
                    onClick={handleClearAllTemplates}
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 border border-rose-500/30 text-xs font-bold transition disabled:opacity-50"
                  >
                    <AlertTriangle size={13} />
                    <span>{clearingAll ? 'Clearing...' : 'Clear All'}</span>
                  </button>
                )}
              </div>
            </div>

            {allStudents.length > 0 && (
              <div className="w-full h-2 rounded-full bg-dark-900 overflow-hidden border border-dark-800">
                <div
                  className="h-full bg-gradient-to-r from-primary-500 via-cyan-400 to-emerald-400 transition-all duration-500 rounded-full"
                  style={{ width: `${enrollProgressStats.pct}%` }}
                />
              </div>
            )}
          </div>

          {/* Roster Filter Bar */}
          <div className="flex flex-col md:flex-row gap-3 items-stretch md:items-center justify-between">
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={enrollClassFilter}
                onChange={(e) => setEnrollClassFilter(e.target.value)}
                className="px-3 py-2 rounded-xl bg-dark-900/90 border border-dark-800 hover:border-dark-700 text-xs text-white transition"
              >
                <option value="All">All Classes</option>
                {classes.map(c => (
                  <option key={c} value={c}>Class {c}</option>
                ))}
              </select>

              <div className="inline-flex rounded-xl bg-dark-950/70 border border-dark-800 p-0.5 text-[11px] font-semibold">
                {[
                  { id: 'all', label: `All (${enrollProgressStats.total})` },
                  { id: 'unenrolled', label: `Pending (${Math.max(0, enrollProgressStats.total - enrollProgressStats.enrolled)})` },
                  { id: 'enrolled', label: `Enrolled (${enrollProgressStats.enrolled})` }
                ].map(opt => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => setEnrollStatusFilter(opt.id)}
                    className={`px-2.5 py-1.5 rounded-lg transition ${
                      enrollStatusFilter === opt.id
                        ? 'bg-primary-600 text-white shadow-sm'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="relative flex-1 md:max-w-xs">
              <Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500" />
              <input
                type="text"
                placeholder="Search student or roll..."
                value={enrollSearch}
                onChange={(e) => setEnrollSearch(e.target.value)}
                className="w-full pl-9 pr-8 py-2 rounded-xl bg-dark-900/90 border border-dark-800 focus:border-primary-500 text-xs text-white placeholder-slate-500 transition"
              />
              {enrollSearch && (
                <button
                  type="button"
                  onClick={() => setEnrollSearch('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white"
                >
                  <X size={13} />
                </button>
              )}
            </div>
          </div>

          {/* Student Multi-Finger Cards */}
          {loadingEnrollData ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {[1, 2, 3, 4].map(i => (
                <div key={i} className="p-4 rounded-2xl bg-dark-900/50 border border-dark-800/70 space-y-3 animate-pulse">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-dark-800" />
                    <div className="flex-1 space-y-1.5">
                      <div className="h-3.5 w-36 rounded bg-dark-800" />
                      <div className="h-2.5 w-24 rounded bg-dark-800/70" />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="h-9 rounded-xl bg-dark-800/70" />
                    <div className="h-9 rounded-xl bg-dark-800/50" />
                  </div>
                </div>
              ))}
            </div>
          ) : filteredEnrollStudents.length === 0 ? (
            <div className="py-12 text-center bg-dark-950/45 rounded-2xl border border-dashed border-dark-800 space-y-1.5">
              <p className="text-sm font-bold text-slate-300 font-outfit">No matching students</p>
              <p className="text-xs text-slate-500">Try clearing your search or switching the status filter.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {filteredEnrollStudents.map(student => {
                const studentTemplates = templatesByStudentId.get(String(student._id)) || [];
                const primaryTmpl = studentTemplates.find(t => (t.finger_index || 1) === 1) || null;
                const backupTmpl = studentTemplates.find(t => t.finger_index === 2) || null;
                const hasAnyPrint = Boolean(primaryTmpl || backupTmpl);
                return (
                  <div
                    key={student._id}
                    className="p-3.5 sm:p-4 rounded-2xl bg-dark-900/75 hover:bg-dark-900/95 border border-dark-800/90 hover:border-primary-500/30 transition-all space-y-3"
                  >
                    {/* Student Header */}
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-3 min-w-0">
                        <div
                          className={`w-10 h-10 rounded-xl border flex items-center justify-center font-bold text-xs shrink-0 ${
                            hasAnyPrint
                              ? 'bg-emerald-500/12 border-emerald-500/30 text-emerald-300'
                              : 'bg-dark-950 border-dark-800 text-slate-400'
                          }`}
                        >
                          {getInitials(student.name)}
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-bold text-white truncate">{student.name}</p>
                          <p className="text-[11px] text-slate-400 mt-0.5">
                            Class <strong className="text-slate-200">{student.class_level}</strong> &bull; Roll <strong className="font-mono text-slate-200">{student.roll_number}</strong>
                          </p>
                        </div>
                      </div>

                      <span
                        className={`text-[10px] font-bold px-2 py-0.5 rounded-full border shrink-0 ${
                          hasAnyPrint
                            ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/25'
                            : 'bg-dark-950 text-slate-500 border-dark-800'
                        }`}
                      >
                        {studentTemplates.length >= 2 ? '2 Prints' : hasAnyPrint ? '1 Print' : 'Pending'}
                      </span>
                    </div>

                    {/* Clean 2-Slot Finger Controls */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {/* Slot 1: Primary Finger */}
                      {primaryTmpl ? (
                        <div className="flex items-center justify-between gap-1.5 px-2.5 py-2 rounded-xl bg-emerald-500/[0.07] border border-emerald-500/25">
                          <div className="min-w-0">
                            <span className="text-[10px] font-bold text-emerald-300 block leading-tight">Primary Finger</span>
                            <span className="text-[10px] font-mono text-slate-400">Slot #{primaryTmpl.slot_id}</span>
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            <button
                              type="button"
                              onClick={() => handleStartEnroll(student, 1)}
                              className="p-1.5 rounded-lg bg-dark-900/90 hover:bg-primary-600 text-slate-300 hover:text-white transition"
                              title="Re-enroll Primary Finger"
                            >
                              <RotateCcw size={12} />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleRemoveTemplate(student, primaryTmpl)}
                              className="p-1.5 rounded-lg bg-dark-900/90 hover:bg-rose-600 text-rose-400 hover:text-white transition"
                              title={`Remove Primary (Slot #${primaryTmpl.slot_id})`}
                            >
                              <Trash2 size={12} />
                            </button>
                          </div>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => handleStartEnroll(student, 1)}
                          className={`${backupTmpl ? '' : 'sm:col-span-2'} w-full px-3 py-2.5 rounded-xl bg-primary-600 hover:bg-primary-500 active:scale-[0.99] text-white text-xs font-bold transition flex items-center justify-center gap-2 shadow-md shadow-primary-600/20`}
                        >
                          <Fingerprint size={14} />
                          <span>Enroll Primary Finger</span>
                        </button>
                      )}

                      {/* Slot 2: Optional Backup Finger */}
                      {(primaryTmpl || backupTmpl) && (
                        backupTmpl ? (
                          <div className="flex items-center justify-between gap-1.5 px-2.5 py-2 rounded-xl bg-cyan-500/[0.07] border border-cyan-500/25">
                            <div className="min-w-0">
                              <span className="text-[10px] font-bold text-cyan-300 block leading-tight">Backup Finger</span>
                              <span className="text-[10px] font-mono text-slate-400">Slot #{backupTmpl.slot_id}</span>
                            </div>
                            <div className="flex items-center gap-1 shrink-0">
                              <button
                                type="button"
                                onClick={() => handleStartEnroll(student, 2)}
                                className="p-1.5 rounded-lg bg-dark-900/90 hover:bg-cyan-600 text-slate-300 hover:text-white transition"
                                title="Re-enroll Backup Finger"
                              >
                                <RotateCcw size={12} />
                              </button>
                              <button
                                type="button"
                                onClick={() => handleRemoveTemplate(student, backupTmpl)}
                                className="p-1.5 rounded-lg bg-dark-900/90 hover:bg-rose-600 text-rose-400 hover:text-white transition"
                                title={`Remove Backup (Slot #${backupTmpl.slot_id})`}
                              >
                                <Trash2 size={12} />
                              </button>
                            </div>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => handleStartEnroll(student, 2)}
                            className="px-3 py-2 rounded-xl bg-dark-950/70 hover:bg-cyan-500/15 text-slate-300 hover:text-cyan-200 border border-dashed border-dark-700 hover:border-cyan-500/40 text-xs font-semibold transition flex items-center justify-center gap-1.5"
                          >
                            <Plus size={13} />
                            <span>Add Backup Finger</span>
                          </button>
                        )
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* INTERACTIVE LIVE ENROLLMENT WIZARD MODAL */}
      {isStaff && showEnrollWizard && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-4 animate-fadeIn">
          <div className="glass-panel w-full max-w-md rounded-3xl border border-white/10 p-5 sm:p-6 space-y-5 shadow-2xl animate-scaleUp relative overflow-hidden">
            {/* Ambient Top Modal Glow */}
            <div
              className={`pointer-events-none absolute -top-20 left-1/2 -translate-x-1/2 w-64 h-40 rounded-full blur-3xl opacity-25 ${
                liveCommand?.status === 'COMPLETED'
                  ? 'bg-emerald-500'
                  : liveCommand?.status === 'FAILED'
                    ? 'bg-rose-500'
                    : 'bg-primary-500'
              }`}
            />

            <div className="relative flex items-start justify-between gap-3">
              <div>
                <span className="text-[10px] font-bold uppercase tracking-widest text-primary-400 flex items-center gap-1">
                  <Sparkles size={11} />
                  Live Biometric Enrollment
                </span>
                <h3 className="text-lg sm:text-xl font-extrabold text-white font-outfit mt-0.5">
                  {enrollWizardStudent?.name || liveCommand?.student_name || 'Student'}
                </h3>
                <div className="flex flex-wrap items-center gap-1.5 mt-1.5 text-[10px]">
                  {enrollWizardStudent?.class_level && (
                    <span className="px-2 py-0.5 rounded-md bg-dark-950/80 border border-dark-800 text-slate-300 font-semibold">
                      Class {enrollWizardStudent.class_level} &bull; Roll {enrollWizardStudent.roll_number}
                    </span>
                  )}
                  <span className="px-2 py-0.5 rounded-md bg-primary-500/15 border border-primary-500/30 text-primary-300 font-bold">
                    {liveCommand?.finger_label || (enrollWizardFingerIndex === 2 ? 'Backup Finger' : 'Primary Finger')}
                  </span>
                  {liveCommand?.slot_id && (
                    <span className="px-2 py-0.5 rounded-md bg-dark-950/80 border border-dark-800 text-slate-400 font-mono">
                      Slot #{liveCommand.slot_id}
                    </span>
                  )}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowEnrollWizard(false)}
                className="p-1.5 rounded-xl bg-dark-900/90 hover:bg-dark-800 border border-dark-800 text-slate-400 hover:text-white transition"
                aria-label="Hide enrollment wizard"
              >
                <X size={15} />
              </button>
            </div>

            {/* Animated Concentric Fingerprint Sonar Ring */}
            <div className="relative flex flex-col items-center text-center py-3 space-y-4">
              <div className="relative flex items-center justify-center">
                {isCommandInFlight && (
                  <span className="absolute w-24 h-24 rounded-full border border-primary-400/35 animate-ping" style={{ animationDuration: '2s' }} />
                )}
                <div
                  className={`relative w-20 h-20 rounded-full flex items-center justify-center border-2 transition-all duration-300 ${
                    liveCommand?.status === 'COMPLETED'
                      ? 'bg-emerald-500/15 border-emerald-400 text-emerald-400 shadow-xl shadow-emerald-500/25'
                      : liveCommand?.status === 'FAILED'
                        ? 'bg-rose-500/15 border-rose-400 text-rose-400 shadow-xl shadow-rose-500/25'
                        : 'bg-primary-500/15 border-primary-400 text-primary-300 shadow-xl shadow-primary-500/25'
                  }`}
                >
                  {liveCommand?.status === 'COMPLETED' ? (
                    <CheckCircle2 size={38} />
                  ) : liveCommand?.status === 'FAILED' ? (
                    <XCircle size={38} />
                  ) : (
                    <Fingerprint size={38} className="animate-pulse" />
                  )}
                </div>
              </div>

              <div className="w-full space-y-2">
                <p className="text-xs sm:text-sm font-semibold text-white leading-relaxed px-2">
                  {liveCommand?.message || 'Sending enrollment command to ESP32 scanner...'}
                </p>
                {liveCommand?.status !== 'FAILED' && (
                  <div className="w-full h-2 rounded-full bg-dark-950/90 border border-dark-800 overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-500 ${
                        liveCommand?.status === 'COMPLETED'
                          ? 'bg-emerald-500'
                          : 'bg-gradient-to-r from-primary-500 via-indigo-400 to-cyan-400'
                      }`}
                      style={{ width: `${enrollStageInfo.pct}%` }}
                    />
                  </div>
                )}
              </div>
            </div>

            {/* 4-Stage Visual Stepper */}
            <div className="grid grid-cols-4 gap-2 text-center text-[10px]">
              {[
                { idx: 1, label: 'ESP32 Ready' },
                { idx: 2, label: 'Scan 1/2' },
                { idx: 3, label: 'Scan 2/2' },
                { idx: 4, label: 'Verified' }
              ].map(st => {
                const done = enrollStageInfo.stage >= st.idx;
                const active = enrollStageInfo.stage >= st.idx - 0.5 && enrollStageInfo.stage < st.idx + 0.5 && liveCommand?.status !== 'COMPLETED';
                return (
                  <div
                    key={st.idx}
                    className={`p-2 rounded-xl border transition-all ${
                      liveCommand?.status === 'FAILED'
                        ? 'bg-dark-950/60 border-dark-800 text-slate-500'
                        : done
                          ? 'bg-emerald-500/12 border-emerald-500/35 text-emerald-300 font-bold'
                          : active
                            ? 'bg-primary-500/15 border-primary-500/45 text-primary-200 font-bold'
                            : 'bg-dark-950/60 border-dark-800 text-slate-500'
                    }`}
                  >
                    <span className="block font-mono text-[11px]">{done ? '✓' : st.idx}</span>
                    <span className="block mt-0.5 leading-tight">{st.label}</span>
                  </div>
                );
              })}
            </div>

            {/* Contextual Troubleshooting Card on Failure */}
            {liveCommand?.status === 'FAILED' && (
              <div className="p-3.5 rounded-2xl bg-rose-500/10 border border-rose-500/25 text-[11px] text-rose-200 space-y-1">
                <p className="font-bold text-rose-300">Quick Tip</p>
                <p className="opacity-90 leading-relaxed">
                  {liveCommand?.step === 'DUPLICATE' || liveCommand?.duplicate_student_name
                    ? 'Ask the student to scan their own finger, or remove the existing slot first.'
                    : 'Place the flat center pad of the finger firmly on the glass, wipe dust, and slightly moisten very dry fingertips.'}
                </p>
              </div>
            )}

            {/* Wizard Action Footer */}
            <div className="flex flex-wrap items-center justify-end gap-2 pt-3 border-t border-white/[0.06]">
              {isCommandInFlight && (
                <button
                  type="button"
                  onClick={handleCancelCommand}
                  className="px-4 py-2 rounded-xl bg-rose-500/15 hover:bg-rose-500/25 border border-rose-500/30 text-rose-300 text-xs font-bold transition"
                >
                  Cancel Enrollment
                </button>
              )}

              {liveCommand?.status === 'FAILED' && enrollWizardStudent && (
                <>
                  <button
                    type="button"
                    onClick={() => setShowEnrollWizard(false)}
                    className="px-3.5 py-2 rounded-xl bg-dark-900 hover:bg-dark-800 border border-dark-800 text-slate-300 text-xs font-semibold transition"
                  >
                    Close
                  </button>
                  <button
                    type="button"
                    onClick={() => handleStartEnroll(enrollWizardStudent, enrollWizardFingerIndex)}
                    className="px-4 py-2 rounded-xl bg-primary-600 hover:bg-primary-500 text-white text-xs font-bold flex items-center gap-1.5 shadow-lg shadow-primary-600/20 transition"
                  >
                    <RotateCcw size={13} />
                    <span>Retry Enrollment</span>
                  </button>
                </>
              )}

              {liveCommand?.status === 'COMPLETED' && (
                <>
                  <button
                    type="button"
                    onClick={() => setShowEnrollWizard(false)}
                    className="px-3.5 py-2 rounded-xl bg-dark-900 hover:bg-dark-800 border border-dark-800 text-slate-300 text-xs font-semibold transition"
                  >
                    Done
                  </button>
                  {enrollWizardStudent && enrollWizardFingerIndex === 1 && (
                    <button
                      type="button"
                      onClick={() => handleStartEnroll(enrollWizardStudent, 2)}
                      className="px-3.5 py-2 rounded-xl bg-cyan-600/20 hover:bg-cyan-600/30 border border-cyan-500/35 text-cyan-200 text-xs font-bold flex items-center gap-1.5 transition"
                    >
                      <Plus size={13} />
                      <span>Add Backup</span>
                    </button>
                  )}
                  {nextUnenrolledStudent && (
                    <button
                      type="button"
                      onClick={() => handleStartEnroll(nextUnenrolledStudent, 1)}
                      className="px-4 py-2 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white text-xs font-bold flex items-center gap-1.5 shadow-lg shadow-emerald-600/20 transition"
                    >
                      <span>Next: {nextUnenrolledStudent.name.split(' ')[0]}</span>
                      <ArrowRight size={13} />
                    </button>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ADD NEW GATE SCANNER MODAL (SuperAdmin Only) */}
      {isSuperAdmin && showAddDeviceModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-4 animate-fadeIn">
          <div className="glass-panel w-full max-w-md rounded-3xl border border-white/10 p-5 sm:p-6 space-y-4 shadow-2xl animate-scaleUp">
            <div className="flex items-center justify-between">
              <div>
                <span className="text-[10px] font-bold uppercase tracking-widest text-primary-400">Hardware Registry</span>
                <h3 className="text-base font-bold text-white font-outfit mt-0.5">Register New Gate Scanner</h3>
              </div>
              <button
                type="button"
                onClick={() => setShowAddDeviceModal(false)}
                className="p-1.5 rounded-xl bg-dark-900 hover:bg-dark-800 border border-dark-800 text-slate-400 hover:text-white transition"
                aria-label="Close modal"
              >
                <X size={15} />
              </button>
            </div>
            <form onSubmit={handleCreateDevice} className="space-y-3.5 text-xs">
              <div>
                <label className="block font-semibold text-slate-400 mb-1.5">Device ID</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. GATE-ESP32-02"
                  value={newDeviceId}
                  onChange={(e) => setNewDeviceId(e.target.value.toUpperCase())}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-dark-900 border border-dark-800 focus:border-primary-500 text-white font-mono transition"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-400 mb-1.5">Scanner Name</label>
                <input
                  type="text"
                  placeholder="e.g. Back Gate Scanner"
                  value={newDeviceName}
                  onChange={(e) => setNewDeviceName(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-dark-900 border border-dark-800 focus:border-primary-500 text-white transition"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2 border-t border-white/[0.06]">
                <button
                  type="button"
                  onClick={() => setShowAddDeviceModal(false)}
                  className="px-3.5 py-2 rounded-xl bg-dark-900 hover:bg-dark-800 border border-dark-800 text-slate-300 font-semibold transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={creatingDevice}
                  className="px-4 py-2 rounded-xl bg-primary-600 hover:bg-primary-500 disabled:opacity-50 text-white font-bold shadow-lg shadow-primary-600/20 transition"
                >
                  {creatingDevice ? 'Registering...' : 'Register Scanner'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default BiometricGatePanel;
