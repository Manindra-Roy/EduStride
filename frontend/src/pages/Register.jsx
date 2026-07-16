import React, { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Mail, Lock, UserCheck, ArrowRight, GraduationCap, ShieldAlert, CheckCircle2, Trash2, Users, UserPlus, Edit, BookOpen, ArrowUp, ArrowDown, ChevronDown, ChevronUp, Eye, EyeOff, Database, Server, Check } from 'lucide-react';
import Logo from '../components/Logo';
import Footer from '../components/Footer';
import axios from 'axios';

const Register = () => {
  const { user, register } = useAuth();
  const navigate = useNavigate();

  const [initialized, setInitialized] = useState(true);
  const [checkingInit, setCheckingInit] = useState(true);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState('Student');
  const [classLevel, setClassLevel] = useState('');
  const [rollNumber, setRollNumber] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [classes, setClasses] = useState([]);

  // Class management state
  const [newClassName, setNewClassName] = useState('');
  const [creatingClass, setCreatingClass] = useState(false);
  const [deletingClassName, setDeletingClassName] = useState(null);
  const [editingClassName, setEditingClassName] = useState(null);
  const [editNewName, setEditNewName] = useState('');
  const [renamingClass, setRenamingClass] = useState(false);

  // Teachers management state
  const [activeTab, setActiveTab] = useState('provision');
  const [teachers, setTeachers] = useState([]);
  const [loadingTeachers, setLoadingTeachers] = useState(false);
  const [deletingTeacherId, setDeletingTeacherId] = useState(null);

  // Students management state
  const [students, setStudents] = useState([]);
  const [loadingStudents, setLoadingStudents] = useState(false);
  const [deletingStudentId, setDeletingStudentId] = useState(null);
  const [editingStudentId, setEditingStudentId] = useState(null);
  const [editStudentEmail, setEditStudentEmail] = useState('');
  const [updatingStudentEmail, setUpdatingStudentEmail] = useState(false);
  const [selectedClassFilter, setSelectedClassFilter] = useState('All');
  const [showPassword, setShowPassword] = useState(false);
  const [passwordStrength, setPasswordStrength] = useState({ score: 0, label: '', color: 'bg-dark-800' });

  const checkPasswordStrength = (pass) => {
    if (!pass) {
      setPasswordStrength({ score: 0, label: '', color: 'bg-dark-800' });
      return;
    }
    if (pass.length < 6) {
      setPasswordStrength({ score: 1, label: 'Weak', color: 'bg-rose-500' });
      return;
    }
    let score = 1;
    if (pass.length >= 8) score++;
    if (/[A-Z]/.test(pass)) score++;
    if (/[0-9]/.test(pass)) score++;
    if (/[^A-Za-z0-9]/.test(pass)) score++;

    let label = 'Weak';
    let color = 'bg-rose-500';
    if (score === 3) {
      label = 'Medium';
      color = 'bg-amber-500';
    } else if (score >= 4) {
      label = 'Strong';
      color = 'bg-emerald-500';
    }

    setPasswordStrength({ score, label, color });
  };

  const fetchClasses = async () => {
    try {
      const res = await axios.get('/api/classes');
      if (res.data.success && Array.isArray(res.data.data)) {
        setClasses(res.data.data);
        if (res.data.data.length > 0) {
          setClassLevel(prev => prev || res.data.data[0]);
        }
      }
    } catch (err) {
      console.error('Failed to load classes:', err);
    }
  };

  // Fetch classes
  useEffect(() => {
    fetchClasses();
  }, []);

  const handleAddClass = async (e) => {
    e.preventDefault();
    if (!newClassName.trim()) return;
    setCreatingClass(true);
    setError('');
    setSuccess('');
    try {
      const res = await axios.post('/api/classes', { name: newClassName.trim() });
      if (res.data.success) {
        setSuccess(`Class ${newClassName.trim().toUpperCase()} created successfully!`);
        setNewClassName('');
        fetchClasses();
        window.dispatchEvent(new Event('classesUpdated'));
      }
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to create class');
    } finally {
      setCreatingClass(false);
    }
  };

  const handleDeleteClass = async (className) => {
    if (!window.confirm(`Are you sure you want to delete Class ${className}? This will fail if students are assigned.`)) {
      return;
    }
    setDeletingClassName(className);
    setError('');
    setSuccess('');
    try {
      const res = await axios.delete(`/api/classes/${className}`);
      if (res.data.success) {
        setSuccess(`Class ${className} deleted successfully!`);
        fetchClasses();
        window.dispatchEvent(new Event('classesUpdated'));
      }
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to delete class');
    } finally {
      setDeletingClassName(null);
    }
  };

  const handleRenameClass = async (e) => {
    e.preventDefault();
    if (!editNewName.trim() || !editingClassName) return;
    setRenamingClass(true);
    setError('');
    setSuccess('');
    try {
      const res = await axios.put(`/api/classes/${editingClassName}`, { newName: editNewName.trim() });
      if (res.data.success) {
        setSuccess(`Successfully renamed Class ${editingClassName} to ${editNewName.trim().toUpperCase()}`);
        setEditingClassName(null);
        setEditNewName('');
        fetchClasses();
        window.dispatchEvent(new Event('classesUpdated'));
      }
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to rename class');
    } finally {
      setRenamingClass(false);
    }
  };

  const handleMoveClass = async (index, direction) => {
    if (direction === 'up' && index === 0) return;
    if (direction === 'down' && index === classes.length - 1) return;

    const newClasses = [...classes];
    const targetIndex = direction === 'up' ? index - 1 : index + 1;

    // Swap
    const temp = newClasses[index];
    newClasses[index] = newClasses[targetIndex];
    newClasses[targetIndex] = temp;

    // Optimistically update local state
    setClasses(newClasses);

    try {
      const res = await axios.put('/api/classes/order', { order: newClasses });
      if (res.data.success) {
        setSuccess('Class order updated successfully!');
        window.dispatchEvent(new Event('classesUpdated'));
      } else {
        fetchClasses();
        setError('Failed to update class order.');
      }
    } catch (err) {
      fetchClasses();
      setError(err.response?.data?.message || 'Failed to update class order.');
    }
  };

  // Check system initialization status
  useEffect(() => {
    const checkInitStatus = async () => {
      try {
        const res = await axios.get('/api/auth/init-status');
        if (res.data.success) {
          setInitialized(res.data.initialized);
          
          if (!res.data.initialized) {
            setRole('SuperAdmin');
          } else if (user) {
            if (user.role === 'SuperAdmin') setRole('Teacher');
            else if (user.role === 'Teacher') setRole('Student');
          }
        }
      } catch (err) {
        console.error('Failed to load system status:', err);
      } finally {
        setCheckingInit(false);
      }
    };
    checkInitStatus();
  }, [user]);

  // Protect student role redirection
  useEffect(() => {
    if (user && user.role === 'Student') {
      navigate('/');
    }
  }, [user, navigate]);

  const fetchTeachers = async () => {
    setLoadingTeachers(true);
    try {
      const res = await axios.get('/api/auth/teachers');
      if (res.data.success) {
        setTeachers(res.data.data);
      }
    } catch (err) {
      console.error('Failed to load teachers:', err);
      setError(err.response?.data?.message || 'Failed to load teachers list');
    } finally {
      setLoadingTeachers(false);
    }
  };

  useEffect(() => {
    if (user && user.role === 'SuperAdmin') {
      fetchTeachers();
    }
  }, [user]);

  const handleDeleteTeacher = async (teacherId, teacherEmail) => {
    if (!window.confirm(`Are you sure you want to delete the teacher account for ${teacherEmail}? This action cannot be undone.`)) {
      return;
    }
    setDeletingTeacherId(teacherId);
    setError('');
    setSuccess('');
    try {
      const res = await axios.delete(`/api/auth/teachers/${teacherId}`);
      if (res.data.success) {
        setSuccess(`Successfully deleted teacher ${teacherEmail}`);
        fetchTeachers();
      }
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to delete teacher');
    } finally {
      setDeletingTeacherId(null);
    }
  };

  const fetchStudents = async () => {
    setLoadingStudents(true);
    try {
      const res = await axios.get('/api/auth/students');
      if (res.data.success) {
        setStudents(res.data.data);
      }
    } catch (err) {
      console.error('Failed to load students:', err);
      setError(err.response?.data?.message || 'Failed to load students list');
    } finally {
      setLoadingStudents(false);
    }
  };



  useEffect(() => {
    if (user && (user.role === 'SuperAdmin' || user.role === 'Teacher')) {
      fetchStudents();
    }
  }, [user]);

  const handleUpdateStudentEmail = async (e, studentUserId) => {
    e.preventDefault();
    if (!editStudentEmail.trim()) return;
    setUpdatingStudentEmail(true);
    setError('');
    setSuccess('');
    try {
      const res = await axios.put(`/api/auth/students/${studentUserId}/email`, { email: editStudentEmail.trim().toLowerCase() });
      if (res.data.success) {
        setSuccess('Student email/login ID updated successfully');
        setEditingStudentId(null);
        fetchStudents();
      }
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to update student login ID');
    } finally {
      setUpdatingStudentEmail(false);
    }
  };

  const handleDeleteStudentAccount = async (studentUserId, studentEmail) => {
    if (!window.confirm(`Are you sure you want to delete the student login account for ${studentEmail}? The student profile (grades, attendance, ledger) will remain intact, but their portal access will be revoked.`)) {
      return;
    }
    setDeletingStudentId(studentUserId);
    setError('');
    setSuccess('');
    try {
      const res = await axios.delete(`/api/auth/students/${studentUserId}`);
      if (res.data.success) {
        setSuccess(`Successfully deleted student account for ${studentEmail}`);
        fetchStudents();
      }
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to delete student account');
    } finally {
      setDeletingStudentId(null);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    setSubmitting(true);

    const payload = { email, password, role };
    if (role === 'Student') {
      payload.class_level = classLevel;
      payload.roll_number = rollNumber;
    }

    try {
      if (user) {
        // Direct call so we keep the current SuperAdmin/Teacher logged-in session active
        const res = await axios.post('/api/auth/register', payload);
        if (res.data.success) {
          setSuccess(`Successfully registered ${role} account for ${email}!`);
          setEmail('');
          setPassword('');
          setRollNumber('');
        }
      } else {
        // Initial setup signup
        const result = await register(email, password, role, classLevel, rollNumber);
        if (result.success) {
          navigate('/');
        } else {
          setError(result.message);
        }
      }
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to register account');
    } finally {
      setSubmitting(false);
    }
  };

  if (checkingInit) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#07080a] bg-grid-pattern">
        <div className="animate-spin rounded-full h-10 w-10 border-t-2 border-primary-500"></div>
      </div>
    );
  }

  // Self-registration is disabled if system is initialized and user is NOT logged in
  if (!user && initialized) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#07080a] bg-grid-pattern px-4 relative overflow-hidden">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full bg-primary-600/5 blur-[150px] pointer-events-none" />
        <div className="w-full max-w-md z-10 text-center space-y-6">
          <div className="bg-primary-600/10 p-2 rounded-2xl border border-primary-500/20 glow-indigo mb-3 w-fit mx-auto animate-pulse">
            <Logo size={56} className="bg-dark-900/30 rounded-xl" />
          </div>
          
          <div className="glass-panel p-8 rounded-2xl border border-dark-800 space-y-5">
            <ShieldAlert size={48} className="text-rose-400 mx-auto" />
            <h2 className="text-xl font-bold text-white font-outfit">Self-Registration Disabled</h2>
            <p className="text-xs text-slate-400 leading-relaxed">
              This ERP portal requires account provisioning by institutional coordinators. Please contact your school administrator or class teacher to register your account.
            </p>
            <div className="pt-4 border-t border-dark-800">
              <Link
                to="/login"
                className="w-full py-2.5 rounded-xl bg-primary-600 hover:bg-primary-500 text-white font-semibold text-xs transition block shadow-lg"
              >
                Sign In to Portal
              </Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const filteredStudents = students.filter(student => {
    if (selectedClassFilter === 'All') return true;
    if (selectedClassFilter === 'Unassigned') {
      const cl = student.studentProfile?.class_level;
      return !cl || !classes.includes(cl);
    }
    return student.studentProfile?.class_level === selectedClassFilter;
  });

  return (
    <div className={user ? "w-full max-w-5xl mx-auto py-2" : "min-h-screen flex items-center justify-center bg-[#07080a] bg-grid-pattern px-4 relative overflow-hidden"}>
      {!user && (
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full bg-primary-600/10 blur-[150px] pointer-events-none" />
      )}

      <div className={`w-full ${user && (user.role === 'SuperAdmin' || user.role === 'Teacher') ? 'max-w-5xl' : 'max-w-md'} z-10 mx-auto transition-all duration-300`}>
        {user ? (
          <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-primary-900/40 via-dark-900/30 to-indigo-900/20 border border-dark-800/80 p-6 sm:p-8 shadow-xl mb-6">
            <div className="absolute top-0 right-0 p-8 opacity-10 pointer-events-none">
              <Users size={160} className="text-primary-500" />
            </div>
            <div className="relative z-10 space-y-2">
              <span className="px-2.5 py-1 rounded-md text-[10px] font-extrabold uppercase tracking-widest bg-primary-500/10 text-primary-400 border border-primary-500/20">
                Administration Hub
              </span>
              <h1 className="text-3xl font-extrabold tracking-tight text-white font-outfit mt-1">
                {activeTab === 'teachers' ? 'Provision Faculty' : activeTab === 'students' ? 'Provision Students' : activeTab === 'classes' ? 'Configure Classes' : 'System Administration'}
              </h1>
              <p className="text-slate-400 text-xs sm:text-sm max-w-2xl">
                {activeTab === 'teachers' ? 'Provision educator logins, revoke credentials, and audit active teachers.' : activeTab === 'students' ? 'Provision student login credentials, update student profiles, and manage enrollment Gmail IDs.' : activeTab === 'classes' ? 'Add new class levels, track course sections, and inspect dynamic student distributions.' : 'Manage institution records and system-wide configurations.'}
              </p>
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center mb-6 animate-fadeIn">
            <div className="bg-primary-600/10 p-2 rounded-2xl border border-primary-500/20 glow-indigo mb-3">
              <Logo size={56} className="bg-dark-900/30 rounded-xl" />
            </div>
            <h2 className="text-3xl font-extrabold text-white tracking-tight font-outfit">Initialize Intranet Portal</h2>
            <p className="text-slate-400 mt-1 text-sm font-medium">Setup the root SuperAdmin system account</p>
          </div>
        )}

        <div className="glass-panel p-4 sm:p-6 md:p-8 rounded-2xl border border-dark-800 shadow-2xl relative">
          <div className="absolute inset-0 bg-gradient-to-b from-white/5 to-transparent pointer-events-none rounded-2xl" />

          {/* Tabs - Show to SuperAdmin and Teacher */}
          {user && (user.role === 'SuperAdmin' || user.role === 'Teacher') && (
            <div className="flex overflow-x-auto gap-1.5 w-full scrollbar-none shrink-0 border-b border-dark-800 mb-6 bg-dark-900/40 p-1 rounded-xl">
              <button
                type="button"
                onClick={() => { setActiveTab('provision'); setError(''); setSuccess(''); }}
                className={`flex-1 py-2 px-3.5 text-xs font-bold rounded-lg transition-all duration-200 flex items-center justify-center gap-1.5 shrink-0 ${
                  activeTab === 'provision'
                    ? 'bg-primary-600 text-white shadow-md'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <UserPlus size={14} />
                <span>Provision</span>
              </button>
              
              {user.role === 'SuperAdmin' && (
                <button
                  type="button"
                  onClick={() => { setActiveTab('teachers'); setError(''); setSuccess(''); }}
                  className={`flex-1 py-2 px-3.5 text-xs font-bold rounded-lg transition-all duration-200 flex items-center justify-center gap-1.5 shrink-0 ${
                    activeTab === 'teachers'
                      ? 'bg-primary-600 text-white shadow-md'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <Users size={14} />
                  <span>Teachers</span>
                </button>
              )}

              <button
                type="button"
                onClick={() => { setActiveTab('students'); setError(''); setSuccess(''); }}
                className={`flex-1 py-2 px-3.5 text-xs font-bold rounded-lg transition-all duration-200 flex items-center justify-center gap-1.5 shrink-0 ${
                  activeTab === 'students'
                    ? 'bg-primary-600 text-white shadow-md'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <GraduationCap size={14} />
                <span>Students</span>
              </button>

              {user.role === 'SuperAdmin' && (
                <button
                  type="button"
                  onClick={() => { setActiveTab('classes'); setError(''); setSuccess(''); }}
                  className={`flex-1 py-2 px-3.5 text-xs font-bold rounded-lg transition-all duration-200 flex items-center justify-center gap-1.5 shrink-0 ${
                    activeTab === 'classes'
                      ? 'bg-primary-600 text-white shadow-md'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <BookOpen size={14} />
                  <span>Classes</span>
                </button>
              )}
            </div>
          )}

          {error && (
            <div className="mb-6 p-4 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-300 text-sm font-medium animate-fadeIn">
              {error}
            </div>
          )}

          {success && (
            <div className="mb-6 p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-sm font-medium flex items-center gap-2 animate-fadeIn">
              <CheckCircle2 size={16} />
              <span>{success}</span>
            </div>
          )}

          {user && user.role === 'SuperAdmin' && activeTab === 'classes' ? (
            <div className="space-y-6 animate-fadeIn">
              {/* Add Class Form */}
              <form onSubmit={handleAddClass} className="flex flex-col sm:flex-row gap-2 p-4 rounded-xl bg-dark-900 border border-dark-850">
                <input
                  type="text"
                  required
                  placeholder="New Class Name (e.g. XI)"
                  value={newClassName}
                  onChange={(e) => setNewClassName(e.target.value)}
                  className="flex-1 px-3.5 py-2.5 rounded-lg bg-dark-950 border border-dark-800 focus:border-primary-500 text-white text-xs outline-none w-full"
                />
                <button
                  type="submit"
                  disabled={creatingClass}
                  className="px-4 py-2.5 bg-primary-600 hover:bg-primary-500 disabled:opacity-50 text-white text-xs font-semibold rounded-lg transition shrink-0 w-full sm:w-auto"
                >
                  {creatingClass ? 'Adding...' : 'Add Class'}
                </button>
              </form>

              {/* Class list table */}
              <div className="overflow-x-auto rounded-xl border border-dark-800/80 bg-dark-900/20">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-dark-800 bg-dark-950/60 text-slate-400 uppercase tracking-wider font-bold font-mono">
                      <th className="py-3.5 px-4 w-24 text-center">Order</th>
                      <th className="py-3.5 px-4">Class Level Name</th>
                      <th className="py-3.5 px-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-dark-800/60">
                    {classes.map((cls, index) => {
                      const isEditing = editingClassName === cls;
                      return (
                        <tr key={cls} className="hover:bg-dark-900/30 transition-colors">
                          <td className="py-3.5 px-4 text-center">
                            <div className="flex items-center justify-center gap-1.5">
                              <button
                                type="button"
                                disabled={index === 0}
                                onClick={() => handleMoveClass(index, 'up')}
                                className="p-1.5 rounded-lg bg-dark-950 border border-dark-800 hover:border-primary-500/30 text-slate-400 hover:text-primary-400 disabled:opacity-20 disabled:pointer-events-none transition duration-150"
                                title="Move Up"
                              >
                                <ArrowUp size={13} />
                              </button>
                              <button
                                type="button"
                                disabled={index === classes.length - 1}
                                onClick={() => handleMoveClass(index, 'down')}
                                className="p-1.5 rounded-lg bg-dark-950 border border-dark-800 hover:border-primary-500/30 text-slate-400 hover:text-primary-400 disabled:opacity-20 disabled:pointer-events-none transition duration-150"
                                title="Move Down"
                              >
                                <ArrowDown size={13} />
                              </button>
                            </div>
                          </td>
                          <td className="py-3.5 px-4">
                            {isEditing ? (
                              <form onSubmit={handleRenameClass} className="flex items-center gap-2 max-w-xs" onClick={(e) => e.stopPropagation()}>
                                <input
                                  type="text"
                                  required
                                  value={editNewName}
                                  onChange={(e) => setEditNewName(e.target.value)}
                                  className="px-2 py-1 rounded bg-dark-950 border border-dark-800 text-white text-xs outline-none focus:border-primary-500"
                                />
                                <button
                                  type="submit"
                                  disabled={renamingClass}
                                  className="px-2 py-1 bg-emerald-600 hover:bg-emerald-500 text-white rounded text-[10px] font-bold"
                                >
                                  {renamingClass ? 'Saving...' : 'Save'}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setEditingClassName(null)}
                                  className="px-2 py-1 bg-dark-800 hover:bg-dark-750 text-slate-350 rounded text-[10px] font-bold"
                                >
                                  Cancel
                                </button>
                              </form>
                            ) : (
                              <span className="text-white font-semibold text-sm">Class {cls}</span>
                            )}
                          </td>
                          <td className="py-3.5 px-4 text-right">
                            {!isEditing && (
                              <div className="flex justify-end gap-2">
                                <button
                                  type="button"
                                  onClick={() => { setEditingClassName(cls); setEditNewName(cls); }}
                                  className="p-2 rounded-lg bg-sky-500/10 hover:bg-sky-500/20 text-sky-400 hover:text-sky-400 transition-colors border border-sky-950/20"
                                  title="Rename Class"
                                >
                                  <Edit size={14} className="text-sky-400" />
                                </button>
                                <button
                                  type="button"
                                  disabled={deletingClassName === cls}
                                  onClick={() => handleDeleteClass(cls)}
                                  className="p-2 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 hover:text-rose-400 transition-colors border border-rose-950/20 disabled:opacity-40"
                                  title="Delete Class"
                                >
                                  {deletingClassName === cls ? (
                                    <div className="w-4 h-4 border-2 border-rose-500/30 border-t-rose-500 rounded-full animate-spin" />
                                  ) : (
                                    <Trash2 size={14} />
                                  )}
                                </button>
                              </div>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ) : user && (user.role === 'SuperAdmin' || user.role === 'Teacher') && activeTab === 'students' ? (
            <div className="space-y-4 animate-fadeIn">
              {loadingStudents ? (
                <div className="py-12 flex flex-col items-center justify-center">
                  <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-primary-500"></div>
                  <p className="mt-3 text-xs text-slate-400 font-medium">Fetching students...</p>
                </div>
              ) : students.length === 0 ? (
                <div className="py-12 text-center border border-dashed border-dark-800 rounded-2xl bg-dark-900/10">
                  <GraduationCap className="mx-auto text-slate-500 mb-3" size={36} />
                  <p className="text-sm font-semibold text-white">No Students Found</p>
                  <p className="text-xs text-slate-400 mt-1">No student login accounts are currently provisioned.</p>
                </div>
              ) : (
                <>
                  {/* Class Filter Tabs */}
                  <div className="flex flex-wrap items-center gap-2 mb-4 border-b border-dark-800/60 pb-4">
                    <span className="text-slate-400 text-xs font-semibold mr-2 font-outfit">Filter by Class:</span>
                    <button
                      type="button"
                      onClick={() => setSelectedClassFilter('All')}
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all duration-200 ${
                        selectedClassFilter === 'All'
                          ? 'bg-primary-600 text-white shadow-lg shadow-primary-500/20'
                          : 'bg-dark-900/30 hover:bg-dark-900/60 text-slate-400 border border-dark-800 hover:text-white'
                      }`}
                    >
                      All ({students.length})
                    </button>
                    {classes.map(c => {
                      const count = students.filter(s => s.studentProfile?.class_level === c).length;
                      return (
                        <button
                          key={c}
                          type="button"
                          onClick={() => setSelectedClassFilter(c)}
                          className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all duration-200 ${
                            selectedClassFilter === c
                              ? 'bg-primary-600 text-white shadow-lg shadow-primary-500/20'
                              : 'bg-dark-900/30 hover:bg-dark-900/60 text-slate-400 border border-dark-800 hover:text-white'
                          }`}
                        >
                          Class {c} ({count})
                        </button>
                      );
                    })}
                    {students.filter(s => !s.studentProfile?.class_level || !classes.includes(s.studentProfile.class_level)).length > 0 && (
                      <button
                        type="button"
                        onClick={() => setSelectedClassFilter('Unassigned')}
                        className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all duration-200 ${
                          selectedClassFilter === 'Unassigned'
                            ? 'bg-primary-600 text-white shadow-lg shadow-primary-500/20'
                            : 'bg-dark-900/30 hover:bg-dark-900/60 text-slate-400 border border-dark-800 hover:text-white'
                        }`}
                      >
                        Unassigned ({students.filter(s => !s.studentProfile?.class_level || !classes.includes(s.studentProfile.class_level)).length})
                      </button>
                    )}
                  </div>

                  {/* Filtered Student Table */}
                  <div className="overflow-x-auto rounded-xl border border-dark-800/80 bg-dark-900/20">
                    {filteredStudents.length === 0 ? (
                      <div className="py-12 text-center text-slate-400 italic">
                        No students found matching this class filter.
                      </div>
                    ) : (
                      <table className="w-full text-left border-collapse text-xs">
                        <thead>
                          <tr className="border-b border-dark-800 bg-dark-950/60 text-slate-400 uppercase tracking-wider font-bold font-mono">
                            <th className="py-3.5 px-4">Student Profile</th>
                            <th className="py-3.5 px-4 hidden sm:table-cell">Class / Roll</th>
                            <th className="py-3.5 px-4 hidden md:table-cell">Created At</th>
                            <th className="py-3.5 px-4 text-right">Actions</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-dark-800/60">
                          {filteredStudents.map((studentAccount) => {
                            const isEditing = editingStudentId === studentAccount._id;
                            return (
                              <tr key={studentAccount._id} className="hover:bg-dark-900/30 transition-colors">
                                <td className="py-3.5 px-4">
                                  <div className="flex items-center gap-3">
                                    {studentAccount.profile_pic ? (
                                      <img
                                        src={studentAccount.profile_pic}
                                        alt="Avatar"
                                        className="w-8 h-8 rounded-lg object-cover border border-primary-500/20"
                                      />
                                    ) : (
                                      <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-primary-600 to-indigo-400 flex items-center justify-center font-bold text-white text-xs">
                                        {studentAccount.email[0].toUpperCase()}
                                      </div>
                                    )}
                                    <div className="flex-1">
                                      {isEditing ? (
                                        <form onSubmit={(e) => handleUpdateStudentEmail(e, studentAccount._id)} className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 max-w-md" onClick={(e) => e.stopPropagation()}>
                                          <input
                                            type="email"
                                            required
                                            value={editStudentEmail}
                                            onChange={(e) => setEditStudentEmail(e.target.value)}
                                            className="px-2 py-1 rounded bg-dark-950 border border-dark-800 text-white text-xs outline-none focus:border-primary-500 w-full sm:w-64"
                                            placeholder="New login/email address"
                                          />
                                          <div className="flex items-center gap-1.5 shrink-0">
                                            <button
                                              type="submit"
                                              disabled={updatingStudentEmail}
                                              className="px-2 py-1 bg-emerald-600 hover:bg-emerald-500 text-white rounded text-[10px] font-bold"
                                            >
                                              {updatingStudentEmail ? 'Saving...' : 'Save'}
                                            </button>
                                            <button
                                              type="button"
                                              onClick={() => setEditingStudentId(null)}
                                              className="px-2 py-1 bg-dark-800 hover:bg-dark-750 text-slate-350 rounded text-[10px] font-bold"
                                            >
                                              Cancel
                                            </button>
                                          </div>
                                        </form>
                                      ) : (
                                        <>
                                          <span className="text-white font-semibold block">{studentAccount.email}</span>
                                          <span className="text-[10px] text-slate-400 block mt-0.5 font-medium">
                                            Profile: {studentAccount.studentProfile?.name || 'Unlinked/Generic'}
                                          </span>
                                        </>
                                      )}
                                    </div>
                                  </div>
                                </td>
                                <td className="py-3.5 px-4 text-slate-300 font-mono hidden sm:table-cell">
                                  {studentAccount.studentProfile ? (
                                    <span>Class {studentAccount.studentProfile.class_level} • Roll {studentAccount.studentProfile.roll_number}</span>
                                  ) : (
                                    <span className="text-slate-500 font-sans italic">Not bound</span>
                                  )}
                                </td>
                                <td className="py-3.5 px-4 text-slate-400 font-mono hidden md:table-cell">
                                  {new Date(studentAccount.createdAt).toLocaleDateString(undefined, {
                                    year: 'numeric',
                                    month: 'short',
                                    day: 'numeric'
                                  })}
                                </td>
                                <td className="py-3.5 px-4 text-right">
                                  {!isEditing && (
                                    <div className="flex justify-end gap-2">
                                      <button
                                        type="button"
                                        onClick={() => { setEditingStudentId(studentAccount._id); setEditStudentEmail(studentAccount.email); }}
                                        className="p-2 rounded-lg bg-sky-500/10 hover:bg-sky-500/20 text-sky-400 hover:text-sky-400 transition-colors border border-sky-950/20"
                                        title="Edit Student Login ID/Email"
                                      >
                                        <Edit size={14} className="text-sky-400" />
                                      </button>
                                      <button
                                        type="button"
                                        disabled={deletingStudentId === studentAccount._id}
                                        onClick={() => handleDeleteStudentAccount(studentAccount._id, studentAccount.email)}
                                        className="p-2 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 hover:text-rose-400 transition-colors border border-rose-950/20 disabled:opacity-40"
                                        title="Delete Student Account"
                                      >
                                        {deletingStudentId === studentAccount._id ? (
                                          <div className="w-4 h-4 border-2 border-rose-500/30 border-t-rose-500 rounded-full animate-spin" />
                                        ) : (
                                          <Trash2 size={15} />
                                        )}
                                      </button>
                                    </div>
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    )}
                  </div>
                </>
              )}
            </div>
          ) : user && user.role === 'SuperAdmin' && activeTab === 'teachers' ? (
            <div className="space-y-4 animate-fadeIn">
              {loadingTeachers ? (
                <div className="py-12 flex flex-col items-center justify-center">
                  <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-primary-500"></div>
                  <p className="mt-3 text-xs text-slate-400 font-medium">Fetching teachers...</p>
                </div>
              ) : teachers.length === 0 ? (
                <div className="py-12 text-center border border-dashed border-dark-800 rounded-2xl bg-dark-900/10">
                  <Users className="mx-auto text-slate-500 mb-3" size={36} />
                  <p className="text-sm font-semibold text-white">No Teachers Found</p>
                  <p className="text-xs text-slate-400 mt-1">No academic educators are currently provisioned.</p>
                </div>
              ) : (
                <div className="overflow-x-auto rounded-xl border border-dark-800/80 bg-dark-900/20">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="border-b border-dark-800 bg-dark-950/60 text-slate-400 uppercase tracking-wider font-bold font-mono">
                        <th className="py-3.5 px-4">Educator</th>
                        <th className="py-3.5 px-4 hidden sm:table-cell">Created At</th>
                        <th className="py-3.5 px-4 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-dark-800/60">
                      {teachers.map((teacher) => (
                        <tr key={teacher._id} className="hover:bg-dark-900/30 transition-colors">
                          <td className="py-3.5 px-4">
                            <div className="flex items-center gap-3">
                              {teacher.profile_pic ? (
                                <img
                                  src={teacher.profile_pic}
                                  alt="Avatar"
                                  className="w-8 h-8 rounded-lg object-cover border border-primary-500/20"
                                />
                              ) : (
                                <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-primary-600 to-indigo-400 flex items-center justify-center font-bold text-white text-xs">
                                  {teacher.email[0].toUpperCase()}
                                </div>
                              )}
                              <div>
                                <span className="text-white font-semibold block">{teacher.email}</span>
                                <span className="text-[10px] text-primary-400 bg-primary-950/40 px-1.5 py-0.5 rounded border border-primary-800/25 mt-0.5 inline-block">
                                  {teacher.role}
                                </span>
                              </div>
                            </div>
                          </td>
                          <td className="py-3.5 px-4 text-slate-450 font-mono hidden sm:table-cell">
                            {new Date(teacher.createdAt).toLocaleDateString(undefined, {
                              year: 'numeric',
                              month: 'short',
                              day: 'numeric'
                            })}
                          </td>
                          <td className="py-3.5 px-4 text-right">
                            <button
                              type="button"
                              disabled={deletingTeacherId === teacher._id}
                              onClick={() => handleDeleteTeacher(teacher._id, teacher.email)}
                              className="p-2 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 hover:text-rose-400 transition-colors border border-rose-950/20 disabled:opacity-40"
                              title="Delete Teacher"
                            >
                              {deletingTeacherId === teacher._id ? (
                                <div className="w-4 h-4 border-2 border-rose-500/30 border-t-rose-500 rounded-full animate-spin" />
                              ) : (
                                <Trash2 size={15} />
                              )}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ) : (
              <div className="grid grid-cols-1 md:grid-cols-12 gap-8 animate-fadeIn">
                {/* Form Column */}
                <form onSubmit={handleSubmit} className="space-y-4 md:col-span-7">
                  <div>
                    <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">Account Role</label>
                    <div className="relative">
                      <span className="absolute inset-y-0 left-0 pl-3.5 flex items-center text-slate-500">
                        <UserCheck size={18} />
                      </span>
                      
                      {/* Conditionally render dropdown options depending on creator role */}
                      {!user ? (
                        <select
                          value={role}
                          disabled
                          className="w-full pl-11 pr-4 py-3 rounded-xl bg-dark-900 border border-dark-800 text-slate-450 text-sm outline-none appearance-none cursor-not-allowed"
                        >
                          <option value="SuperAdmin">SuperAdmin (System Owner)</option>
                        </select>
                      ) : user.role === 'SuperAdmin' ? (
                        <select
                          value={role}
                          onChange={(e) => setRole(e.target.value)}
                          className="w-full pl-11 pr-10 py-3 rounded-xl bg-dark-900 border border-dark-800 focus:border-primary-500 text-white transition outline-none text-sm appearance-none cursor-pointer"
                        >
                          <option value="Teacher">Academic Educator (Teacher)</option>
                          <option value="Student">Student / Parent Portal</option>
                        </select>
                      ) : (
                        <select
                          value={role}
                          disabled
                          className="w-full pl-11 pr-4 py-3 rounded-xl bg-dark-900 border border-dark-800 text-slate-450 text-sm outline-none appearance-none cursor-not-allowed"
                        >
                          <option value="Student">Student / Parent Portal</option>
                        </select>
                      )}
                      <span className="absolute inset-y-0 right-0 pr-3.5 flex items-center text-slate-500 pointer-events-none">
                        <ChevronDown size={16} />
                      </span>
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">Email Address</label>
                    <div className="relative">
                      <span className="absolute inset-y-0 left-0 pl-3.5 flex items-center text-slate-500">
                        <Mail size={18} />
                      </span>
                      <input
                        type="email"
                        required
                        placeholder="name@institution.com"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        className="w-full pl-11 pr-4 py-3 rounded-xl bg-dark-900 border border-dark-800 focus:border-primary-500 focus:ring-1 focus:ring-primary-500 text-white placeholder-slate-500 transition duration-150 outline-none text-sm"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">Password</label>
                    <div className="relative">
                      <span className="absolute inset-y-0 left-0 pl-3.5 flex items-center text-slate-500">
                        <Lock size={18} />
                      </span>
                      <input
                        type={showPassword ? "text" : "password"}
                        required
                        placeholder="••••••••"
                        value={password}
                        onChange={(e) => {
                          setPassword(e.target.value);
                          checkPasswordStrength(e.target.value);
                        }}
                        className="w-full pl-11 pr-10 py-3 rounded-xl bg-dark-900 border border-dark-800 focus:border-primary-500 focus:ring-1 focus:ring-primary-500 text-white placeholder-slate-500 transition duration-150 outline-none text-sm"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-500 hover:text-white transition"
                      >
                        {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                      </button>
                    </div>
                    {/* Password Strength Meter */}
                    {password && (
                      <div className="mt-2.5 animate-fadeIn">
                        <div className="flex items-center justify-between text-[10px] mb-1">
                          <span className="text-slate-400 font-semibold uppercase tracking-wider">Password Strength:</span>
                          <span className={`font-bold ${
                            passwordStrength.label === 'Strong' ? 'text-emerald-400' :
                            passwordStrength.label === 'Medium' ? 'text-amber-400' : 'text-rose-400'
                          }`}>
                            {passwordStrength.label}
                          </span>
                        </div>
                        <div className="h-1.5 w-full bg-dark-950 rounded-full overflow-hidden border border-dark-850">
                          <div
                            className={`h-full ${passwordStrength.color} transition-all duration-300`}
                            style={{ width: `${(passwordStrength.score / 5) * 100}%` }}
                          />
                        </div>
                      </div>
                    )}
                  </div>

                  {role === 'Student' && (
                    <div className="p-4 rounded-xl bg-primary-950/20 border border-primary-500/10 space-y-4 animate-fadeIn">
                      <p className="text-xs text-primary-400 font-medium">
                        Note: The student profile must already exist in the system (created in class lists) to bind.
                      </p>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div>
                          <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">Class Level</label>
                          <div className="relative">
                            <select
                              value={classLevel}
                              onChange={(e) => setClassLevel(e.target.value)}
                              className="w-full pl-3 pr-10 py-2.5 rounded-lg bg-dark-900 border border-dark-800 focus:border-primary-500 text-white text-sm outline-none appearance-none cursor-pointer"
                            >
                              {classes.map((c) => (
                                <option key={c} value={c}>Class {c}</option>
                              ))}
                            </select>
                            <span className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-500 pointer-events-none">
                              <ChevronDown size={14} />
                            </span>
                          </div>
                        </div>
                        <div>
                          <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">Roll Number</label>
                          <input
                            type="text"
                            required
                            placeholder="e.g. 1"
                            value={rollNumber}
                            onChange={(e) => setRollNumber(e.target.value)}
                            className="w-full px-3 py-2.5 rounded-lg bg-dark-900 border border-dark-800 focus:border-primary-500 text-white placeholder-slate-600 text-sm outline-none"
                          />
                        </div>
                      </div>
                      <span className="text-[10px] text-slate-500 leading-relaxed block mt-1">
                        Enter your current progress-based roll number. Roll numbers automatically adjust as classroom progress changes.
                      </span>
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={submitting}
                    className="w-full mt-6 py-3 rounded-xl bg-primary-600 hover:bg-primary-500 active:bg-primary-750 text-white font-medium text-sm transition duration-150 flex items-center justify-center gap-2 shadow-lg hover:shadow-primary-500/10"
                  >
                    {submitting ? (
                      <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    ) : (
                      <>
                        <span>{user ? 'Provision User' : 'Initialize Owner'}</span>
                        <ArrowRight size={16} />
                      </>
                    )}
                  </button>
                </form>

                {/* Stats & Info Column */}
                <div className="md:col-span-5 space-y-6">
                  {/* System Stats Card */}
                  <div className="bg-dark-900/40 border border-dark-800/80 rounded-xl p-5 space-y-4">
                    <h4 className="text-xs font-bold text-white uppercase tracking-wider border-b border-dark-800 pb-2 flex items-center gap-2">
                      <Server size={14} className="text-primary-400" />
                      System Status
                    </h4>
                    
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-slate-400">Database Status:</span>
                        <span className="flex items-center gap-1.5 text-xs text-emerald-400 font-semibold font-mono">
                          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-ping shrink-0" />
                          Online
                        </span>
                      </div>

                      <div className="flex items-center justify-between">
                        <span className="text-xs text-slate-400">Total Classes Configured:</span>
                        <span className="text-xs text-white font-bold font-mono">{classes.length}</span>
                      </div>

                      {user?.role === 'SuperAdmin' && (
                        <div className="flex items-center justify-between">
                          <span className="text-xs text-slate-400">Provisioned Teachers:</span>
                          <span className="text-xs text-white font-bold font-mono">{teachers.length}</span>
                        </div>
                      )}

                      <div className="flex items-center justify-between">
                        <span className="text-xs text-slate-400">Provisioned Students:</span>
                        <span className="text-xs text-white font-bold font-mono">{students.length}</span>
                      </div>
                    </div>
                  </div>

                  {/* Provisioning Guide */}
                  <div className="bg-primary-950/10 border border-primary-900/20 rounded-xl p-5 space-y-3">
                    <h4 className="text-xs font-bold text-primary-400 uppercase tracking-wider flex items-center gap-2">
                      <Database size={14} />
                      Provisioning Rules
                    </h4>
                    <ul className="space-y-2.5 text-xs text-slate-400 leading-relaxed list-none pl-0">
                      <li className="flex gap-2">
                        <Check size={14} className="text-primary-500 shrink-0 mt-0.5" />
                        <span><strong>Valid Emails Only:</strong> Student/Teacher user accounts require valid Gmail or GSuite addresses.</span>
                      </li>
                      <li className="flex gap-2">
                        <Check size={14} className="text-primary-500 shrink-0 mt-0.5" />
                        <span><strong>Student Binding:</strong> Prior to provision student portal access, ensure their academic profile is added under class levels.</span>
                      </li>
                      <li className="flex gap-2">
                        <Check size={14} className="text-primary-500 shrink-0 mt-0.5" />
                        <span><strong>Permissions:</strong> Administrators are fully audited. Account revocation removes portal access immediately.</span>
                      </li>
                    </ul>
                  </div>
                </div>
              </div>
          )}
        </div>

        {/* Footer actions */}
        <p className="text-center text-slate-400 text-sm mt-6">
          {user ? (
            <Link to="/" className="text-primary-400 hover:text-primary-300 font-semibold transition">
              Back to Dashboard
            </Link>
          ) : (
            <>
              Already initialized?{' '}
              <Link to="/login" className="text-primary-400 hover:text-primary-300 font-semibold transition">
                Sign In
              </Link>
            </>
          )}
        </p>

        {!user && <Footer className="border-t-0 mt-8 pt-4 justify-center sm:flex-col sm:gap-2 opacity-75" />}
      </div>
    </div>
  );
};

export default Register;
