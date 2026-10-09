import React, { useState, useEffect, useMemo, useRef } from 'react';
import axios from 'axios';
import { useAuth } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
  LineChart,
  Line
} from 'recharts';
import {
  Zap,
  Users,
  BookOpen,
  Calendar,
  Clock,
  Plus,
  Search,
  Trash2,
  Edit3,
  CheckCircle2,
  FileText,
  UserPlus,
  UserMinus,
  X,
  ChevronDown,
  ChevronUp,
  Layers,
  GraduationCap,
  AlertCircle,
  ExternalLink,
  Filter,
  Award,
  MessageSquare,
  Send,
  Phone,
  Mail,
  TrendingUp,
  Check,
  MinusCircle,
  HelpCircle,
  BarChart2,
  DollarSign,
  ShieldCheck,
  FileCheck,
  FileSpreadsheet
} from 'lucide-react';

const SpecialBatchesPanel = () => {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [batches, setBatches] = useState([]);
  const [studentsList, setStudentsList] = useState([]);
  const [classList, setClassList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  const workbenchRef = useRef(null);

  // Selected Batch Detail Workbench
  const [selectedBatchId, setSelectedBatchId] = useState(null);
  const [selectedBatchDetails, setSelectedBatchDetails] = useState(null);
  const [loadingBatchDetails, setLoadingBatchDetails] = useState(false);
  const [batchTab, setBatchTab] = useState('performance'); // 'performance', 'roster', 'attendance', 'tests', 'timetable', 'lms'

  const handleSelectBatch = (id) => {
    setSelectedBatchId(id);
    if (typeof window !== 'undefined' && window.innerWidth < 1024 && workbenchRef.current) {
      setTimeout(() => {
        workbenchRef.current?.scrollIntoView({ behavior: 'smooth' });
      }, 100);
    }
  };

  // Filters & Search
  const [activeFilterTab, setActiveFilterTab] = useState('All'); // 'All', 'My', 'Active', 'Archived'
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedSubjectFilter, setSelectedSubjectFilter] = useState('All');

  // Modals state
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingBatch, setEditingBatch] = useState(null);

  const [showManageStudentsModal, setShowManageStudentsModal] = useState(false);
  const [showAddLessonModal, setShowAddLessonModal] = useState(false);
  const [showAddTestModal, setShowAddTestModal] = useState(false);
  const [showAddScheduleModal, setShowAddScheduleModal] = useState(false);
  const [selectedStudentForProfile, setSelectedStudentForProfile] = useState(null);

  // Form states for Create/Edit Batch
  const [batchForm, setBatchForm] = useState({
    name: '',
    subject: '',
    description: '',
    batch_fee: 0,
    status: 'Active',
    schedule: [{ day: 'Monday', period_name: 'Period 1', start_time: '16:00', end_time: '17:30', room: 'Extra Room 1', subject: '', instructor_name: '' }],
    students: []
  });

  const [studentSearchFilter, setStudentSearchFilter] = useState('');
  const [classFilterForStudentPicker, setClassFilterForStudentPicker] = useState('All');
  const [submitting, setSubmitting] = useState(false);

  // Form states for Add LMS Lesson
  const [lessonForm, setLessonForm] = useState({
    title: '',
    subject: '',
    chapter_name: '',
    content: '',
    workflow_stage: 'Notes Distributed',
    file: null
  });

  // Form states for Attendance Register
  const [attendanceDate, setAttendanceDate] = useState(new Date().toISOString().substring(0, 10));
  const [attendanceSession, setAttendanceSession] = useState('Session 1');
  const [attendanceMap, setAttendanceMap] = useState({}); // studentId -> 'Present' | 'Absent' | 'Late' | 'Excused'
  const [attendanceRemarksMap, setAttendanceRemarksMap] = useState({}); // studentId -> remark

  // Form states for Exam Test Scores
  const [testForm, setTestForm] = useState({
    test_name: '',
    subject: '',
    total_marks: 100,
    passing_marks: 40,
    date: new Date().toISOString().substring(0, 10),
    scores: {} // studentId -> marks_obtained
  });

  // Form states for Schedule Slot
  const [scheduleForm, setScheduleForm] = useState({
    day: 'Monday',
    period_name: 'Period 1',
    start_time: '16:00',
    end_time: '17:30',
    room: 'Extra Room 1',
    subject: '',
    instructor_name: ''
  });

  const canManage = user?.role === 'SuperAdmin' || user?.role === 'Teacher';
  const isStudent = user?.role === 'Student';
  const currentStudentId = user?.studentProfile?._id;

  // Fetch all batches
  const fetchBatches = async () => {
    try {
      setLoading(true);
      setError('');
      const res = await axios.get('/api/special-batches');
      if (res.data.success) {
        setBatches(res.data.data);
        if (res.data.data.length > 0 && !selectedBatchId) {
          setSelectedBatchId(res.data.data[0]._id);
        }
      }
    } catch (err) {
      console.error('Failed to fetch special batches:', err);
      setError(err.response?.data?.message || 'Failed to load special batches');
    } finally {
      setLoading(false);
    }
  };

  // Fetch single batch full details with dynamic merit rankings
  const fetchBatchDetails = async (id) => {
    if (!id) return;
    try {
      setLoadingBatchDetails(true);
      const res = await axios.get(`/api/special-batches/${id}`);
      if (res.data.success) {
        setSelectedBatchDetails(res.data.data);
        
        // Initialize testForm scores with default values
        const defaultScores = {};
        res.data.data.students?.forEach(std => {
          if (std && std._id) defaultScores[std._id] = 0;
        });
        setTestForm(prev => ({ ...prev, subject: res.data.data.subject, scores: defaultScores }));

        // Initialize attendance map for selected date/session if available
        initAttendanceMap(res.data.data, attendanceDate, attendanceSession);
      }
    } catch (err) {
      console.error('Failed to fetch batch details:', err);
    } finally {
      setLoadingBatchDetails(false);
    }
  };

  const fetchStudents = async () => {
    if (!canManage) return;
    try {
      const res = await axios.get('/api/students?limit=500');
      if (res.data.success) {
        setStudentsList(res.data.data);
      }
    } catch (err) {
      console.error('Failed to load students roster:', err);
    }
  };

  const fetchClasses = async () => {
    try {
      const res = await axios.get('/api/classes');
      if (res.data.success) {
        setClassList(res.data.data);
      }
    } catch (err) {
      console.error('Failed to load classes:', err);
    }
  };

  useEffect(() => {
    fetchBatches();
    fetchStudents();
    fetchClasses();
  }, [user]);

  useEffect(() => {
    if (selectedBatchId) {
      fetchBatchDetails(selectedBatchId);
    }
  }, [selectedBatchId]);

  // Helper to initialize attendance map for date/session
  const initAttendanceMap = (batchData, dateStr, sessionStr) => {
    if (!batchData || !batchData.students) return;
    const existingSheet = batchData.attendance_records?.find(att => 
      new Date(att.date).toISOString().substring(0, 10) === dateStr &&
      (att.session_name || 'Session 1') === sessionStr
    );

    const initialMap = {};
    const initialRemarks = {};

    batchData.students.forEach(std => {
      if (std && std._id) {
        if (existingSheet) {
          const rec = existingSheet.records?.find(r => r.student && ((r.student._id || r.student).toString() === std._id.toString()));
          initialMap[std._id] = rec ? rec.status : 'Present';
          initialRemarks[std._id] = rec ? rec.remarks || '' : '';
        } else {
          initialMap[std._id] = 'Present';
          initialRemarks[std._id] = '';
        }
      }
    });

    setAttendanceMap(initialMap);
    setAttendanceRemarksMap(initialRemarks);
  };

  useEffect(() => {
    if (selectedBatchDetails) {
      initAttendanceMap(selectedBatchDetails, attendanceDate, attendanceSession);
    }
  }, [attendanceDate, attendanceSession]);

  // Derived Overall Stats
  const globalStats = useMemo(() => {
    const totalBatches = batches.length;
    const activeBatches = batches.filter(b => b.status === 'Active').length;
    const totalLessons = batches.reduce((acc, b) => acc + (b.extra_lessons?.length || 0), 0);
    const studentSet = new Set();
    batches.forEach(b => {
      b.students?.forEach(s => {
        if (s) {
          const sId = s._id ? s._id.toString() : s.toString();
          studentSet.add(sId);
        }
      });
    });

    return {
      totalBatches,
      activeBatches,
      totalLessons,
      enrolledStudentsCount: studentSet.size
    };
  }, [batches]);

  const availableSubjects = useMemo(() => {
    const subjects = new Set();
    batches.forEach(b => {
      if (b.subject) subjects.add(b.subject);
    });
    return Array.from(subjects);
  }, [batches]);

  // Student specific derived performance metrics for selected batch
  const myStudentPerformance = useMemo(() => {
    if (!selectedBatchDetails || !selectedBatchDetails.students || !currentStudentId) return null;
    return selectedBatchDetails.students.find(
      std => std && std._id && std._id.toString() === currentStudentId.toString()
    ) || null;
  }, [selectedBatchDetails, currentStudentId]);

  const myAttendanceHistory = useMemo(() => {
    if (!selectedBatchDetails || !selectedBatchDetails.attendance_records || !currentStudentId) return [];
    const history = [];
    selectedBatchDetails.attendance_records.forEach(att => {
      const rec = att.records?.find(r => r.student && ((r.student._id || r.student).toString() === currentStudentId.toString()));
      if (rec) {
        history.push({
          date: att.date,
          session_name: att.session_name || 'Session 1',
          status: rec.status,
          remarks: rec.remarks || ''
        });
      }
    });
    return history.sort((a, b) => new Date(b.date) - new Date(a.date));
  }, [selectedBatchDetails, currentStudentId]);

  const myExamScores = useMemo(() => {
    if (!selectedBatchDetails || !selectedBatchDetails.test_scores || !currentStudentId) return [];
    const scores = [];
    selectedBatchDetails.test_scores.forEach(ts => {
      const sc = ts.scores?.find(s => s.student && ((s.student._id || s.student).toString() === currentStudentId.toString()));
      if (sc) {
        const pct = ((sc.marks_obtained / ts.total_marks) * 100).toFixed(1);
        let sumPct = 0;
        ts.scores?.forEach(s => sumPct += (s.marks_obtained / ts.total_marks) * 100);
        const classAvg = ts.scores?.length > 0 ? (sumPct / ts.scores.length).toFixed(1) : 0;
        scores.push({
          test_id: ts._id,
          test_name: ts.test_name,
          subject: ts.subject || selectedBatchDetails.subject,
          date: ts.date,
          marks_obtained: sc.marks_obtained,
          total_marks: ts.total_marks,
          passing_marks: ts.passing_marks || 40,
          pct: Number(pct),
          class_avg: Number(classAvg),
          badge: getGradeBadge(Number(pct))
        });
      }
    });
    return scores;
  }, [selectedBatchDetails, currentStudentId]);

  const filteredBatches = useMemo(() => {
    return batches.filter(batch => {
      if (activeFilterTab === 'My' && user?.role === 'Teacher') {
        if (batch.instructor?._id !== user._id) return false;
      }
      if (activeFilterTab === 'Active' && batch.status !== 'Active') return false;
      if (activeFilterTab === 'Archived' && batch.status !== 'Archived') return false;
      if (selectedSubjectFilter !== 'All' && batch.subject !== selectedSubjectFilter) return false;

      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase();
        const matchesName = batch.name?.toLowerCase().includes(query);
        const matchesSubject = batch.subject?.toLowerCase().includes(query);
        const matchesDesc = batch.description?.toLowerCase().includes(query);
        const matchesStudent = batch.students?.some(s => s && s.name && s.name.toLowerCase().includes(query));
        return matchesName || matchesSubject || matchesDesc || matchesStudent;
      }
      return true;
    });
  }, [batches, activeFilterTab, searchQuery, selectedSubjectFilter, user]);

  // Open Create/Edit Batch Modal
  const handleOpenCreateModal = (batchToEdit = null) => {
    if (batchToEdit) {
      setEditingBatch(batchToEdit);
      setBatchForm({
        name: batchToEdit.name || '',
        subject: batchToEdit.subject || '',
        description: batchToEdit.description || '',
        batch_fee: batchToEdit.batch_fee || 0,
        status: batchToEdit.status || 'Active',
        schedule: batchToEdit.schedule && batchToEdit.schedule.length > 0 
          ? batchToEdit.schedule 
          : [{ day: 'Monday', period_name: 'Period 1', start_time: '16:00', end_time: '17:30', room: 'Extra Room 1', subject: '', instructor_name: '' }],
        students: batchToEdit.students ? batchToEdit.students.map(s => s._id) : []
      });
    } else {
      setEditingBatch(null);
      setBatchForm({
        name: '',
        subject: '',
        description: '',
        batch_fee: 0,
        status: 'Active',
        schedule: [{ day: 'Monday', period_name: 'Period 1', start_time: '16:00', end_time: '17:30', room: 'Extra Room 1', subject: '', instructor_name: '' }],
        students: []
      });
    }
    setShowCreateModal(true);
  };

  // Submit Create/Edit Batch
  const handleSubmitBatchForm = async (e) => {
    e.preventDefault();
    try {
      setSubmitting(true);
      setError('');
      if (editingBatch) {
        const res = await axios.put(`/api/special-batches/${editingBatch._id}`, batchForm);
        if (res.data.success) {
          setSuccessMsg('Special batch updated successfully!');
          fetchBatches();
          if (selectedBatchId === editingBatch._id) fetchBatchDetails(editingBatch._id);
          setShowCreateModal(false);
        }
      } else {
        const res = await axios.post('/api/special-batches', batchForm);
        if (res.data.success) {
          setSuccessMsg('Special batch created successfully!');
          fetchBatches();
          setSelectedBatchId(res.data.data._id);
          setShowCreateModal(false);
        }
      }
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to save special batch');
    } finally {
      setSubmitting(false);
      setTimeout(() => setSuccessMsg(''), 4000);
    }
  };

  // Delete Batch
  const handleDeleteBatch = async (batchId, e) => {
    e.stopPropagation();
    if (!window.confirm('Are you sure you want to delete this special batch? This action cannot be undone.')) return;
    try {
      const res = await axios.delete(`/api/special-batches/${batchId}`);
      if (res.data.success) {
        setSuccessMsg('Special batch deleted.');
        fetchBatches();
        if (selectedBatchId === batchId) setSelectedBatchId(null);
      }
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to delete special batch');
    }
  };

  // Toggle student enrollment
  const handleToggleStudentEnrollment = async (studentId) => {
    if (!selectedBatchDetails) return;
    const isEnrolled = selectedBatchDetails.students?.some(s => s._id === studentId);
    try {
      if (isEnrolled) {
        const res = await axios.delete(`/api/special-batches/${selectedBatchDetails._id}/students/${studentId}`);
        if (res.data.success) fetchBatchDetails(selectedBatchDetails._id);
      } else {
        const res = await axios.post(`/api/special-batches/${selectedBatchDetails._id}/students`, { studentIds: [studentId] });
        if (res.data.success) fetchBatchDetails(selectedBatchDetails._id);
      }
    } catch (err) {
      console.error('Failed to update student enrollment:', err);
    }
  };

  // Add LMS Handout Lesson
  const handleAddLesson = async (e) => {
    e.preventDefault();
    if (!selectedBatchDetails || !lessonForm.title) return;
    try {
      setSubmitting(true);
      const formData = new FormData();
      formData.append('title', lessonForm.title);
      formData.append('subject', lessonForm.subject || selectedBatchDetails.subject);
      formData.append('chapter_name', lessonForm.chapter_name || '');
      formData.append('content', lessonForm.content || '');
      formData.append('workflow_stage', lessonForm.workflow_stage || 'Notes Distributed');
      if (lessonForm.file) formData.append('file', lessonForm.file);

      const res = await axios.post(`/api/special-batches/${selectedBatchDetails._id}/extra-lessons`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
      if (res.data.success) {
        setSuccessMsg('Handout material added to batch!');
        fetchBatchDetails(selectedBatchDetails._id);
        setShowAddLessonModal(false);
        setLessonForm({ title: '', subject: '', chapter_name: '', content: '', workflow_stage: 'Notes Distributed', file: null });
      }
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to add lesson material');
    } finally {
      setSubmitting(false);
      setTimeout(() => setSuccessMsg(''), 4000);
    }
  };

  // Delete LMS Handout
  const handleDeleteLesson = async (lessonId) => {
    if (!selectedBatchDetails) return;
    if (!window.confirm('Delete this study material handout?')) return;
    try {
      const res = await axios.delete(`/api/special-batches/${selectedBatchDetails._id}/extra-lessons/${lessonId}`);
      if (res.data.success) fetchBatchDetails(selectedBatchDetails._id);
    } catch (err) {
      console.error('Failed to delete lesson:', err);
    }
  };

  // Commit Batch Attendance
  const handleCommitAttendance = async () => {
    if (!selectedBatchDetails || !selectedBatchDetails.students) return;
    try {
      setSubmitting(true);
      const recordsPayload = selectedBatchDetails.students
        .filter(std => std && std._id)
        .map(std => ({
          student: std._id,
          status: attendanceMap[std._id] || 'Present',
          remarks: attendanceRemarksMap[std._id] || ''
        }));

      const res = await axios.post(`/api/special-batches/${selectedBatchDetails._id}/attendance`, {
        date: attendanceDate,
        session_name: attendanceSession,
        records: recordsPayload
      });

      if (res.data.success) {
        setSuccessMsg('Batch attendance committed successfully!');
        fetchBatchDetails(selectedBatchDetails._id);
      }
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to save attendance');
    } finally {
      setSubmitting(false);
      setTimeout(() => setSuccessMsg(''), 4000);
    }
  };

  // Commit Exam Test Score Record
  const handleCommitTestScore = async (e) => {
    e.preventDefault();
    if (!selectedBatchDetails || !selectedBatchDetails.students || !testForm.test_name) return;
    try {
      setSubmitting(true);
      const scoresPayload = selectedBatchDetails.students
        .filter(std => std && std._id)
        .map(std => ({
          student: std._id,
          marks_obtained: Number((testForm.scores && testForm.scores[std._id]) || 0)
        }));

      const res = await axios.post(`/api/special-batches/${selectedBatchDetails._id}/test-scores`, {
        test_name: testForm.test_name,
        subject: testForm.subject || selectedBatchDetails.subject,
        total_marks: Number(testForm.total_marks || 100),
        passing_marks: Number(testForm.passing_marks || 40),
        date: testForm.date,
        scores: scoresPayload
      });

      if (res.data.success) {
        setSuccessMsg('Exam test marks committed successfully!');
        fetchBatchDetails(selectedBatchDetails._id);
        setShowAddTestModal(false);
      }
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to save exam test scores');
    } finally {
      setSubmitting(false);
      setTimeout(() => setSuccessMsg(''), 4000);
    }
  };

  // Delete Exam Test Record
  const handleDeleteTestRecord = async (testId) => {
    if (!selectedBatchDetails) return;
    if (!window.confirm('Remove this test score record?')) return;
    try {
      const res = await axios.delete(`/api/special-batches/${selectedBatchDetails._id}/test-scores/${testId}`);
      if (res.data.success) fetchBatchDetails(selectedBatchDetails._id);
    } catch (err) {
      console.error('Failed to delete test score:', err);
    }
  };

  // Add Timetable Slot
  const handleAddScheduleSlot = async (e) => {
    e.preventDefault();
    if (!selectedBatchDetails) return;
    try {
      setSubmitting(true);
      const slotToAdd = {
        ...scheduleForm,
        period_name: scheduleForm.period_name?.trim() || 'Period',
        subject: scheduleForm.subject?.trim() || selectedBatchDetails.subject || '',
        room: scheduleForm.room?.trim() || 'Extra Room'
      };
      const updatedSchedule = [...(selectedBatchDetails.schedule || []), slotToAdd];
      const res = await axios.put(`/api/special-batches/${selectedBatchDetails._id}`, { schedule: updatedSchedule });
      if (res.data.success) {
        setSuccessMsg('Schedule slot added to batch timetable!');
        fetchBatchDetails(selectedBatchDetails._id);
        setShowAddScheduleModal(false);
      }
    } catch (err) {
      setError('Failed to update timetable schedule');
    } finally {
      setSubmitting(false);
      setTimeout(() => setSuccessMsg(''), 4000);
    }
  };

  // Remove Timetable Slot
  const handleRemoveScheduleSlot = async (slotToRemove, e) => {
    if (e) e.stopPropagation();
    if (!selectedBatchDetails || !slotToRemove) return;
    const slotLabel = slotToRemove.period_name || `${slotToRemove.start_time} - ${slotToRemove.end_time}`;
    if (!window.confirm(`Are you sure you want to remove timetable slot "${slotLabel}" on ${slotToRemove.day}?`)) return;

    try {
      setSubmitting(true);
      setError('');
      if (slotToRemove._id) {
        try {
          const res = await axios.delete(`/api/special-batches/${selectedBatchDetails._id}/schedule/${slotToRemove._id}`);
          if (res.data.success) {
            setSuccessMsg('Schedule slot removed successfully!');
            fetchBatchDetails(selectedBatchDetails._id);
            return;
          }
        } catch (err) {
          console.warn('DELETE schedule endpoint fallback to PUT:', err);
        }
      }

      // Fallback: update timetable schedule via PUT
      const updatedSchedule = (selectedBatchDetails.schedule || []).filter(s => {
        if (slotToRemove._id && s._id) {
          return s._id.toString() !== slotToRemove._id.toString();
        }
        return s !== slotToRemove && !(
          s.day === slotToRemove.day &&
          s.start_time === slotToRemove.start_time &&
          s.end_time === slotToRemove.end_time &&
          s.period_name === slotToRemove.period_name
        );
      });

      const res = await axios.put(`/api/special-batches/${selectedBatchDetails._id}`, { schedule: updatedSchedule });
      if (res.data.success) {
        setSuccessMsg('Schedule slot removed successfully!');
        fetchBatchDetails(selectedBatchDetails._id);
      }
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to remove timetable schedule slot');
    } finally {
      setSubmitting(false);
      setTimeout(() => setSuccessMsg(''), 4000);
    }
  };

  // Trigger Email Progress Report for Batch
  const handleTriggerBatchProgressReport = async () => {
    if (!selectedBatchDetails) return;
    if (!window.confirm(`Send automated progress report emails to parents of all enrolled students in ${selectedBatchDetails.name}?`)) return;
    try {
      setSubmitting(true);
      const res = await axios.post(`/api/special-batches/${selectedBatchDetails._id}/trigger-report`);
      if (res.data.success) {
        setSuccessMsg(`Progress report emails sent to ${res.data.sentCount} parents!`);
      }
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to send progress reports');
    } finally {
      setSubmitting(false);
      setTimeout(() => setSuccessMsg(''), 5000);
    }
  };

  // Open Chat Room for Special Batch
  const handleOpenBatchChat = () => {
    if (!selectedBatchDetails) return;
    navigate('/chat', { state: { targetRoom: `BATCH_${selectedBatchDetails._id}` } });
  };

  // Grade badge calculator helper
  const getGradeBadge = (pct) => {
    if (pct >= 90) return { label: 'A+', color: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' };
    if (pct >= 80) return { label: 'A', color: 'bg-indigo-500/20 text-indigo-400 border-indigo-500/30' };
    if (pct >= 70) return { label: 'B', color: 'bg-primary-500/20 text-primary-400 border-primary-500/30' };
    if (pct >= 60) return { label: 'C', color: 'bg-amber-500/20 text-amber-400 border-amber-500/30' };
    return { label: 'F', color: 'bg-rose-500/20 text-rose-400 border-rose-500/30' };
  };

  // Filtered student list for Enrollment Picker modal
  const filteredStudentsForPicker = useMemo(() => {
    return studentsList.filter(std => {
      if (classFilterForStudentPicker !== 'All' && std.class_level !== classFilterForStudentPicker) return false;
      if (studentSearchFilter.trim()) {
        const query = studentSearchFilter.toLowerCase();
        return std.name.toLowerCase().includes(query) || 
               std.roll_number?.toString().includes(query) ||
               std.class_level?.toLowerCase().includes(query);
      }
      return true;
    });
  }, [studentsList, classFilterForStudentPicker, studentSearchFilter]);

  // Chart data for selected batch test scores history
  const batchTestChartData = useMemo(() => {
    if (!selectedBatchDetails || !selectedBatchDetails.test_scores) return [];
    return selectedBatchDetails.test_scores.map(ts => {
      let sumPct = 0;
      ts.scores?.forEach(sc => {
        sumPct += (sc.marks_obtained / ts.total_marks) * 100;
      });
      const avgPct = ts.scores?.length > 0 ? (sumPct / ts.scores.length).toFixed(1) : 0;
      return {
        name: ts.test_name,
        avgPct: Number(avgPct),
        totalMarks: ts.total_marks
      };
    }).reverse();
  }, [selectedBatchDetails]);

  return (
    <div className="space-y-6 pb-12">
      {/* Header Banner */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-gradient-to-r from-dark-900 via-dark-850 to-primary-950/40 p-6 rounded-3xl border border-dark-800/80 shadow-2xl relative overflow-hidden">
        <div className="absolute -right-12 -top-12 w-64 h-64 bg-primary-500/10 rounded-full blur-3xl pointer-events-none" />
        <div className="space-y-1.5 z-10">
          <div className="flex items-center gap-2.5">
            <span className="p-2 rounded-xl bg-primary-500/10 text-primary-400 border border-primary-500/20">
              <Zap size={22} className="animate-pulse" />
            </span>
            <h1 className="text-2xl md:text-3xl font-extrabold text-white font-outfit tracking-tight">
              Special Batches Workbench
            </h1>
            <span className="bg-primary-500/10 text-primary-400 border border-primary-500/20 text-[10px] font-bold px-2.5 py-0.5 rounded-full font-mono uppercase">
              Enterprise Feature Parity
            </span>
          </div>
          <p className="text-xs md:text-sm text-slate-400 max-w-2xl font-normal leading-relaxed">
            Manage specialized coaching cohorts, foundation batches, and remedial groups with full feature parity — complete with merit roll rankings, attendance registers, exam ledgers, 7-day timetables, LMS handouts, and live voice lounges.
          </p>
        </div>

        {canManage && (
          <button
            onClick={() => handleOpenCreateModal()}
            className="flex items-center justify-center gap-2 px-5 py-3 rounded-2xl bg-gradient-to-r from-primary-600 to-indigo-600 text-white font-bold text-xs hover:shadow-lg hover:shadow-primary-500/20 hover:scale-[1.02] active:scale-[0.98] transition duration-200 cursor-pointer shrink-0 z-10 border border-primary-400/30"
          >
            <Plus size={16} />
            <span>Create Special Batch</span>
          </button>
        )}
      </div>

      {/* Global Alerts */}
      {error && (
        <div className="p-4 rounded-2xl bg-rose-500/10 border border-rose-500/20 text-rose-300 text-xs flex items-center justify-between animate-slideUp">
          <div className="flex items-center gap-2.5">
            <AlertCircle size={16} className="shrink-0 text-rose-400" />
            <span>{error}</span>
          </div>
          <button onClick={() => setError('')} className="p-1 hover:text-white cursor-pointer"><X size={14} /></button>
        </div>
      )}

      {successMsg && (
        <div className="p-4 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 text-xs flex items-center justify-between animate-slideUp">
          <div className="flex items-center gap-2.5">
            <CheckCircle2 size={16} className="shrink-0 text-emerald-400" />
            <span>{successMsg}</span>
          </div>
          <button onClick={() => setSuccessMsg('')} className="p-1 hover:text-white cursor-pointer"><X size={14} /></button>
        </div>
      )}

      {/* Overview Analytics Bar */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="glass-card p-4 rounded-2xl border border-dark-800/80 flex items-center gap-3">
          <div className="p-3 rounded-xl bg-primary-500/10 text-primary-400 border border-primary-500/20 shrink-0">
            <Layers size={20} />
          </div>
          <div>
            <span className="text-[10px] text-slate-400 uppercase font-bold tracking-wider block">Total Special Batches</span>
            <span className="text-xl font-extrabold text-white font-outfit">{globalStats.totalBatches}</span>
          </div>
        </div>

        <div className="glass-card p-4 rounded-2xl border border-dark-800/80 flex items-center gap-3">
          <div className="p-3 rounded-xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 shrink-0">
            <ShieldCheck size={20} />
          </div>
          <div>
            <span className="text-[10px] text-slate-400 uppercase font-bold tracking-wider block">Active Batches</span>
            <span className="text-xl font-extrabold text-white font-outfit">{globalStats.activeBatches}</span>
          </div>
        </div>

        <div className="glass-card p-4 rounded-2xl border border-dark-800/80 flex items-center gap-3">
          <div className="p-3 rounded-xl bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 shrink-0">
            <Users size={20} />
          </div>
          <div>
            <span className="text-[10px] text-slate-400 uppercase font-bold tracking-wider block">Enrolled Students</span>
            <span className="text-xl font-extrabold text-white font-outfit">{globalStats.enrolledStudentsCount}</span>
          </div>
        </div>

        <div className="glass-card p-4 rounded-2xl border border-dark-800/80 flex items-center gap-3">
          <div className="p-3 rounded-xl bg-amber-500/10 text-amber-400 border border-amber-500/20 shrink-0">
            <BookOpen size={20} />
          </div>
          <div>
            <span className="text-[10px] text-slate-400 uppercase font-bold tracking-wider block">Curriculum Handouts</span>
            <span className="text-xl font-extrabold text-white font-outfit">{globalStats.totalLessons}</span>
          </div>
        </div>
      </div>

      {/* Main Grid: Left Batches Selector List & Right Comprehensive Workbench */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Column: Batches List (4 Cols) */}
        <div className="lg:col-span-4 space-y-4">
          <div className="glass-panel p-4 rounded-3xl border border-dark-800/80 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-bold text-white font-outfit flex items-center gap-2">
                <Filter size={16} className="text-primary-400" />
                Select Special Batch
              </h2>
              <span className="text-[10px] text-slate-400 font-mono">{filteredBatches.length} items</span>
            </div>

            {/* Filters & Search */}
            <div className="space-y-2">
              <div className="bg-dark-900/60 rounded-xl px-3 py-2 border border-dark-800 flex items-center gap-2">
                <Search size={14} className="text-slate-500 shrink-0" />
                <input
                  type="text"
                  placeholder="Filter by name, subject..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="bg-transparent text-xs text-white placeholder-slate-555 outline-none w-full"
                />
              </div>

              <div className="flex items-center gap-1.5 overflow-x-auto pb-1 no-scrollbar text-[11px]">
                {['All', ...(user?.role === 'Teacher' ? ['My'] : []), 'Active', 'Archived'].map(tab => (
                  <button
                    key={tab}
                    onClick={() => setActiveFilterTab(tab)}
                    className={`px-3 py-1.5 rounded-xl font-medium transition cursor-pointer shrink-0 ${
                      activeFilterTab === tab
                        ? 'bg-primary-600 text-white font-bold shadow-md shadow-primary-500/20'
                        : 'bg-dark-900/60 text-slate-400 hover:text-white border border-dark-800'
                    }`}
                  >
                    {tab === 'All' ? (isStudent ? 'Enrolled Batches' : 'All Batches') : (tab === 'My' ? 'My Batches' : tab)}
                  </button>
                ))}
              </div>
            </div>

            {/* Batches Cards List */}
            <div className="space-y-2.5 max-h-[600px] overflow-y-auto pr-1">
              {loading ? (
                <div className="p-8 text-center text-xs text-slate-400 space-y-2">
                  <div className="w-6 h-6 border-2 border-primary-500 border-t-transparent rounded-full animate-spin mx-auto" />
                  <span>Loading special batches...</span>
                </div>
              ) : filteredBatches.length === 0 ? (
                <div className="p-8 text-center text-xs text-slate-400 bg-dark-950/40 rounded-2xl border border-dark-850">
                  No special batches found matching filters.
                </div>
              ) : (
                filteredBatches.map(b => {
                  const isSelected = selectedBatchId === b._id;
                  return (
                    <div
                      key={b._id}
                      onClick={() => handleSelectBatch(b._id)}
                      className={`p-4 rounded-2xl border transition-all duration-200 cursor-pointer relative overflow-hidden group ${
                        isSelected
                          ? 'bg-primary-600/10 border-primary-500/60 shadow-lg shadow-primary-500/10'
                          : 'bg-dark-900/40 border-dark-800/80 hover:bg-dark-900/80 hover:border-dark-750'
                      }`}
                    >
                      {isSelected && (
                        <div className="absolute top-0 left-0 bottom-0 w-1 bg-gradient-to-b from-primary-400 to-indigo-500" />
                      )}

                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-bold text-white font-outfit group-hover:text-primary-300 transition">
                              {b.name}
                            </span>
                            <span className="text-[9px] px-2 py-0.5 rounded-full bg-primary-500/10 text-primary-400 border border-primary-500/20 font-medium">
                              {b.subject}
                            </span>
                          </div>
                          <p className="text-[11px] text-slate-400 line-clamp-1 mt-1 font-normal">
                            {b.description || 'No description provided'}
                          </p>
                        </div>

                        {canManage && (
                          <div className="flex items-center gap-1 opacity-80 group-hover:opacity-100">
                            <button
                              onClick={(e) => { e.stopPropagation(); handleOpenCreateModal(b); }}
                              className="p-1 rounded-lg hover:bg-dark-800 text-slate-400 hover:text-white transition cursor-pointer"
                              title="Edit batch"
                            >
                              <Edit3 size={13} />
                            </button>
                            <button
                              onClick={(e) => handleDeleteBatch(b._id, e)}
                              className="p-1 rounded-lg hover:bg-rose-500/20 text-slate-400 hover:text-rose-400 transition cursor-pointer"
                              title="Delete batch"
                            >
                              <Trash2 size={13} />
                            </button>
                          </div>
                        )}
                      </div>

                      <div className="flex items-center justify-between mt-3 text-[10px] text-slate-400 pt-2 border-t border-dark-800/40">
                        <span className="flex items-center gap-1">
                          <Users size={12} className="text-slate-500" />
                          {b.students?.length || 0} Students
                        </span>
                        <span className="flex items-center gap-1">
                          <BookOpen size={12} className="text-slate-500" />
                          {b.extra_lessons?.length || 0} Lessons
                        </span>
                        {b.batch_fee > 0 && (
                          <span className="flex items-center gap-0.5 text-emerald-400 font-bold">
                            ₹{b.batch_fee}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>

        {/* Right Column: Comprehensive Feature-Rich Workbench (8 Cols) */}
        <div ref={workbenchRef} className="lg:col-span-8 scroll-mt-6">
          {!selectedBatchDetails ? (
            <div className="glass-panel p-12 rounded-3xl border border-dark-800/80 text-center space-y-3">
              <Zap size={40} className="mx-auto text-primary-400/40" />
              <h3 className="text-base font-bold text-white font-outfit">No Special Batch Selected</h3>
              <p className="text-xs text-slate-400 max-w-md mx-auto">
                Select a special batch from the left list to access its full suite of tools: merit roll rankings, daily attendance registers, exam ledgers, 7-day timetables, and LMS handouts.
              </p>
            </div>
          ) : (
            <div className="glass-panel rounded-3xl border border-dark-800/80 overflow-hidden shadow-2xl space-y-0">
              {/* Batch Banner & Quick Action Header */}
              <div className="p-6 bg-gradient-to-r from-dark-900 via-dark-850 to-primary-950/60 border-b border-dark-800/80 relative">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2.5">
                      <span className="p-2 rounded-xl bg-gradient-to-tr from-primary-600 to-indigo-500 text-white shadow-md">
                        <Zap size={18} />
                      </span>
                      <h2 className="text-xl font-extrabold text-white font-outfit">
                        {selectedBatchDetails.name}
                      </h2>
                      <span className="text-xs font-bold px-2.5 py-0.5 rounded-full bg-primary-500/10 text-primary-400 border border-primary-500/20">
                        {selectedBatchDetails.subject}
                      </span>
                    </div>
                    <p className="text-xs text-slate-400 max-w-xl">
                      {selectedBatchDetails.description || 'Dedicated specialized coaching cohort'}
                    </p>
                  </div>

                  {/* Actions Bar */}
                  <div className="flex items-center gap-2 flex-wrap">
                    <button
                      onClick={handleOpenBatchChat}
                      className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-primary-600 hover:bg-primary-500 text-white font-bold text-xs transition cursor-pointer shadow-md shadow-primary-500/20"
                      title="Open Live Chat Room & Voice Lounge"
                    >
                      <MessageSquare size={14} />
                      <span>Live Chat & Lounge</span>
                    </button>

                    {canManage && (
                      <button
                        onClick={handleTriggerBatchProgressReport}
                        className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-dark-900 hover:bg-dark-800 text-slate-200 hover:text-white border border-dark-750 font-medium text-xs transition cursor-pointer"
                        title="Send Batch Progress Report Emails to Parents"
                      >
                        <Mail size={14} className="text-amber-400" />
                        <span>Email Reports</span>
                      </button>
                    )}
                  </div>
                </div>

                {/* Sub-Tabs Bar */}
                <div className="flex items-center gap-1 mt-6 overflow-x-auto no-scrollbar border-b border-dark-800/60 pb-1 text-xs">
                  {[
                    { id: 'performance', label: 'Merit & Performance', icon: Award },
                    { id: 'roster', label: 'Enrolled Roster', icon: Users },
                    { id: 'attendance', label: 'Attendance Register', icon: Calendar },
                    { id: 'tests', label: 'Exam Score Ledger', icon: FileSpreadsheet },
                    { id: 'timetable', label: '7-Day Timetable', icon: Clock },
                    { id: 'lms', label: 'LMS Handouts', icon: BookOpen },
                  ].map(tab => {
                    const IconComponent = tab.icon;
                    const isActive = batchTab === tab.id;
                    return (
                      <button
                        key={tab.id}
                        onClick={() => setBatchTab(tab.id)}
                        className={`flex items-center gap-2 px-3.5 py-2.5 rounded-xl font-bold transition cursor-pointer shrink-0 border ${
                          isActive
                            ? 'bg-primary-600 text-white border-primary-500 shadow-md shadow-primary-500/20'
                            : 'bg-dark-950/40 text-slate-400 hover:text-white border-transparent hover:bg-dark-900/60'
                        }`}
                      >
                        <IconComponent size={14} />
                        <span>{tab.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Tab Contents Container */}
              <div className="p-6">
                {/* ----------------- TAB 1: MERIT & PERFORMANCE ----------------- */}
                {batchTab === 'performance' && (
                  <div className="space-y-6 animate-fadeIn">
                    {/* Key Metrics Cards */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                      <div className="bg-dark-900/60 p-4 rounded-2xl border border-dark-800/80">
                        <span className="text-[10px] text-slate-400 uppercase font-bold tracking-wider block">Enrolled Students</span>
                        <span className="text-xl font-extrabold text-white font-outfit">{selectedBatchDetails.students?.length || 0}</span>
                      </div>
                      <div className="bg-dark-900/60 p-4 rounded-2xl border border-dark-800/80">
                        <span className="text-[10px] text-slate-400 uppercase font-bold tracking-wider block">Attendance Sessions</span>
                        <span className="text-xl font-extrabold text-emerald-400 font-outfit">{selectedBatchDetails.attendance_records?.length || 0}</span>
                      </div>
                      <div className="bg-dark-900/60 p-4 rounded-2xl border border-dark-800/80">
                        <span className="text-[10px] text-slate-400 uppercase font-bold tracking-wider block">Total Exam Tests</span>
                        <span className="text-xl font-extrabold text-indigo-400 font-outfit">{selectedBatchDetails.test_scores?.length || 0}</span>
                      </div>
                      <div className="bg-dark-900/60 p-4 rounded-2xl border border-dark-800/80">
                        <span className="text-[10px] text-slate-400 uppercase font-bold tracking-wider block">LMS Handouts</span>
                        <span className="text-xl font-extrabold text-amber-400 font-outfit">{selectedBatchDetails.extra_lessons?.length || 0}</span>
                      </div>
                    </div>

                    {/* Personal Merit Standing Banner for Enrolled Student */}
                    {isStudent && myStudentPerformance && (
                      <div className="bg-gradient-to-r from-primary-950/60 via-indigo-950/40 to-dark-900 p-5 rounded-2xl border border-primary-500/40 shadow-xl flex flex-col sm:flex-row items-center justify-between gap-4 animate-slideUp">
                        <div className="flex items-center gap-3">
                          <div className="p-3 rounded-2xl bg-amber-500/20 text-amber-300 border border-amber-500/30 shrink-0">
                            <Award size={24} />
                          </div>
                          <div>
                            <h4 className="text-sm font-extrabold text-white font-outfit flex items-center gap-2">
                              Your Merit Standing: Rank #{myStudentPerformance.batch_merit_rank || 1}
                              <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                                Enrolled
                              </span>
                            </h4>
                            <p className="text-xs text-slate-300">
                              {myStudentPerformance.name} • Class {myStudentPerformance.class_level || 'N/A'} • Roll #{myStudentPerformance.roll_number || 'N/A'}
                            </p>
                          </div>
                        </div>

                        <div className="flex items-center gap-5 text-xs font-mono font-bold shrink-0">
                          <div className="text-center">
                            <span className="text-[10px] text-slate-400 block font-normal uppercase">Attendance</span>
                            <span className={`text-sm ${myStudentPerformance.batch_attendance_pct >= 75 ? 'text-emerald-400' : 'text-rose-400'}`}>
                              {myStudentPerformance.batch_attendance_pct || 0}%
                            </span>
                          </div>
                          <div className="text-center border-l border-dark-800 pl-4">
                            <span className="text-[10px] text-slate-400 block font-normal uppercase">Exam Avg</span>
                            <span className="text-sm text-indigo-400">{myStudentPerformance.batch_test_avg_pct || 0}%</span>
                          </div>
                          <div className="text-center border-l border-dark-800 pl-4">
                            <span className="text-[10px] text-slate-400 block font-normal uppercase">Merit Points</span>
                            <span className="text-sm text-amber-400">{myStudentPerformance.merit_score || 0} pts</span>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Progress-based Merit Roll Ranking Table */}
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <h3 className="text-sm font-bold text-white font-outfit flex items-center gap-2">
                          <Award size={16} className="text-amber-400" />
                          Progress-Based Merit Roll Leaderboard
                        </h3>
                        <span className="text-[10px] text-slate-400 font-mono">Weighted: 80% Exams + 20% Attendance</span>
                      </div>

                      <div className="overflow-x-auto rounded-2xl border border-dark-800/80">
                        <table className="w-full text-left text-xs min-w-[600px]">
                          <thead className="bg-dark-900/80 text-slate-400 uppercase font-mono text-[10px] border-b border-dark-800">
                            <tr>
                              <th className="p-3">Merit Rank</th>
                              <th className="p-3">Student Name</th>
                              <th className="p-3">Class Grade</th>
                              <th className="p-3">Batch Attendance %</th>
                              <th className="p-3">Batch Exam Avg %</th>
                              <th className="p-3 text-right">Composite Score</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-dark-850/60">
                            {!selectedBatchDetails.students || selectedBatchDetails.students.length === 0 ? (
                              <tr>
                                <td colSpan="6" className="p-6 text-center text-slate-500">
                                  No students enrolled in this special batch yet.
                                </td>
                              </tr>
                            ) : (
                              selectedBatchDetails.students
                                .filter(std => std && std._id)
                                .map((std, idx) => {
                                  const rank = std.batch_merit_rank || idx + 1;
                                  const isMe = currentStudentId && std._id?.toString() === currentStudentId.toString();
                                  let medalBadge = null;
                                  if (rank === 1) medalBadge = <span className="px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 font-bold border border-amber-500/40">🥇 1st Rank</span>;
                                  else if (rank === 2) medalBadge = <span className="px-2 py-0.5 rounded-full bg-slate-300/20 text-slate-200 font-bold border border-slate-300/40">🥈 2nd Rank</span>;
                                  else if (rank === 3) medalBadge = <span className="px-2 py-0.5 rounded-full bg-amber-700/20 text-amber-500 font-bold border border-amber-700/40">🥉 3rd Rank</span>;
                                  else medalBadge = <span className="font-mono text-slate-400 font-bold">#{rank}</span>;

                                  return (
                                    <tr key={std._id} className={`${isMe ? 'bg-primary-600/15 border-l-4 border-primary-500 font-bold' : 'hover:bg-dark-900/40'} transition`}>
                                      <td className="p-3">{medalBadge}</td>
                                      <td className="p-3 font-bold text-white flex items-center gap-2">
                                        <span>{std.name || 'Unnamed Student'}</span>
                                        {isMe && <span className="text-[9px] font-extrabold px-1.5 py-0.5 rounded bg-primary-500 text-white font-mono uppercase">YOU</span>}
                                      </td>
                                      <td className="p-3 text-slate-400 font-mono">Class {std.class_level || 'N/A'}</td>
                                      <td className="p-3">
                                        <span className={`font-mono font-bold ${std.batch_attendance_pct >= 75 ? 'text-emerald-400' : 'text-rose-400'}`}>
                                          {std.batch_attendance_pct || 0}%
                                        </span>
                                      </td>
                                      <td className="p-3">
                                        <span className="font-mono font-bold text-indigo-400">
                                          {std.batch_test_avg_pct || 0}%
                                        </span>
                                      </td>
                                      <td className="p-3 text-right">
                                        <span className="px-2.5 py-1 rounded-xl bg-primary-500/10 text-primary-400 border border-primary-500/20 font-bold font-mono">
                                          {std.merit_score || 0} pts
                                        </span>
                                      </td>
                                    </tr>
                                  );
                                })
                            )}
                          </tbody>
                        </table>
                      </div>
                    </div>

                    {/* Performance Trends Chart */}
                    {batchTestChartData.length > 0 && (
                      <div className="bg-dark-900/40 p-5 rounded-2xl border border-dark-800/80 space-y-3">
                        <h4 className="text-xs font-bold text-white font-outfit flex items-center gap-2">
                          <BarChart2 size={16} className="text-primary-400" />
                          Batch Exam Score Performance Trends
                        </h4>
                        <div className="h-64 w-full">
                          <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={batchTestChartData}>
                              <CartesianGrid strokeDasharray="3 3" stroke="#1f293d" />
                              <XAxis dataKey="name" stroke="#64748b" tick={{ fontSize: 10 }} />
                              <YAxis stroke="#64748b" tick={{ fontSize: 10 }} domain={[0, 100]} />
                              <Tooltip
                                contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', borderRadius: '12px', fontSize: '11px' }}
                              />
                              <Bar dataKey="avgPct" name="Class Avg %" fill="#6366f1" radius={[6, 6, 0, 0]} />
                            </BarChart>
                          </ResponsiveContainer>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* ----------------- TAB 2: ENROLLED ROSTER ----------------- */}
                {batchTab === 'roster' && (
                  <div className="space-y-4 animate-fadeIn">
                    <div className="flex items-center justify-between">
                      <h3 className="text-sm font-bold text-white font-outfit flex items-center gap-2">
                        <Users size={16} className="text-indigo-400" />
                        Enrolled Students ({selectedBatchDetails.students?.length || 0})
                      </h3>

                      {canManage && (
                        <button
                          onClick={() => setShowManageStudentsModal(true)}
                          className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-primary-600 hover:bg-primary-500 text-white font-bold text-xs transition cursor-pointer"
                        >
                          <UserPlus size={14} />
                          <span>Manage Enrollment</span>
                        </button>
                      )}
                    </div>

                    <div className="overflow-x-auto rounded-2xl border border-dark-800/80">
                      <table className="w-full text-left text-xs min-w-[600px]">
                        <thead className="bg-dark-900/80 text-slate-400 uppercase font-mono text-[10px] border-b border-dark-800">
                          <tr>
                            <th className="p-3">Rank</th>
                            <th className="p-3">Student Name</th>
                            <th className="p-3">Class Level</th>
                            <th className="p-3">Roll No.</th>
                            <th className="p-3">Attendance %</th>
                            <th className="p-3">Exam Avg %</th>
                            {canManage && <th className="p-3 text-right">Actions</th>}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-dark-850/60">
                          {!selectedBatchDetails.students || selectedBatchDetails.students.length === 0 ? (
                            <tr>
                              <td colSpan="7" className="p-6 text-center text-slate-500">
                                No students enrolled in this batch. Click "Manage Enrollment" to add students.
                              </td>
                            </tr>
                          ) : (
                            selectedBatchDetails.students
                              .filter(std => std && std._id)
                              .map((std, idx) => (
                              <tr key={std._id} className="hover:bg-dark-900/40 transition">
                                <td className="p-3 font-mono font-bold text-amber-400">#{std.batch_merit_rank || idx + 1}</td>
                                <td className="p-3 font-bold text-white">{std.name}</td>
                                <td className="p-3 font-mono text-slate-400">Class {std.class_level}</td>
                                <td className="p-3 font-mono text-slate-400">#{std.roll_number}</td>
                                <td className="p-3 font-mono font-bold text-emerald-400">{std.batch_attendance_pct}%</td>
                                <td className="p-3 font-mono font-bold text-indigo-400">{std.batch_test_avg_pct}%</td>
                                {canManage && (
                                  <td className="p-3 text-right">
                                    <button
                                      onClick={() => handleToggleStudentEnrollment(std._id)}
                                      className="p-1.5 rounded-lg bg-rose-500/10 text-rose-400 hover:bg-rose-500/20 transition cursor-pointer"
                                      title="Remove from batch"
                                    >
                                      <UserMinus size={14} />
                                    </button>
                                  </td>
                                )}
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* ----------------- TAB 3: ATTENDANCE REGISTER ----------------- */}
                {batchTab === 'attendance' && (
                  <div className="space-y-4 animate-fadeIn">
                    {isStudent ? (
                      <div className="space-y-4">
                        {/* Student Personal Attendance Summary Header */}
                        <div className="bg-dark-900/60 p-4 rounded-2xl border border-dark-800/80 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                          <div className="flex items-center gap-3">
                            <div className="p-3 rounded-xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                              <Calendar size={20} />
                            </div>
                            <div>
                              <h4 className="text-sm font-bold text-white font-outfit">Your Attendance History Record</h4>
                              <p className="text-xs text-slate-400">Total Recorded Sessions: {myAttendanceHistory.length}</p>
                            </div>
                          </div>
                          {myStudentPerformance && (
                            <div className="flex items-center gap-2">
                              <span className="text-xs text-slate-400 font-mono">Overall Rate:</span>
                              <span className={`text-base font-extrabold font-mono px-3 py-1 rounded-xl border ${
                                myStudentPerformance.batch_attendance_pct >= 75
                                  ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                                  : 'bg-rose-500/10 text-rose-400 border-rose-500/30'
                              }`}>
                                {myStudentPerformance.batch_attendance_pct}%
                              </span>
                            </div>
                          )}
                        </div>

                        <div className="overflow-x-auto rounded-2xl border border-dark-800/80">
                          <table className="w-full text-left text-xs min-w-[500px]">
                            <thead className="bg-dark-900/80 text-slate-400 uppercase font-mono text-[10px] border-b border-dark-800">
                              <tr>
                                <th className="p-3">Date</th>
                                <th className="p-3">Session Name</th>
                                <th className="p-3">Status</th>
                                <th className="p-3">Instructor Remarks</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-dark-850/60">
                              {myAttendanceHistory.length === 0 ? (
                                <tr>
                                  <td colSpan="4" className="p-6 text-center text-slate-500">
                                    No attendance records logged for your profile in this batch yet.
                                  </td>
                                </tr>
                              ) : (
                                myAttendanceHistory.map((rec, idx) => {
                                  let statusBadge = null;
                                  if (rec.status === 'Present') statusBadge = <span className="px-2.5 py-1 rounded-lg bg-emerald-500/20 text-emerald-300 font-bold border border-emerald-500/30">🟢 Present</span>;
                                  else if (rec.status === 'Absent') statusBadge = <span className="px-2.5 py-1 rounded-lg bg-rose-500/20 text-rose-300 font-bold border border-rose-500/30">🔴 Absent</span>;
                                  else if (rec.status === 'Late') statusBadge = <span className="px-2.5 py-1 rounded-lg bg-amber-500/20 text-amber-300 font-bold border border-amber-500/30">🟡 Late</span>;
                                  else if (rec.status === 'Excused') statusBadge = <span className="px-2.5 py-1 rounded-lg bg-indigo-500/20 text-indigo-300 font-bold border border-indigo-500/30">🔵 Excused</span>;

                                  return (
                                    <tr key={idx} className="hover:bg-dark-900/40 transition">
                                      <td className="p-3 font-mono text-white">{new Date(rec.date).toLocaleDateString()}</td>
                                      <td className="p-3 font-bold text-slate-300">{rec.session_name}</td>
                                      <td className="p-3">{statusBadge}</td>
                                      <td className="p-3 text-slate-400 italic">{rec.remarks || 'No remarks'}</td>
                                    </tr>
                                  );
                                })
                              )}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-dark-900/40 p-4 rounded-2xl border border-dark-800/80">
                          <div className="flex items-center gap-3">
                            <div>
                              <label className="text-[10px] text-slate-400 font-bold uppercase block">Date</label>
                              <input
                                type="date"
                                value={attendanceDate}
                                onChange={(e) => setAttendanceDate(e.target.value)}
                                className="bg-dark-950 border border-dark-800 rounded-xl px-3 py-1.5 text-xs text-white outline-none focus:border-primary-500"
                              />
                            </div>
                            <div>
                              <label className="text-[10px] text-slate-400 font-bold uppercase block">Session</label>
                              <select
                                value={attendanceSession}
                                onChange={(e) => setAttendanceSession(e.target.value)}
                                className="bg-dark-950 border border-dark-800 rounded-xl px-3 py-1.5 text-xs text-white outline-none focus:border-primary-500"
                              >
                                <option value="Session 1">Session 1</option>
                                <option value="Session 2">Session 2</option>
                                <option value="Extra Batch Session">Extra Batch Session</option>
                              </select>
                            </div>
                          </div>

                          {canManage && (
                            <div className="flex items-center gap-2">
                              <button
                                onClick={() => {
                                  const newMap = {};
                                  selectedBatchDetails.students?.forEach(s => { if (s && s._id) newMap[s._id] = 'Present'; });
                                  setAttendanceMap(newMap);
                                }}
                                className="px-3 py-1.5 rounded-xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-xs font-bold hover:bg-emerald-500/20 cursor-pointer"
                              >
                                Mark All Present
                              </button>
                              <button
                                onClick={handleCommitAttendance}
                                disabled={submitting}
                                className="px-4 py-1.5 rounded-xl bg-primary-600 text-white text-xs font-bold hover:bg-primary-500 transition cursor-pointer shadow-md"
                              >
                                {submitting ? 'Saving...' : 'Save Register'}
                              </button>
                            </div>
                          )}
                        </div>
                      </>
                    )}

                    {/* Attendance Register Matrix Table */}
                    <div className="overflow-x-auto rounded-2xl border border-dark-800/80">
                      <table className="w-full text-left text-xs min-w-[600px]">
                        <thead className="bg-dark-900/80 text-slate-400 uppercase font-mono text-[10px] border-b border-dark-800">
                          <tr>
                            <th className="p-3">Student Name</th>
                            <th className="p-3">Class Grade</th>
                            <th className="p-3">Attendance Status</th>
                            <th className="p-3">Remarks</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-dark-850/60">
                          {!selectedBatchDetails.students || selectedBatchDetails.students.length === 0 ? (
                            <tr>
                              <td colSpan="4" className="p-6 text-center text-slate-500">
                                No students enrolled to log attendance.
                              </td>
                            </tr>
                          ) : (
                            selectedBatchDetails.students
                              .filter(std => std && std._id)
                              .map(std => {
                              const currentStatus = attendanceMap[std._id] || 'Present';
                              return (
                                <tr key={std._id} className="hover:bg-dark-900/40 transition">
                                  <td className="p-3 font-bold text-white">{std.name}</td>
                                  <td className="p-3 font-mono text-slate-400">Class {std.class_level}</td>
                                  <td className="p-3">
                                    <div className="flex items-center gap-1.5">
                                      {['Present', 'Absent', 'Late', 'Excused'].map(st => {
                                        const isSelected = currentStatus === st;
                                        let activeStyle = '';
                                        if (st === 'Present') activeStyle = 'bg-emerald-500 text-white font-bold';
                                        else if (st === 'Absent') activeStyle = 'bg-rose-500 text-white font-bold';
                                        else if (st === 'Late') activeStyle = 'bg-amber-500 text-white font-bold';
                                        else if (st === 'Excused') activeStyle = 'bg-indigo-500 text-white font-bold';

                                        return (
                                          <button
                                            key={st}
                                            disabled={!canManage}
                                            onClick={() => setAttendanceMap(prev => ({ ...prev, [std._id]: st }))}
                                            className={`px-2.5 py-1 rounded-lg text-[10px] transition cursor-pointer border ${
                                              isSelected
                                                ? activeStyle
                                                : 'bg-dark-950/60 text-slate-400 border-dark-800 hover:text-white'
                                            }`}
                                          >
                                            {st}
                                          </button>
                                        );
                                      })}
                                    </div>
                                  </td>
                                  <td className="p-3">
                                    <input
                                      type="text"
                                      disabled={!canManage}
                                      placeholder="Optional remarks..."
                                      value={attendanceRemarksMap[std._id] || ''}
                                      onChange={(e) => setAttendanceRemarksMap(prev => ({ ...prev, [std._id]: e.target.value }))}
                                      className="bg-dark-950 border border-dark-800 rounded-lg px-2.5 py-1 text-xs text-white outline-none w-48"
                                    />
                                  </td>
                                </tr>
                              );
                            })
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* ----------------- TAB 4: EXAM SCORE LEDGER ----------------- */}
                {batchTab === 'tests' && (
                  <div className="space-y-4 animate-fadeIn">
                    <div className="flex items-center justify-between">
                      <h3 className="text-sm font-bold text-white font-outfit flex items-center gap-2">
                        <FileSpreadsheet size={16} className="text-indigo-400" />
                        Exam Test Score History ({selectedBatchDetails.test_scores?.length || 0})
                      </h3>

                      {canManage && (
                        <button
                          onClick={() => setShowAddTestModal(true)}
                          className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-primary-600 hover:bg-primary-500 text-white font-bold text-xs transition cursor-pointer"
                        >
                          <Plus size={14} />
                          <span>Log New Test Marks</span>
                        </button>
                      )}
                    </div>

                    <div className="space-y-3">
                      {!selectedBatchDetails.test_scores || selectedBatchDetails.test_scores.length === 0 ? (
                        <div className="p-8 text-center text-xs text-slate-500 bg-dark-900/40 rounded-2xl border border-dark-800">
                          No exam test score records logged yet.
                        </div>
                      ) : (
                        selectedBatchDetails.test_scores.map(ts => {
                          let sumPct = 0;
                          ts.scores?.forEach(sc => sumPct += (sc.marks_obtained / ts.total_marks) * 100);
                          const classAvgPct = ts.scores?.length > 0 ? (sumPct / ts.scores.length).toFixed(1) : 0;

                          return (
                            <div key={ts._id} className="bg-dark-900/40 p-4 rounded-2xl border border-dark-800/80 space-y-3">
                              <div className="flex items-center justify-between">
                                <div>
                                  <h4 className="text-xs font-bold text-white font-outfit flex items-center gap-2">
                                    {ts.test_name}
                                    <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-primary-500/10 text-primary-400 border border-primary-500/20">
                                      {ts.subject || selectedBatchDetails.subject}
                                    </span>
                                  </h4>
                                  <span className="text-[10px] text-slate-400 font-mono">
                                    Date: {new Date(ts.date).toLocaleDateString()} • Max Marks: {ts.total_marks} • Pass: {ts.passing_marks || 40}
                                  </span>
                                </div>

                                <div className="flex items-center gap-3">
                                  <span className="text-xs font-bold text-indigo-400 font-mono bg-indigo-500/10 border border-indigo-500/20 px-2.5 py-1 rounded-xl">
                                    Class Avg: {classAvgPct}%
                                  </span>

                                  {canManage && (
                                    <button
                                      onClick={() => handleDeleteTestRecord(ts._id)}
                                      className="p-1.5 rounded-lg hover:bg-rose-500/20 text-slate-400 hover:text-rose-400 transition cursor-pointer"
                                      title="Delete test record"
                                    >
                                      <Trash2 size={14} />
                                    </button>
                                  )}
                                </div>
                              </div>

                              {/* Student Marks Breakdown Grid */}
                              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 pt-2 border-t border-dark-800/40 text-xs">
                                {ts.scores?.map(sc => {
                                  const stdName = sc.student?.name || 'Student';
                                  const stdId = sc.student?._id || sc.student;
                                  const isMe = currentStudentId && stdId?.toString() === currentStudentId.toString();
                                  const pct = ((sc.marks_obtained / ts.total_marks) * 100).toFixed(1);
                                  const badge = getGradeBadge(pct);

                                  return (
                                    <div
                                      key={sc._id || stdId}
                                      className={`p-2.5 rounded-xl border flex items-center justify-between transition ${
                                        isMe
                                          ? 'bg-primary-600/20 border-primary-500/60 shadow-md font-bold'
                                          : 'bg-dark-950/60 border-dark-850'
                                      }`}
                                    >
                                      <div className="flex items-center gap-1.5 truncate">
                                        <span className="text-slate-200 font-medium truncate">{stdName}</span>
                                        {isMe && <span className="text-[8px] font-extrabold px-1 py-0.2 rounded bg-primary-500 text-white font-mono uppercase shrink-0">YOU</span>}
                                      </div>
                                      <div className="flex items-center gap-1.5 shrink-0">
                                        <span className="font-mono font-bold text-white">{sc.marks_obtained}/{ts.total_marks}</span>
                                        <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded border font-mono ${badge.color}`}>
                                          {badge.label}
                                        </span>
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>
                )}

                {/* ----------------- TAB 5: 7-DAY TIMETABLE GRID ----------------- */}
                {batchTab === 'timetable' && (
                  <div className="space-y-4 animate-fadeIn">
                    <div className="flex items-center justify-between">
                      <h3 className="text-sm font-bold text-white font-outfit flex items-center gap-2">
                        <Clock size={16} className="text-amber-400" />
                        Weekly 7-Day Timetable Grid
                      </h3>

                      {canManage && (
                        <button
                          onClick={() => {
                            setScheduleForm({
                              day: 'Monday',
                              period_name: `Period ${(selectedBatchDetails.schedule?.length || 0) + 1}`,
                              start_time: '16:00',
                              end_time: '17:30',
                              room: 'Extra Room 1',
                              subject: selectedBatchDetails.subject || '',
                              instructor_name: ''
                            });
                            setShowAddScheduleModal(true);
                          }}
                          className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-primary-600 hover:bg-primary-500 text-white font-bold text-xs transition cursor-pointer shadow-md shadow-primary-500/20"
                        >
                          <Plus size={14} />
                          <span>Add Schedule Slot</span>
                        </button>
                      )}
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                      {['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].map(dayName => {
                        const slots = selectedBatchDetails.schedule?.filter(s => s.day === dayName) || [];
                        return (
                          <div key={dayName} className="bg-dark-900/40 p-4 rounded-2xl border border-dark-800/80 space-y-2.5">
                            <h4 className="text-xs font-bold text-primary-400 uppercase tracking-wider font-mono flex items-center justify-between border-b border-dark-800 pb-2">
                              <span>{dayName}</span>
                              <span className="text-[10px] text-slate-500 font-normal">{slots.length} Slots</span>
                            </h4>

                            {slots.length === 0 ? (
                              <p className="text-[11px] text-slate-600 italic py-2">No slots scheduled</p>
                            ) : (
                              slots.map((st, sIdx) => (
                                <div
                                  key={st._id || sIdx}
                                  className="bg-dark-950/60 p-2.5 rounded-xl border border-dark-850 hover:border-dark-750 transition space-y-1.5 group relative"
                                >
                                  <div className="flex items-center justify-between text-xs font-bold text-white">
                                    <span className="truncate pr-2">{st.period_name || 'Period'}</span>
                                    <div className="flex items-center gap-1.5 shrink-0">
                                      <span className="text-[10px] text-emerald-400 font-mono px-1.5 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/20">
                                        {st.start_time} - {st.end_time}
                                      </span>
                                      {canManage && (
                                        <button
                                          type="button"
                                          onClick={(e) => handleRemoveScheduleSlot(st, e)}
                                          disabled={submitting}
                                          className="p-1 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 transition cursor-pointer disabled:opacity-50"
                                          title={`Remove ${st.period_name || 'slot'}`}
                                          aria-label="Remove schedule slot"
                                        >
                                          <Trash2 size={13} />
                                        </button>
                                      )}
                                    </div>
                                  </div>
                                  <div className="flex items-center justify-between text-[11px] text-slate-400">
                                    <span className="truncate pr-2">{st.subject || selectedBatchDetails.subject}</span>
                                    <span className="text-slate-500 font-mono shrink-0">{st.room || 'Room TBA'}</span>
                                  </div>
                                </div>
                              ))
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* ----------------- TAB 6: LMS HANDOUTS ----------------- */}
                {batchTab === 'lms' && (
                  <div className="space-y-4 animate-fadeIn">
                    <div className="flex items-center justify-between">
                      <h3 className="text-sm font-bold text-white font-outfit flex items-center gap-2">
                        <BookOpen size={16} className="text-emerald-400" />
                        Curriculum LMS Study Materials ({selectedBatchDetails.extra_lessons?.length || 0})
                      </h3>

                      {canManage && (
                        <button
                          onClick={() => setShowAddLessonModal(true)}
                          className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-primary-600 hover:bg-primary-500 text-white font-bold text-xs transition cursor-pointer"
                        >
                          <Plus size={14} />
                          <span>Upload Handout</span>
                        </button>
                      )}
                    </div>

                    <div className="space-y-3">
                      {!selectedBatchDetails.extra_lessons || selectedBatchDetails.extra_lessons.length === 0 ? (
                        <div className="p-8 text-center text-xs text-slate-500 bg-dark-900/40 rounded-2xl border border-dark-800">
                          No study material handouts uploaded yet.
                        </div>
                      ) : (
                        selectedBatchDetails.extra_lessons.map(les => (
                          <div key={les._id} className="bg-dark-900/40 p-4 rounded-2xl border border-dark-800/80 flex items-start justify-between gap-4">
                            <div className="space-y-1">
                              <div className="flex items-center gap-2">
                                <FileText size={16} className="text-primary-400" />
                                <h4 className="text-xs font-bold text-white font-outfit">{les.title}</h4>
                                <span className="text-[9px] px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-bold">
                                  {les.workflow_stage || 'Distributed'}
                                </span>
                              </div>
                              {les.content && <p className="text-xs text-slate-400">{les.content}</p>}
                              <span className="text-[10px] text-slate-500 font-mono block">
                                {new Date(les.date).toLocaleDateString()} {les.filesize && `• ${les.filesize}`}
                              </span>
                            </div>

                            <div className="flex items-center gap-2 shrink-0">
                              {les.file_url && (
                                <a
                                  href={les.file_url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="px-3 py-1.5 rounded-xl bg-dark-950 border border-dark-800 text-xs font-bold text-primary-400 hover:text-white transition flex items-center gap-1.5"
                                >
                                  <ExternalLink size={13} />
                                  <span>Download</span>
                                </a>
                              )}

                              {canManage && (
                                <button
                                  onClick={() => handleDeleteLesson(les._id)}
                                  className="p-1.5 rounded-lg hover:bg-rose-500/20 text-slate-400 hover:text-rose-400 transition cursor-pointer"
                                  title="Delete handout"
                                >
                                  <Trash2 size={14} />
                                </button>
                              )}
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ----------------- MODALS ----------------- */}

      {/* Create / Edit Special Batch Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fadeIn">
          <div className="bg-dark-900 border border-dark-800 w-full max-w-lg rounded-3xl shadow-2xl relative overflow-hidden max-h-[85dvh] flex flex-col">
            <div className="flex items-center justify-between border-b border-dark-800 p-5 shrink-0">
              <h3 className="text-base font-bold text-white font-outfit flex items-center gap-2">
                <Zap size={18} className="text-primary-400" />
                {editingBatch ? 'Edit Special Batch' : 'Create New Special Batch'}
              </h3>
              <button onClick={() => setShowCreateModal(false)} className="p-1 text-slate-400 hover:text-white cursor-pointer transition">
                <X size={16} />
              </button>
            </div>

            <form onSubmit={handleSubmitBatchForm} className="flex flex-col flex-1 overflow-hidden min-h-0">
              <div className="p-5 overflow-y-auto flex-1 overscroll-contain space-y-4">
                <div>
                  <label className="text-xs font-bold text-slate-300 block mb-1">Batch Name *</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g., Advanced Physics Olympiad"
                    value={batchForm.name}
                    onChange={(e) => setBatchForm(prev => ({ ...prev, name: e.target.value }))}
                    className="w-full bg-dark-950 border border-dark-800 rounded-xl px-3.5 py-2.5 text-xs text-white outline-none focus:border-primary-500"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-bold text-slate-300 block mb-1">Subject *</label>
                    <input
                      type="text"
                      required
                      placeholder="e.g., Physics"
                      value={batchForm.subject}
                      onChange={(e) => setBatchForm(prev => ({ ...prev, subject: e.target.value }))}
                      className="w-full bg-dark-950 border border-dark-800 rounded-xl px-3.5 py-2.5 text-xs text-white outline-none focus:border-primary-500"
                    />
                  </div>

                  <div>
                    <label className="text-xs font-bold text-slate-300 block mb-1">Batch Fee (₹)</label>
                    <input
                      type="number"
                      placeholder="e.g., 1500"
                      value={batchForm.batch_fee}
                      onChange={(e) => setBatchForm(prev => ({ ...prev, batch_fee: e.target.value }))}
                      className="w-full bg-dark-950 border border-dark-800 rounded-xl px-3.5 py-2.5 text-xs text-white outline-none focus:border-primary-500 font-mono"
                    />
                  </div>
                </div>

                <div>
                  <label className="text-xs font-bold text-slate-300 block mb-1">Description</label>
                  <textarea
                    rows="3"
                    placeholder="Batch goals, prerequisites..."
                    value={batchForm.description}
                    onChange={(e) => setBatchForm(prev => ({ ...prev, description: e.target.value }))}
                    className="w-full bg-dark-950 border border-dark-800 rounded-xl px-3.5 py-2.5 text-xs text-white outline-none focus:border-primary-500"
                  />
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 p-4 border-t border-dark-800 shrink-0 bg-dark-950/40">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="px-4 py-2 rounded-xl bg-dark-900 border border-dark-800 text-slate-300 text-xs font-bold hover:text-white cursor-pointer transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-5 py-2 rounded-xl bg-primary-600 text-white text-xs font-bold hover:bg-primary-500 transition cursor-pointer shadow-md shadow-primary-500/20 disabled:opacity-50"
                >
                  {submitting ? 'Saving...' : (editingBatch ? 'Save Changes' : 'Create Batch')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Manage Enrollment Modal */}
      {showManageStudentsModal && selectedBatchDetails && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fadeIn">
          <div className="bg-dark-900 border border-dark-800 w-full max-w-2xl rounded-3xl shadow-2xl relative overflow-hidden max-h-[85dvh] flex flex-col">
            <div className="flex items-center justify-between border-b border-dark-800 p-5 shrink-0">
              <div>
                <h3 className="text-base font-bold text-white font-outfit flex items-center gap-2">
                  <UserPlus size={18} className="text-primary-400" />
                  Manage Student Enrollment
                </h3>
                <span className="text-xs text-slate-400">Batch: {selectedBatchDetails.name}</span>
              </div>
              <button onClick={() => setShowManageStudentsModal(false)} className="p-1 text-slate-400 hover:text-white cursor-pointer transition">
                <X size={16} />
              </button>
            </div>

            {/* Filters */}
            <div className="p-4 border-b border-dark-800/60 flex items-center gap-3 shrink-0 bg-dark-950/40">
              <div className="bg-dark-900 border border-dark-800 rounded-xl px-3 py-2 flex items-center gap-2 flex-1">
                <Search size={14} className="text-slate-500" />
                <input
                  type="text"
                  placeholder="Search student by name or roll number..."
                  value={studentSearchFilter}
                  onChange={(e) => setStudentSearchFilter(e.target.value)}
                  className="bg-transparent text-xs text-white outline-none w-full"
                />
              </div>

              <select
                value={classFilterForStudentPicker}
                onChange={(e) => setClassFilterForStudentPicker(e.target.value)}
                className="bg-dark-900 border border-dark-800 rounded-xl px-3 py-2 text-xs text-white outline-none"
              >
                <option value="All">All Grade Classes</option>
                {classList.map(c => <option key={c} value={c}>Class {c}</option>)}
              </select>
            </div>

            {/* Students List */}
            <div className="flex-1 overflow-y-auto overscroll-contain p-4 space-y-2">
              {filteredStudentsForPicker.map(std => {
                const isEnrolled = selectedBatchDetails.students?.some(s => s._id === std._id);
                return (
                  <div
                    key={std._id}
                    className="p-3 rounded-2xl bg-dark-950/60 border border-dark-850 flex items-center justify-between"
                  >
                    <div>
                      <h4 className="text-xs font-bold text-white">{std.name}</h4>
                      <span className="text-[10px] text-slate-400 font-mono">Class {std.class_level} • Roll #{std.roll_number}</span>
                    </div>

                    <button
                      onClick={() => handleToggleStudentEnrollment(std._id)}
                      className={`px-3 py-1.5 rounded-xl text-xs font-bold transition cursor-pointer ${
                        isEnrolled
                          ? 'bg-rose-500/10 text-rose-400 border border-rose-500/20 hover:bg-rose-500/20'
                          : 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 hover:bg-emerald-500/20'
                      }`}
                    >
                      {isEnrolled ? 'Enrolled (Click to remove)' : '+ Enroll Student'}
                    </button>
                  </div>
                );
              })}
            </div>

            <div className="flex items-center justify-end p-4 border-t border-dark-800 shrink-0 bg-dark-950/40">
              <button
                type="button"
                onClick={() => setShowManageStudentsModal(false)}
                className="px-5 py-2 rounded-xl bg-dark-900 border border-dark-800 text-slate-300 text-xs font-bold hover:text-white cursor-pointer transition"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Upload LMS Handout Modal */}
      {showAddLessonModal && selectedBatchDetails && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fadeIn">
          <div className="bg-dark-900 border border-dark-800 w-full max-w-md rounded-3xl shadow-2xl relative overflow-hidden max-h-[85dvh] flex flex-col">
            <div className="flex items-center justify-between border-b border-dark-800 p-5 shrink-0">
              <h3 className="text-base font-bold text-white font-outfit flex items-center gap-2">
                <BookOpen size={18} className="text-primary-400" />
                Upload LMS Study Material
              </h3>
              <button onClick={() => setShowAddLessonModal(false)} className="p-1 text-slate-400 hover:text-white cursor-pointer transition"><X size={16} /></button>
            </div>

            <form onSubmit={handleAddLesson} className="flex flex-col flex-1 overflow-hidden min-h-0">
              <div className="p-5 overflow-y-auto flex-1 overscroll-contain space-y-3">
                <div>
                  <label className="text-xs font-bold text-slate-300 block mb-1">Title *</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g., Quantum Physics Handout 01"
                    value={lessonForm.title}
                    onChange={(e) => setLessonForm(prev => ({ ...prev, title: e.target.value }))}
                    className="w-full bg-dark-950 border border-dark-800 rounded-xl px-3.5 py-2 text-xs text-white outline-none focus:border-primary-500"
                  />
                </div>

                <div>
                  <label className="text-xs font-bold text-slate-300 block mb-1">Pipeline Workflow Stage</label>
                  <select
                    value={lessonForm.workflow_stage}
                    onChange={(e) => setLessonForm(prev => ({ ...prev, workflow_stage: e.target.value }))}
                    className="w-full bg-dark-950 border border-dark-800 rounded-xl px-3.5 py-2 text-xs text-white outline-none focus:border-primary-500"
                  >
                    <option value="Drafting">Drafting</option>
                    <option value="Notes Distributed">Notes Distributed</option>
                    <option value="Assignment Assigned">Assignment Assigned</option>
                    <option value="Revised">Revised</option>
                  </select>
                </div>

                <div>
                  <label className="text-xs font-bold text-slate-300 block mb-1">File Attachment (PDF, DOCX, Images)</label>
                  <input
                    type="file"
                    onChange={(e) => setLessonForm(prev => ({ ...prev, file: e.target.files[0] }))}
                    className="w-full bg-dark-950 border border-dark-800 rounded-xl px-3 py-2 text-xs text-slate-300 outline-none"
                  />
                </div>

                <div>
                  <label className="text-xs font-bold text-slate-300 block mb-1">Content Notes / Description</label>
                  <textarea
                    rows="2"
                    placeholder="Notes..."
                    value={lessonForm.content}
                    onChange={(e) => setLessonForm(prev => ({ ...prev, content: e.target.value }))}
                    className="w-full bg-dark-950 border border-dark-800 rounded-xl px-3.5 py-2 text-xs text-white outline-none"
                  />
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 p-4 border-t border-dark-800 shrink-0 bg-dark-950/40">
                <button
                  type="button"
                  onClick={() => setShowAddLessonModal(false)}
                  className="px-4 py-2 rounded-xl bg-dark-900 border border-dark-800 text-slate-300 text-xs font-bold hover:text-white cursor-pointer transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-5 py-2 rounded-xl bg-primary-600 text-white text-xs font-bold hover:bg-primary-500 transition cursor-pointer shadow-md shadow-primary-500/20 disabled:opacity-50"
                >
                  {submitting ? 'Uploading...' : 'Publish Handout'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Log Exam Test Score Modal */}
      {showAddTestModal && selectedBatchDetails && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fadeIn">
          <div className="bg-dark-900 border border-dark-800 w-full max-w-lg rounded-3xl shadow-2xl relative overflow-hidden max-h-[85dvh] flex flex-col">
            <div className="flex items-center justify-between border-b border-dark-800 p-5 shrink-0">
              <h3 className="text-base font-bold text-white font-outfit flex items-center gap-2">
                <FileSpreadsheet size={18} className="text-indigo-400" />
                Log Exam Test Score Entry
              </h3>
              <button onClick={() => setShowAddTestModal(false)} className="p-1 text-slate-400 hover:text-white cursor-pointer transition"><X size={16} /></button>
            </div>

            <form onSubmit={handleCommitTestScore} className="flex flex-col flex-1 overflow-hidden min-h-0">
              <div className="p-5 overflow-y-auto flex-1 overscroll-contain space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-bold text-slate-300 block mb-1">Test Name *</label>
                    <input
                      type="text"
                      required
                      placeholder="e.g., Weekly Quiz 01"
                      value={testForm.test_name}
                      onChange={(e) => setTestForm(prev => ({ ...prev, test_name: e.target.value }))}
                      className="w-full bg-dark-950 border border-dark-800 rounded-xl px-3.5 py-2 text-xs text-white outline-none focus:border-primary-500"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-bold text-slate-300 block mb-1">Subject</label>
                    <input
                      type="text"
                      value={testForm.subject}
                      onChange={(e) => setTestForm(prev => ({ ...prev, subject: e.target.value }))}
                      className="w-full bg-dark-950 border border-dark-800 rounded-xl px-3.5 py-2 text-xs text-white outline-none focus:border-primary-500"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-bold text-slate-300 block mb-1">Total Marks</label>
                    <input
                      type="number"
                      value={testForm.total_marks}
                      onChange={(e) => setTestForm(prev => ({ ...prev, total_marks: Number(e.target.value) }))}
                      className="w-full bg-dark-950 border border-dark-800 rounded-xl px-3.5 py-2 text-xs text-white outline-none focus:border-primary-500 font-mono"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-bold text-slate-300 block mb-1">Passing Marks</label>
                    <input
                      type="number"
                      value={testForm.passing_marks}
                      onChange={(e) => setTestForm(prev => ({ ...prev, passing_marks: Number(e.target.value) }))}
                      className="w-full bg-dark-950 border border-dark-800 rounded-xl px-3.5 py-2 text-xs text-white outline-none focus:border-primary-500 font-mono"
                    />
                  </div>
                </div>

                {/* Student Marks Inputs */}
                <div className="space-y-2 pt-2 border-t border-dark-800">
                  <label className="text-xs font-bold text-slate-300 block">Student Exam Marks Entry</label>
                  {selectedBatchDetails.students
                    ?.filter(std => std && std._id)
                    .map(std => (
                      <div key={std._id} className="flex items-center justify-between bg-dark-950/60 p-2.5 rounded-xl border border-dark-850">
                        <span className="text-xs text-white font-bold">{std.name || 'Unnamed Student'}</span>
                        <div className="flex items-center gap-1.5">
                          <input
                            type="number"
                            min="0"
                            max={testForm.total_marks}
                            value={(testForm.scores && testForm.scores[std._id]) || 0}
                            onChange={(e) => setTestForm(prev => ({
                              ...prev,
                              scores: { ...(prev.scores || {}), [std._id]: Number(e.target.value) }
                            }))}
                            className="w-20 bg-dark-900 border border-dark-800 rounded-lg px-2.5 py-1 text-xs text-white text-right font-mono outline-none focus:border-primary-500"
                          />
                          <span className="text-xs text-slate-500 font-mono">/ {testForm.total_marks}</span>
                        </div>
                      </div>
                  ))}
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 p-4 border-t border-dark-800 shrink-0 bg-dark-950/40">
                <button
                  type="button"
                  onClick={() => setShowAddTestModal(false)}
                  className="px-4 py-2 rounded-xl bg-dark-900 border border-dark-800 text-slate-300 text-xs font-bold hover:text-white cursor-pointer transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-5 py-2 rounded-xl bg-primary-600 text-white text-xs font-bold hover:bg-primary-500 transition cursor-pointer shadow-md shadow-primary-500/20 disabled:opacity-50"
                >
                  {submitting ? 'Saving...' : 'Save Exam Marks'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add Schedule Slot Modal */}
      {showAddScheduleModal && selectedBatchDetails && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fadeIn">
          <div className="bg-dark-900 border border-dark-800 w-full max-w-md rounded-3xl shadow-2xl relative overflow-hidden max-h-[85dvh] flex flex-col">
            <div className="flex items-center justify-between border-b border-dark-800 p-5 shrink-0">
              <h3 className="text-base font-bold text-white font-outfit flex items-center gap-2">
                <Clock size={18} className="text-amber-400" />
                Add Timetable Schedule Slot
              </h3>
              <button onClick={() => setShowAddScheduleModal(false)} className="p-1 text-slate-400 hover:text-white cursor-pointer transition"><X size={16} /></button>
            </div>

            <form onSubmit={handleAddScheduleSlot} className="flex flex-col flex-1 overflow-hidden min-h-0">
              <div className="p-5 overflow-y-auto flex-1 overscroll-contain space-y-3">
                <div>
                  <label className="text-xs font-bold text-slate-300 block mb-1">Day of Week</label>
                  <select
                    value={scheduleForm.day}
                    onChange={(e) => setScheduleForm(prev => ({ ...prev, day: e.target.value }))}
                    className="w-full bg-dark-950 border border-dark-800 rounded-xl px-3.5 py-2 text-xs text-white outline-none"
                  >
                    {['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].map(d => (
                      <option key={d} value={d}>{d}</option>
                    ))}
                  </select>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-bold text-slate-300 block mb-1">Period / Slot Name</label>
                    <input
                      type="text"
                      placeholder="e.g. Period 1"
                      value={scheduleForm.period_name}
                      onChange={(e) => setScheduleForm(prev => ({ ...prev, period_name: e.target.value }))}
                      className="w-full bg-dark-950 border border-dark-800 rounded-xl px-3.5 py-2 text-xs text-white outline-none"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-bold text-slate-300 block mb-1">Subject</label>
                    <input
                      type="text"
                      placeholder={selectedBatchDetails.subject || "e.g. Physics"}
                      value={scheduleForm.subject}
                      onChange={(e) => setScheduleForm(prev => ({ ...prev, subject: e.target.value }))}
                      className="w-full bg-dark-950 border border-dark-800 rounded-xl px-3.5 py-2 text-xs text-white outline-none"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-bold text-slate-300 block mb-1">Start Time</label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. 16:00"
                      value={scheduleForm.start_time}
                      onChange={(e) => setScheduleForm(prev => ({ ...prev, start_time: e.target.value }))}
                      className="w-full bg-dark-950 border border-dark-800 rounded-xl px-3.5 py-2 text-xs text-white outline-none font-mono"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-bold text-slate-300 block mb-1">End Time</label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. 17:30"
                      value={scheduleForm.end_time}
                      onChange={(e) => setScheduleForm(prev => ({ ...prev, end_time: e.target.value }))}
                      className="w-full bg-dark-950 border border-dark-800 rounded-xl px-3.5 py-2 text-xs text-white outline-none font-mono"
                    />
                  </div>
                </div>

                <div>
                  <label className="text-xs font-bold text-slate-300 block mb-1">Room Assignment</label>
                  <input
                    type="text"
                    placeholder="e.g. Extra Room 1"
                    value={scheduleForm.room}
                    onChange={(e) => setScheduleForm(prev => ({ ...prev, room: e.target.value }))}
                    className="w-full bg-dark-950 border border-dark-800 rounded-xl px-3.5 py-2 text-xs text-white outline-none"
                  />
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 p-4 border-t border-dark-800 shrink-0 bg-dark-950/40">
                <button
                  type="button"
                  onClick={() => setShowAddScheduleModal(false)}
                  className="px-4 py-2 rounded-xl bg-dark-900 border border-dark-800 text-slate-300 text-xs font-bold hover:text-white cursor-pointer transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-5 py-2 rounded-xl bg-primary-600 text-white text-xs font-bold hover:bg-primary-500 transition cursor-pointer shadow-md shadow-primary-500/20 disabled:opacity-50"
                >
                  {submitting ? 'Saving...' : 'Add Slot'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default SpecialBatchesPanel;
