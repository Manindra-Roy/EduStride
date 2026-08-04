import React, { useState, useEffect, useMemo } from 'react';
import { 
  Calendar, 
  Clock, 
  User, 
  Radio, 
  CheckCircle2,
  Filter, 
  Edit3,
  Grid,
  List,
  Search
} from 'lucide-react';

const DAYS_OF_WEEK = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const DAY_ABBR = {
  Monday: 'MON',
  Tuesday: 'TUE',
  Wednesday: 'WED',
  Thursday: 'THU',
  Friday: 'FRI',
  Saturday: 'SAT',
  Sunday: 'SUN'
};

// Subject Color Mapping for rich aesthetic badges
const getSubjectTheme = (subject = '') => {
  const s = subject.toLowerCase();
  if (s.includes('math')) return { bg: 'bg-indigo-500/10', border: 'border-indigo-500/30', text: 'text-indigo-400', bar: 'bg-indigo-500' };
  if (s.includes('sci') || s.includes('bio')) return { bg: 'bg-emerald-500/10', border: 'border-emerald-500/30', text: 'text-emerald-400', bar: 'bg-emerald-500' };
  if (s.includes('phy')) return { bg: 'bg-sky-500/10', border: 'border-sky-500/30', text: 'text-sky-400', bar: 'bg-sky-500' };
  if (s.includes('chem')) return { bg: 'bg-amber-500/10', border: 'border-amber-500/30', text: 'text-amber-400', bar: 'bg-amber-500' };
  if (s.includes('eng') || s.includes('lit')) return { bg: 'bg-rose-500/10', border: 'border-rose-500/30', text: 'text-rose-400', bar: 'bg-rose-500' };
  if (s.includes('hist') || s.includes('geo') || s.includes('soc')) return { bg: 'bg-purple-500/10', border: 'border-purple-500/30', text: 'text-purple-400', bar: 'bg-purple-500' };
  return { bg: 'bg-primary-500/10', border: 'border-primary-500/30', text: 'text-primary-400', bar: 'bg-primary-500' };
};

// Helper: get initials from teacher name (e.g. "Prof. Vance" -> "PV")
const getInitials = (name = '') => {
  if (!name) return 'ED';
  const parts = name.replace(/^(Mr|Mrs|Ms|Dr|Prof)\.?\s+/i, '').trim().split(' ');
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return parts[0] ? parts[0].substring(0, 2).toUpperCase() : 'ED';
};

// Helper: parse slot time string like "09:00 AM" or "09:00 AM - 10:00 AM" to minutes from midnight
const parseTimeToMinutes = (timeStr) => {
  if (!timeStr) return null;
  const parts = timeStr.split('-').map(s => s.trim());
  const startTimeRaw = parts[0];
  
  const match = startTimeRaw.match(/(\d+):(\d+)\s*(AM|PM)/i);
  if (!match) return null;
  
  let hours = parseInt(match[1], 10);
  const minutes = parseInt(match[2], 10);
  const period = match[3].toUpperCase();
  
  if (period === 'PM' && hours < 12) hours += 12;
  if (period === 'AM' && hours === 12) hours = 0;
  
  const startMins = hours * 60 + minutes;
  
  let endMins = startMins + 60;
  if (parts.length > 1) {
    const endMatch = parts[1].match(/(\d+):(\d+)\s*(AM|PM)/i);
    if (endMatch) {
      let endHours = parseInt(endMatch[1], 10);
      const endMinutes = parseInt(endMatch[2], 10);
      const endPeriod = endMatch[3].toUpperCase();
      if (endPeriod === 'PM' && endHours < 12) endHours += 12;
      if (endPeriod === 'AM' && endHours === 12) endHours = 0;
      endMins = endHours * 60 + endMinutes;
    }
  }
  
  return { startMins, endMins };
};

// Get current day string e.g. "Monday"
const getCurrentDayName = () => {
  const dayIndex = new Date().getDay();
  const mappedIndex = dayIndex === 0 ? 6 : dayIndex - 1;
  return DAYS_OF_WEEK[mappedIndex];
};

