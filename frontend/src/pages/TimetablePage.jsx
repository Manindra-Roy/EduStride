import React, { useEffect, useState, useMemo } from 'react';
import { createPortal } from 'react-dom';
import axios from 'axios';
import { useAuth } from '../context/AuthContext';
import ClassTimetable from '../components/ClassTimetable';
import { 
  Calendar, 
  X, 
  Plus, 
  Trash2, 
  CheckCircle, 
  AlertTriangle,
  Clock,
  BookOpen
} from 'lucide-react';

const DAYS_OF_WEEK = [
  { full: 'Monday', abbr: 'MON' },
  { full: 'Tuesday', abbr: 'TUE' },
  { full: 'Wednesday', abbr: 'WED' },
  { full: 'Thursday', abbr: 'THU' },
  { full: 'Friday', abbr: 'FRI' },
  { full: 'Saturday', abbr: 'SAT' },
  { full: 'Sunday', abbr: 'SUN' }
];

const TimetablePage = () => {
  const { user } = useAuth();
  const [timetable, setTimetable] = useState([]);
  const [classes, setClasses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [studentDetails, setStudentDetails] = useState(null);

  // Timetable Edit State
  const [showTimetableModal, setShowTimetableModal] = useState(false);
  const [editingDay, setEditingDay] = useState('Monday');
  const [tempSlots, setTempSlots] = useState([]);
  const [savingTimetable, setSavingTimetable] = useState(false);
  const [timetableError, setTimetableError] = useState('');
  const [timetableSuccess, setTimetableSuccess] = useState('');

  const fetchTimetableData = async () => {
    try {
      setLoading(true);
      const [ttRes, classRes] = await Promise.allSettled([
        axios.get('/api/timetable'),
        axios.get('/api/classes')
      ]);

      if (ttRes.status === 'fulfilled' && ttRes.value?.data) {
        const data = ttRes.value.data;
        setTimetable(data.success ? (data.data || []) : (Array.isArray(data) ? data : []));
      }

      if (classRes.status === 'fulfilled' && classRes.value?.data) {
        const data = classRes.value.data;
        setClasses(data.success ? (data.data || []) : (Array.isArray(data) ? data : []));
      }

      if (user?.role === 'Student' && user?.studentProfile?._id) {
        try {
          const stRes = await axios.get(`/api/students/${user.studentProfile._id}`);
          if (stRes.data?.success) {
            setStudentDetails(stRes.data.data);
          }
        } catch (stErr) {
          console.error('Failed to load student details:', stErr);
        }
      }
    } catch (err) {
      console.error('Failed to load timetable page data:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTimetableData();
  }, [user]);

  // Sync tempSlots when switching day or opening modal
  useEffect(() => {
    if (showTimetableModal && Array.isArray(timetable)) {
      const dayObj = timetable.find(t => t.day === editingDay);
      if (dayObj && Array.isArray(dayObj.slots)) {
        setTempSlots(JSON.parse(JSON.stringify(dayObj.slots)));
      } else {
        setTempSlots([]);
      }
    }
  }, [editingDay, timetable, showTimetableModal]);

  const handleAddTempSlot = () => {
    const defaultGrade = classes.length > 0 ? classes[0] : 'VII';
    setTempSlots(prev => [...prev, { grade: defaultGrade, time: '09:00 AM', subject: 'Mathematics', teacher: '' }]);
  };

  const handleRemoveTempSlot = (index) => {
    setTempSlots(prev => prev.filter((_, i) => i !== index));
  };

  const handleTempSlotChange = (index, field, value) => {
    setTempSlots(prev => {
      const updated = [...prev];
      updated[index] = { ...updated[index], [field]: value };
      return updated;
    });
  };

  const handleSaveTimetable = async (e) => {
    if (e) e.preventDefault();
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
        setTimeout(() => {
          setTimetableSuccess('');
        }, 3000);
      }
    } catch (err) {
      setTimetableError(err.response?.data?.message || 'Failed to save timetable schedule');
    } finally {
      setSavingTimetable(false);
    }
  };

  return (
    <div className="space-y-6 animate-fadeIn max-w-7xl mx-auto w-full">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-dark-800 pb-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-white font-outfit tracking-tight">Class Timetable & Master Schedule</h1>
          <p className="text-xs text-slate-400 mt-1">
            Real-time daily class schedules, active period tracking, and assigned educators across all class levels
          </p>
        </div>
      </div>

      {/* Main Timetable Component */}
      <ClassTimetable
        timetable={timetable}
        studentGrade={studentDetails?.class_level || ''}
        userRole={user?.role}
        availableClasses={classes}
        loading={loading}
        onModifyClick={() => {
          setTimetableError('');
          setTimetableSuccess('');
          setShowTimetableModal(true);
        }}
      />

      {/* --- MODIFY TIMETABLE MODAL (PORTAL TO DOCUMENT.BODY) --- */}
      {showTimetableModal && createPortal(
        <div className="fixed inset-0 z-[9999] flex items-end sm:items-center justify-center bg-black/85 backdrop-blur-md p-0 sm:p-4">
          <div className="glass-panel w-full max-w-2xl sm:rounded-2xl rounded-t-3xl border border-dark-800 overflow-hidden shadow-2xl relative animate-scaleUp max-h-[92vh] sm:max-h-[90vh] flex flex-col">
            {/* Mobile Drag Pill */}
            <div className="w-12 h-1.5 bg-dark-700 rounded-full mx-auto my-2.5 sm:hidden shrink-0" />

            <div className="p-4 sm:p-6 border-b border-dark-800 flex justify-between items-center shrink-0">
              <h3 className="text-base sm:text-lg font-bold text-white font-outfit flex items-center gap-2">
                <Calendar size={20} className="text-primary-500 shrink-0" />
                <span>Modify Weekly Timetable Schedule</span>
              </h3>
              <button 
                onClick={() => setShowTimetableModal(false)} 
                className="p-1.5 rounded-xl bg-dark-900 border border-dark-800 text-slate-400 hover:text-white transition"
              >
                <X size={18} />
              </button>
            </div>

            <div className="p-4 sm:p-6 overflow-y-auto flex-1 space-y-4">
              {timetableError && (
                <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-center gap-2">
                  <AlertTriangle size={16} className="shrink-0 text-rose-400" />
                  <span>{timetableError}</span>
                </div>
              )}
              {timetableSuccess && (
                <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs flex items-center gap-2">
                  <CheckCircle size={16} className="shrink-0 text-emerald-400" />
                  <span>{timetableSuccess}</span>
                </div>
              )}

              {/* Day selection tabs with touch scroll */}
              <div className="flex gap-1.5 border-b border-dark-800 pb-3 overflow-x-auto no-scrollbar touch-pan-x">
                {DAYS_OF_WEEK.map(({ full, abbr }) => (
                  <button
                    key={full}
                    type="button"
                    onClick={() => { setEditingDay(full); setTimetableError(''); setTimetableSuccess(''); }}
                    className={`px-2.5 py-1.5 sm:px-3 sm:py-2 rounded-xl text-xs font-bold transition-all shrink-0 flex items-center gap-1 ${
                      editingDay === full 
                        ? 'bg-primary-600 text-white shadow-md' 
                        : 'bg-dark-900 border border-dark-850 text-slate-400 hover:text-white'
                    }`}
                  >
                    <span className="sm:hidden">{abbr}</span>
                    <span className="hidden sm:inline">{full}</span>
                  </button>
                ))}
              </div>

              {/* Slots editor list */}
              <div className="space-y-3.5">
                {tempSlots.length === 0 ? (
                  <div className="text-center py-10 text-slate-500 text-xs border border-dashed border-dark-800 rounded-2xl bg-dark-950/40 space-y-2">
                    <p className="font-semibold text-slate-400">No timeslots scheduled for {editingDay}</p>
                    <p className="text-[11px] text-slate-500">Tap 'Add Timeslot' below to configure class periods.</p>
                  </div>
                ) : (
                  tempSlots.map((slot, index) => (
                    <div key={index} className="p-4 rounded-2xl bg-dark-900/90 border border-dark-850 space-y-3 relative hover:border-dark-750 transition">
                      <div className="flex justify-between items-center border-b border-dark-850 pb-2">
                        <span className="text-xs font-mono font-bold text-primary-400 bg-primary-950/80 border border-primary-800 px-2 py-0.5 rounded-lg">
                          Slot #{index + 1}
                        </span>
                        <button
                          type="button"
                          onClick={() => handleRemoveTempSlot(index)}
                          className="px-2 py-1 rounded-lg text-xs font-semibold text-rose-400 hover:bg-rose-500/10 border border-rose-500/20 transition flex items-center gap-1"
                          title="Delete slot"
                        >
                          <Trash2 size={13} />
                          <span>Delete</span>
                        </button>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 pt-1">
                        <div>
                          <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Class Grade</label>
                          <select
                            required
                            value={slot.grade}
                            onChange={(e) => handleTempSlotChange(index, 'grade', e.target.value)}
                            className="w-full px-3 py-2 rounded-xl bg-dark-950 border border-dark-800 text-white text-xs outline-none focus:border-primary-500 cursor-pointer"
                          >
                            <option value="" disabled>Select Class</option>
                            {classes.map(c => (
                              <option key={c} value={c}>
                                {c.startsWith('Class') ? c : `Class ${c}`}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Time Frame</label>
                          <input
                            type="text"
                            required
                            placeholder="e.g. 09:00 AM - 10:00 AM"
                            value={slot.time}
                            onChange={(e) => handleTempSlotChange(index, 'time', e.target.value)}
                            className="w-full px-3 py-2 rounded-xl bg-dark-950 border border-dark-800 text-white text-xs outline-none focus:border-primary-500 font-mono"
                          />
                          {/* Quick Preset Buttons */}
                          <div className="flex flex-wrap gap-1 mt-1.5">
                            {['08:00 AM', '09:00 AM - 10:00 AM', '11:00 AM - 12:00 PM', '01:30 PM - 02:30 PM', '05:00 PM - 06:00 PM'].map(preset => (
                              <button
                                key={preset}
                                type="button"
                                onClick={() => handleTempSlotChange(index, 'time', preset)}
                                className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-dark-950 border border-dark-800 text-slate-400 hover:text-primary-300 hover:border-primary-600 transition"
                              >
                                {preset}
                              </button>
                            ))}
                          </div>
                        </div>
                        <div>
                          <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Subject</label>
                          <input
                            type="text"
                            required
                            placeholder="e.g. Mathematics"
                            value={slot.subject}
                            onChange={(e) => handleTempSlotChange(index, 'subject', e.target.value)}
                            className="w-full px-3 py-2 rounded-xl bg-dark-950 border border-dark-800 text-white text-xs outline-none focus:border-primary-500"
                          />
                        </div>
                        <div>
                          <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Assigned Teacher</label>
                          <input
                            type="text"
                            placeholder="e.g. Prof. Vance"
                            value={slot.teacher}
                            onChange={(e) => handleTempSlotChange(index, 'teacher', e.target.value)}
                            className="w-full px-3 py-2 rounded-xl bg-dark-950 border border-dark-800 text-white text-xs outline-none focus:border-primary-500"
                          />
                        </div>
                      </div>
                    </div>
                  ))
                )}

                <button
                  type="button"
                  onClick={handleAddTempSlot}
                  className="w-full py-2.5 rounded-xl border border-dashed border-primary-500/40 bg-primary-600/5 hover:bg-primary-600/10 text-primary-400 text-xs font-bold transition flex items-center justify-center gap-1.5"
                >
                  <Plus size={15} />
                  <span>Add Timeslot to {editingDay}</span>
                </button>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="p-4 sm:p-6 border-t border-dark-800 flex justify-between items-center bg-dark-950/60 shrink-0">
              <button
                type="button"
                onClick={() => setShowTimetableModal(false)}
                className="px-4 py-2 rounded-xl bg-dark-900 border border-dark-800 text-slate-400 hover:text-white text-xs font-semibold transition"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveTimetable}
                disabled={savingTimetable}
                className="px-5 py-2 rounded-xl bg-primary-600 hover:bg-primary-500 text-white text-xs font-bold transition flex items-center gap-1.5 shadow-lg shadow-primary-500/20 disabled:opacity-50"
              >
                {savingTimetable ? 'Saving...' : 'Save Schedule Changes'}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
};

export default TimetablePage;
