import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { useAuth } from '../context/AuthContext';
import { 
  Users, 
  BookOpen, 
  CreditCard, 
  Percent, 
  AlertTriangle, 
  TrendingUp, 
  Clock, 
  Calendar,
  ChevronRight,
  Sparkles,
  User
} from 'lucide-react';
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer, 
  LineChart, 
  Line, 
  PieChart, 
  Pie, 
  Cell 
} from 'recharts';

const Dashboard = () => {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [classes, setClasses] = useState([]);
  const [stats, setStats] = useState({
    totalStudents: 0,
    classCounts: {},
    expectedRevenue: 0,
    collectedRevenue: 0,
    outstandingRevenue: 0,
    lowAttendanceCount: 0
  });

  const [studentDetails, setStudentDetails] = useState(null);
  const [timetable, setTimetable] = useState([]);
  const [dailyAttendanceLogs, setDailyAttendanceLogs] = useState([]);
  const [rightPanelTab, setRightPanelTab] = useState('scores'); // 'scores' or 'attendance'
  const [syllabusProgress, setSyllabusProgress] = useState([]);

  useEffect(() => {
    const fetchData = async () => {
      try {
        if (user.role === 'Student') {
          let studentClass = user.studentProfile?.class_level || '';
          // Fetch specific student details
          if (user.studentProfile?._id) {
            const res = await axios.get(`/api/students/${user.studentProfile._id}`);
            if (res.data.success) {
              setStudentDetails(res.data.data);
              studentClass = res.data.data.class_level;
            }
          }
          // Fetch timetable
          const timetableRes = await axios.get('/api/timetable');
          if (timetableRes.data.success) {
            setTimetable(timetableRes.data.data);
          }
          // Fetch daily attendance logs
          if (user.studentProfile?._id) {
            const attRes = await axios.get(`/api/students/${user.studentProfile._id}/attendance`);
            if (attRes.data.success) {
              setDailyAttendanceLogs(attRes.data.data);
            }
          }
          // Fetch syllabus progress dynamically
          const [subjectsRes, materialsRes] = await Promise.all([
            axios.get(`/api/subjects?class_level=${studentClass}`),
            axios.get('/api/study-materials')
          ]);

          if (subjectsRes.data.success && materialsRes.data.success) {
            const subjectsList = subjectsRes.data.data.map(s => s.name);
            const materialsList = materialsRes.data.data || [];
            const counts = {};

            subjectsList.forEach(sub => {
              counts[sub] = { total: 4, completed: 0 };
            });

            materialsList.forEach(m => {
              if (m.class_level === studentClass) {
                if (!counts[m.subject]) {
                  counts[m.subject] = { total: 4, completed: 0 };
                }
                if (m.status === 'Notes Distributed' || m.status === 'Revised') {
                  counts[m.subject].completed += 1;
                }
                const totalCountInDb = materialsList.filter(x => x.class_level === studentClass && x.subject === m.subject).length;
                if (totalCountInDb > counts[m.subject].total) {
                  counts[m.subject].total = totalCountInDb;
                }
              }
            });

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
            setSyllabusProgress(formatted);
          }
        } else {
          // Fetch global stats for Admin/Teacher
          const studentsRes = await axios.get('/api/students?limit=1000');
          const feeStatsRes = user.role === 'SuperAdmin' ? await axios.get('/api/fees/stats') : null;
          const classesRes = await axios.get('/api/classes');

          const studentsList = studentsRes.data.data || [];
          const classesList = classesRes.data.success && Array.isArray(classesRes.data.data) ? classesRes.data.data : [];
          setClasses(classesList);
          
          // Compute metrics
          const counts = {};
          classesList.forEach(c => {
            counts[c] = 0;
          });
          let lowAttendance = 0;
          const currentMonthStr = new Date().toISOString().substring(0, 7);

          studentsList.forEach(s => {
            counts[s.class_level] = (counts[s.class_level] || 0) + 1;
            const currentAttendance = s.attendance_history?.find(h => h.month === currentMonthStr);
            if (currentAttendance && currentAttendance.total_classes > 0) {
              const rate = (currentAttendance.attended / currentAttendance.total_classes) * 100;
              if (rate < 75) {
                lowAttendance++;
              }
            }
          });

          const totalExpected = feeStatsRes?.data?.data?.totalExpectedRevenue || studentsList.reduce((sum, s) => sum + ((s.monthly_fee || 1500) * 12), 0);
          const totalCollected = feeStatsRes?.data?.data?.actualCollectedRevenue || 0;
          const totalOutstanding = feeStatsRes?.data?.data?.outstandingBalance || Math.max(0, totalExpected - totalCollected);

          setStats({
            totalStudents: studentsList.length,
            classCounts: counts,
            expectedRevenue: totalExpected,
            collectedRevenue: totalCollected,
            outstandingRevenue: totalOutstanding,
            lowAttendanceCount: lowAttendance
          });
        }
      } catch (err) {
        console.error('Failed to load dashboard data:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [user]);

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center min-h-[60vh]">
        <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-primary-500"></div>
      </div>
    );
  }

  // --- STUDENT / PARENT VIEW ---
  if (user.role === 'Student') {
    // Fallback data if student doesn't have records yet
    const attendanceRecords = studentDetails?.attendance_history || [];
    const recentScores = studentDetails?.test_scores || [];
    const tuitionScores = studentDetails?.tuition_test_scores || [];
    
    const latestAttendance = attendanceRecords[attendanceRecords.length - 1] || { total_classes: 20, attended: 16 };
    const attendancePercentage = latestAttendance.total_classes > 0 
      ? Math.round((latestAttendance.attended / latestAttendance.total_classes) * 100) 
      : 80;

    const attendanceColor = attendancePercentage >= 75 
      ? 'text-emerald-400 border-emerald-500/20 bg-emerald-500/5' 
      : attendancePercentage >= 50 
        ? 'text-amber-400 border-amber-500/20 bg-amber-500/5' 
        : 'text-rose-400 border-rose-500/20 bg-rose-500/5';

    // Mock fee ledger if empty
    const personalLedger = studentDetails?.ledger || { months: [] };
    const currentMonthIndex = new Date().getMonth();
    const monthsName = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    const currentMonthName = monthsName[currentMonthIndex];
    const currentFeeState = personalLedger.months?.find(m => m.month_name === currentMonthName) || { status: 'Unpaid', amount_paid: 0 };

    // Prepare chart data for student performance curve
    const chartData = recentScores.map(score => ({
      name: score.test_name,
      percentage: Math.round((score.marks_obtained / score.total_marks) * 100),
      subject: score.subject
    })).slice(-6); // Last 6 tests

    const defaultChartData = [
      { name: 'Unit Test 1', percentage: 72, subject: 'Math' },
      { name: 'Pop Quiz 1', percentage: 85, subject: 'Science' },
      { name: 'Unit Test 2', percentage: 68, subject: 'English' },
      { name: 'Mid Term', percentage: 78, subject: 'Math' },
      { name: 'Pop Quiz 2', percentage: 92, subject: 'Science' },
      { name: 'Finals Prep', percentage: 84, subject: 'Geography' }
    ];

    return (
      <div className="space-y-6">
        {/* Welcome Section */}
        <div className="glass-panel p-6 rounded-2xl border border-dark-800 flex flex-col md:flex-row md:items-center justify-between gap-4 relative overflow-hidden">
          <div className="absolute top-0 right-0 p-8 opacity-10 pointer-events-none">
            <Sparkles size={120} className="text-primary-500" />
          </div>
          <div className="flex items-center gap-4">
            {user?.profile_pic ? (
              <img 
                src={user.profile_pic} 
                alt="Profile" 
                className="w-16 h-16 rounded-2xl object-cover border-2 border-primary-500/25 shadow-md shadow-primary-500/5"
              />
            ) : (
              <div className="w-16 h-16 rounded-2xl bg-gradient-to-tr from-primary-600 to-indigo-400 flex items-center justify-center font-bold text-white text-2xl shadow-md">
                {user?.email[0].toUpperCase()}
              </div>
            )}
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-white font-outfit">
                Hello, {studentDetails?.name || 'Student'}!
              </h1>
              <p className="text-slate-400 text-sm mt-1 font-medium">
                Here's a breakdown of your academic progress for Class {studentDetails?.class_level || 'N/A'}.
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            <span 
              className="px-3 py-1.5 rounded-xl bg-dark-900 border border-dark-800 text-xs font-semibold text-slate-300 flex items-center gap-1"
              title="Roll number is determined dynamically by your progress rank in class (combining test scores and attendance)."
            >
              Roll No (Rank): {studentDetails?.roll_number || 'N/A'}
              {studentDetails?.roll_number === '01' && <span className="text-amber-400 text-sm ml-1 select-none">👑</span>}
            </span>
            <span className="px-3 py-1.5 rounded-xl bg-primary-950/40 border border-primary-800/30 text-xs font-semibold text-primary-400">
              Status: Active
            </span>
          </div>
        </div>

        {/* Dashboard Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Card 1: Attendance Gauge */}
          <div className="glass-panel p-6 rounded-2xl border border-dark-800 flex flex-col items-center justify-center text-center">
            <h3 className="text-slate-400 text-sm font-semibold uppercase tracking-wider mb-4 self-start">Monthly Attendance</h3>
            <div className={`relative flex items-center justify-center w-28 h-28 rounded-full border-4 ${attendanceColor.split(' ')[1]} mb-4`}>
              <div className="text-2xl font-extrabold text-white font-outfit">{attendancePercentage}%</div>
              <Percent className="absolute top-2 right-2 text-slate-500" size={12} />
            </div>
            <p className="text-sm font-semibold text-white">
              {latestAttendance.attended} of {latestAttendance.total_classes} Classes Attended
            </p>
            <span className={`mt-3 px-3 py-1 rounded-full text-xs font-medium border ${attendanceColor.split(' ').slice(0,2).join(' ')}`}>
              {attendancePercentage >= 75 ? 'Compliant status' : attendancePercentage >= 50 ? 'Warning Threshold' : 'Critical Non-compliant'}
            </span>

            {/* Recent Daily Logs list */}
            <div className="mt-4 pt-3 border-t border-dark-800/60 w-full">
              <span className="text-[10px] uppercase font-bold text-slate-500 tracking-wider block mb-2 text-left">Recent Daily Logs</span>
              <div className="space-y-1.5 max-h-24 overflow-y-auto">
                {dailyAttendanceLogs.slice(0, 3).map((log, i) => (
                  <div key={i} className="flex justify-between items-center text-[10px] font-mono">
                    <span className="text-slate-400">
                      {new Date(log.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
                    </span>
                    <span className={`font-bold ${log.status === 'Present' ? 'text-emerald-400' : 'text-rose-400'}`}>{log.status}</span>
                  </div>
                ))}
                {dailyAttendanceLogs.length === 0 && (
                  <span className="text-[10px] text-slate-500 block text-left">No logs found</span>
                )}
              </div>
            </div>
          </div>

          {/* Card 2: Syllabus Status */}
          <div className="glass-panel p-6 rounded-2xl border border-dark-800 flex flex-col justify-between">
            <div>
              <h3 className="text-slate-400 text-sm font-semibold uppercase tracking-wider mb-3">Syllabus Progress</h3>
              <div className="space-y-3 max-h-36 overflow-y-auto pr-1">
                {syllabusProgress.length > 0 ? (
                  syllabusProgress.map((item, index) => {
                    const barColor = item.percentage >= 75
                      ? 'bg-emerald-500'
                      : item.percentage >= 50
                        ? 'bg-indigo-500'
                        : 'bg-rose-500';
                    return (
                      <div key={index}>
                        <div className="flex justify-between text-xs font-medium mb-1">
                          <span className="text-slate-350">{item.subject}</span>
                          <span className="text-slate-400">{item.percentage}% Complete</span>
                        </div>
                        <div className="w-full bg-dark-900 rounded-full h-1.5">
                          <div className={`${barColor} h-1.5 rounded-full transition-all duration-300`} style={{ width: `${item.percentage}%` }}></div>
                        </div>
                      </div>
                    );
                  })
                ) : (
                  <div className="text-center py-6 text-slate-500 text-xs border border-dashed border-dark-850 rounded-xl">
                    No subjects loaded
                  </div>
                )}
              </div>
            </div>
            <div className="mt-4 pt-4 border-t border-dark-800/60 text-xs text-slate-400 flex justify-between items-center shrink-0">
              <span>Running Chapter Logs</span>
              <a href="/lms" className="text-primary-400 hover:text-primary-300 font-semibold flex items-center font-outfit">
                LMS Handouts <ChevronRight size={14} />
              </a>
            </div>
          </div>
        </div>

        {/* Weekly Timetable */}
        <div className="glass-panel p-6 rounded-2xl border border-dark-800 space-y-4">
          <div className="border-b border-dark-800 pb-3 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2">
            <div>
              <h3 className="text-white text-base font-bold font-outfit flex items-center gap-2">
                <Calendar className="text-primary-500" size={18} />
                <span>Class Timetable (Class {studentDetails?.class_level || 'N/A'})</span>
              </h3>
              <p className="text-xs text-slate-450 mt-0.5">Your daily class schedule and educators</p>
            </div>
            <span className="text-slate-450 text-[10px] font-bold px-2 py-1 rounded bg-dark-900 border border-dark-850 font-mono">
              7-Day Schedule
            </span>
          </div>

          {(() => {
            const studentGrade = studentDetails?.class_level || '';
            const filteredDays = timetable.map(t => ({
              day: t.day,
              slots: t.slots.filter(slot => slot.grade?.trim().toUpperCase() === studentGrade.trim().toUpperCase())
            })).filter(t => t.slots.length > 0);

            if (filteredDays.length === 0) {
              return (
                <div className="text-center py-8 text-slate-500 text-xs border border-dashed border-dark-850 rounded-xl">
                  No classes scheduled for Class {studentGrade || 'your grade'} at this time.
                </div>
              );
            }

            return (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
                {filteredDays.map((t, index) => (
                  <div key={index} className="p-4 rounded-xl bg-dark-900/30 border border-dark-850/60 space-y-3 hover:border-dark-750 transition flex flex-col justify-between">
                    <h4 className="text-xs font-bold text-primary-400 font-mono border-l-2 border-l-primary-500 pl-2 bg-primary-950/20 py-1">{t.day}</h4>
                    <div className="space-y-2.5">
                      {t.slots.map((slot, idx) => (
                        <div key={idx} className="p-3 rounded-lg bg-dark-900/60 border border-dark-850 space-y-1.5 hover:border-dark-800 transition">
                          <div className="flex justify-between items-start gap-1">
                            <span className="text-xs font-bold text-white leading-tight">{slot.subject}</span>
                          </div>
                          <div className="flex items-center gap-1.5 text-[10px] text-slate-400">
                            <Clock size={12} className="text-slate-500" />
                            <span className="font-mono">{slot.time}</span>
                          </div>
                          <div className="flex items-center gap-1.5 text-[10px] text-slate-400">
                            <User size={12} className="text-slate-500" />
                            <span>{slot.teacher}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            );
          })()}
        </div>

        {/* Charts & Marks */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Performance curve chart */}
          <div className="glass-panel p-6 rounded-2xl border border-dark-800 lg:col-span-2">
            <h3 className="text-white text-base font-bold font-outfit mb-6 flex items-center gap-2">
              <TrendingUp className="text-primary-500" size={18} />
              <span>Academic Performance Curve</span>
            </h3>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData.length > 0 ? chartData : defaultChartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#2e3155" />
                  <XAxis dataKey="name" stroke="#94a3b8" fontSize={12} />
                  <YAxis domain={[0, 100]} stroke="#94a3b8" fontSize={12} />
                  <Tooltip 
                    contentStyle={{ backgroundColor: '#1b1c31', borderColor: '#2e3155', borderRadius: '12px' }}
                    labelStyle={{ color: '#fff', fontWeight: 'bold' }}
                  />
                  <Line 
                    type="monotone" 
                    dataKey="percentage" 
                    stroke="#6366f1" 
                    strokeWidth={3} 
                    dot={{ fill: '#4f46e5', r: 5 }} 
                    activeDot={{ r: 8 }} 
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Recent Marks / Attendance Tabs Card */}
          <div className="glass-panel p-6 rounded-2xl border border-dark-800 flex flex-col h-[22rem]">
            <div className="flex justify-between items-center border-b border-dark-800 pb-3 mb-4 shrink-0">
              <div className="flex gap-2 bg-dark-950 p-0.5 rounded-lg border border-dark-850">
                <button
                  type="button"
                  onClick={() => setRightPanelTab('scores')}
                  className={`px-2.5 py-1 rounded-md text-xs font-bold transition ${
                    rightPanelTab === 'scores'
                      ? 'bg-primary-600 text-white'
                      : 'text-slate-550 hover:text-slate-300'
                  }`}
                >
                  Exam Scores
                </button>
                <button
                  type="button"
                  onClick={() => setRightPanelTab('attendance')}
                  className={`px-2.5 py-1 rounded-md text-xs font-bold transition ${
                    rightPanelTab === 'attendance'
                      ? 'bg-primary-600 text-white'
                      : 'text-slate-550 hover:text-slate-300'
                  }`}
                >
                  Attendance Logs
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto pr-1">
              {rightPanelTab === 'scores' ? (
                <div className="space-y-3">
                  {recentScores.length > 0 ? (
                    recentScores.map((score, index) => (
                      <div key={index} className="flex justify-between items-center p-3 rounded-xl bg-dark-900/50 border border-dark-900/80 font-outfit">
                        <div>
                          <h4 className="text-sm font-semibold text-white">{score.test_name}</h4>
                          <span className="text-[10px] text-slate-400 block mt-0.5">{score.subject} • {new Date(score.date).toLocaleDateString()}</span>
                        </div>
                        <span className="text-sm font-bold text-indigo-400 font-mono">
                          {score.marks_obtained}/{score.total_marks}
                        </span>
                      </div>
                    ))
                  ) : (
                    <div className="text-center py-12 text-slate-500 text-sm">
                      No tests logged yet.
                    </div>
                  )}
                </div>
              ) : (
                <div className="space-y-3">
                  {dailyAttendanceLogs.length > 0 ? (
                    dailyAttendanceLogs.map((log, index) => (
                      <div key={index} className="flex justify-between items-center p-3 rounded-xl bg-dark-900/50 border border-dark-900/80 font-mono">
                        <div>
                          <h4 className="text-xs font-bold text-white">
                            {new Date(log.date).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}
                          </h4>
                          <span className="text-[9px] text-slate-500 block mt-0.5">Daily Session</span>
                        </div>
                        <span className={`text-[10px] font-extrabold px-2 py-0.5 rounded ${
                          log.status === 'Present'
                            ? 'bg-emerald-500/10 text-emerald-450 border border-emerald-500/20'
                            : 'bg-rose-500/10 text-rose-450 border border-rose-500/20'
                        }`}>
                          {log.status}
                        </span>
                      </div>
                    ))
                  ) : (
                    <div className="text-center py-12 text-slate-500 text-sm">
                      No attendance logs recorded yet.
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
        {/* Scores Grid */}
        <div className="grid grid-cols-1 2xl:grid-cols-2 gap-6">
          {/* School Exam Scores Section */}
          <div className="glass-panel p-6 rounded-2xl border border-dark-800 space-y-4">
            <div className="border-b border-dark-800 pb-4 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
              <div>
                <h3 className="text-white text-base font-bold font-outfit flex items-center gap-2">
                  <BookOpen className="text-primary-500" size={18} />
                  <span>School Exam Scores</span>
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">Comprehensive history of your academic evaluations and test scores</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <span className="px-3 py-1.5 rounded-xl bg-dark-900 border border-dark-850 text-xs font-semibold text-slate-350">
                  Tests Conducted: {recentScores.length}
                </span>
                {recentScores.length > 0 && (
                  <span className="px-3 py-1.5 rounded-xl bg-emerald-950/40 border border-emerald-800/30 text-xs font-semibold text-emerald-400">
                    Average: {Math.round(recentScores.reduce((sum, s) => sum + (s.marks_obtained / s.total_marks * 100), 0) / recentScores.length)}%
                  </span>
                )}
              </div>
            </div>

            {recentScores.length > 0 ? (
              <>
                {/* Desktop Table view */}
                <div className="hidden lg:block overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-dark-800/60 text-slate-400 text-xs font-semibold uppercase tracking-wider font-mono">
                        <th className="pb-3 pl-2">Exam / Test Name</th>
                        <th className="pb-3">Subject</th>
                        <th className="pb-3">Date</th>
                        <th className="pb-3 text-right">Marks</th>
                        <th className="pb-3 text-right">Percentage</th>
                        <th className="pb-3 pr-2 text-right">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-dark-850/40 text-sm">
                      {recentScores.map((score, index) => {
                        const percentage = Math.round((score.marks_obtained / score.total_marks) * 100);
                        let badgeClass = '';
                        let statusLabel = '';
                        if (percentage >= 85) {
                          badgeClass = 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20';
                          statusLabel = 'Excellent';
                        } else if (percentage >= 60) {
                          badgeClass = 'bg-indigo-500/10 text-indigo-400 border border-indigo-500/20';
                          statusLabel = 'Good';
                        } else if (percentage >= 40) {
                          badgeClass = 'bg-amber-500/10 text-amber-400 border border-amber-500/20';
                          statusLabel = 'Passed';
                        } else {
                          badgeClass = 'bg-rose-500/10 text-rose-450 border border-rose-500/20';
                          statusLabel = 'Needs Review';
                        }

                        return (
                          <tr key={score._id || index} className="hover:bg-dark-900/20 transition duration-150">
                            <td className="py-3.5 pl-2 font-semibold text-white font-outfit">{score.test_name}</td>
                            <td className="py-3.5 text-slate-350 font-medium">{score.subject}</td>
                            <td className="py-3.5 text-slate-450 text-xs font-mono">
                              {new Date(score.date).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}
                            </td>
                            <td className="py-3.5 text-right font-mono font-semibold text-slate-200">
                              {score.marks_obtained} <span className="text-slate-500">/ {score.total_marks}</span>
                            </td>
                            <td className="py-3.5 text-right">
                              <div className="inline-flex flex-col items-end gap-1">
                                <span className="font-mono font-bold text-primary-400">{percentage}%</span>
                                <div className="w-16 bg-dark-900 rounded-full h-1">
                                  <div 
                                    className={`h-1 rounded-full ${percentage >= 85 ? 'bg-emerald-500' : percentage >= 40 ? 'bg-primary-500' : 'bg-rose-500'}`} 
                                    style={{ width: `${percentage}%` }}
                                  />
                                </div>
                              </div>
                            </td>
                            <td className="py-3.5 pr-2 text-right">
                              <span className={`px-2.5 py-1 rounded-lg text-[10px] font-extrabold tracking-wide uppercase ${badgeClass}`}>
                                {statusLabel}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Mobile Card view */}
                <div className="grid grid-cols-1 gap-3 lg:hidden">
                  {recentScores.map((score, index) => {
                    const percentage = Math.round((score.marks_obtained / score.total_marks) * 100);
                    let badgeClass = '';
                    let statusLabel = '';
                    if (percentage >= 85) {
                      badgeClass = 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20';
                      statusLabel = 'Excellent';
                    } else if (percentage >= 60) {
                      badgeClass = 'bg-indigo-500/10 text-indigo-400 border border-indigo-500/20';
                      statusLabel = 'Good';
                    } else if (percentage >= 40) {
                      badgeClass = 'bg-amber-500/10 text-amber-400 border border-amber-500/20';
                      statusLabel = 'Passed';
                    } else {
                      badgeClass = 'bg-rose-500/10 text-rose-450 border border-rose-500/20';
                      statusLabel = 'Needs Review';
                    }

                    return (
                      <div key={score._id || index} className="p-4 rounded-xl bg-dark-900/40 border border-dark-850 space-y-3">
                        <div className="flex justify-between items-start">
                          <div>
                            <h4 className="text-sm font-semibold text-white font-outfit">{score.test_name}</h4>
                            <span className="text-xs text-slate-455 mt-0.5 block">{score.subject}</span>
                          </div>
                          <span className={`px-2 py-0.5 rounded text-[9px] font-extrabold tracking-wide uppercase ${badgeClass}`}>
                            {statusLabel}
                          </span>
                        </div>
                        
                        <div className="flex justify-between items-center pt-2 border-t border-dark-800/40">
                          <div className="text-[10px] text-slate-500 font-mono">
                            {new Date(score.date).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}
                          </div>
                          <div className="flex items-center gap-3">
                            <span className="text-xs font-mono font-semibold text-slate-350">
                              {score.marks_obtained}/{score.total_marks}
                            </span>
                            <span className="text-xs font-mono font-bold text-primary-400">{percentage}%</span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            ) : (
              <div className="text-center py-10 text-slate-550 text-xs border border-dashed border-dark-850 rounded-xl">
                No school exam scores logged in your profile yet.
              </div>
            )}
          </div>

          {/* Tuition Exam Scores Section */}
          <div className="glass-panel p-6 rounded-2xl border border-dark-800 space-y-4">
            <div className="border-b border-dark-800 pb-4 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
              <div>
                <h3 className="text-white text-base font-bold font-outfit flex items-center gap-2">
                  <TrendingUp className="text-emerald-500" size={18} />
                  <span>Tuition Exam Scores</span>
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">Comprehensive history of your evaluation and tests at the tuition center</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <span className="px-3 py-1.5 rounded-xl bg-dark-900 border border-dark-850 text-xs font-semibold text-slate-355">
                  Tests Conducted: {tuitionScores.length}
                </span>
                {tuitionScores.length > 0 && (
                  <span className="px-3 py-1.5 rounded-xl bg-emerald-950/40 border border-emerald-800/30 text-xs font-semibold text-emerald-400">
                    Average: {Math.round(tuitionScores.reduce((sum, s) => sum + (s.marks_obtained / s.total_marks * 100), 0) / tuitionScores.length)}%
                  </span>
                )}
              </div>
            </div>

            {tuitionScores.length > 0 ? (
              <>
                {/* Desktop Table view */}
                <div className="hidden lg:block overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-dark-800/60 text-slate-400 text-xs font-semibold uppercase tracking-wider font-mono">
                        <th className="pb-3 pl-2">Exam / Test Name</th>
                        <th className="pb-3">Subject</th>
                        <th className="pb-3">Date</th>
                        <th className="pb-3 text-right">Marks</th>
                        <th className="pb-3 text-right">Percentage</th>
                        <th className="pb-3 pr-2 text-right">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-dark-850/40 text-sm">
                      {tuitionScores.map((score, index) => {
                        const percentage = Math.round((score.marks_obtained / score.total_marks) * 100);
                        let badgeClass = '';
                        let statusLabel = '';
                        if (percentage >= 85) {
                          badgeClass = 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20';
                          statusLabel = 'Excellent';
                        } else if (percentage >= 60) {
                          badgeClass = 'bg-indigo-500/10 text-indigo-400 border border-indigo-500/20';
                          statusLabel = 'Good';
                        } else if (percentage >= 40) {
                          badgeClass = 'bg-amber-500/10 text-amber-400 border border-amber-500/20';
                          statusLabel = 'Passed';
                        } else {
                          badgeClass = 'bg-rose-500/10 text-rose-450 border border-rose-500/20';
                          statusLabel = 'Needs Review';
                        }

                        return (
                          <tr key={score._id || index} className="hover:bg-dark-900/20 transition duration-150">
                            <td className="py-3.5 pl-2 font-semibold text-white font-outfit">{score.test_name}</td>
                            <td className="py-3.5 text-slate-350 font-medium">{score.subject}</td>
                            <td className="py-3.5 text-slate-450 text-xs font-mono">
                              {new Date(score.date).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}
                            </td>
                            <td className="py-3.5 text-right font-mono font-semibold text-slate-200">
                              {score.marks_obtained} <span className="text-slate-500">/ {score.total_marks}</span>
                            </td>
                            <td className="py-3.5 text-right">
                              <div className="inline-flex flex-col items-end gap-1">
                                <span className="font-mono font-bold text-emerald-400">{percentage}%</span>
                                <div className="w-16 bg-dark-900 rounded-full h-1">
                                  <div 
                                    className={`h-1 rounded-full ${percentage >= 85 ? 'bg-emerald-500' : percentage >= 40 ? 'bg-emerald-600' : 'bg-rose-500'}`} 
                                    style={{ width: `${percentage}%` }}
                                  />
                                </div>
                              </div>
                            </td>
                            <td className="py-3.5 pr-2 text-right">
                              <span className={`px-2.5 py-1 rounded-lg text-[10px] font-extrabold tracking-wide uppercase ${badgeClass}`}>
                                {statusLabel}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Mobile Card view */}
                <div className="grid grid-cols-1 gap-3 lg:hidden">
                  {tuitionScores.map((score, index) => {
                    const percentage = Math.round((score.marks_obtained / score.total_marks) * 100);
                    let badgeClass = '';
                    let statusLabel = '';
                    if (percentage >= 85) {
                      badgeClass = 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20';
                      statusLabel = 'Excellent';
                    } else if (percentage >= 60) {
                      badgeClass = 'bg-indigo-500/10 text-indigo-400 border border-indigo-500/20';
                      statusLabel = 'Good';
                    } else if (percentage >= 40) {
                      badgeClass = 'bg-amber-500/10 text-amber-400 border border-amber-500/20';
                      statusLabel = 'Passed';
                    } else {
                      badgeClass = 'bg-rose-500/10 text-rose-450 border border-rose-500/20';
                      statusLabel = 'Needs Review';
                    }

                    return (
                      <div key={score._id || index} className="p-4 rounded-xl bg-dark-900/40 border border-dark-850 space-y-3">
                        <div className="flex justify-between items-start">
                          <div>
                            <h4 className="text-sm font-semibold text-white font-outfit">{score.test_name}</h4>
                            <span className="text-xs text-slate-455 mt-0.5 block">{score.subject}</span>
                          </div>
                          <span className={`px-2 py-0.5 rounded text-[9px] font-extrabold tracking-wide uppercase ${badgeClass}`}>
                            {statusLabel}
                          </span>
                        </div>
                        
                        <div className="flex justify-between items-center pt-2 border-t border-dark-800/40">
                          <div className="text-[10px] text-slate-500 font-mono">
                            {new Date(score.date).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}
                          </div>
                          <div className="flex items-center gap-3">
                            <span className="text-xs font-mono font-semibold text-slate-355">
                              {score.marks_obtained}/{score.total_marks}
                            </span>
                            <span className="text-xs font-mono font-bold text-emerald-400">{percentage}%</span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            ) : (
              <div className="text-center py-10 text-slate-550 text-xs border border-dashed border-dark-850 rounded-xl">
                No tuition exam scores logged in your profile yet.
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // --- ADMIN / TEACHER VIEW ---
  // Dynamic Pie chart colors
  const COLORS = ['#6366f1', '#3b82f6', '#10b981', '#f59e0b', '#ec4899', '#8b5cf6', '#06b6d4', '#14b8a6', '#f43f5e'];

  // Pie chart data
  const pieData = classes.map((c, index) => ({
    name: `Class ${c}`,
    value: stats.classCounts[c] || 0,
    color: COLORS[index % COLORS.length]
  }));

  return (
    <div className="space-y-6">
      {/* Welcome & Stats Row - Redesigned to be a gorgeous premium header card */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-primary-900/40 via-dark-900/30 to-indigo-900/20 border border-dark-800/80 p-6 sm:p-8 shadow-xl flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div className="absolute top-0 right-0 p-8 opacity-10 pointer-events-none">
          <Sparkles size={160} className="text-primary-500" />
        </div>
        <div className="relative z-10 flex items-center gap-4 animate-fadeIn">
          {user?.profile_pic ? (
            <img 
              src={user.profile_pic} 
              alt="Profile" 
              className="w-16 h-16 rounded-2xl object-cover border-2 border-primary-500/25 shadow-md shadow-primary-500/5"
            />
          ) : (
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-tr from-primary-600 to-indigo-400 flex items-center justify-center font-bold text-white text-2xl shadow-md">
              {user?.email[0].toUpperCase()}
            </div>
          )}
          <div>
            <span className="px-2.5 py-1 rounded-md text-[10px] font-extrabold uppercase tracking-widest bg-primary-500/10 text-primary-400 border border-primary-500/20">
              System Command
            </span>
            <h1 className="text-3xl font-extrabold tracking-tight text-white font-outfit mt-1">EduStride Control Center</h1>
            <p className="text-slate-400 text-xs sm:text-sm max-w-2xl mt-0.5 font-medium">
              Welcome back, {user?.role}! Inspect live student counts, financial metrics, and operational dashboards.
            </p>
          </div>
        </div>
        <div className="relative z-10 text-xs text-slate-400 flex items-center gap-2 bg-dark-950/40 border border-dark-800/80 px-3.5 py-2 rounded-xl h-fit shrink-0 self-start md:self-center font-mono">
          <Calendar size={14} className="text-primary-500" />
          <span>{new Date().toLocaleDateString(undefined, { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' })}</span>
        </div>
      </div>

      {/* Analytics Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {/* Total Students */}
        <div className="glass-panel p-6 rounded-2xl border border-dark-800 relative">
          <div className="flex justify-between items-center mb-4">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">Active Students</span>
            <div className="p-2 rounded-lg bg-primary-600/10 text-primary-400">
              <Users size={18} />
            </div>
          </div>
          <p className="text-3xl font-extrabold text-white font-outfit">{stats.totalStudents}</p>
          <span className="text-[10px] font-semibold text-emerald-400 block mt-1">Cross-batch operations enabled</span>
        </div>

        {/* Total Collected Revenue */}
        <div className="glass-panel p-6 rounded-2xl border border-dark-800 relative">
          <div className="flex justify-between items-center mb-4">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">Collected Revenue</span>
            <div className="p-2 rounded-lg bg-emerald-600/10 text-emerald-400">
              <CreditCard size={18} />
            </div>
          </div>
          <p className="text-3xl font-extrabold text-white font-outfit">₹{stats.collectedRevenue.toLocaleString()}</p>
          <span className="text-[10px] font-semibold text-slate-400 block mt-1">Updated via gateway webhook</span>
        </div>

        {/* Outstanding Balance */}
        <div className="glass-panel p-6 rounded-2xl border border-dark-800 relative">
          <div className="flex justify-between items-center mb-4">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">Outstanding Balance</span>
            <div className="p-2 rounded-lg bg-rose-600/10 text-rose-400">
              <AlertTriangle size={18} />
            </div>
          </div>
          <p className="text-3xl font-extrabold text-white font-outfit">₹{stats.outstandingRevenue.toLocaleString()}</p>
          <span className="text-[10px] font-semibold text-rose-400 block mt-1">Pending payments nag targets</span>
        </div>

        {/* Defaulter / Attendance Warnings */}
        <div className="glass-panel p-6 rounded-2xl border border-dark-800 relative">
          <div className="flex justify-between items-center mb-4">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">Low Attendance Alerts</span>
            <div className="p-2 rounded-lg bg-amber-600/10 text-amber-400">
              <Percent size={18} />
            </div>
          </div>
          <p className="text-3xl font-extrabold text-white font-outfit">{stats.lowAttendanceCount}</p>
          <span className="text-[10px] font-semibold text-amber-400 block mt-1">Students below 75% target</span>
        </div>
      </div>

      {/* Visual Analytics */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Class distribution charts */}
        <div className="glass-panel p-6 rounded-2xl border border-dark-800 lg:col-span-2">
          <h3 className="text-white text-base font-bold font-outfit mb-4">Class Enrollment Ratios</h3>
          <div className="flex flex-col md:flex-row items-center justify-around gap-4">
            <div className="w-full md:w-1/2 h-64">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={pieData}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={80}
                    paddingAngle={5}
                    dataKey="value"
                  >
                    {pieData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="space-y-3 w-full md:w-1/3">
              {pieData.map(item => (
                <div key={item.name} className="flex items-center justify-between p-2 rounded-lg bg-dark-900/30 border border-dark-800/40">
                  <div className="flex items-center gap-2">
                    <span className="w-3 h-3 rounded-full" style={{ backgroundColor: item.color }}></span>
                    <span className="text-sm font-semibold text-slate-300">{item.name}</span>
                  </div>
                  <span className="text-sm font-bold text-white">{item.value} Students</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Quick Task Schedules */}
        <div className="glass-panel p-6 rounded-2xl border border-dark-800 flex flex-col justify-between">
          <div>
            <h3 className="text-white text-base font-bold font-outfit mb-4 flex items-center gap-2">
              <Clock className="text-primary-500" size={18} />
              <span>Cron Daemon Handlers</span>
            </h3>
            <div className="space-y-4">
              <div className="p-3 rounded-xl bg-dark-900 border border-dark-850">
                <div className="flex justify-between items-center mb-1">
                  <span className="text-xs font-bold text-white">Fee Reminder Mailer</span>
                  <span className="text-[10px] bg-primary-600/10 text-primary-400 border border-primary-500/20 px-2 py-0.5 rounded-full font-medium">Monthly (5th)</span>
                </div>
                <p className="text-xs text-slate-400">Scans monthly feeLedgers for outstanding balance notifications.</p>
              </div>

              <div className="p-3 rounded-xl bg-dark-900 border border-dark-850">
                <div className="flex justify-between items-center mb-1">
                  <span className="text-xs font-bold text-white">Attendance Monitor</span>
                  <span className="text-[10px] bg-indigo-600/10 text-indigo-400 border border-indigo-500/20 px-2 py-0.5 rounded-full font-medium">Weekly (Sun)</span>
                </div>
                <p className="text-xs text-slate-400">Notifies guardians for students under the 75% attendance line.</p>
              </div>
            </div>
          </div>
          <a href="/automations" className="w-full mt-4 text-center py-2 rounded-xl bg-dark-900 hover:bg-dark-800 border border-dark-850 text-xs font-semibold text-slate-300 transition duration-150 block">
            Manage Cron Systems
          </a>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
