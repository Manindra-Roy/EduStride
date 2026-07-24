import React, { useEffect, useState, useMemo, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import axios from 'axios';
import { useAuth } from '../context/AuthContext';
import { 
  Plus, 
  Search, 
  Check, 
  X, 
  Edit, 
  Trash2, 
  Award, 
  CheckSquare, 
  Filter, 
  AlertCircle,
  TrendingUp,
  UserPlus,
  BookOpen,
  History,
  Users
} from 'lucide-react';
import { 
  LineChart, 
  Line, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer 
} from 'recharts';

const ClassGrid = () => {
  const { class_level } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (user && user.role === 'Student' && user.studentProfile) {
      const studentClass = user.studentProfile.class_level || '';
      if (class_level.toUpperCase() !== studentClass.toUpperCase()) {
        navigate(`/class/${studentClass}`);
      }
    }
  }, [user, class_level, navigate]);
  
  const [students, setStudents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [defaulterFilter, setDefaulterFilter] = useState('All'); // 'All', 'Paid', 'Unpaid'
  const [selectedStudent, setSelectedStudent] = useState(null);

  const detailPanelRef = useRef(null);

  useEffect(() => {
    if (selectedStudent && window.innerWidth < 1024 && detailPanelRef.current) {
      detailPanelRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [selectedStudent]);

  // Modals state
  const [showAddModal, setShowAddModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showTestModal, setShowTestModal] = useState(false);
  const [showAttendanceModal, setShowAttendanceModal] = useState(false);
  const [attendanceDate, setAttendanceDate] = useState(new Date().toISOString().split('T')[0]);
  const [detailedAttendance, setDetailedAttendance] = useState([]);
  const [attendanceViewTab, setAttendanceViewTab] = useState('monthly'); // 'monthly' or 'daily'

  // Forms state
  const [studentForm, setStudentForm] = useState({
    name: '',
    roll_number: '(Auto-ranked)',
    parent_name: '',
    primary_contact: '',
    secondary_contact: '',
    status: 'Active',
    monthly_fee: 0,
    is_free_tier: false
  });
  
  const [testForm, setTestForm] = useState({
    type: 'school', // 'school' or 'tuition'
    subject: '',
    test_name: '',
    marks_obtained: '',
    total_marks: '',
    date: new Date().toISOString().substring(0, 10)
  });

  const [performanceTab, setPerformanceTab] = useState('school'); // 'school' or 'tuition'

  const [subjects, setSubjects] = useState([]);
  const [subjectsList, setSubjectsList] = useState([]);

  // Subject Management State
  const [showSubjectModal, setShowSubjectModal] = useState(false);
  const [newSubjectName, setNewSubjectName] = useState('');
  const [newSubjectChapters, setNewSubjectChapters] = useState('4');
  const [subjectError, setSubjectError] = useState('');
  const [subjectSuccess, setSubjectSuccess] = useState('');
  const [addingSubject, setAddingSubject] = useState(false);
  const [savingSubjectId, setSavingSubjectId] = useState(null);
  const [savedSubjectId, setSavedSubjectId] = useState(null);

  const fetchClassSubjects = async () => {
    try {
      const res = await axios.get(`/api/subjects?class_level=${class_level}`);
      if (res.data.success && Array.isArray(res.data.data)) {
        const subjectNames = res.data.data.map(s => s.name);
        setSubjects(subjectNames);
        setSubjectsList(res.data.data);
        if (subjectNames.length > 0 && !subjectNames.includes(testForm.subject)) {
          setTestForm(prev => ({ ...prev, subject: subjectNames[0] }));
        }
      }
    } catch (err) {
      console.error('Failed to load subjects:', err);
    }
  };

  useEffect(() => {
    fetchClassSubjects();
  }, [class_level]);

  const handleAddSubject = async (e) => {
    e.preventDefault();
    setSubjectError('');
    setSubjectSuccess('');
    if (!newSubjectName.trim()) return;

    setAddingSubject(true);
    try {
      const res = await axios.post('/api/subjects', {
        name: newSubjectName.trim(),
        class_level,
        total_chapters: parseInt(newSubjectChapters, 10) || 4
      });
      if (res.data.success) {
        setSubjectSuccess(`Subject '${newSubjectName.trim()}' added successfully!`);
        setNewSubjectName('');
        setNewSubjectChapters('4');
        await fetchClassSubjects();
      }
    } catch (err) {
      setSubjectError(err.response?.data?.message || 'Failed to add subject');
    } finally {
      setAddingSubject(false);
    }
  };

  const handleDeleteSubject = async (subjectId, subjectName) => {
    setSubjectError('');
    setSubjectSuccess('');
    if (!window.confirm(`Are you sure you want to delete subject '${subjectName}'?`)) {
      return;
    }

    try {
      const res = await axios.delete(`/api/subjects/${subjectId}`);
      if (res.data.success) {
        setSubjectSuccess(`Subject '${subjectName}' deleted successfully.`);
        await fetchClassSubjects();
      }
    } catch (err) {
      setSubjectError(err.response?.data?.message || 'Failed to delete subject');
    }
  };

  const [bulkAttendanceList, setBulkAttendanceList] = useState([]);
  const [masterAttendanceChecked, setMasterAttendanceChecked] = useState(true);

  const [submitError, setSubmitError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Fetch student listings for this class level
  const fetchStudents = async () => {
    setLoading(true);
    try {
      // Students request
      const res = await axios.get(`/api/students?class_level=${class_level}&limit=1000`);
      if (res.data.success) {
        setStudents(res.data.data);
        if (user && user.role === 'Student' && res.data.data.length > 0) {
          const selfStudent = res.data.data.find(s => s._id === (user.studentProfile?._id || user.studentProfile));
          setSelectedStudent(selfStudent || res.data.data[0]);
        }
      }
    } catch (err) {
      console.error('Failed to load class students:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStudents();
    setSelectedStudent(null);
  }, [class_level]);

  useEffect(() => {
    const fetchDetailedAttendance = async () => {
      if (!selectedStudent?._id) {
        setDetailedAttendance([]);
        return;
      }
      const isStudent = user?.role === 'Student';
      const isSelf = isStudent && (user.studentProfile?._id || user.studentProfile) === selectedStudent._id;
      if (isStudent && !isSelf) {
        setDetailedAttendance([]);
        return;
      }
      try {
        const res = await axios.get(`/api/students/${selectedStudent._id}/attendance`);
        if (res.data.success) {
          setDetailedAttendance(res.data.data);
        }
      } catch (err) {
        console.error('Failed to fetch student detailed attendance:', err);
      }
    };
    fetchDetailedAttendance();
  }, [selectedStudent, user]);

  // Frontend quick-filtering
  const filteredStudents = useMemo(() => {
    return students.filter(student => {
      const matchesSearch = 
        student.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        student.roll_number.includes(searchQuery);

      const matchesFees = 
        defaulterFilter === 'All' || 
        (defaulterFilter === 'Paid' && (student.fee_status === 'Paid' || student.is_free_tier)) ||
        (defaulterFilter === 'Unpaid' && !student.is_free_tier && (student.fee_status === 'Unpaid' || student.fee_status === 'Partial/Pending'));

      return matchesSearch && matchesFees;
    });
  }, [students, searchQuery, defaulterFilter]);

  // Handle forms
  const handleStudentFormChange = (e) => {
    const { name, value, type, checked } = e.target;
    setStudentForm(prev => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : value
    }));
  };

  const handleTestFormChange = (e) => {
    setTestForm({ ...testForm, [e.target.name]: e.target.value });
  };

  // Create Student
  const handleAddStudent = async (e) => {
    e.preventDefault();
    setSubmitError('');
    setSubmitting(true);
    try {
      const payload = { ...studentForm, class_level };
      const res = await axios.post('/api/students', payload);
      if (res.data.success) {
        setShowAddModal(false);
        setStudentForm({
          name: '',
          roll_number: '(Auto-ranked)',
          parent_name: '',
          primary_contact: '',
          secondary_contact: '',
          status: 'Active',
          monthly_fee: 0,
          is_free_tier: false
        });
        fetchStudents();
      }
    } catch (err) {
      setSubmitError(err.response?.data?.message || 'Failed to create student profile');
    } finally {
      setSubmitting(false);
    }
  };

  // Open Edit Student Modal
  const openEditModal = (student) => {
    setStudentForm({
      name: student.name,
      roll_number: student.roll_number,
      parent_name: student.parent_name,
      primary_contact: student.primary_contact,
      secondary_contact: student.secondary_contact,
      status: student.status,
      monthly_fee: student.is_free_tier ? 0 : (student.monthly_fee !== undefined ? student.monthly_fee : 0),
      is_free_tier: Boolean(student.is_free_tier)
    });
    setSelectedStudent(student);
    setShowEditModal(true);
  };

  // Submit Edit Student
  const handleEditStudent = async (e) => {
    e.preventDefault();
    setSubmitError('');
    setSubmitting(true);
    try {
      const res = await axios.put(`/api/students/${selectedStudent._id}`, studentForm);
      if (res.data.success) {
        setShowEditModal(false);
        fetchStudents();
      }
    } catch (err) {
      setSubmitError(err.response?.data?.message || 'Failed to update student profile');
    } finally {
      setSubmitting(false);
    }
  };

  // Delete Student
  const handleDeleteStudent = async (studentId) => {
    if (window.confirm('Are you absolutely sure you want to delete this student profile and all their tuition data?')) {
      try {
        const res = await axios.delete(`/api/students/${studentId}`);
        if (res.data.success) {
          fetchStudents();
          if (selectedStudent?._id === studentId) setSelectedStudent(null);
        }
      } catch (err) {
        alert(err.response?.data?.message || 'Failed to delete student');
      }
    }
  };

  // Open Add Test Marks Modal
  const openTestModal = (student) => {
    setSelectedStudent(student);
    setTestForm({
      type: 'school',
      subject: subjects[0] || '',
      test_name: '',
      marks_obtained: '',
      total_marks: '',
      date: new Date().toISOString().substring(0, 10)
    });
    setShowTestModal(true);
  };

  // Inject Test Score
  const handleAddTestScore = async (e) => {
    e.preventDefault();
    setSubmitError('');
    setSubmitting(true);
    try {
      const endpoint = testForm.type === 'tuition'
        ? `/api/students/${selectedStudent._id}/tuition-test-scores`
        : `/api/students/${selectedStudent._id}/test-scores`;
      const res = await axios.post(endpoint, testForm);
      if (res.data.success) {
        setShowTestModal(false);
        fetchStudents();
        // Refresh selected student details
        const detailsRes = await axios.get(`/api/students/${selectedStudent._id}`);
        setSelectedStudent(detailsRes.data.data);
      }
    } catch (err) {
      setSubmitError(err.response?.data?.message || 'Failed to add test score');
    } finally {
      setSubmitting(false);
    }
  };

  // Fetch Saved Attendance for a Date
  const fetchAttendanceForDate = async (targetDate) => {
    try {
      const res = await axios.get(`/api/students/attendance/bulk?class_level=${class_level}&date=${targetDate}`);
      const activeStudents = students.filter(s => s.status === 'Active');
      if (res.data.success) {
        if (res.data.exists) {
          const savedRecordsMap = {};
          res.data.records.forEach(r => {
            savedRecordsMap[r.student_id] = r.attended;
          });

          const list = activeStudents.map(s => ({
            student_id: s._id,
            name: s.name,
            roll_number: s.roll_number,
            attended: savedRecordsMap[s._id] !== undefined ? savedRecordsMap[s._id] : true
          }));
          setBulkAttendanceList(list);
          setMasterAttendanceChecked(list.every(item => item.attended));
        } else {
          // Default all to checked/present
          const list = activeStudents.map(s => ({
            student_id: s._id,
            name: s.name,
            roll_number: s.roll_number,
            attended: true
          }));
          setBulkAttendanceList(list);
          setMasterAttendanceChecked(true);
        }
      }
    } catch (err) {
      console.error('Failed to fetch saved attendance:', err);
    }
  };

  const handleAttendanceDateChange = (newDate) => {
    setAttendanceDate(newDate);
    fetchAttendanceForDate(newDate);
  };

  // Open Bulk Attendance Sheet
  const openAttendanceModal = () => {
    const todayStr = new Date().toISOString().split('T')[0];
    setAttendanceDate(todayStr);
    fetchAttendanceForDate(todayStr);
    setShowAttendanceModal(true);
  };

  // Toggle master checkbox in Attendance Sheet
  const toggleMasterAttendance = () => {
    const newState = !masterAttendanceChecked;
    setMasterAttendanceChecked(newState);
    setBulkAttendanceList(bulkAttendanceList.map(item => ({ ...item, attended: newState })));
  };

  // Toggle single attendance checkbox
  const toggleSingleAttendance = (index) => {
    const list = [...bulkAttendanceList];
    list[index].attended = !list[index].attended;
    setBulkAttendanceList(list);

    // Update master status check
    const allChecked = list.every(item => item.attended);
    setMasterAttendanceChecked(allChecked);
  };

  // Save Bulk Attendance
  const submitBulkAttendance = async () => {
    setSubmitting(true);
    try {
      const payload = {
        class_level,
        date: attendanceDate,
        attendance_list: bulkAttendanceList.map(item => ({
          student_id: item.student_id,
          attended: item.attended
        }))
      };
      const res = await axios.post('/api/students/attendance/bulk', payload);
      if (res.data.success) {
        setShowAttendanceModal(false);
        fetchStudents();
      }
    } catch (err) {
      alert(err.response?.data?.message || 'Failed to log daily attendance');
    } finally {
      setSubmitting(false);
    }
  };

  // Prepare chart data for selected student performance curve
  const selectedStudentScores = performanceTab === 'school'
    ? (selectedStudent?.test_scores || [])
    : (selectedStudent?.tuition_test_scores || []);
  const performanceChartData = selectedStudentScores.map(score => ({
    name: score.test_name,
    percentage: Math.round((score.marks_obtained / score.total_marks) * 100),
    subject: score.subject
  })).slice(-8);

  const getAttendanceRate = (student) => {
    const currentMonthStr = new Date().toISOString().substring(0, 7);
    const history = student.attendance_history?.find(h => h.month === currentMonthStr);
    if (!history || history.total_classes === 0) return 100;
    return Math.round((history.attended / history.total_classes) * 100);
  };

  if (user && user.role === 'Student') {
    return (
      <div className="space-y-6">
        {/* Header */}
        <div className="glass-panel p-4 sm:p-6 rounded-2xl border border-dark-800 flex flex-col md:flex-row md:items-center justify-between gap-4 relative overflow-hidden animate-fadeIn">
          <div className="absolute top-0 right-0 p-8 opacity-10 pointer-events-none">
            <BookOpen size={120} className="text-primary-500" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-white font-outfit">Class {class_level} - My Class</h1>
            <p className="text-slate-400 text-sm mt-1 font-medium">Explore classmate profiles and view your own records and academic trackers.</p>
          </div>
          <span className="px-3 py-1.5 rounded-xl bg-primary-950/40 border border-primary-800/30 text-xs font-semibold text-primary-400 w-fit animate-scaleUp">
            Class Level: {class_level}
          </span>
        </div>

        {/* Grid: Left Column (Classmate Roster List) / Right Column (Selected Profile Details) */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
          {/* Left Column - Students Roster */}
          <div className="lg:col-span-1 space-y-4">
            <div className="glass-panel p-4 rounded-xl border border-dark-800">
              <div className="relative w-full">
                <span className="absolute inset-y-0 left-0 pl-3 flex items-center text-slate-500 pointer-events-none">
                  <Search size={16} />
                </span>
                <input
                  type="text"
                  placeholder="Search classmate..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-9 pr-4 py-2.5 rounded-lg bg-dark-900 border border-dark-850 text-white placeholder-slate-500 outline-none text-xs focus:border-primary-500"
                />
              </div>
            </div>

            {/* Classmate List Card */}
            <div className="glass-panel rounded-2xl border border-dark-800 overflow-hidden shadow-2xl">
              <div className="max-h-[600px] overflow-y-auto">
                {loading ? (
                  <div className="text-center py-12">
                    <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-primary-500 mx-auto"></div>
                  </div>
                ) : filteredStudents.length === 0 ? (
                  <div className="text-center py-12 text-slate-500 text-sm">
                    No classmates found.
                  </div>
                ) : (
                  <div className="divide-y divide-dark-800/40">
                    {filteredStudents.map((student) => {
                      const isSelf = (user.studentProfile?._id || user.studentProfile) === student._id;
                      return (
                        <div
                          key={student._id}
                          onClick={() => setSelectedStudent(student)}
                          className={`p-4 cursor-pointer transition duration-155 flex items-center justify-between hover:bg-dark-900/30 ${
                            selectedStudent?._id === student._id 
                              ? 'bg-primary-600/10 border-l-4 border-l-primary-500' 
                              : ''
                          }`}
                        >
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-primary-600 to-indigo-400 flex items-center justify-center font-bold text-white text-xs">
                              {student.name[0].toUpperCase()}
                            </div>
                            <div>
                              <div className="font-semibold text-white text-xs flex items-center gap-1.5">
                                <span>{student.name}</span>
                                {isSelf && (
                                  <span className="px-1.5 py-0.5 rounded bg-primary-500/20 text-[9px] font-bold text-primary-400 border border-primary-500/30">
                                    Me
                                  </span>
                                )}
                              </div>
                              <span className="text-[10px] text-slate-500 font-mono block mt-0.5">
                                Roll No: {student.roll_number}
                              </span>
                            </div>
                          </div>
                          <span className={`px-2 py-0.5 rounded text-[9px] font-bold uppercase ${
                            student.status === 'Active' 
                              ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' 
                              : 'bg-rose-500/10 text-rose-400 border border-rose-500/20'
                          }`}>
                            {student.status}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Right Column - Detail Panel */}
          <div className="lg:col-span-2 space-y-6">
            {selectedStudent ? (
              <div className="glass-panel p-4 sm:p-6 rounded-2xl border border-dark-800 space-y-6 relative overflow-hidden animate-fadeIn">
                <div className="absolute -top-20 -right-20 w-40 h-40 rounded-full bg-primary-600/5 blur-[50px]" />
                
                {/* Header Profile details */}
                <div className="flex items-center gap-4">
                  <div className="w-14 h-14 rounded-xl bg-gradient-to-tr from-primary-600 to-indigo-400 flex items-center justify-center font-bold text-white text-xl shadow">
                    {selectedStudent.name[0].toUpperCase()}
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h2 className="text-lg font-bold text-white font-outfit">{selectedStudent.name}</h2>
                      {((user.studentProfile?._id || user.studentProfile) === selectedStudent._id) && (
                        <span className="px-2 py-0.5 rounded bg-primary-500/20 text-[10px] font-extrabold text-primary-400 border border-primary-500/35">
                          My Profile
                        </span>
                      )}
                    </div>
                    <p className="text-slate-400 text-xs mt-0.5">Roll No: {selectedStudent.roll_number} • Class {selectedStudent.class_level}</p>
                  </div>
                </div>

                {/* Status & Contact Details */}
                {((user.studentProfile?._id || user.studentProfile) === selectedStudent._id) ? (
                  // Full detailed view for the logged-in student themselves
                  <>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-4 rounded-xl bg-dark-900/60 border border-dark-900/80 text-xs">
                      <div className="flex justify-between md:col-span-2 pb-2 border-b border-dark-800/60">
                        <span className="text-slate-500">Academic Standing</span>
                        <span className="font-semibold text-emerald-400">{selectedStudent.status}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-500">Parent / Guardian</span>
                        <span className="font-semibold text-white">{selectedStudent.parent_name}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-500">Contact Number</span>
                        <span className="font-mono text-white">{selectedStudent.primary_contact}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-500">Secondary Emergency</span>
                        <span className="font-mono text-slate-300">{selectedStudent.secondary_contact}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-500">Joining Date</span>
                        <span className="text-slate-300">{new Date(selectedStudent.joining_date).toLocaleDateString()}</span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-slate-500">Monthly Tuition Fee</span>
                        {selectedStudent.is_free_tier ? (
                          <span className="font-semibold text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded text-[11px] border border-emerald-500/20">Free Tier (₹0)</span>
                        ) : (
                          <span className="font-mono text-white">₹{(selectedStudent.monthly_fee || 0).toLocaleString()}</span>
                        )}
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-slate-500">Fee Payment Status</span>
                        {selectedStudent.is_free_tier ? (
                          <span className="px-2 py-0.5 rounded text-[10px] font-extrabold uppercase bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                            Exempt (Free Tier)
                          </span>
                        ) : (
                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                            selectedStudent.fee_status === 'Paid' 
                              ? 'bg-emerald-500/15 text-emerald-400' 
                              : selectedStudent.fee_status === 'Partial/Pending' 
                                ? 'bg-amber-500/15 text-amber-400' 
                                : 'bg-rose-500/15 text-rose-400'
                          }`}>
                            {selectedStudent.fee_status}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Performance curve chart */}
                    <div className="pt-4 border-t border-dark-800/60 space-y-3">
                      <div className="flex justify-between items-center">
                        <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                          <TrendingUp size={14} className="text-primary-500" />
                          <span>Academic Performance</span>
                        </h3>
                        <div className="flex gap-1 bg-dark-950 p-0.5 rounded-lg border border-dark-850">
                          <button
                            type="button"
                            onClick={() => setPerformanceTab('school')}
                            className={`px-2 py-0.5 rounded text-[10px] font-bold transition ${
                              performanceTab === 'school'
                                ? 'bg-primary-600 text-white'
                                : 'text-slate-500 hover:text-slate-350'
                            }`}
                          >
                            School
                          </button>
                          <button
                            type="button"
                            onClick={() => setPerformanceTab('tuition')}
                            className={`px-2 py-0.5 rounded text-[10px] font-bold transition ${
                              performanceTab === 'tuition'
                                ? 'bg-primary-600 text-white'
                                : 'text-slate-500 hover:text-slate-350'
                            }`}
                          >
                            Tuition
                          </button>
                        </div>
                      </div>

                      {selectedStudentScores.length > 0 ? (
                        <div className="h-48 bg-dark-900/30 rounded-xl border border-dark-850 p-2">
                          <ResponsiveContainer width="100%" height="100%">
                            <LineChart data={performanceChartData}>
                              <CartesianGrid strokeDasharray="3 3" stroke="#2e3155" />
                              <XAxis dataKey="name" fontSize={8} stroke="#64748b" />
                              <YAxis domain={[0, 100]} fontSize={8} stroke="#64748b" />
                              <Tooltip contentStyle={{ fontSize: '10px', backgroundColor: '#1b1c31', borderRadius: '8px' }} />
                              <Line type="monotone" dataKey="percentage" stroke={performanceTab === 'tuition' ? '#10b981' : '#6366f1'} strokeWidth={2} dot={{ r: 3 }} />
                            </LineChart>
                          </ResponsiveContainer>
                        </div>
                      ) : (
                        <div className="p-4 rounded-xl border border-dashed border-dark-850 text-center text-slate-500 text-xs">
                          No {performanceTab} exam scores logged for performance charting.
                        </div>
                      )}
                    </div>

                    {/* Attendance Tracker */}
                    <div className="pt-4 border-t border-dark-800/60">
                      <div className="flex justify-between items-center mb-3">
                        <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400">Attendance Tracker</h3>
                        <div className="flex gap-1 bg-dark-950 p-0.5 rounded-lg border border-dark-850">
                          <button
                            type="button"
                            onClick={() => setAttendanceViewTab('monthly')}
                            className={`px-2 py-0.5 rounded text-[10px] font-bold transition ${
                              attendanceViewTab === 'monthly'
                                ? 'bg-primary-600 text-white'
                                : 'text-slate-550 hover:text-slate-350'
                            }`}
                          >
                            Monthly
                          </button>
                          <button
                            type="button"
                            onClick={() => setAttendanceViewTab('daily')}
                            className={`px-2 py-0.5 rounded text-[10px] font-bold transition ${
                              attendanceViewTab === 'daily'
                                ? 'bg-primary-600 text-white'
                                : 'text-slate-550 hover:text-slate-350'
                            }`}
                          >
                            Daily Logs
                          </button>
                        </div>
                      </div>

                      {attendanceViewTab === 'monthly' ? (
                        <div className="space-y-2 max-h-36 overflow-y-auto pr-1">
                          {selectedStudent.attendance_history?.length > 0 ? (
                            selectedStudent.attendance_history.map((h, i) => {
                              const rate = h.total_classes > 0 ? Math.round((h.attended / h.total_classes) * 100) : 0;
                              return (
                                <div key={i} className="flex justify-between items-center p-2 rounded-lg bg-dark-905 border border-dark-900 font-mono">
                                  <span className="text-xs text-slate-350 font-bold">{h.month}</span>
                                  <div className="flex items-center gap-3">
                                    <span className="text-[10px] text-slate-500">{h.attended} / {h.total_classes} classes</span>
                                    <span className={`text-xs font-bold ${rate >= 75 ? 'text-emerald-400' : rate >= 50 ? 'text-amber-400' : 'text-rose-400'}`}>{rate}%</span>
                                  </div>
                                </div>
                              );
                            })
                          ) : (
                            <div className="text-center py-6 text-slate-500 text-xs border border-dashed border-dark-850 rounded-xl">No attendance summaries.</div>
                          )}
                        </div>
                      ) : (
                        <div className="space-y-2 max-h-36 overflow-y-auto pr-1">
                          {detailedAttendance.length > 0 ? (
                            detailedAttendance.map((log, i) => (
                              <div key={i} className="flex justify-between items-center p-2 rounded-lg bg-dark-900 border border-dark-900 font-mono">
                                <span className="text-xs text-slate-300 font-bold">
                                  {new Date(log.date).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}
                                </span>
                                <span className={`text-[10px] font-extrabold px-2 py-0.5 rounded ${
                                  log.status === 'Present'
                                    ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                                    : 'bg-rose-500/10 text-rose-400 border border-rose-500/20'
                                }`}>
                                  {log.status}
                                </span>
                              </div>
                            ))
                          ) : (
                            <div className="text-center py-6 text-slate-500 text-xs border border-dashed border-dark-850 rounded-xl">No daily logs found.</div>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Academic Session History */}
                    {selectedStudent.academic_history?.length > 0 && (
                      <div className="pt-4 border-t border-dark-800/60 space-y-3 animate-fadeIn">
                        <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-405 flex items-center gap-1.5 font-outfit">
                          <History size={14} className="text-primary-500" />
                          <span>Session Archives (Academic History)</span>
                        </h3>
                        <div className="space-y-2.5 max-h-48 overflow-y-auto pr-1">
                          {selectedStudent.academic_history.map((record, index) => {
                            const totalScores = record.test_scores || [];
                            const avgScore = totalScores.length > 0 
                              ? Math.round(totalScores.reduce((sum, s) => sum + (s.marks_obtained / s.total_marks * 100), 0) / totalScores.length)
                              : null;

                            let totalClasses = 0;
                            let attended = 0;
                            if (record.attendance_history && record.attendance_history.length > 0) {
                              record.attendance_history.forEach(att => {
                                totalClasses += att.total_classes;
                                attended += att.attended;
                              });
                            }
                            const attendanceRate = totalClasses > 0 ? Math.round((attended / totalClasses) * 100) : null;

                            return (
                              <div key={index} className="p-3 rounded-xl bg-dark-900 border border-dark-850 space-y-2 text-xs hover:border-dark-750 transition duration-150">
                                <div className="flex justify-between items-center border-b border-dark-800 pb-1.5">
                                  <span className="font-bold text-white">Class {record.class_level} ({record.academic_year})</span>
                                  <span className={`px-2 py-0.5 rounded text-[9px] font-extrabold ${
                                    record.promotion_status === 'Promoted' || record.promotion_status === 'Graduated'
                                      ? 'bg-emerald-500/10 text-emerald-450 border border-emerald-500/20'
                                      : 'bg-amber-500/10 text-amber-450 border border-amber-500/20'
                                  }`}>
                                    {record.promotion_status}
                                  </span>
                                </div>
                                <div className="grid grid-cols-3 gap-2 text-[10px] text-slate-400">
                                  <div>
                                    <span className="text-slate-500 block">Roll Number</span>
                                    <span className="font-bold text-slate-200">{record.roll_number}</span>
                                  </div>
                                  <div>
                                    <span className="text-slate-500 block">Avg Exam Score</span>
                                    <span className="font-bold text-slate-200">{avgScore !== null ? `${avgScore}%` : 'N/A'}</span>
                                  </div>
                                  <div>
                                    <span className="text-slate-500 block">Attendance Rate</span>
                                    <span className={`font-bold ${attendanceRate !== null ? (attendanceRate >= 75 ? 'text-emerald-400' : 'text-amber-400') : 'text-slate-250'}`}>
                                      {attendanceRate !== null ? `${attendanceRate}%` : 'N/A'}
                                    </span>
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </>
                ) : (
                  // Redacted view for classmates
                  <>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-4 rounded-xl bg-dark-900/60 border border-dark-900/80 text-xs animate-fadeIn">
                      <div className="flex justify-between md:col-span-2 pb-2 border-b border-dark-800/60">
                        <span className="text-slate-500">Academic Standing</span>
                        <span className="font-semibold text-emerald-400">{selectedStudent.status}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-500">Parent / Guardian</span>
                        <span className="font-semibold text-slate-500">Restricted</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-500">Contact Number</span>
                        <span className="font-semibold text-slate-500">Restricted</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-500">Joining Date</span>
                        <span className="text-slate-300">{new Date(selectedStudent.joining_date).toLocaleDateString()}</span>
                      </div>
                    </div>

                    <div className="p-5 rounded-2xl border border-dashed border-dark-800 bg-dark-950/20 text-center space-y-2 animate-scaleUp">
                      <AlertCircle className="mx-auto text-slate-500" size={24} />
                      <h4 className="text-xs font-semibold text-slate-400">Classmate Privacy Shield Enabled</h4>
                      <p className="text-[11px] text-slate-500 leading-relaxed max-w-sm mx-auto">
                        For student privacy, detailed test scores, contact details, parental details, and payment histories are only viewable by teachers, administrators, and the students themselves.
                      </p>
                    </div>
                  </>
                )}
              </div>
            ) : (
              <div className="glass-panel p-8 rounded-2xl border border-dark-800 text-center py-20 text-slate-500 text-sm">
                <AlertCircle className="mx-auto text-dark-800 mb-3" size={36} />
                <span>Select a classmate to view their profile</span>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header Panel - Redesigned to match premium page header standard */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-primary-900/40 via-dark-900/30 to-indigo-900/20 border border-dark-800/80 p-6 sm:p-8 shadow-xl flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div className="absolute top-0 right-0 p-8 opacity-10 pointer-events-none">
          <Users size={160} className="text-primary-500" />
        </div>
        <div className="relative z-10 space-y-2">
          <span className="px-2.5 py-1 rounded-md text-[10px] font-extrabold uppercase tracking-widest bg-primary-500/10 text-primary-400 border border-primary-500/20">
            Class Dashboard
          </span>
          <h1 className="text-3xl font-extrabold tracking-tight text-white font-outfit mt-1">Class {class_level} Roster & Logs</h1>
          <p className="text-slate-405 text-xs sm:text-sm max-w-2xl">
            Manage student academic profiles, record daily attendance compliance metrics, update grading matrices, and allocate handouts.
          </p>
        </div>
        
        {user.role !== 'Student' && (
          <div className="relative z-10 flex items-center gap-3 shrink-0 self-start md:self-center flex-wrap">
            <button 
              onClick={() => {
                setSubjectError('');
                setSubjectSuccess('');
                setShowSubjectModal(true);
              }}
              className="flex items-center gap-2 px-3.5 py-2.5 rounded-xl bg-dark-900 border border-dark-800 text-slate-350 hover:text-white hover:bg-dark-805 transition font-bold text-[10px] uppercase tracking-wider shadow-inner"
            >
              <BookOpen size={14} className="text-primary-500" />
              <span>Subjects</span>
            </button>

            <button 
              onClick={openAttendanceModal}
              className="flex items-center gap-2 px-3.5 py-2.5 rounded-xl bg-dark-900 border border-dark-800 text-slate-350 hover:text-white hover:bg-dark-805 transition font-bold text-[10px] uppercase tracking-wider shadow-inner"
            >
              <CheckSquare size={14} className="text-emerald-500" />
              <span>Bulk Attendance</span>
            </button>
            
            <button 
              onClick={() => {
                setStudentForm({
                  name: '',
                  roll_number: '(Auto-ranked)',
                  parent_name: '',
                  primary_contact: '',
                  secondary_contact: '',
                  status: 'Active',
                  monthly_fee: 0,
                  is_free_tier: false
                });
                setSubmitError('');
                setShowAddModal(true);
              }}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-primary-600 hover:bg-primary-500 active:bg-primary-750 text-white transition font-bold text-[10px] uppercase tracking-wider shadow-lg shadow-primary-500/10"
            >
              <Plus size={14} />
              <span>Add Student</span>
            </button>
          </div>
        )}
      </div>

      {/* Grid: Left Column (Table List) / Right Column (Detail Panel) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
        {/* Left Column - Students Roster */}
        <div className="lg:col-span-2 space-y-4">
          <div className="glass-panel p-4 rounded-xl border border-dark-800 flex flex-col md:flex-row gap-4 items-center justify-between">
            {/* Search Input */}
            <div className="relative w-full md:w-72">
              <span className="absolute inset-y-0 left-0 pl-3 flex items-center text-slate-500 pointer-events-none">
                <Search size={16} />
              </span>
              <input
                type="text"
                placeholder="Search Roll, Name..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-4 py-2 rounded-lg bg-dark-900 border border-dark-850 text-white placeholder-slate-500 outline-none text-xs focus:border-primary-500"
              />
            </div>

            {/* Filter Buttons */}
            <div className="flex items-center gap-2 w-full md:w-auto">
              <Filter size={14} className="text-slate-500 hidden md:inline" />
              <div className="grid grid-cols-3 gap-1 bg-dark-900 p-1 rounded-lg border border-dark-850 w-full md:w-auto">
                {['All', 'Paid', 'Unpaid'].map((f) => (
                  <button
                    key={f}
                    onClick={() => setDefaulterFilter(f)}
                    className={`px-3 py-1 text-[10px] uppercase font-bold tracking-wider rounded-md transition ${
                      defaulterFilter === f 
                        ? 'bg-primary-600 text-white' 
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {f === 'Unpaid' ? 'Defaulters' : f}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Student Roster Table Card */}
          <div className="glass-panel rounded-2xl border border-dark-800 overflow-hidden shadow-2xl">
            <div className="overflow-x-auto">
              {loading ? (
                <div className="text-center py-20">
                  <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-primary-500 mx-auto"></div>
                </div>
              ) : filteredStudents.length === 0 ? (
                <div className="text-center py-20 text-slate-500 text-sm">
                  No students found matching filters.
                </div>
              ) : (
                <table className="w-full text-left border-collapse text-xs select-none">
                  <thead>
                    <tr className="border-b border-dark-800 bg-dark-950/60 text-slate-450 uppercase tracking-wider font-bold font-mono">
                      <th className="py-3.5 px-4 rounded-tl-xl text-center w-24">Rank (Roll)</th>
                      <th className="py-3.5 px-4">Student Name</th>
                      <th className="py-3.5 px-4">Fee Status</th>
                      <th className="py-3.5 px-4 text-center hidden sm:table-cell">Attendance Rate</th>
                      <th className="py-3.5 px-4 hidden md:table-cell">Primary Phone</th>
                      {user.role !== 'Student' && <th className="py-3.5 px-4 text-right rounded-tr-xl">Actions</th>}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-dark-800/50">
                    {filteredStudents.map((student) => {
                      const attRate = getAttendanceRate(student);
                      const attColor = attRate >= 75 
                        ? 'text-emerald-400 bg-emerald-500/10' 
                        : attRate >= 50 
                          ? 'text-amber-400 bg-amber-500/10' 
                          : 'text-rose-400 bg-rose-500/10';

                      return (
                        <tr 
                          key={student._id}
                          onClick={() => setSelectedStudent(student)}
                          className={`group cursor-pointer transition-all duration-150 hover:bg-dark-900/40 ${selectedStudent?._id === student._id ? 'bg-primary-600/5 border-l-2 border-l-primary-500' : ''}`}
                        >
                          <td className="py-4 px-4 font-mono font-bold text-slate-350 text-center group-hover:text-white transition">
                            <div className="flex items-center justify-center gap-1.5">
                              <span className="w-6 text-right">{student.roll_number}</span>
                              {student.roll_number === '01' ? (
                                <span className="text-amber-400 text-sm select-none" title="Top Ranked Progress">👑</span>
                              ) : (
                                <span className="w-5" />
                              )}
                            </div>
                          </td>
                          <td className="py-4 px-4">
                            <div className="font-semibold text-white group-hover:text-primary-400 transition">{student.name}</div>
                            <span className="text-[10px] text-slate-500 block mt-0.5">{student.parent_name} (Parent)</span>
                          </td>
                          <td className="py-4 px-4">
                            {student.is_free_tier ? (
                              <span className="px-2 py-0.5 rounded text-[10px] font-extrabold uppercase tracking-wide bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                                Free Tier
                              </span>
                            ) : (
                              <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                student.fee_status === 'Paid' 
                                  ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/20' 
                                  : student.fee_status === 'Partial/Pending' 
                                    ? 'bg-amber-500/15 text-amber-400 border border-amber-500/20' 
                                    : 'bg-rose-500/15 text-rose-400 border border-rose-500/20'
                              }`}>
                                {student.fee_status}
                              </span>
                            )}
                          </td>
                          <td className="py-4 px-4 text-center hidden sm:table-cell">
                            <span className={`px-2 py-0.5 rounded text-xs font-bold ${attColor}`}>
                              {attRate}%
                            </span>
                          </td>
                          <td className="py-4 px-4 text-slate-300 font-mono text-xs hidden md:table-cell">{student.primary_contact}</td>
                          
                          {user.role !== 'Student' && (
                            <td className="py-4 px-4 text-right" onClick={(e) => e.stopPropagation()}>
                              <div className="flex justify-end gap-1.5">
                                <button 
                                  onClick={() => openTestModal(student)}
                                  title="Log exam marks"
                                  className="p-1.5 rounded-lg bg-dark-900 border border-dark-850 text-indigo-400 hover:bg-indigo-600/10 hover:text-white transition"
                                >
                                  <Award size={14} />
                                </button>
                                <button 
                                  onClick={() => openEditModal(student)}
                                  title="Edit profile"
                                  className="p-1.5 rounded-lg bg-dark-900 border border-dark-850 text-sky-400 hover:bg-sky-600/10 hover:text-white transition"
                                >
                                  <Edit size={14} />
                                </button>
                                <button 
                                  onClick={() => handleDeleteStudent(student._id)}
                                  title="Delete student"
                                  className="p-1.5 rounded-lg bg-dark-900 border border-dark-850 text-rose-400 hover:bg-rose-600/10 hover:text-white transition"
                                >
                                  <Trash2 size={14} />
                                </button>
                              </div>
                            </td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>

        {/* Right Column - Detail Panel */}
        <div className="space-y-6" ref={detailPanelRef}>
          {selectedStudent ? (
            <div className="glass-panel p-4 sm:p-6 rounded-2xl border border-dark-800 space-y-6 relative overflow-hidden">
              {/* Decorative Accent Glow */}
              <div className="absolute -top-20 -right-20 w-40 h-40 rounded-full bg-primary-600/5 blur-[50px]" />
              
              {/* Header Profile details */}
              <div className="flex justify-between items-start">
                <div>
                  <div className="w-12 h-12 rounded-xl bg-gradient-to-tr from-primary-600 to-indigo-400 flex items-center justify-center font-bold text-white text-lg mb-3 shadow">
                    {selectedStudent.name[0].toUpperCase()}
                  </div>
                  <h2 className="text-lg font-bold text-white font-outfit">{selectedStudent.name}</h2>
                  <p className="text-slate-400 text-xs mt-1">Roll No: {selectedStudent.roll_number} • Class {selectedStudent.class_level}</p>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedStudent(null)}
                  className="p-2 rounded-lg bg-dark-900 border border-dark-850 hover:bg-dark-800 text-slate-500 hover:text-white transition lg:hidden"
                  title="Close panel"
                >
                  <X size={16} />
                </button>
              </div>

              {/* Status & Contact Details */}
              <div className="p-4 rounded-xl bg-dark-900/60 border border-dark-900/80 space-y-3 text-xs">
                <div className="flex justify-between">
                  <span className="text-slate-500">Academic Standing</span>
                  <span className="font-semibold text-emerald-400">{selectedStudent.status}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Parent / Guardian</span>
                  <span className="font-semibold text-white">{selectedStudent.parent_name}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Contact Number</span>
                  <span className="font-mono text-white">{selectedStudent.primary_contact}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Secondary Emergency</span>
                  <span className="font-mono text-slate-300">{selectedStudent.secondary_contact}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Joining Date</span>
                  <span className="text-slate-300">{new Date(selectedStudent.joining_date).toLocaleDateString()}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-slate-500">Monthly Tuition Fee</span>
                  {selectedStudent.is_free_tier ? (
                    <span className="font-semibold text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded text-[11px] border border-emerald-500/20">Free Tier (₹0)</span>
                  ) : (
                    <span className="font-mono text-white">₹{(selectedStudent.monthly_fee || 0).toLocaleString()}</span>
                  )}
                </div>
              </div>

              {/* Performance curve chart */}
              <div className="space-y-3">
                <div className="flex justify-between items-center">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                    <TrendingUp size={14} className="text-primary-500" />
                    <span>Academic Performance</span>
                  </h3>
                  <div className="flex gap-1 bg-dark-950 p-0.5 rounded-lg border border-dark-850">
                    <button
                      type="button"
                      onClick={() => setPerformanceTab('school')}
                      className={`px-2 py-0.5 rounded text-[10px] font-bold transition ${
                        performanceTab === 'school'
                          ? 'bg-primary-600 text-white'
                          : 'text-slate-550 hover:text-slate-350'
                      }`}
                    >
                      School
                    </button>
                    <button
                      type="button"
                      onClick={() => setPerformanceTab('tuition')}
                      className={`px-2 py-0.5 rounded text-[10px] font-bold transition ${
                        performanceTab === 'tuition'
                          ? 'bg-primary-600 text-white'
                          : 'text-slate-550 hover:text-slate-350'
                      }`}
                    >
                      Tuition
                    </button>
                  </div>
                </div>

                {selectedStudentScores.length > 0 ? (
                  <div className="h-40 bg-dark-900/30 rounded-xl border border-dark-850 p-2">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={performanceChartData}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#2e3155" />
                        <XAxis dataKey="name" fontSize={8} stroke="#64748b" />
                        <YAxis domain={[0, 100]} fontSize={8} stroke="#64748b" />
                        <Tooltip contentStyle={{ fontSize: '10px', backgroundColor: '#1b1c31', borderRadius: '8px' }} />
                        <Line type="monotone" dataKey="percentage" stroke={performanceTab === 'tuition' ? '#10b981' : '#6366f1'} strokeWidth={2} dot={{ r: 3 }} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                ) : (
                  <div className="p-4 rounded-xl border border-dashed border-dark-850 text-center text-slate-500 text-xs">
                    No {performanceTab} exam scores logged for performance charting.
                  </div>
                )}
              </div>

              {/* Attendance Tracker */}
              <div>
                <div className="flex justify-between items-center mb-3">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400">Attendance Tracker</h3>
                  <div className="flex gap-1 bg-dark-950 p-0.5 rounded-lg border border-dark-850">
                    <button
                      type="button"
                      onClick={() => setAttendanceViewTab('monthly')}
                      className={`px-2 py-0.5 rounded text-[10px] font-bold transition ${
                        attendanceViewTab === 'monthly'
                          ? 'bg-primary-600 text-white'
                          : 'text-slate-500 hover:text-slate-350'
                      }`}
                    >
                      Monthly
                    </button>
                    <button
                      type="button"
                      onClick={() => setAttendanceViewTab('daily')}
                      className={`px-2 py-0.5 rounded text-[10px] font-bold transition ${
                        attendanceViewTab === 'daily'
                          ? 'bg-primary-600 text-white'
                          : 'text-slate-500 hover:text-slate-350'
                      }`}
                    >
                      Daily Logs
                    </button>
                  </div>
                </div>

                {attendanceViewTab === 'monthly' ? (
                  <div className="space-y-2 max-h-32 overflow-y-auto pr-1">
                    {selectedStudent.attendance_history?.length > 0 ? (
                      selectedStudent.attendance_history.map((h, i) => {
                        const rate = h.total_classes > 0 ? Math.round((h.attended / h.total_classes) * 100) : 0;
                        return (
                          <div key={i} className="flex justify-between items-center p-2 rounded-lg bg-dark-905 border border-dark-900 font-mono">
                            <span className="text-xs text-slate-350 font-bold">{h.month}</span>
                            <div className="flex items-center gap-3">
                              <span className="text-[10px] text-slate-500">{h.attended} / {h.total_classes} classes</span>
                              <span className={`text-xs font-bold ${rate >= 75 ? 'text-emerald-400' : rate >= 50 ? 'text-amber-400' : 'text-rose-400'}`}>{rate}%</span>
                            </div>
                          </div>
                        );
                      })
                    ) : (
                      <div className="text-center py-6 text-slate-500 text-xs border border-dashed border-dark-850 rounded-xl">No attendance summaries.</div>
                    )}
                  </div>
                ) : (
                  <div className="space-y-2 max-h-32 overflow-y-auto pr-1">
                    {detailedAttendance.length > 0 ? (
                      detailedAttendance.map((log, i) => (
                        <div key={i} className="flex justify-between items-center p-2 rounded-lg bg-dark-905 border border-dark-900 font-mono">
                          <span className="text-xs text-slate-350 font-bold">
                            {new Date(log.date).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}
                          </span>
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
                      <div className="text-center py-6 text-slate-500 text-xs border border-dashed border-dark-850 rounded-xl">No daily logs found.</div>
                    )}
                  </div>
                )}
              </div>

              {/* Academic Session History */}
              {selectedStudent.academic_history?.length > 0 && (
                <div className="pt-4 border-t border-dark-800/60 space-y-3 animate-fadeIn">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-1.5 font-outfit">
                    <History size={14} className="text-primary-500" />
                    <span>Session Archives (Academic History)</span>
                  </h3>
                  <div className="space-y-2.5 max-h-48 overflow-y-auto pr-1">
                    {selectedStudent.academic_history.map((record, index) => {
                      const totalScores = record.test_scores || [];
                      const avgScore = totalScores.length > 0 
                        ? Math.round(totalScores.reduce((sum, s) => sum + (s.marks_obtained / s.total_marks * 100), 0) / totalScores.length)
                        : null;

                      let totalClasses = 0;
                      let attended = 0;
                      if (record.attendance_history && record.attendance_history.length > 0) {
                        record.attendance_history.forEach(att => {
                          totalClasses += att.total_classes;
                          attended += att.attended;
                        });
                      }
                      const attendanceRate = totalClasses > 0 ? Math.round((attended / totalClasses) * 100) : null;

                      return (
                        <div key={index} className="p-3 rounded-xl bg-dark-900 border border-dark-850 space-y-2 text-xs hover:border-dark-750 transition duration-150">
                          <div className="flex justify-between items-center border-b border-dark-800 pb-1.5">
                            <span className="font-bold text-white">Class {record.class_level} ({record.academic_year})</span>
                            <span className={`px-2 py-0.5 rounded text-[9px] font-extrabold ${
                              record.promotion_status === 'Promoted' || record.promotion_status === 'Graduated'
                                ? 'bg-emerald-500/10 text-emerald-450 border border-emerald-500/20'
                                : 'bg-amber-500/10 text-amber-450 border border-amber-500/20'
                            }`}>
                              {record.promotion_status}
                            </span>
                          </div>
                          <div className="grid grid-cols-3 gap-2 text-[10px] text-slate-400">
                            <div>
                              <span className="text-slate-500 block">Roll Number</span>
                              <span className="font-bold text-slate-200">{record.roll_number}</span>
                            </div>
                            <div>
                              <span className="text-slate-500 block">Avg Exam Score</span>
                              <span className="font-bold text-slate-200">{avgScore !== null ? `${avgScore}%` : 'N/A'}</span>
                            </div>
                            <div>
                              <span className="text-slate-550 block">Attendance Rate</span>
                              <span className={`font-bold ${attendanceRate !== null ? (attendanceRate >= 75 ? 'text-emerald-400' : 'text-amber-400') : 'text-slate-200'}`}>
                                {attendanceRate !== null ? `${attendanceRate}%` : 'N/A'}
                              </span>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="glass-panel p-8 rounded-2xl border border-dark-800 text-center py-24 text-slate-500 text-sm">
              <AlertCircle className="mx-auto text-dark-800 mb-3" size={36} />
              <span>Select a student to display profile metrics and analytics</span>
            </div>
          )}
        </div>
      </div>

      {/* --- ADD STUDENT MODAL --- */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4">
          <div className="glass-panel w-full max-w-lg rounded-2xl border border-dark-800 overflow-hidden shadow-2xl relative animate-scaleUp">
            <div className="p-6 border-b border-dark-800 flex justify-between items-center">
              <h3 className="text-base font-bold text-white font-outfit flex items-center gap-2">
                <UserPlus size={18} className="text-primary-500" />
                <span>Add Student to Class {class_level}</span>
              </h3>
              <button onClick={() => setShowAddModal(false)} className="text-slate-500 hover:text-white transition">
                <X size={20} />
              </button>
            </div>
            
            {submitError && (
              <div className="mx-6 mt-4 p-3 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs">
                {submitError}
              </div>
            )}

            <form onSubmit={handleAddStudent} className="p-6 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-400 mb-1.5">Full Name</label>
                  <input
                    type="text"
                    name="name"
                    required
                    value={studentForm.name}
                    onChange={handleStudentFormChange}
                    className="w-full px-3.5 py-2.5 rounded-lg bg-dark-900 border border-dark-850 text-white text-xs outline-none focus:border-primary-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-400 mb-1.5">Roll Number (Auto-ranked)</label>
                  <input
                    type="text"
                    name="roll_number"
                    required
                    readOnly
                    value={studentForm.roll_number}
                    className="w-full px-3.5 py-2.5 rounded-lg bg-dark-950/40 border border-dark-850 text-slate-400 text-xs cursor-not-allowed outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-400 mb-1.5">Parent / Guardian Name</label>
                <input
                  type="text"
                  name="parent_name"
                  required
                  value={studentForm.parent_name}
                  onChange={handleStudentFormChange}
                  className="w-full px-3.5 py-2.5 rounded-lg bg-dark-900 border border-dark-850 text-white text-xs outline-none focus:border-primary-500"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-400 mb-1.5">Primary Contact</label>
                  <input
                    type="text"
                    name="primary_contact"
                    required
                    placeholder="e.g. +1 555 1234"
                    value={studentForm.primary_contact}
                    onChange={handleStudentFormChange}
                    className="w-full px-3.5 py-2.5 rounded-lg bg-dark-900 border border-dark-850 text-white text-xs outline-none focus:border-primary-500 font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-400 mb-1.5">Emergency Contact</label>
                  <input
                    type="text"
                    name="secondary_contact"
                    required
                    value={studentForm.secondary_contact}
                    onChange={handleStudentFormChange}
                    className="w-full px-3.5 py-2.5 rounded-lg bg-dark-900 border border-dark-850 text-white text-xs outline-none focus:border-primary-500 font-mono"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="block text-xs font-semibold text-slate-400">Monthly Tuition Fee (INR)</label>
                  <label className="flex items-center gap-1.5 cursor-pointer text-xs text-indigo-400 hover:text-indigo-300 select-none">
                    <input
                      type="checkbox"
                      name="is_free_tier"
                      checked={studentForm.is_free_tier || false}
                      onChange={(e) => setStudentForm(prev => ({
                        ...prev,
                        is_free_tier: e.target.checked,
                        monthly_fee: e.target.checked ? 0 : prev.monthly_fee
                      }))}
                      className="w-3.5 h-3.5 rounded border-dark-850 bg-dark-900 text-indigo-600 focus:ring-indigo-500"
                    />
                    <span className="font-semibold">Free Tier Student</span>
                  </label>
                </div>
                <input
                  type="number"
                  name="monthly_fee"
                  required={!studentForm.is_free_tier}
                  disabled={studentForm.is_free_tier}
                  min="0"
                  placeholder={studentForm.is_free_tier ? "Free Tier (₹0)" : "e.g. 2000"}
                  value={studentForm.is_free_tier ? 0 : studentForm.monthly_fee}
                  onChange={handleStudentFormChange}
                  className="w-full px-3.5 py-2.5 rounded-lg bg-dark-900 border border-dark-850 text-white text-xs outline-none focus:border-primary-500 font-mono disabled:opacity-50 disabled:cursor-not-allowed"
                />
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t border-dark-800">
                <button 
                  type="button" 
                  onClick={() => setShowAddModal(false)}
                  className="px-4 py-2 text-xs font-semibold rounded-lg bg-dark-900 border border-dark-850 text-slate-400 hover:text-white transition"
                >
                  Cancel
                </button>
                <button 
                  type="submit"
                  disabled={submitting}
                  className="px-4 py-2 text-xs font-semibold rounded-lg bg-primary-600 hover:bg-primary-500 text-white transition flex items-center gap-1.5"
                >
                  {submitting ? 'Creating...' : 'Register Student'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* --- EDIT STUDENT MODAL --- */}
      {showEditModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4">
          <div className="glass-panel w-full max-w-lg rounded-2xl border border-dark-800 overflow-hidden shadow-2xl relative animate-scaleUp">
            <div className="p-6 border-b border-dark-800 flex justify-between items-center">
              <h3 className="text-base font-bold text-white font-outfit">Edit Student Profile</h3>
              <button onClick={() => setShowEditModal(false)} className="text-slate-500 hover:text-white transition">
                <X size={20} />
              </button>
            </div>

            {submitError && (
              <div className="mx-6 mt-4 p-3 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs">
                {submitError}
              </div>
            )}

            <form onSubmit={handleEditStudent} className="p-6 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-400 mb-1.5">Full Name</label>
                  <input
                    type="text"
                    name="name"
                    required
                    value={studentForm.name}
                    onChange={handleStudentFormChange}
                    className="w-full px-3.5 py-2.5 rounded-lg bg-dark-900 border border-dark-850 text-white text-xs outline-none focus:border-primary-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-400 mb-1.5">Roll Number (Auto-ranked)</label>
                  <input
                    type="text"
                    name="roll_number"
                    required
                    readOnly
                    value={studentForm.roll_number}
                    className="w-full px-3.5 py-2.5 rounded-lg bg-dark-950/40 border border-dark-850 text-slate-400 text-xs cursor-not-allowed outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-400 mb-1.5">Parent / Guardian Name</label>
                <input
                  type="text"
                  name="parent_name"
                  required
                  value={studentForm.parent_name}
                  onChange={handleStudentFormChange}
                  className="w-full px-3.5 py-2.5 rounded-lg bg-dark-900 border border-dark-850 text-white text-xs outline-none focus:border-primary-500"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-400 mb-1.5">Primary Contact</label>
                  <input
                    type="text"
                    name="primary_contact"
                    required
                    value={studentForm.primary_contact}
                    onChange={handleStudentFormChange}
                    className="w-full px-3.5 py-2.5 rounded-lg bg-dark-900 border border-dark-850 text-white text-xs outline-none focus:border-primary-500 font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-400 mb-1.5">Status</label>
                  <select
                    name="status"
                    value={studentForm.status}
                    onChange={handleStudentFormChange}
                    className="w-full px-3.5 py-2.5 rounded-lg bg-dark-900 border border-dark-850 text-white text-xs outline-none focus:border-primary-500"
                  >
                    <option value="Active">Active</option>
                    <option value="Inactive">Inactive</option>
                  </select>
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="block text-xs font-semibold text-slate-400">Monthly Tuition Fee (INR)</label>
                  <label className="flex items-center gap-1.5 cursor-pointer text-xs text-indigo-400 hover:text-indigo-300 select-none">
                    <input
                      type="checkbox"
                      name="is_free_tier"
                      checked={studentForm.is_free_tier || false}
                      onChange={(e) => setStudentForm(prev => ({
                        ...prev,
                        is_free_tier: e.target.checked,
                        monthly_fee: e.target.checked ? 0 : prev.monthly_fee
                      }))}
                      className="w-3.5 h-3.5 rounded border-dark-850 bg-dark-900 text-indigo-600 focus:ring-indigo-500"
                    />
                    <span className="font-semibold">Free Tier Student</span>
                  </label>
                </div>
                <input
                  type="number"
                  name="monthly_fee"
                  required={!studentForm.is_free_tier}
                  disabled={studentForm.is_free_tier}
                  min="0"
                  placeholder={studentForm.is_free_tier ? "Free Tier (₹0)" : "e.g. 2000"}
                  value={studentForm.is_free_tier ? 0 : studentForm.monthly_fee}
                  onChange={handleStudentFormChange}
                  className="w-full px-3.5 py-2.5 rounded-lg bg-dark-900 border border-dark-850 text-white text-xs outline-none focus:border-primary-500 font-mono disabled:opacity-50 disabled:cursor-not-allowed"
                />
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t border-dark-800">
                <button 
                  type="button" 
                  onClick={() => setShowEditModal(false)}
                  className="px-4 py-2 text-xs font-semibold rounded-lg bg-dark-900 border border-dark-850 text-slate-400 hover:text-white transition"
                >
                  Cancel
                </button>
                <button 
                  type="submit"
                  disabled={submitting}
                  className="px-4 py-2 text-xs font-semibold rounded-lg bg-primary-600 hover:bg-primary-500 text-white transition"
                >
                  {submitting ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* --- ADD TEST MARKS MODAL --- */}
      {showTestModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4">
          <div className="glass-panel w-full max-w-md rounded-2xl border border-dark-800 overflow-hidden shadow-2xl relative animate-scaleUp">
            <div className="p-6 border-b border-dark-800 flex justify-between items-center">
              <h3 className="text-base font-bold text-white font-outfit">Log Exam Marks - {selectedStudent?.name}</h3>
              <button onClick={() => setShowTestModal(false)} className="text-slate-500 hover:text-white transition">
                <X size={20} />
              </button>
            </div>

            {submitError && (
              <div className="mx-6 mt-4 p-3 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs">
                {submitError}
              </div>
            )}

            <form onSubmit={handleAddTestScore} className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-400 mb-1.5">Score Category</label>
                <select
                  name="type"
                  value={testForm.type}
                  onChange={handleTestFormChange}
                  className="w-full px-3 py-2.5 rounded-lg bg-dark-900 border border-dark-850 text-white text-xs outline-none focus:border-primary-500"
                >
                  <option value="school">School Exam Score</option>
                  <option value="tuition">Tuition Exam Score</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-400 mb-1.5">Subject Category</label>
                <select
                  name="subject"
                  value={testForm.subject}
                  onChange={handleTestFormChange}
                  className="w-full px-3 py-2.5 rounded-lg bg-dark-900 border border-dark-850 text-white text-xs outline-none focus:border-primary-500"
                >
                  {subjects.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-400 mb-1.5">Test / Exam Name</label>
                <input
                  type="text"
                  name="test_name"
                  required
                  placeholder="e.g. Unit Test 1, Final Term"
                  value={testForm.test_name}
                  onChange={handleTestFormChange}
                  className="w-full px-3.5 py-2.5 rounded-lg bg-dark-900 border border-dark-850 text-white text-xs outline-none focus:border-primary-500"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-400 mb-1.5">Marks Obtained</label>
                  <input
                    type="number"
                    name="marks_obtained"
                    required
                    min="0"
                    value={testForm.marks_obtained}
                    onChange={handleTestFormChange}
                    className="w-full px-3.5 py-2.5 rounded-lg bg-dark-900 border border-dark-850 text-white text-xs outline-none focus:border-primary-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-400 mb-1.5">Maximum Marks</label>
                  <input
                    type="number"
                    name="total_marks"
                    required
                    min="1"
                    value={testForm.total_marks}
                    onChange={handleTestFormChange}
                    className="w-full px-3.5 py-2.5 rounded-lg bg-dark-900 border border-dark-850 text-white text-xs outline-none focus:border-primary-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-400 mb-1.5">Assessment Date</label>
                <input
                  type="date"
                  name="date"
                  value={testForm.date}
                  onChange={handleTestFormChange}
                  className="w-full px-3.5 py-2.5 rounded-lg bg-dark-900 border border-dark-850 text-white text-xs outline-none focus:border-primary-500"
                />
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t border-dark-800">
                <button 
                  type="button" 
                  onClick={() => setShowTestModal(false)}
                  className="px-4 py-2 text-xs font-semibold rounded-lg bg-dark-900 border border-dark-850 text-slate-400 hover:text-white transition"
                >
                  Cancel
                </button>
                <button 
                  type="submit"
                  disabled={submitting}
                  className="px-4 py-2 text-xs font-semibold rounded-lg bg-primary-600 hover:bg-primary-500 text-white transition"
                >
                  {submitting ? 'Logging...' : 'Inject Score'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* --- BULK ATTENDANCE SHEET MODAL --- */}
      {showAttendanceModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4">
          <div className="glass-panel w-full max-w-2xl rounded-2xl border border-dark-800 overflow-hidden shadow-2xl relative animate-scaleUp max-h-[90vh] flex flex-col">
            <div className="p-6 border-b border-dark-800 flex justify-between items-center shrink-0">
              <div>
                <h3 className="text-base font-bold text-white font-outfit">Daily Attendance Matrix - Class {class_level}</h3>
                <p className="text-slate-500 text-xs mt-0.5">Toggle daily presence; logs count in calendar ledger</p>
              </div>
              <button onClick={() => setShowAttendanceModal(false)} className="text-slate-500 hover:text-white transition">
                <X size={20} />
              </button>
            </div>

            {/* Matrix Sheet Roster */}
            <div className="p-6 overflow-y-auto flex-1 space-y-4">
              <div className="flex flex-col sm:flex-row gap-3 justify-between items-start sm:items-center p-3 rounded-xl bg-dark-900 border border-dark-850">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-slate-450">Select Date:</span>
                  <input 
                    type="date"
                    required
                    value={attendanceDate}
                    max={new Date().toISOString().split('T')[0]}
                    onChange={(e) => handleAttendanceDateChange(e.target.value)}
                    className="px-2 py-1 rounded bg-dark-950 border border-dark-800 text-white text-xs outline-none focus:border-primary-500 font-mono"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-slate-450">Check-All Override</span>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input 
                      type="checkbox" 
                      checked={masterAttendanceChecked} 
                      onChange={toggleMasterAttendance}
                      className="sr-only peer"
                    />
                    <div className="w-11 h-6 bg-dark-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-slate-300 after:border-slate-350 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary-600"></div>
                  </label>
                </div>
              </div>

              <div className="border border-dark-850 rounded-xl overflow-hidden bg-dark-905">
                <div className="grid grid-cols-12 bg-dark-900 border-b border-dark-850 p-3 text-xs font-semibold text-slate-400 uppercase tracking-wider">
                  <div className="col-span-2 text-center">Roll</div>
                  <div className="col-span-7">Student Name</div>
                  <div className="col-span-3 text-center">Status</div>
                </div>

                <div className="divide-y divide-dark-900 max-h-72 overflow-y-auto">
                  {bulkAttendanceList.map((item, index) => (
                    <div key={item.student_id} className="grid grid-cols-12 p-3 text-xs items-center hover:bg-dark-900/40">
                      <div className="col-span-2 text-center font-mono font-bold text-slate-400">{item.roll_number}</div>
                      <div className="col-span-7 font-medium text-white">{item.name}</div>
                      <div className="col-span-3 flex justify-center">
                        <button
                          type="button"
                          onClick={() => toggleSingleAttendance(index)}
                          className={`px-3 py-1 rounded-lg text-[10px] font-bold uppercase transition ${
                            item.attended 
                              ? 'bg-emerald-500/10 text-emerald-450 border border-emerald-500/20' 
                              : 'bg-rose-500/10 text-rose-450 border border-rose-500/20'
                          }`}
                        >
                          {item.attended ? 'Present' : 'Absent'}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="p-6 border-t border-dark-800 flex justify-end gap-3 shrink-0 bg-dark-950/20">
              <button 
                type="button" 
                onClick={() => setShowAttendanceModal(false)}
                className="px-4 py-2 text-xs font-semibold rounded-lg bg-dark-900 border border-dark-850 text-slate-400 hover:text-white transition"
              >
                Cancel
              </button>
              <button 
                type="button"
                onClick={submitBulkAttendance}
                disabled={submitting}
                className="px-4 py-2 text-xs font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white transition flex items-center gap-1.5"
              >
                {submitting ? 'Submitting...' : 'Commit Daily Sheet'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* --- MANAGE SUBJECTS MODAL --- */}
      {showSubjectModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4">
          <div className="glass-panel w-full max-w-md rounded-2xl border border-dark-800 overflow-hidden shadow-2xl relative animate-scaleUp">
            <div className="p-6 border-b border-dark-800 flex justify-between items-center">
              <h3 className="text-base font-bold text-white font-outfit flex items-center gap-2">
                <BookOpen size={18} className="text-primary-500" />
                <span>Manage Subjects - Class {class_level}</span>
              </h3>
              <button onClick={() => setShowSubjectModal(false)} className="text-slate-500 hover:text-white transition">
                <X size={20} />
              </button>
            </div>

            <div className="p-6 space-y-4">
              {subjectError && (
                <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs">
                  {subjectError}
                </div>
              )}
              {subjectSuccess && (
                <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs">
                  {subjectSuccess}
                </div>
              )}

              {/* Add Subject Form */}
              <form onSubmit={handleAddSubject} className="flex flex-col sm:flex-row gap-2">
                <input
                  type="text"
                  required
                  placeholder="New Subject Name (e.g. Physics)"
                  value={newSubjectName}
                  onChange={(e) => setNewSubjectName(e.target.value)}
                  className="flex-1 px-3 py-2 rounded-xl bg-dark-900 border border-dark-850 focus:border-primary-500 text-white text-xs outline-none"
                />
                <div className="flex gap-2">
                  <input
                    type="number"
                    min="1"
                    required
                    placeholder="Chapters"
                    title="Number of Chapters"
                    value={newSubjectChapters}
                    onChange={(e) => setNewSubjectChapters(e.target.value)}
                    className="w-20 px-3 py-2 rounded-xl bg-dark-900 border border-dark-850 focus:border-primary-500 text-white text-xs outline-none text-center"
                  />
                  <button
                    type="submit"
                    disabled={addingSubject}
                    className="px-4 py-2 bg-primary-600 hover:bg-primary-500 disabled:opacity-50 text-white text-xs font-semibold rounded-xl transition duration-150 shrink-0"
                  >
                    {addingSubject ? 'Adding...' : 'Add Subject'}
                  </button>
                </div>
              </form>

              {/* Subjects List */}
              <div className="border border-dark-850 rounded-xl overflow-hidden bg-dark-905 max-h-60 overflow-y-auto">
                <div className="bg-dark-900 border-b border-dark-850 p-3 text-xs font-semibold text-slate-450 uppercase tracking-wider">
                  Active Subjects
                </div>
                <div className="divide-y divide-dark-900">
                  {subjectsList.length === 0 ? (
                    <div className="p-4 text-center text-slate-500 text-xs">
                      No subjects defined for this class.
                    </div>
                  ) : (
                    subjectsList.map((sub) => (
                      <div key={sub._id} className="flex justify-between items-center p-2.5 text-xs hover:bg-dark-900/40">
                        <span className="font-semibold text-white">{sub.name}</span>
                        <div className="flex items-center gap-2">
                          <div className="flex items-center gap-1">
                            <span className="text-[10px] text-slate-450">Chapters:</span>
                            <input
                              type="number"
                              min="1"
                              value={sub.total_chapters || 4}
                              onChange={async (e) => {
                                const newTotal = parseInt(e.target.value, 10);
                                if (!isNaN(newTotal) && newTotal >= 1) {
                                  try {
                                    setSavingSubjectId(sub._id);
                                    setSubjectsList(prev => prev.map(item => item._id === sub._id ? { ...item, total_chapters: newTotal } : item));
                                    await axios.put(`/api/subjects/${sub._id}`, { total_chapters: newTotal });
                                    setSavingSubjectId(null);
                                    setSavedSubjectId(sub._id);
                                    setTimeout(() => setSavedSubjectId(null), 1000);
                                  } catch (err) {
                                    setSavingSubjectId(null);
                                    console.error('Failed to update chapters', err);
                                  }
                                }
                              }}
                              className={`w-12 px-1 py-0.5 rounded text-white text-[10px] text-center outline-none transition-all duration-300 font-semibold border ${
                                savingSubjectId === sub._id
                                  ? 'border-amber-500 bg-amber-500/5 shadow-[0_0_10px_rgba(245,158,11,0.2)]'
                                  : savedSubjectId === sub._id
                                    ? 'border-emerald-500 bg-emerald-500/5 shadow-[0_0_10px_rgba(16,185,129,0.2)]'
                                    : 'border-dark-850 bg-dark-900 focus:border-primary-500'
                              }`}
                            />
                          </div>
                          <button
                            type="button"
                            onClick={() => handleDeleteSubject(sub._id, sub.name)}
                            className="p-1 rounded text-rose-450 hover:bg-rose-500/10 hover:text-rose-305 transition animate-fadeIn"
                            title={`Delete ${sub.name}`}
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>

            <div className="p-6 border-t border-dark-800 flex justify-end">
              <button 
                type="button" 
                onClick={() => setShowSubjectModal(false)}
                className="px-4 py-2 text-xs font-semibold rounded-lg bg-dark-900 border border-dark-850 text-slate-455 hover:text-white transition"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ClassGrid;