export default function ClassTimetable({
  timetable = [],
  studentGrade = '',
  userRole = 'Student',
  onModifyClick = null,
  loading = false,
  availableClasses = ['VII', 'VIII', 'IX', 'X']
}) {
  const todayName = getCurrentDayName();
  const [selectedDay, setSelectedDay] = useState(todayName);
  const [selectedGradeFilter, setSelectedGradeFilter] = useState(studentGrade || 'ALL');
  const [viewMode, setViewMode] = useState('agenda'); // 'agenda' or 'weekly'
  const [searchQuery, setSearchQuery] = useState('');
  const [currentTimeMinutes, setCurrentTimeMinutes] = useState(0);

  const safeTimetable = useMemo(() => Array.isArray(timetable) ? timetable : [], [timetable]);
  const safeClasses = useMemo(() => Array.isArray(availableClasses) ? availableClasses : ['VII', 'VIII', 'IX', 'X'], [availableClasses]);

  // Sync grade filter if student profile updates
  useEffect(() => {
    if (studentGrade && userRole === 'Student') {
      setSelectedGradeFilter(studentGrade);
    }
  }, [studentGrade, userRole]);

  // Live clock interval
  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      setCurrentTimeMinutes(now.getHours() * 60 + now.getMinutes());
    };
    updateTime();
    const interval = setInterval(updateTime, 30000);
    return () => clearInterval(interval);
  }, []);

  // Filter slots for a given day & grade safely
  const getSlotsForDay = (dayName) => {
    if (!safeTimetable.length) return [];
    const dayData = safeTimetable.find(t => t && t.day && t.day.toLowerCase() === dayName.toLowerCase());
    if (!dayData || !dayData.slots || !Array.isArray(dayData.slots)) return [];
    let slots = dayData.slots;

    if (selectedGradeFilter && selectedGradeFilter !== 'ALL') {
      slots = slots.filter(s => s && s.grade?.trim().toUpperCase() === selectedGradeFilter.trim().toUpperCase());
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      slots = slots.filter(s => 
        (s.subject && s.subject.toLowerCase().includes(q)) ||
        (s.teacher && s.teacher.toLowerCase().includes(q)) ||
        (s.grade && s.grade.toLowerCase().includes(q))
      );
    }

    return slots;
  };

  // Count total slots per class grade safely
  const gradeSlotCounts = useMemo(() => {
    const counts = { ALL: 0 };
    safeClasses.forEach(c => { counts[c] = 0; });
    
    safeTimetable.forEach(day => {
      if (day && day.slots && Array.isArray(day.slots)) {
        day.slots.forEach(slot => {
          counts.ALL++;
          const g = slot.grade?.trim().toUpperCase();
          if (g && counts[g] !== undefined) counts[g]++;
        });
      }
    });
    return counts;
  }, [safeTimetable, safeClasses]);

  // Slot status calculation
  const getSlotStatus = (dayName, timeStr) => {
    if (dayName !== todayName) return { status: 'NORMAL', progress: 0 };
    const parsed = parseTimeToMinutes(timeStr);
    if (!parsed) return { status: 'NORMAL', progress: 0 };

    const { startMins, endMins } = parsed;

    if (currentTimeMinutes >= startMins && currentTimeMinutes <= endMins) {
      const total = endMins - startMins;
      const elapsed = currentTimeMinutes - startMins;
      const progress = Math.min(100, Math.max(0, Math.round((elapsed / total) * 100)));
      const remainingMins = endMins - currentTimeMinutes;
      return { status: 'LIVE', label: 'LIVE NOW', progress, remainingMins };
    } else if (currentTimeMinutes < startMins) {
      const startInMins = startMins - currentTimeMinutes;
      return { status: 'UPCOMING', label: 'UPCOMING', startInMins };
    } else {
      return { status: 'COMPLETED', label: 'COMPLETED', progress: 100 };
    }
  };

  // Scheduled days with active periods
  const scheduledDays = useMemo(() => {
    return DAYS_OF_WEEK.filter(d => getSlotsForDay(d).length > 0);
  }, [safeTimetable, selectedGradeFilter, searchQuery]);

  const daysToDisplay = scheduledDays.length > 0 ? scheduledDays : DAYS_OF_WEEK;

  // Auto-select valid scheduled day when filter changes
  useEffect(() => {
    if (scheduledDays.length > 0 && !scheduledDays.includes(selectedDay)) {
      if (scheduledDays.includes(todayName)) {
        setSelectedDay(todayName);
      } else {
        setSelectedDay(scheduledDays[0]);
      }
    }
  }, [selectedGradeFilter, timetable, searchQuery, scheduledDays]);

  // Discover live ongoing class period today
  const liveSlotToday = useMemo(() => {
    const todaySlots = getSlotsForDay(todayName);
    return todaySlots.find(slot => getSlotStatus(todayName, slot.time).status === 'LIVE');
  }, [safeTimetable, selectedGradeFilter, currentTimeMinutes, searchQuery]);

  const currentDaySlots = getSlotsForDay(selectedDay);

  // Distinct educators assigned on selected day
  const assignedEducatorsCount = useMemo(() => {
    const set = new Set();
    currentDaySlots.forEach(s => { if (s.teacher) set.add(s.teacher); });
    return set.size;
  }, [currentDaySlots]);

  return (
    <div className="glass-panel p-4 sm:p-6 rounded-2xl border border-dark-800 space-y-4 shadow-2xl overflow-hidden max-w-full">
      {/* Top Header & Navigation Bar */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 border-b border-dark-800/80 pb-4 overflow-hidden">
        <div className="flex items-center gap-2.5 min-w-0 max-w-full">
          <div className="p-2 rounded-xl bg-primary-500/10 border border-primary-500/20 text-primary-400 shrink-0">
            <Calendar size={18} />
          </div>
          <div className="min-w-0">
            <h2 className="text-base font-bold text-white font-outfit truncate">
              Class Timetable Schedule {selectedGradeFilter && selectedGradeFilter !== 'ALL' ? `— Class ${selectedGradeFilter}` : ''}
            </h2>
            <p className="text-xs text-slate-400 truncate">
              {userRole === 'Student' 
                ? 'Your daily class schedule & assigned educators' 
                : 'Campus master timetable & active period monitor'}
            </p>
          </div>
        </div>

        {/* Action Controls & Mode Toggles */}
        <div className="flex items-center gap-2 flex-wrap w-full sm:w-auto justify-between sm:justify-end shrink-0">
          {/* Search Bar Input (Admin/Teacher view or Desktop) */}
          {userRole !== 'Student' && (
            <div className="relative flex-1 sm:flex-none min-w-[140px]">
              <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
              <input
                type="text"
                placeholder="Search..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-8 pr-3 py-1.5 rounded-xl bg-dark-950 border border-dark-850 text-white text-xs placeholder:text-slate-500 outline-none focus:border-primary-500 transition"
              />
              {searchQuery && (
                <button 
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white text-[10px] font-bold"
                >
                  ✕
                </button>
              )}
            </div>
          )}

          {/* View Mode Toggle for Admin/Teacher */}
          {userRole !== 'Student' && (
            <div className="flex items-center bg-dark-950 border border-dark-850 p-1 rounded-xl shrink-0">
              <button
                type="button"
                onClick={() => setViewMode('agenda')}
                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-bold transition ${
                  viewMode === 'agenda'
                    ? 'bg-primary-600 text-white shadow-md'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <List size={13} />
                <span>Agenda</span>
              </button>
              <button
                type="button"
                onClick={() => setViewMode('weekly')}
                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-bold transition ${
                  viewMode === 'weekly'
                    ? 'bg-primary-600 text-white shadow-md'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <Grid size={13} />
                <span className="hidden sm:inline">Weekly Grid</span>
                <span className="sm:hidden">Grid</span>
              </button>
            </div>
          )}

          {/* Modify Planner Button for Admin/Teacher */}
          {onModifyClick && (userRole === 'SuperAdmin' || userRole === 'Teacher') && (
            <button
              type="button"
              onClick={onModifyClick}
              className="px-3 py-1.5 rounded-xl bg-gradient-to-r from-primary-600 to-indigo-600 hover:from-primary-500 hover:to-indigo-500 text-white shadow-lg shadow-primary-500/20 text-xs font-bold transition flex items-center gap-1.5 shrink-0 active:scale-95"
            >
              <Edit3 size={13} className="shrink-0" />
              <span>Modify Planner</span>
            </button>
          )}
        </div>
      </div>

      {/* Metric Stats Bar (Visible only on Desktop for Admins/Teachers) */}
      {userRole !== 'Student' && (
        <div className="hidden sm:grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="p-3 rounded-xl bg-dark-900/60 border border-dark-850 space-y-1">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block font-outfit">Active Status</span>
            <div className="flex items-center gap-1.5 text-xs font-bold font-outfit">
              {liveSlotToday ? (
                <span className="text-emerald-400 flex items-center gap-1">
                  <Radio size={12} className="animate-pulse" />
                  Live Period
                </span>
              ) : (
                <span className="text-slate-400 flex items-center gap-1">
                  <Clock size={12} />
                  No Active Class
                </span>
              )}
            </div>
          </div>

          <div className="p-3 rounded-xl bg-dark-900/60 border border-dark-850 space-y-1">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block font-outfit">Periods Scheduled</span>
            <p className="text-sm font-extrabold text-white font-mono">{currentDaySlots.length} Classes</p>
          </div>

          <div className="p-3 rounded-xl bg-dark-900/60 border border-dark-850 space-y-1">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block font-outfit">Educators On Duty</span>
            <p className="text-sm font-extrabold text-indigo-400 font-mono">{assignedEducatorsCount} Teachers</p>
          </div>

          <div className="p-3 rounded-xl bg-dark-900/60 border border-dark-850 space-y-1">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block font-outfit">Grade Filter</span>
            <p className="text-sm font-extrabold text-sky-400 font-mono">
              {selectedGradeFilter === 'ALL' ? 'All Grades' : `Class ${selectedGradeFilter}`}
            </p>
          </div>
        </div>
      )}

      {/* Class Level Filter Pills for Admin/Teacher */}
      {userRole !== 'Student' && safeClasses.length > 0 && (
        <div className="flex items-center gap-2 overflow-x-auto no-scrollbar py-1">
          <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider font-outfit shrink-0 flex items-center gap-1">
            <Filter size={11} className="text-primary-400" />
            Class:
          </span>
          <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar">
            <button
              type="button"
              onClick={() => setSelectedGradeFilter('ALL')}
              className={`px-3 py-1 rounded-lg text-xs font-bold transition shrink-0 flex items-center gap-1.5 ${
                selectedGradeFilter === 'ALL'
                  ? 'bg-primary-600 text-white shadow-md'
                  : 'bg-dark-900 border border-dark-850 text-slate-400 hover:text-white'
              }`}
            >
              <span>All Classes</span>
              {gradeSlotCounts.ALL > 0 && (
                <span className={`text-[9px] px-1.5 py-0.2 rounded-full font-mono font-black ${
                  selectedGradeFilter === 'ALL' ? 'bg-white/20 text-white' : 'bg-dark-950 text-slate-400'
                }`}>
                  {gradeSlotCounts.ALL}
                </span>
              )}
            </button>

            {safeClasses.map(c => {
              const isSelected = selectedGradeFilter === c;
              const count = gradeSlotCounts[c] || 0;
              return (
                <button
                  key={c}
                  type="button"
                  onClick={() => setSelectedGradeFilter(c)}
                  className={`px-3 py-1 rounded-lg text-xs font-bold transition shrink-0 flex items-center gap-1.5 ${
                    isSelected
                      ? 'bg-primary-600 text-white shadow-md'
                      : 'bg-dark-900 border border-dark-850 text-slate-400 hover:text-white'
                  }`}
                >
                  <span>Class {c}</span>
                  {count > 0 && (
                    <span className={`text-[9px] px-1.5 py-0.2 rounded-full font-mono font-black ${
                      isSelected ? 'bg-white/20 text-white' : 'bg-dark-950 text-slate-400'
                    }`}>
                      {count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Live Class Banner for Student */}
      {liveSlotToday && (
        <div className="p-3.5 rounded-xl bg-emerald-950/40 border border-emerald-500/40 flex items-center justify-between flex-wrap gap-2 text-xs animate-fadeIn">
          <div className="flex items-center gap-2">
            <Radio size={14} className="text-emerald-400 animate-pulse shrink-0" />
            <span className="text-emerald-300 font-bold">
              LIVE NOW: <strong className="text-white">{liveSlotToday.subject}</strong> — {liveSlotToday.teacher}
            </span>
          </div>
          <span className="text-xs font-mono font-extrabold text-emerald-300 bg-emerald-900/60 border border-emerald-700/50 px-2 py-0.5 rounded-md shrink-0">
            {liveSlotToday.time}
          </span>
        </div>
      )}

      {/* Agenda Mode (Daily View - Compact Mobile Design for Student) */}
      {(viewMode === 'agenda' || userRole === 'Student') && (
        <div className="space-y-3.5">
          {/* Day selection tabs with touch scroll - ONLY SHOW SCHEDULED DAYS */}
          <div className="flex gap-1.5 border-b border-dark-800/80 pb-3 overflow-x-auto no-scrollbar">
            {daysToDisplay.map((d) => {
              const isSelected = selectedDay === d;
              const isToday = d === todayName;
              const count = getSlotsForDay(d).length;

              return (
                <button
                  key={d}
                  type="button"
                  onClick={() => setSelectedDay(d)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition shrink-0 flex items-center gap-1.5 ${
                    isSelected
                      ? 'bg-primary-600 text-white shadow-md'
                      : isToday
                      ? 'bg-emerald-500/10 border border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/20'
                      : 'bg-dark-900 border border-dark-850 text-slate-400 hover:text-white'
                  }`}
                >
                  <span className="sm:hidden">{DAY_ABBR[d]}</span>
                  <span className="hidden sm:inline">{d}</span>
                  {isToday && (
                    <span className={`w-1.5 h-1.5 rounded-full ${isSelected ? 'bg-white' : 'bg-emerald-400 animate-ping'}`} />
                  )}
                  {count > 0 && (
                    <span className={`text-[9px] px-1.5 py-0.2 rounded-full font-mono font-black ${
                      isSelected ? 'bg-white/20 text-white' : 'bg-dark-950 text-slate-400'
                    }`}>
                      {count}
                    </span>
                  )}
                </button>
              );
            })}

            {/* Today jump button */}
            {daysToDisplay.includes(todayName) && selectedDay !== todayName && (
              <button
                type="button"
                onClick={() => setSelectedDay(todayName)}
                className="ml-auto px-2.5 py-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-xs font-bold transition flex items-center gap-1 shrink-0"
              >
                <Radio size={11} className="animate-pulse" />
                <span>Today</span>
              </button>
            )}
          </div>

          {/* Period Slots Card List */}
          {loading ? (
            <div className="text-center py-8">
              <div className="animate-spin rounded-full h-6 w-6 border-t-2 border-primary-500 mx-auto" />
            </div>
          ) : currentDaySlots.length === 0 ? (
            <div className="text-center py-8 text-slate-500 text-xs border border-dashed border-dark-850 rounded-xl space-y-1">
              <p className="font-bold text-slate-400">No periods scheduled for {selectedDay}</p>
              <p className="text-[11px] text-slate-500">
                {selectedGradeFilter !== 'ALL' ? `Class ${selectedGradeFilter} has no classes on ${selectedDay}.` : 'No class periods logged.'}
              </p>
            </div>
          ) : (
            <div className="space-y-2.5">
              {currentDaySlots.map((slot, idx) => {
                const statusInfo = getSlotStatus(selectedDay, slot.time);

                return (
                  <div
                    key={idx}
                    className={`p-3.5 rounded-xl transition-all space-y-2 relative overflow-hidden ${
                      statusInfo.status === 'LIVE'
                        ? 'bg-dark-900 border-2 border-emerald-500/60 shadow-lg shadow-emerald-950/40'
                        : 'bg-dark-900 border border-dark-850 hover:border-dark-750'
                    }`}
                  >
                    {/* Left status accent border */}
                    <div className={`absolute top-0 left-0 bottom-0 w-1 ${
                      statusInfo.status === 'LIVE' 
                        ? 'bg-emerald-500' 
                        : statusInfo.status === 'UPCOMING'
                        ? 'bg-sky-500'
                        : 'bg-dark-800'
                    }`} />

                    <div className="pl-2 space-y-2">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-xs sm:text-sm font-bold text-white font-outfit">{slot.subject}</span>
                          <span className="text-[9px] font-bold text-primary-400 bg-primary-950/60 border border-primary-900 px-1.5 py-0.5 rounded font-mono">
                            {slot.grade?.startsWith('Class') ? slot.grade : `Class ${slot.grade}`}
                          </span>

                          {statusInfo.status === 'LIVE' && (
                            <span className="text-[9px] font-bold text-emerald-400 bg-emerald-950/80 border border-emerald-800 px-1.5 py-0.5 rounded font-mono flex items-center gap-1 animate-pulse">
                              <Radio size={9} />
                              LIVE NOW
                            </span>
                          )}
                          {statusInfo.status === 'UPCOMING' && (
                            <span className="text-[9px] font-medium text-sky-400 bg-sky-950/60 border border-sky-900 px-1.5 py-0.5 rounded font-mono">
                              UPCOMING
                            </span>
                          )}
                          {statusInfo.status === 'COMPLETED' && (
                            <span className="text-[9px] font-medium text-slate-500 bg-dark-950 border border-dark-800 px-1.5 py-0.5 rounded font-mono flex items-center gap-1">
                              <CheckCircle2 size={9} className="text-emerald-500" />
                              Done
                            </span>
                          )}
                        </div>

                        <div className="flex items-center gap-1.5 font-mono text-slate-300 font-bold bg-dark-950 border border-dark-800 px-2.5 py-1 rounded-lg text-xs shrink-0 self-start sm:self-auto">
                          <Clock size={12} className="text-primary-400 shrink-0" />
                          <span>{slot.time}</span>
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5 text-[11px] text-slate-400 font-medium pt-1.5 border-t border-dark-850">
                        <User size={12} className="text-slate-500 shrink-0" />
                        <span>{slot.teacher || 'Assigned Educator'}</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Weekly Matrix View (Full 7-Day Grid for Admins/Teachers) */}
      {viewMode === 'weekly' && userRole !== 'Student' && (
        <div className="overflow-x-auto no-scrollbar border border-dark-850 rounded-xl bg-dark-905">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-dark-900 border-b border-dark-850 text-slate-400 uppercase text-[10px] font-bold font-outfit tracking-wider">
                <th className="p-3 w-28">Day</th>
                <th className="p-3">Scheduled Class Slots</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-dark-900">
              {DAYS_OF_WEEK.map((dayName) => {
                const slots = getSlotsForDay(dayName);
                const isToday = dayName === todayName;

                return (
                  <tr key={dayName} className={`hover:bg-dark-900/50 transition ${isToday ? 'bg-emerald-950/10' : ''}`}>
                    <td className="p-3 font-bold font-outfit text-white shrink-0">
                      <div className="flex items-center gap-1.5">
                        <span>{dayName}</span>
                        {isToday && (
                          <span className="text-[9px] font-mono font-bold text-emerald-400 bg-emerald-950 border border-emerald-800 px-1.5 py-0.2 rounded">
                            Today
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="p-3">
                      {slots.length === 0 ? (
                        <span className="text-slate-500 text-[11px] italic">No periods assigned</span>
                      ) : (
                        <div className="flex flex-wrap gap-2">
                          {slots.map((slot, idx) => (
                            <div 
                              key={idx}
                              className="p-2 rounded-lg bg-dark-900 border border-dark-850 flex items-center gap-2 text-xs hover:border-primary-500/40 transition"
                            >
                              <span className="font-mono text-primary-400 font-bold text-[10px] bg-dark-950 px-1.5 py-0.5 rounded border border-dark-800">
                                {slot.time}
                              </span>
                              <span className="font-bold text-white">{slot.subject}</span>
                              <span className="text-[9px] text-slate-400 bg-dark-950 px-1 py-0.2 rounded font-mono">
                                {slot.grade?.startsWith('Class') ? slot.grade : `Class ${slot.grade}`}
                              </span>
                              <span className="text-[10px] text-slate-400 border-l border-dark-800 pl-1.5">
                                {slot.teacher}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
