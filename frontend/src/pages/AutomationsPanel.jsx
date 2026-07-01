import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { 
  Settings, 
  CheckCircle, 
  AlertTriangle, 
  Calendar, 
  User, 
  Clock, 
  Activity, 
  TrendingUp,
  Mail,
  GraduationCap,
  Trash2,
  X,
  Plus
} from 'lucide-react';

const AutomationsPanel = () => {
  const [loading, setLoading] = useState(true);
  const [progressData, setProgressData] = useState([]);
  
  // Timetable State
  const [timetable, setTimetable] = useState([]);
  const [loadingTimetable, setLoadingTimetable] = useState(false);

  // Edit Timetable State
  const [showTimetableModal, setShowTimetableModal] = useState(false);
  const [editingDay, setEditingDay] = useState('Monday');
  const [tempSlots, setTempSlots] = useState([]);
  const [savingTimetable, setSavingTimetable] = useState(false);
  const [timetableError, setTimetableError] = useState('');
  const [timetableSuccess, setTimetableSuccess] = useState('');

  // Selected class for syllabus tracking
  const [syllabusClass, setSyllabusClass] = useState('');
  const [classes, setClasses] = useState([]);

  // Class Management State
  const [newClassName, setNewClassName] = useState('');
  const [classError, setClassError] = useState('');
  const [classSuccess, setClassSuccess] = useState('');
  const [addingClass, setAddingClass] = useState(false);

  // Core System State
  const [systemMetrics, setSystemMetrics] = useState(null);
  const [loadingMetrics, setLoadingMetrics] = useState(false);
  const [triggeringNag, setTriggeringNag] = useState(false);
  const [triggeringAttendance, setTriggeringAttendance] = useState(false);
  const [triggeringProgress, setTriggeringProgress] = useState(false);
  const [progressReportsLog, setProgressReportsLog] = useState([]);
  const [systemMessage, setSystemMessage] = useState('');
  const [systemError, setSystemError] = useState('');

  // Custom Email Dispatcher States
  const [studentsList, setStudentsList] = useState([]);
  const [loadingStudentsList, setLoadingStudentsList] = useState(false);
  const [emailTarget, setEmailTarget] = useState('class'); // 'class' or 'student'
  const [emailClassLevel, setEmailClassLevel] = useState('');
  const [emailStudentId, setEmailStudentId] = useState('');
  const [emailSubject, setEmailSubject] = useState('');
  const [emailBody, setEmailBody] = useState('');
  const [dispatchingEmail, setDispatchingEmail] = useState(false);
  const [emailSuccess, setEmailSuccess] = useState('');
  const [emailError, setEmailError] = useState('');

  // Monthly Progress Report Target States
  const [reportTarget, setReportTarget] = useState('all'); // 'all' | 'class' | 'student'
  const [reportClassLevel, setReportClassLevel] = useState('');
  const [reportStudentId, setReportStudentId] = useState('');

  // Student Promotion States
  const [promoMode, setPromoMode] = useState('class'); // 'class' | 'student'
  const [promoSourceClass, setPromoSourceClass] = useState('');
  const [promoStudentId, setPromoStudentId] = useState('');
  const [promoTargetClass, setPromoTargetClass] = useState('');
  const [promoStatus, setPromoStatus] = useState('Promoted');
  const [promoNewYear, setPromoNewYear] = useState(new Date().getFullYear() + 1);
  const [executingPromo, setExecutingPromo] = useState(false);
  const [promoSuccess, setPromoSuccess] = useState('');
  const [promoError, setPromoError] = useState('');

  const fetchStudentsList = async () => {
    setLoadingStudentsList(true);
    try {
      const res = await axios.get('/api/students?limit=1000');
      if (res.data.success) {
        setStudentsList(res.data.data || []);
      }
    } catch (err) {
      console.error('Failed to fetch students list:', err);
    } finally {
      setLoadingStudentsList(false);
    }
  };

  useEffect(() => {
    if (classes.length > 0) {
      if (!emailClassLevel) setEmailClassLevel(classes[0]);
      if (!reportClassLevel) setReportClassLevel(classes[0]);
      if (!promoSourceClass) setPromoSourceClass(classes[0]);
      if (!promoTargetClass) setPromoTargetClass(classes[1] || classes[0]);
    }
  }, [classes]);

  useEffect(() => {
    if (studentsList.length > 0) {
      if (!emailStudentId) setEmailStudentId(studentsList[0]._id);
      if (!reportStudentId) setReportStudentId(studentsList[0]._id);
      if (!promoStudentId) setPromoStudentId(studentsList[0]._id);
    }
  }, [studentsList]);

  const handleSendCustomEmail = async (e) => {
    e.preventDefault();
    setEmailError('');
    setEmailSuccess('');
    
    if (!emailSubject.trim() || !emailBody.trim()) {
      setEmailError('Please enter both subject and body.');
      return;
    }
    
    if (emailTarget === 'class' && !emailClassLevel) {
      setEmailError('Please select a target class.');
      return;
    }
    
    if (emailTarget === 'student' && !emailStudentId) {
      setEmailError('Please select a target student.');
      return;
    }
    
    setDispatchingEmail(true);
    try {
      const payload = {
        target: emailTarget,
        subject: emailSubject.trim(),
        body: emailBody.trim(),
        class_level: emailTarget === 'class' ? emailClassLevel : undefined,
        student_id: emailTarget === 'student' ? emailStudentId : undefined
      };
      
      const res = await axios.post('/api/automations/send-custom-email', payload);
      if (res.data.success) {
        setEmailSuccess(res.data.message || 'Announcement email sent successfully!');
        setEmailSubject('');
        setEmailBody('');
      }
    } catch (err) {
      setEmailError(err.response?.data?.message || 'Failed to dispatch custom email.');
    } finally {
      setDispatchingEmail(false);
    }
  };

  const handleExecutePromotion = async (e) => {
    e.preventDefault();
    setPromoError('');
    setPromoSuccess('');

    if (promoMode === 'class' && !promoSourceClass) {
      setPromoError('Please select the source class.');
      return;
    }

    if (promoMode === 'student' && !promoStudentId) {
      setPromoError('Please select the target student.');
      return;
    }

    if (!promoTargetClass) {
      setPromoError('Please select the target class.');
      return;
    }

    if (!promoNewYear) {
      setPromoError('Please specify the new academic year.');
      return;
    }

    const confirmMessage = promoMode === 'class'
      ? `Are you sure you want to promote all active students in Class ${promoSourceClass} to Class ${promoTargetClass} for the year ${promoNewYear}? This will archive their current grades and attendance history.`
      : `Are you sure you want to promote the selected student to Class ${promoTargetClass} for the year ${promoNewYear}? This will archive their current grades and attendance history.`;

    if (!window.confirm(confirmMessage)) {
      return;
    }

    setExecutingPromo(true);
    try {
      const payload = {
        studentIds: promoMode === 'student' ? [promoStudentId] : undefined,
        sourceClass: promoMode === 'class' ? promoSourceClass : undefined,
        targetClass: promoTargetClass,
        promotionStatus: promoStatus,
        newAcademicYear: Number(promoNewYear)
      };

      const res = await axios.post('/api/students/promote', payload);
      if (res.data.success) {
        setPromoSuccess(res.data.message || 'Promotion processed successfully!');
        // Refresh local data
        await fetchSystemMetrics();
        await fetchStudentsList();
      }
    } catch (err) {
      setPromoError(err.response?.data?.message || 'Failed to execute promotion.');
    } finally {
      setExecutingPromo(false);
    }
  };

  // Sync temp slots when day is changed
  useEffect(() => {
    const dayData = timetable.find(t => t.day === editingDay);
    if (dayData) {
      setTempSlots(JSON.parse(JSON.stringify(dayData.slots)));
    } else {
      setTempSlots([]);
    }
  }, [editingDay, timetable, showTimetableModal]);

  const fetchTimetable = async () => {
    setLoadingTimetable(true);
    try {
      const res = await axios.get('/api/timetable');
      if (res.data.success) {
        setTimetable(res.data.data);
      }
    } catch (err) {
      console.error('Failed to fetch timetable:', err);
    } finally {
      setLoadingTimetable(false);
    }
  };

  const handleAddTempSlot = () => {
    setTempSlots([...tempSlots, { time: '09:00 AM', subject: 'New Subject', teacher: 'Educator Name', grade: classes[0] || '' }]);
  };

  const handleRemoveTempSlot = (index) => {
    setTempSlots(tempSlots.filter((_, idx) => idx !== index));
  };

  const handleTempSlotChange = (index, field, value) => {
    const updated = [...tempSlots];
    updated[index][field] = value;
    setTempSlots(updated);
  };

  const handleSaveTimetable = async (e) => {
    e.preventDefault();
    setTimetableError('');
    setTimetableSuccess('');
    setSavingTimetable(true);

    try {
      const updatedTimetable = timetable.map(t => {
        if (t.day === editingDay) {
          return { ...t, slots: tempSlots };
        }
        return t;
      });

      const res = await axios.put('/api/timetable', { data: updatedTimetable });
      if (res.data.success) {
        setTimetable(res.data.data);
        setTimetableSuccess(`Timetable for ${editingDay} updated successfully!`);
      }
    } catch (err) {
      setTimetableError(err.response?.data?.message || 'Failed to save timetable');
    } finally {
      setSavingTimetable(false);
    }
  };

  // All state declarations consolidated at the top of the component

  const fetchSystemMetrics = async () => {
    setLoadingMetrics(true);
    setSystemError('');
    try {
      const res = await axios.get('/api/automations/status');
      if (res.data.success) {
        setSystemMetrics(res.data.data);
      }
    } catch (err) {
      setSystemError('Failed to retrieve core system status metrics.');
      console.error(err);
    } finally {
      setLoadingMetrics(false);
    }
  };

  const handleTriggerFeeNag = async () => {
    setTriggeringNag(true);
    setSystemMessage('');
    setSystemError('');
    try {
      const res = await axios.post('/api/automations/trigger-fee-nag');
      if (res.data.success) {
        setSystemMessage(res.data.message);
        await fetchSystemMetrics();
      }
    } catch (err) {
      setSystemError(err.response?.data?.message || 'Manual execution of Fee Reminder Mailer failed.');
    } finally {
      setTriggeringNag(false);
    }
  };

  const handleTriggerAttendanceAlert = async () => {
    setTriggeringAttendance(true);
    setSystemMessage('');
    setSystemError('');
    try {
      const res = await axios.post('/api/automations/trigger-attendance-alert');
      if (res.data.success) {
        setSystemMessage(res.data.message);
        await fetchSystemMetrics();
      }
    } catch (err) {
      setSystemError(err.response?.data?.message || 'Manual execution of Low Attendance Scanner failed.');
    } finally {
      setTriggeringAttendance(false);
    }
  };

  const handleTriggerProgressReport = async () => {
    setSystemMessage('');
    setSystemError('');

    if (reportTarget === 'class' && !reportClassLevel) {
      setSystemError('Please select a target class.');
      return;
    }

    if (reportTarget === 'student' && !reportStudentId) {
      setSystemError('Please select a target student.');
      return;
    }

    setTriggeringProgress(true);
    setProgressReportsLog([]);
    try {
      const payload = {
        target: reportTarget,
        class_level: reportTarget === 'class' ? reportClassLevel : undefined,
        student_id: reportTarget === 'student' ? reportStudentId : undefined
      };
      const res = await axios.post('/api/automations/trigger-progress-report', payload);
      if (res.data.success) {
        setSystemMessage(res.data.message);
        setProgressReportsLog(res.data.data || []);
        await fetchSystemMetrics();
      }
    } catch (err) {
      setSystemError(err.response?.data?.message || 'Manual execution of Progress Reports dispatch failed.');
    } finally {
      setTriggeringProgress(false);
    }
  };

  // Fetch classes on mount & fetch system status
  useEffect(() => {
    const fetchClasses = async () => {
      try {
        const res = await axios.get('/api/classes');
        if (res.data.success && Array.isArray(res.data.data)) {
          setClasses(res.data.data);
          if (res.data.data.length > 0 && !res.data.data.includes(syllabusClass)) {
            setSyllabusClass(res.data.data[0]);
          }
        }
      } catch (err) {
        console.error('Failed to fetch classes for syllabus tracker:', err);
      }
    };
    fetchClasses();
    fetchSystemMetrics();
    fetchTimetable();
    fetchStudentsList();
  }, []);

  const handleAddClass = async (e) => {
    e.preventDefault();
    setClassError('');
    setClassSuccess('');
    if (!newClassName.trim()) return;

    setAddingClass(true);
    try {
      const res = await axios.post('/api/classes', { name: newClassName });
      if (res.data.success) {
        setClassSuccess(`Class ${newClassName.toUpperCase().trim()} added successfully!`);
        setNewClassName('');
        // Re-fetch classes
        const classesRes = await axios.get('/api/classes');
        if (classesRes.data.success) {
          setClasses(classesRes.data.data);
        }
      }
    } catch (err) {
      setClassError(err.response?.data?.message || 'Failed to add class level');
    } finally {
      setAddingClass(false);
    }
  };

  const handleDeleteClass = async (className) => {
    setClassError('');
    setClassSuccess('');
    if (!window.confirm(`Are you sure you want to delete Class ${className}?`)) {
      return;
    }

    try {
      const res = await axios.delete(`/api/classes/${className}`);
      if (res.data.success) {
        setClassSuccess(res.data.message || `Class ${className} deleted successfully!`);
        // Re-fetch classes
        const classesRes = await axios.get('/api/classes');
        if (classesRes.data.success) {
          setClasses(classesRes.data.data);
          if (classesRes.data.data.length > 0 && !classesRes.data.data.includes(syllabusClass)) {
            setSyllabusClass(classesRes.data.data[0]);
          }
        }
      }
    } catch (err) {
      setClassError(err.response?.data?.message || 'Failed to delete class level');
    }
  };

  // Fetch study materials to calculate curriculum progress
  useEffect(() => {
    const calculateProgress = async () => {
      setLoading(true);
      try {
        // Fetch subjects dynamically class-wise
        const subjectsRes = syllabusClass ? await axios.get(`/api/subjects?class_level=${syllabusClass}`) : { data: { success: true, data: [] } };
        const subjectsList = subjectsRes.data.success && Array.isArray(subjectsRes.data.data)
          ? subjectsRes.data.data.map(s => s.name)
          : [];

        const res = await axios.get('/api/study-materials');
        if (res.data.success) {
          const list = res.data.data || [];
          const counts = {};

          // Initialize subject counters
          subjectsList.forEach(sub => {
            counts[sub] = { total: 4, completed: 0 }; // Assume 4 chapters standard
          });

          // Group uploaded materials and count status
          list.forEach(m => {
            if (m.class_level === syllabusClass) {
              if (!counts[m.subject]) {
                counts[m.subject] = { total: 4, completed: 0 };
              }
              // Count if status is notes distributed or revised
              if (m.status === 'Notes Distributed' || m.status === 'Revised') {
                counts[m.subject].completed += 1;
              }
              // If total materials is more than 4, adjust chapters total
              if (list.filter(x => x.class_level === syllabusClass && x.subject === m.subject).length > counts[m.subject].total) {
                counts[m.subject].total = list.filter(x => x.class_level === syllabusClass && x.subject === m.subject).length;
              }
            }
          });

          // Convert to chart-friendly format
          const formatted = Object.keys(counts).map(sub => {
            const pct = counts[sub].total > 0 
              ? Math.round((counts[sub].completed / counts[sub].total) * 100) 
              : 0;
            return {
              subject: sub,
              completed: counts[sub].completed,
              total: counts[sub].total,
              percentage: pct
            };
          });

          setProgressData(formatted);
        }
      } catch (err) {
        console.error('Failed to load syllabus analytics:', err);
      } finally {
        setLoading(false);
      }
    };
    calculateProgress();
  }, [syllabusClass]);

  return (
    <div className="space-y-6">
      {/* Title - Redesigned to match premium page header standard */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-primary-900/40 via-dark-900/30 to-indigo-900/20 border border-dark-800/80 p-6 sm:p-8 shadow-xl">
        <div className="absolute top-0 right-0 p-8 opacity-10 pointer-events-none">
          <Settings size={160} className="text-primary-500" />
        </div>
        <div className="relative z-10 space-y-2">
          <span className="px-2.5 py-1 rounded-md text-[10px] font-extrabold uppercase tracking-widest bg-primary-500/10 text-primary-400 border border-primary-500/20">
            System Administration
          </span>
          <h1 className="text-3xl font-extrabold tracking-tight text-white font-outfit mt-1">Background Systems & Planners</h1>
          <p className="text-slate-400 text-xs sm:text-sm max-w-2xl">
            Audit background cron managers, inspect active syllabus progression matrices, and configure system calendars.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
        {/* Left Column: Cron managers & Syllabus */}
        <div className="lg:col-span-2 space-y-6">
          {/* Cron Daemons Status */}
          <div className="glass-panel p-6 rounded-2xl border border-dark-800 space-y-4">
            <h2 className="text-base font-bold text-white font-outfit flex items-center gap-2">
              <Activity className="text-primary-500" size={18} />
              <span>Cron Background Services</span>
            </h2>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Cron 1 */}
              <div className="p-4 rounded-xl bg-dark-900 border border-dark-850 flex flex-col justify-between space-y-3">
                <div className="flex justify-between items-center">
                  <span className="px-2.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-[10px] font-bold">
                    Running daemon
                  </span>
                  <span className="text-[10px] text-slate-500 font-mono">0 8 5 * *</span>
                </div>
                <div>
                  <h4 className="text-sm font-bold text-white flex items-center gap-1.5">
                    <Mail size={14} className="text-indigo-400" />
                    <span>Tuition Fee Nagging</span>
                  </h4>
                  <p className="text-xs text-slate-400 mt-1">
                    Scans payment ledgers on the 5th of each month. Transmits email alerts to parents of students marked as 'Unpaid'.
                  </p>
                </div>
              </div>

              {/* Cron 2 */}
              <div className="p-4 rounded-xl bg-dark-900 border border-dark-850 flex flex-col justify-between space-y-3">
                <div className="flex justify-between items-center">
                  <span className="px-2.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-[10px] font-bold">
                    Running daemon
                  </span>
                  <span className="text-[10px] text-slate-500 font-mono">0 9 * * 0</span>
                </div>
                <div>
                  <h4 className="text-sm font-bold text-white flex items-center gap-1.5">
                    <AlertTriangle size={14} className="text-amber-400" />
                    <span>Low Attendance Scanner</span>
                  </h4>
                  <p className="text-xs text-slate-400 mt-1">
                    Fires weekly warning logs when student attendance levels fall below the 75% institutional compliance requirement.
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Syllabus progression tracker */}
          <div className="glass-panel p-6 rounded-2xl border border-dark-800 space-y-4">
            <div className="flex justify-between items-center border-b border-dark-800 pb-3">
              <h2 className="text-base font-bold text-white font-outfit flex items-center gap-2">
                <TrendingUp className="text-primary-500" size={18} />
                <span>Syllabus Completion Analyzer</span>
              </h2>
              
              <select
                value={syllabusClass}
                onChange={(e) => setSyllabusClass(e.target.value)}
                className="px-2.5 py-1.5 rounded-lg bg-dark-900 border border-dark-850 text-white text-xs outline-none"
              >
                {classes.map(c => <option key={c} value={c}>Class {c}</option>)}
              </select>
            </div>

            {loading ? (
              <div className="text-center py-8">
                <div className="animate-spin rounded-full h-6 w-6 border-t-2 border-primary-500 mx-auto"></div>
              </div>
            ) : (
              <div className="space-y-4">
                {progressData.map((item) => (
                  <div key={item.subject} className="p-3.5 rounded-xl bg-dark-900/40 border border-dark-900">
                    <div className="flex justify-between items-center text-xs font-semibold mb-2">
                      <span className="text-white">{item.subject}</span>
                      <span className="text-slate-400">
                        {item.percentage}% ({item.completed}/{item.total} chapters distributed)
                      </span>
                    </div>
                    <div className="w-full bg-dark-900 rounded-full h-2">
                      <div 
                        className={`h-2 rounded-full transition-all duration-500 ${
                          item.percentage >= 75 
                            ? 'bg-emerald-500' 
                            : item.percentage >= 50 
                              ? 'bg-indigo-500' 
                              : 'bg-rose-500'
                        }`} 
                        style={{ width: `${item.percentage}%` }}
                      ></div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Class Level Management Panel */}
          <div className="glass-panel p-6 rounded-2xl border border-dark-800 space-y-4">
            <h2 className="text-base font-bold text-white font-outfit flex items-center gap-2">
              <GraduationCap className="text-primary-500" size={18} />
              <span>Class Level Management</span>
            </h2>
            <p className="text-xs text-slate-400">Add or remove academic classes within the system.</p>

            {classError && (
              <div className="p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-450 text-xs font-medium">
                {classError}
              </div>
            )}
            {classSuccess && (
              <div className="p-3.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-450 text-xs font-medium">
                {classSuccess}
              </div>
            )}

            <form onSubmit={handleAddClass} className="flex gap-2">
              <input
                type="text"
                required
                placeholder="e.g. XI, XII, V"
                value={newClassName}
                onChange={(e) => setNewClassName(e.target.value)}
                className="flex-1 px-3.5 py-2.5 rounded-xl bg-dark-900 border border-dark-850 focus:border-primary-500 text-white text-xs outline-none transition"
              />
              <button
                type="submit"
                disabled={addingClass}
                className="px-4 py-2 bg-primary-600 hover:bg-primary-500 disabled:opacity-50 text-white text-xs font-semibold rounded-xl transition duration-150 flex items-center gap-1 shrink-0"
              >
                {addingClass ? 'Adding...' : 'Add Class'}
              </button>
            </form>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 pt-2">
              {classes.map((c) => (
                <div key={c} className="flex justify-between items-center p-3 rounded-xl bg-dark-900 border border-dark-850 hover:border-dark-750 transition">
                  <span className="text-xs font-bold text-white">Class {c}</span>
                  <button
                    onClick={() => handleDeleteClass(c)}
                    className="p-1 rounded text-rose-450 hover:bg-rose-500/10 hover:text-rose-300 transition"
                    title={`Delete Class ${c}`}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* Custom Email Broadcaster Panel */}
          <div className="glass-panel p-6 rounded-2xl border border-dark-800 space-y-4">
            <h2 className="text-base font-bold text-white font-outfit flex items-center gap-2">
              <Mail className="text-primary-500" size={18} />
              <span>Direct Mail Communicator</span>
            </h2>
            <p className="text-xs text-slate-400">Broadcast customized administrative announcements and emails directly to parent portals.</p>

            {emailError && (
              <div className="p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs font-medium animate-fadeIn">
                {emailError}
              </div>
            )}
            {emailSuccess && (
              <div className="p-3.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-medium animate-fadeIn">
                {emailSuccess}
              </div>
            )}

            <form onSubmit={handleSendCustomEmail} className="space-y-4">
              {/* Target Selection toggles */}
              <div>
                <label className="block text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-2">Send Broadcast Target</label>
                <div className="flex gap-2 p-1 bg-dark-900 border border-dark-850 rounded-xl max-w-xs">
                  <button
                    type="button"
                    onClick={() => { setEmailTarget('class'); setEmailError(''); setEmailSuccess(''); }}
                    className={`flex-1 py-2 text-xs font-bold rounded-lg transition-all duration-200 ${
                      emailTarget === 'class'
                        ? 'bg-primary-600 text-white shadow-md'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    Class-wise
                  </button>
                  <button
                    type="button"
                    onClick={() => { setEmailTarget('student'); setEmailError(''); setEmailSuccess(''); }}
                    className={`flex-1 py-2 text-xs font-bold rounded-lg transition-all duration-200 ${
                      emailTarget === 'student'
                        ? 'bg-primary-600 text-white shadow-md'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    Student-wise
                  </button>
                </div>
              </div>

              {/* Conditional dropdown selects */}
              {emailTarget === 'class' ? (
                <div>
                  <label className="block text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Select Class Level</label>
                  <select
                    value={emailClassLevel}
                    onChange={(e) => setEmailClassLevel(e.target.value)}
                    className="w-full max-w-md px-3.5 py-2.5 rounded-xl bg-dark-900 border border-dark-850 focus:border-primary-500 text-white text-xs outline-none transition cursor-pointer"
                  >
                    <option value="" disabled>-- Select Class --</option>
                    {classes.map(c => (
                      <option key={c} value={c}>Class {c}</option>
                    ))}
                  </select>
                </div>
              ) : (
                <div>
                  <label className="block text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Select Student</label>
                  {loadingStudentsList ? (
                    <div className="text-slate-500 text-xs">Loading students...</div>
                  ) : (
                    <select
                      value={emailStudentId}
                      onChange={(e) => setEmailStudentId(e.target.value)}
                      className="w-full max-w-md px-3.5 py-2.5 rounded-xl bg-dark-900 border border-dark-850 focus:border-primary-500 text-white text-xs outline-none transition cursor-pointer"
                    >
                      <option value="" disabled>-- Select Student --</option>
                      {studentsList.map(s => (
                        <option key={s._id} value={s._id}>
                          {s.name} (Class {s.class_level}, Roll {s.roll_number})
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              )}

              {/* Subject */}
              <div>
                <label className="block text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Email Subject</label>
                <input
                  type="text"
                  required
                  placeholder="Enter notice / mail subject"
                  value={emailSubject}
                  onChange={(e) => setEmailSubject(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-dark-900 border border-dark-850 focus:border-primary-500 text-white text-xs outline-none transition"
                />
              </div>

              {/* Body */}
              <div>
                <label className="block text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Email Message Body</label>
                <textarea
                  required
                  rows={5}
                  placeholder="Write message details here..."
                  value={emailBody}
                  onChange={(e) => setEmailBody(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-dark-900 border border-dark-850 focus:border-primary-500 text-white text-xs outline-none transition font-sans resize-y"
                />
              </div>

              <button
                type="submit"
                disabled={dispatchingEmail}
                className="px-5 py-2.5 bg-gradient-to-r from-primary-600 to-indigo-600 hover:from-primary-500 hover:to-indigo-500 disabled:opacity-50 text-white text-xs font-semibold rounded-xl transition duration-150 flex items-center justify-center gap-1.5 shadow-md shadow-primary-500/10 cursor-pointer"
              >
                {dispatchingEmail ? (
                  <>
                    <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    <span>Sending Broadcast...</span>
                  </>
                ) : (
                  <>
                    <Mail size={14} />
                    <span>Send Announcement Email</span>
                  </>
                )}
              </button>
            </form>
          </div>

          {/* Student Session Promotion Manager Panel */}
          <div className="glass-panel p-6 rounded-2xl border border-dark-800 space-y-4">
            <h2 className="text-base font-bold text-white font-outfit flex items-center gap-2">
              <GraduationCap className="text-primary-500" size={18} />
              <span>Student Session Promotion Manager</span>
            </h2>
            <p className="text-xs text-slate-400">
              Promote students batch-wise or individually to the next academic class session. This will archive their current grades and attendance history into their profile record.
            </p>

            {promoError && (
              <div className="p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs font-medium animate-fadeIn">
                {promoError}
              </div>
            )}
            {promoSuccess && (
              <div className="p-3.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-450 text-xs font-medium animate-fadeIn">
                {promoSuccess}
              </div>
            )}

            <form onSubmit={handleExecutePromotion} className="space-y-4">
              {/* Mode Selection */}
              <div>
                <label className="block text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-2">Promotion Selection Mode</label>
                <div className="flex gap-2 p-1 bg-dark-900 border border-dark-850 rounded-xl max-w-xs">
                  <button
                    type="button"
                    onClick={() => { setPromoMode('class'); setPromoError(''); setPromoSuccess(''); }}
                    className={`flex-1 py-2 text-xs font-bold rounded-lg transition-all duration-200 ${
                      promoMode === 'class'
                        ? 'bg-primary-600 text-white shadow-md'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    Class-wise (Batch)
                  </button>
                  <button
                    type="button"
                    onClick={() => { setPromoMode('student'); setPromoError(''); setPromoSuccess(''); }}
                    className={`flex-1 py-2 text-xs font-bold rounded-lg transition-all duration-200 ${
                      promoMode === 'student'
                        ? 'bg-primary-600 text-white shadow-md'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    Student-wise
                  </button>
                </div>
              </div>

              {/* Conditional dropdown selects */}
              {promoMode === 'class' ? (
                <div>
                  <label className="block text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Source Class (Current Class)</label>
                  <select
                    value={promoSourceClass}
                    onChange={(e) => setPromoSourceClass(e.target.value)}
                    className="w-full max-w-md px-3.5 py-2.5 rounded-xl bg-dark-900 border border-dark-850 focus:border-primary-500 text-white text-xs outline-none transition cursor-pointer"
                  >
                    <option value="" disabled>-- Select Class --</option>
                    {classes.map(c => (
                      <option key={c} value={c}>Class {c}</option>
                    ))}
                  </select>
                </div>
              ) : (
                <div>
                  <label className="block text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Select Student to Promote</label>
                  {loadingStudentsList ? (
                    <div className="text-slate-500 text-xs">Loading students...</div>
                  ) : (
                    <select
                      value={promoStudentId}
                      onChange={(e) => setPromoStudentId(e.target.value)}
                      className="w-full max-w-md px-3.5 py-2.5 rounded-xl bg-dark-900 border border-dark-850 focus:border-primary-500 text-white text-xs outline-none transition cursor-pointer"
                    >
                      <option value="" disabled>-- Select Student --</option>
                      {studentsList.map(s => (
                        <option key={s._id} value={s._id}>
                          {s.name} (Class {s.class_level}, Roll {s.roll_number})
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              )}

              {/* Target Class Selector */}
              <div>
                <label className="block text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Target Class (Next Class)</label>
                <select
                  value={promoTargetClass}
                  onChange={(e) => setPromoTargetClass(e.target.value)}
                  className="w-full max-w-md px-3.5 py-2.5 rounded-xl bg-dark-900 border border-dark-850 focus:border-primary-500 text-white text-xs outline-none transition cursor-pointer"
                >
                  <option value="" disabled>-- Select Target Class --</option>
                  {classes.map(c => (
                    <option key={c} value={c}>Class {c}</option>
                  ))}
                  <option value="GRADUATED">GRADUATED (Mark Student as Inactive)</option>
                </select>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-md">
                {/* Promotion Status */}
                <div>
                  <label className="block text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Promotion Decision</label>
                  <select
                    value={promoStatus}
                    onChange={(e) => setPromoStatus(e.target.value)}
                    className="w-full px-3.5 py-2.5 rounded-xl bg-dark-900 border border-dark-850 focus:border-primary-500 text-white text-xs outline-none transition cursor-pointer"
                  >
                    <option value="Promoted">Promoted (Advances to Next Class)</option>
                    <option value="Retained">Retained (Repeats Class - Archives scores)</option>
                    <option value="Graduated">Graduated (Completed studies)</option>
                  </select>
                </div>

                {/* New Academic Year */}
                <div>
                  <label className="block text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1.5">New Session Year</label>
                  <input
                    type="number"
                    required
                    min={2020}
                    max={2100}
                    value={promoNewYear}
                    onChange={(e) => setPromoNewYear(e.target.value)}
                    className="w-full px-3.5 py-2.5 rounded-xl bg-dark-900 border border-dark-850 focus:border-primary-500 text-white text-xs outline-none transition font-mono"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={executingPromo}
                className="px-5 py-2.5 bg-gradient-to-r from-indigo-600 to-primary-600 hover:from-indigo-500 hover:to-primary-500 disabled:opacity-50 text-white text-xs font-semibold rounded-xl transition duration-150 flex items-center justify-center gap-1.5 shadow-md shadow-primary-500/10 cursor-pointer"
              >
                {executingPromo ? (
                  <>
                    <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    <span>Executing Promotion...</span>
                  </>
                ) : (
                  <>
                    <GraduationCap size={14} />
                    <span>Execute Session Promotion</span>
                  </>
                )}
              </button>
            </form>
          </div>
        </div>

        {/* Right Column: System settings & Timetable */}
        <div className="space-y-6">
          {/* Manage Core System Panel */}
          <div className="glass-panel p-6 rounded-2xl border border-dark-800 space-y-4 animate-fadeIn">
            <h2 className="text-base font-bold text-white font-outfit flex items-center gap-2">
              <Settings className="text-primary-500" size={18} />
              <span>Manage Core System</span>
            </h2>
            <p className="text-xs text-slate-400">Control system microservices, query runtime metrics, and test active email relays.</p>

            {systemError && (
              <div className="p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs font-medium">
                {systemError}
              </div>
            )}
            {systemMessage && (
              <div className="p-3.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-medium font-outfit">
                {systemMessage}
              </div>
            )}

            {loadingMetrics ? (
              <div className="text-center py-4">
                <div className="animate-spin rounded-full h-5 w-5 border-t-2 border-primary-500 mx-auto"></div>
              </div>
            ) : systemMetrics ? (
              <div className="space-y-2 text-xs">
                <div className="flex justify-between p-2.5 rounded-lg bg-dark-900 border border-dark-850">
                  <span className="text-slate-500">MDB Database Status</span>
                  <span className="font-bold text-emerald-400">{systemMetrics.dbStatus}</span>
                </div>
                <div className="flex justify-between p-2.5 rounded-lg bg-dark-900 border border-dark-850">
                  <span className="text-slate-500">SMTP Nodemailer</span>
                  <span className={`font-bold ${systemMetrics.mailerStatus.includes('Operational') ? 'text-emerald-400' : 'text-amber-400'}`}>
                    {systemMetrics.mailerStatus.split(' ')[0]}
                  </span>
                </div>
                <div className="flex justify-between p-2.5 rounded-lg bg-dark-900 border border-dark-850">
                  <span className="text-slate-500">Node / Platform</span>
                  <span className="font-mono text-slate-300">{systemMetrics.nodeVersion} ({systemMetrics.platform})</span>
                </div>
                <div className="flex justify-between p-2.5 rounded-lg bg-dark-900 border border-dark-850">
                  <span className="text-slate-500">Memory Usage / Uptime</span>
                  <span className="font-mono text-slate-300">{systemMetrics.memory.usage} ({systemMetrics.uptime})</span>
                </div>
                
                {/* Stats indicators grid */}
                <div className="grid grid-cols-3 gap-2 pt-2 text-center">
                  <div className="p-2 bg-dark-900/60 border border-dark-850 rounded-xl">
                    <span className="text-[10px] text-slate-500 block">Classes</span>
                    <span className="text-sm font-extrabold text-white">{systemMetrics.classCount}</span>
                  </div>
                  <div className="p-2 bg-dark-900/60 border border-dark-850 rounded-xl">
                    <span className="text-[10px] text-slate-500 block">Subjects</span>
                    <span className="text-sm font-extrabold text-white">{systemMetrics.subjectCount}</span>
                  </div>
                  <div className="p-2 bg-dark-900/60 border border-dark-850 rounded-xl">
                    <span className="text-[10px] text-slate-500 block">Students</span>
                    <span className="text-sm font-extrabold text-white">{systemMetrics.studentCount}</span>
                  </div>
                </div>
              </div>
            ) : (
              <div className="p-3 text-center text-slate-500 text-xs">Metrics unavailable</div>
            )}

            {/* Manual Triggers Form */}
            <div className="space-y-4 pt-3 border-t border-dark-800">
              <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider">System Automation Dispatchers</label>
              
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={handleTriggerFeeNag}
                  disabled={triggeringNag || loadingMetrics}
                  className="w-full py-2.5 rounded-xl bg-primary-600 hover:bg-primary-500 disabled:opacity-50 text-white font-semibold text-xs transition duration-150 flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  {triggeringNag ? 'Reminding...' : 'Fee Reminders'}
                </button>
                <button
                  onClick={handleTriggerAttendanceAlert}
                  disabled={triggeringAttendance || loadingMetrics}
                  className="w-full py-2.5 rounded-xl bg-dark-900 hover:bg-dark-850 disabled:opacity-50 border border-dark-800 text-slate-350 font-semibold text-xs transition duration-150 flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  {triggeringAttendance ? 'Scanning...' : 'Attendance Check'}
                </button>
              </div>

              {/* Progress Reports Dispatch Section */}
              <div className="p-3 bg-dark-900/60 border border-dark-850 rounded-xl space-y-3">
                <div className="flex justify-between items-center">
                  <span className="text-xs font-bold text-white">Monthly Progress Report</span>
                  <span className="text-[9px] text-slate-500 font-mono">Current Month</span>
                </div>

                {/* Target Selector */}
                <div>
                  <div className="flex gap-1.5 p-1 bg-dark-950 border border-dark-850 rounded-lg">
                    <button
                      type="button"
                      onClick={() => { setReportTarget('all'); }}
                      className={`flex-1 py-1 text-[10px] font-bold rounded transition-all duration-150 cursor-pointer ${
                        reportTarget === 'all'
                          ? 'bg-emerald-600 text-white shadow-sm'
                          : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      All
                    </button>
                    <button
                      type="button"
                      onClick={() => { setReportTarget('class'); }}
                      className={`flex-1 py-1 text-[10px] font-bold rounded transition-all duration-150 cursor-pointer ${
                        reportTarget === 'class'
                          ? 'bg-emerald-600 text-white shadow-sm'
                          : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      Class
                    </button>
                    <button
                      type="button"
                      onClick={() => { setReportTarget('student'); }}
                      className={`flex-1 py-1 text-[10px] font-bold rounded transition-all duration-150 cursor-pointer ${
                        reportTarget === 'student'
                          ? 'bg-emerald-600 text-white shadow-sm'
                          : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      Student
                    </button>
                  </div>
                </div>

                {/* Conditional Dropdown Selection */}
                {reportTarget === 'class' && (
                  <div className="animate-fadeIn">
                    <label className="block text-[9px] font-semibold text-slate-500 uppercase tracking-wider mb-1">Select Target Class</label>
                    <select
                      value={reportClassLevel}
                      onChange={(e) => setReportClassLevel(e.target.value)}
                      className="w-full px-2.5 py-1.5 rounded-lg bg-dark-950 border border-dark-850 focus:border-emerald-500 text-white text-[11px] outline-none transition cursor-pointer"
                    >
                      <option value="" disabled>-- Select Class --</option>
                      {classes.map(c => (
                        <option key={c} value={c}>Class {c}</option>
                      ))}
                    </select>
                  </div>
                )}

                {reportTarget === 'student' && (
                  <div className="animate-fadeIn">
                    <label className="block text-[9px] font-semibold text-slate-500 uppercase tracking-wider mb-1">Select Target Student</label>
                    {loadingStudentsList ? (
                      <div className="text-slate-500 text-[10px]">Loading students...</div>
                    ) : (
                      <select
                        value={reportStudentId}
                        onChange={(e) => setReportStudentId(e.target.value)}
                        className="w-full px-2.5 py-1.5 rounded-lg bg-dark-950 border border-dark-850 focus:border-emerald-500 text-white text-[11px] outline-none transition cursor-pointer"
                      >
                        <option value="" disabled>-- Select Student --</option>
                        {studentsList.map(s => (
                          <option key={s._id} value={s._id}>
                            {s.name} (Class {s.class_level})
                          </option>
                        ))}
                      </select>
                    )}
                  </div>
                )}

                <button
                  onClick={handleTriggerProgressReport}
                  disabled={triggeringProgress || loadingMetrics}
                  className="w-full py-2 rounded-lg bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 disabled:opacity-50 text-white font-bold text-xs transition duration-150 flex items-center justify-center gap-1.5 cursor-pointer shadow-sm shadow-emerald-500/10"
                >
                  {triggeringProgress ? (
                    <>
                      <div className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      <span>Sending Progress Reports...</span>
                    </>
                  ) : (
                    <>
                      <TrendingUp size={13} />
                      <span>Execute Progress Reports</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>

          {/* Dispatched Reports Log */}
          {progressReportsLog.length > 0 && (
            <div className="glass-panel p-6 rounded-2xl border border-dark-800 space-y-4 animate-scaleUp">
              <h2 className="text-base font-bold text-white font-outfit flex items-center gap-2">
                <CheckCircle className="text-emerald-500" size={18} />
                <span>Dispatched Progress Reports</span>
              </h2>
              <p className="text-xs text-slate-400">Reports sent via email and simulated on WhatsApp for the current month.</p>
              
              <div className="space-y-3 max-h-64 overflow-y-auto pr-1">
                {progressReportsLog.map((log, index) => (
                  <div key={index} className="p-3 rounded-xl bg-dark-900 border border-dark-850 space-y-2 text-xs">
                    <div className="flex justify-between items-center border-b border-dark-800 pb-1.5">
                      <span className="font-bold text-white font-outfit">{log.studentName}</span>
                      <span className="text-[9px] font-mono text-slate-500">Roll: {log.rollNumber}</span>
                    </div>
                    <div className="space-y-1 text-slate-400 text-[10px]">
                      <div><span className="text-slate-500 font-semibold">Parent:</span> {log.parentName}</div>
                      <div><span className="text-slate-500 font-semibold">Email:</span> {log.email}</div>
                      <div><span className="text-slate-500 font-semibold">WhatsApp:</span> {log.phone}</div>
                      <div className="flex justify-between items-center mt-2 pt-2 border-t border-dark-800/80">
                        <div className="flex gap-2 font-mono text-[9px]">
                          <span className="text-emerald-400">Email: Dispatched</span>
                          <span className="text-slate-500">|</span>
                          <span className="text-teal-400">WhatsApp: Ready</span>
                        </div>
                        <a
                          href={log.whatsappLink}
                          target="_blank"
                          rel="noreferrer"
                          className="px-2 py-0.5 rounded bg-teal-500/10 hover:bg-teal-500/25 border border-teal-500/30 text-teal-400 text-[9px] font-bold transition-all duration-150 flex items-center gap-1 font-outfit"
                        >
                          Send WhatsApp
                        </a>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Timetable planner */}
          <div className="glass-panel p-6 rounded-2xl border border-dark-800 space-y-4">
            <div className="flex justify-between items-center border-b border-dark-800 pb-3">
              <div>
                <h2 className="text-base font-bold text-white font-outfit flex items-center gap-2">
                  <Calendar className="text-indigo-400" size={18} />
                  <span>Interactive Scheduling Planner</span>
                </h2>
                <p className="text-xs text-slate-400 mt-1">Weekly timeslots and assigned educators</p>
              </div>
              <button
                onClick={() => {
                  setTimetableError('');
                  setTimetableSuccess('');
                  setShowTimetableModal(true);
                }}
                className="px-2.5 py-1.5 rounded-lg bg-dark-900 border border-dark-850 text-slate-350 hover:text-white text-xs font-semibold transition shrink-0"
              >
                Modify Planner
              </button>
            </div>

            {loadingTimetable ? (
              <div className="text-center py-8">
                <div className="animate-spin rounded-full h-6 w-6 border-t-2 border-primary-500 mx-auto"></div>
              </div>
            ) : timetable.length === 0 ? (
              <div className="text-center py-8 text-slate-500 text-xs border border-dashed border-dark-850 rounded-xl">
                No scheduling records loaded.
              </div>
            ) : (
              <div className="space-y-4 overflow-y-auto max-h-[14rem] pr-1">
                {timetable.map((t, index) => (
                  <div key={index} className="space-y-2.5">
                    <h4 className="text-xs font-bold text-slate-300 font-mono border-l-2 border-l-primary-500 pl-2 bg-dark-900/20 py-1">{t.day}</h4>
                    <div className="space-y-2">
                      {t.slots.map((slot, idx) => (
                        <div key={idx} className="p-3 rounded-xl bg-dark-900 border border-dark-850 space-y-2 hover:border-dark-750 transition">
                          <div className="flex justify-between items-center">
                            <span className="text-xs font-bold text-white">{slot.subject}</span>
                            <span className="text-[9px] font-bold text-primary-400 bg-primary-950/60 border border-primary-900 px-1.5 py-0.5 rounded">
                              Class {slot.grade}
                            </span>
                          </div>
                          <div className="flex justify-between items-center text-[10px] text-slate-500 font-medium">
                            <span className="flex items-center gap-1">
                              <User size={12} />
                              {slot.teacher}
                            </span>
                            <span className="flex items-center gap-1 font-mono">
                              <Clock size={12} />
                              {slot.time}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

      {/* --- MODIFY TIMETABLE MODAL --- */}
      {showTimetableModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4">
          <div className="glass-panel w-full max-w-2xl rounded-2xl border border-dark-800 overflow-hidden shadow-2xl relative animate-scaleUp max-h-[90vh] flex flex-col">
            <div className="p-6 border-b border-dark-800 flex justify-between items-center shrink-0">
              <h3 className="text-base font-bold text-white font-outfit flex items-center gap-2">
                <Calendar size={18} className="text-primary-500" />
                <span>Modify Weekly Scheduling Planner</span>
              </h3>
              <button onClick={() => setShowTimetableModal(false)} className="text-slate-500 hover:text-white transition">
                <X size={20} />
              </button>
            </div>

            <div className="p-6 overflow-y-auto flex-1 space-y-4">
              {timetableError && (
                <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs">
                  {timetableError}
                </div>
              )}
              {timetableSuccess && (
                <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs">
                  {timetableSuccess}
                </div>
              )}

              {/* Day selection tabs */}
              <div className="flex gap-1.5 border-b border-dark-800 pb-3 overflow-x-auto">
                {['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].map((d) => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => { setEditingDay(d); setTimetableError(''); setTimetableSuccess(''); }}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition shrink-0 ${
                      editingDay === d 
                        ? 'bg-primary-600 text-white' 
                        : 'bg-dark-900 border border-dark-850 text-slate-400 hover:text-white'
                    }`}
                  >
                    {d}
                  </button>
                ))}
              </div>

              {/* Slots editor list */}
              <div className="space-y-3.5">
                {tempSlots.length === 0 ? (
                  <div className="text-center py-8 text-slate-500 text-xs border border-dashed border-dark-800 rounded-xl">
                    No slots scheduled for {editingDay}. Click 'Add Slot' to build schedule.
                  </div>
                ) : (
                  tempSlots.map((slot, index) => (
                    <div key={index} className="p-4 rounded-xl bg-dark-900 border border-dark-850 space-y-3 relative hover:border-dark-750 transition">
                      <button
                        type="button"
                        onClick={() => handleRemoveTempSlot(index)}
                        className="absolute top-3 right-3 p-1 rounded text-rose-450 hover:bg-rose-500/10 hover:text-rose-350 transition"
                        title="Delete slot"
                      >
                        <Trash2 size={14} />
                      </button>

                      <div className="grid grid-cols-2 md:grid-cols-4 gap-3.5 pt-1">
                        <div>
                          <label className="block text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1">Class Grade</label>
                          <select
                            required
                            value={slot.grade}
                            onChange={(e) => handleTempSlotChange(index, 'grade', e.target.value)}
                            className="w-full px-2.5 py-1.5 rounded-lg bg-dark-950 border border-dark-800 text-white text-xs outline-none focus:border-primary-500"
                          >
                            <option value="" disabled>Select Class</option>
                            {classes.map(c => (
                              <option key={c} value={c}>Class {c}</option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="block text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1">Time Frame</label>
                          <input
                            type="text"
                            required
                            value={slot.time}
                            onChange={(e) => handleTempSlotChange(index, 'time', e.target.value)}
                            placeholder="e.g. 09:00 AM"
                            className="w-full px-2.5 py-1.5 rounded-lg bg-dark-950 border border-dark-800 text-white text-xs outline-none focus:border-primary-500"
                          />
                        </div>
                        <div>
                          <label className="block text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1">Subject</label>
                          <input
                            type="text"
                            required
                            value={slot.subject}
                            onChange={(e) => handleTempSlotChange(index, 'subject', e.target.value)}
                            placeholder="e.g. Mathematics"
                            className="w-full px-2.5 py-1.5 rounded-lg bg-dark-950 border border-dark-800 text-white text-xs outline-none focus:border-primary-500"
                          />
                        </div>
                        <div>
                          <label className="block text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1">Educator</label>
                          <input
                            type="text"
                            required
                            value={slot.teacher}
                            onChange={(e) => handleTempSlotChange(index, 'teacher', e.target.value)}
                            placeholder="e.g. Dr. Carter"
                            className="w-full px-2.5 py-1.5 rounded-lg bg-dark-950 border border-dark-800 text-white text-xs outline-none focus:border-primary-500"
                          />
                        </div>
                      </div>
                    </div>
                  ))
                )}
                <button
                  type="button"
                  onClick={handleAddTempSlot}
                  className="w-full py-2.5 border border-dashed border-dark-800 hover:border-dark-700 text-slate-450 hover:text-slate-300 rounded-xl transition text-xs font-semibold flex items-center justify-center gap-1.5 bg-dark-900"
                >
                  <Plus size={14} />
                  <span>Add Timeslot</span>
                </button>
              </div>
            </div>

            <div className="p-6 border-t border-dark-800 flex justify-end gap-3 shrink-0 bg-dark-950/20">
              <button 
                type="button" 
                onClick={() => setShowTimetableModal(false)}
                className="px-4 py-2 text-xs font-semibold rounded-lg bg-dark-900 border border-dark-850 text-slate-400 hover:text-white transition"
              >
                Close
              </button>
              <button 
                type="button"
                onClick={handleSaveTimetable}
                disabled={savingTimetable}
                className="px-4 py-2 text-xs font-semibold rounded-lg bg-primary-600 hover:bg-primary-500 text-white transition flex items-center gap-1.5"
              >
                {savingTimetable ? 'Saving...' : 'Save Schedule Changes'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  </div>
);
};

export default AutomationsPanel;
