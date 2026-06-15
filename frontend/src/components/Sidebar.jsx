import React, { useState, useEffect, useMemo } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import axios from 'axios';
import { useAuth } from '../context/AuthContext';
import { 
  LayoutDashboard, 
  Users, 
  CreditCard, 
  BookOpen, 
  MessageSquare, 
  Settings, 
  LogOut, 
  Menu, 
  X,
  GraduationCap,
  UserPlus
} from 'lucide-react';

import Logo from './Logo';

const Sidebar = ({ isOpen, setIsOpen }) => {
  const { user, logout, updateUserProfilePic } = useAuth();
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [avatarFile, setAvatarFile] = useState(null);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [avatarError, setAvatarError] = useState('');
  const [classesList, setClassesList] = useState([]);
  const navigate = useNavigate();

  // Password Change States
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPasswordSection, setShowPasswordSection] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);
  const [passwordError, setPasswordError] = useState('');
  const [passwordSuccess, setPasswordSuccess] = useState('');

  const handleCloseModal = () => {
    setShowProfileModal(false);
    setAvatarFile(null);
    setAvatarError('');
    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');
    setPasswordError('');
    setPasswordSuccess('');
    setShowPasswordSection(false);
  };

  const handlePasswordChangeSubmit = async (e) => {
    e.preventDefault();
    setPasswordError('');
    setPasswordSuccess('');

    if (newPassword !== confirmPassword) {
      setPasswordError('New passwords do not match.');
      return;
    }

    if (newPassword.length < 6) {
      setPasswordError('New password must be at least 6 characters long.');
      return;
    }

    setChangingPassword(true);
    try {
      const res = await axios.put('/api/auth/change-password', {
        currentPassword,
        newPassword
      });
      if (res.data.success) {
        setPasswordSuccess('Password updated successfully!');
        setCurrentPassword('');
        setNewPassword('');
        setConfirmPassword('');
        setTimeout(() => {
          setShowPasswordSection(false);
          setPasswordSuccess('');
        }, 2000);
      }
    } catch (err) {
      setPasswordError(err.response?.data?.message || 'Failed to update password.');
    } finally {
      setChangingPassword(false);
    }
  };

  useEffect(() => {
    const fetchClasses = async () => {
      try {
        const res = await axios.get('/api/classes');
        if (res.data.success) {
          setClassesList(res.data.data);
        }
      } catch (err) {
        console.error('Failed to load classes:', err);
      }
    };
    fetchClasses();
  }, []);

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const handleAvatarChange = (e) => {
    setAvatarFile(e.target.files[0]);
    setAvatarError('');
  };

  const handleAvatarUpload = async (e) => {
    e.preventDefault();
    if (!avatarFile) {
      setAvatarError('Please select an image file first.');
      return;
    }

    setUploadingAvatar(true);
    setAvatarError('');
    const formData = new FormData();
    formData.append('avatar', avatarFile);

    try {
      const res = await axios.put('/api/auth/profile-pic', formData, {
        headers: {
          'Content-Type': 'multipart/form-data'
        }
      });
      if (res.data.success) {
        updateUserProfilePic(res.data.profile_pic);
        setAvatarFile(null);
        const fileInput = document.getElementById('avatar-input-file');
        if (fileInput) fileInput.value = '';
      }
    } catch (err) {
      setAvatarError(err.response?.data?.message || 'Avatar upload failed.');
    } finally {
      setUploadingAvatar(false);
    }
  };

  const navItems = useMemo(() => {
    const items = [
      {
        name: 'Dashboard',
        path: '/',
        icon: LayoutDashboard,
        roles: ['SuperAdmin', 'Teacher', 'Student']
      }
    ];

    // Add dynamic classes
    classesList.forEach(cls => {
      items.push({
        name: `Class ${cls}`,
        path: `/class/${cls}`,
        icon: Users,
        roles: ['SuperAdmin', 'Teacher']
      });
    });

    // Add student class route
    items.push({
      name: 'My Class',
      path: `/class/${user?.studentProfile?.class_level || ''}`,
      icon: Users,
      roles: ['Student']
    });

    // Add the rest
    items.push(
      {
        name: 'Tuition Fees',
        path: '/fees',
        icon: CreditCard,
        roles: ['SuperAdmin', 'Teacher', 'Student']
      },
      {
        name: 'LMS Center',
        path: '/lms',
        icon: BookOpen,
        roles: ['SuperAdmin', 'Teacher', 'Student']
      },
      {
        name: 'Class Chats',
        path: '/chats',
        icon: MessageSquare,
        roles: ['SuperAdmin', 'Teacher', 'Student']
      },
      {
        name: 'Provision Users',
        path: '/register',
        icon: UserPlus,
        roles: ['SuperAdmin', 'Teacher']
      },
      {
        name: 'Automations',
        path: '/automations',
        icon: Settings,
        roles: ['SuperAdmin']
      }
    );

    return items;
  }, [classesList, user]);

  const filteredItems = useMemo(() => {
    return navItems.filter(item => item.roles.includes(user?.role));
  }, [navItems, user]);

  const toggleSidebar = () => setIsOpen(!isOpen);

  return (
    <>
      {/* Sidebar Container */}
      <aside className={`
        fixed inset-y-0 left-0 z-40 w-64 lg:static lg:block
        glass-panel border-r border-dark-800 flex flex-col justify-between
        transform ${isOpen ? 'translate-x-0' : '-translate-x-full'} lg:transform-none
        transition-transform duration-300 ease-in-out
      `}>
        {/* Header */}
        <div>
          <div className="h-20 flex items-center px-6 border-b border-dark-800/80 gap-3">
            <Logo className="border border-primary-500/35 rounded-xl bg-dark-900/40 glow-indigo" size={40} />
            <div>
              <h1 className="text-lg font-bold tracking-tight text-white font-outfit">EduStride</h1>
              <span className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold font-outfit">ERP & LMS Suite</span>
            </div>
          </div>

          {/* Navigation Links */}
          <nav className="p-4 space-y-1.5 overflow-y-auto max-h-[calc(100vh-18rem)]">
            {filteredItems.map((item) => (
              <NavLink
                key={item.name}
                to={item.path}
                onClick={() => setIsOpen(false)}
                className={({ isActive }) => `
                  flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all duration-200
                  ${isActive 
                    ? 'bg-primary-600/10 text-primary-400 border-l-4 border-primary-500 font-semibold shadow-inner' 
                    : 'text-slate-400 hover:bg-dark-900/60 hover:text-slate-200 border-l-4 border-transparent'}
                `}
              >
                <item.icon size={18} />
                <span>{item.name}</span>
              </NavLink>
            ))}
          </nav>
        </div>

        {/* User profile footer */}
        <div className="p-4 border-t border-dark-800/80 bg-dark-950/40">
          <div 
            onClick={() => setShowProfileModal(true)}
            className="flex items-center gap-3 mb-4 px-2 cursor-pointer hover:bg-dark-900/50 py-2 rounded-xl transition duration-150 group"
          >
            {user?.profile_pic ? (
              <img 
                src={user.profile_pic} 
                alt="Avatar" 
                className="w-10 h-10 rounded-xl object-cover border border-primary-500/20 group-hover:border-primary-500/45 shadow transition duration-150"
              />
            ) : (
              <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-primary-600 to-indigo-400 flex items-center justify-center font-bold text-white shadow group-hover:from-primary-500 group-hover:to-indigo-350 transition duration-150">
                {user?.email[0].toUpperCase()}
              </div>
            )}
            <div className="overflow-hidden flex-1">
              <p className="text-sm font-semibold text-white truncate group-hover:text-primary-300 transition duration-150">{user?.email}</p>
              <span className="text-[10px] font-semibold text-primary-400 bg-primary-950/60 px-2 py-0.5 rounded-full border border-primary-800/30">
                {user?.role}
              </span>
            </div>
          </div>
          <button
            onClick={handleLogout}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium text-rose-400 hover:bg-rose-500/10 hover:text-rose-300 transition duration-150 border border-transparent hover:border-rose-950/20"
          >
            <LogOut size={16} />
            <span>Sign Out</span>
          </button>
        </div>
      </aside>

      {/* Overlay when sidebar open on mobile */}
      {isOpen && (
        <div 
          onClick={toggleSidebar}
          className="lg:hidden fixed inset-0 z-30 bg-black/60 backdrop-blur-sm"
        />
      )}

      {/* --- PROFILE SETTINGS MODAL --- */}
      {showProfileModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4">
          <div className="glass-panel w-full max-w-md max-h-[90vh] overflow-y-auto rounded-2xl border border-dark-800 shadow-2xl relative animate-scaleUp">
            <div className="p-6 border-b border-dark-800 flex justify-between items-center">
              <h3 className="text-base font-bold text-white font-outfit">My Profile Settings</h3>
              <button onClick={handleCloseModal} className="text-slate-500 hover:text-white transition">
                <X size={20} />
              </button>
            </div>

            <div className="p-6 space-y-6">
              {/* Profile Avatar Display */}
              <div className="flex flex-col items-center gap-4 text-center">
                <div className="relative group">
                  {user?.profile_pic ? (
                    <img 
                      src={user.profile_pic} 
                      alt="Profile Large" 
                      className="w-24 h-24 rounded-2xl object-cover border-2 border-primary-500/30 shadow-lg"
                    />
                  ) : (
                    <div className="w-24 h-24 rounded-2xl bg-gradient-to-tr from-primary-600 to-indigo-400 flex items-center justify-center font-bold text-white text-4xl shadow-lg">
                      {user?.email[0].toUpperCase()}
                    </div>
                  )}
                </div>
                <div>
                  <h4 className="text-base font-bold text-white font-outfit">{user?.studentProfile?.name || 'Aether Member'}</h4>
                  <span className="text-xs text-primary-400 font-semibold">{user?.role} Account</span>
                </div>
              </div>

              {/* Upload Form */}
              <form onSubmit={handleAvatarUpload} className="space-y-4 pt-4 border-t border-dark-800/80">
                <h5 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Update Profile Picture</h5>
                {avatarError && (
                  <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs">
                    {avatarError}
                  </div>
                )}
                <div className="flex flex-col gap-3">
                  <input
                    id="avatar-input-file"
                    type="file"
                    accept="image/*"
                    onChange={handleAvatarChange}
                    className="w-full text-slate-550 text-xs file:mr-3 file:py-2 file:px-4 file:rounded-xl file:border-0 file:bg-dark-900 file:text-slate-350 file:hover:bg-dark-850 file:cursor-pointer outline-none transition"
                  />
                  <button
                    type="submit"
                    disabled={uploadingAvatar || !avatarFile}
                    className="w-full py-2.5 rounded-xl bg-primary-600 hover:bg-primary-500 disabled:opacity-40 disabled:hover:bg-primary-600 text-white font-semibold text-xs transition duration-150 flex items-center justify-center gap-1.5 shadow-md shadow-primary-500/10 cursor-pointer"
                  >
                    {uploadingAvatar ? 'Uploading...' : 'Save New Avatar'}
                  </button>
                </div>
              </form>

              {/* Details List */}
              <div className="pt-4 border-t border-dark-800/80 space-y-3 text-xs">
                <h5 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Account Meta Details</h5>
                <div className="flex justify-between p-2.5 rounded-lg bg-dark-900/40 border border-dark-850">
                  <span className="text-slate-500">Email Address</span>
                  <span className="text-white font-medium">{user?.email}</span>
                </div>
                {user?.role === 'Student' && user?.studentProfile && (
                  <>
                    <div className="flex justify-between p-2.5 rounded-lg bg-dark-900/40 border border-dark-850">
                      <span className="text-slate-500">Class Level</span>
                      <span className="text-white font-medium">Class {user.studentProfile.class_level}</span>
                    </div>
                    <div className="flex justify-between p-2.5 rounded-lg bg-dark-900/40 border border-dark-850">
                      <span className="text-slate-500">Roll Number</span>
                      <span className="text-white font-medium font-mono">{user.studentProfile.roll_number}</span>
                    </div>
                  </>
                )}
              </div>

              {/* Change Password Section */}
              <div className="pt-4 border-t border-dark-800/80 space-y-3">
                <button
                  type="button"
                  onClick={() => {
                    setShowPasswordSection(!showPasswordSection);
                    setPasswordError('');
                    setPasswordSuccess('');
                  }}
                  className="w-full flex justify-between items-center py-2.5 px-3 rounded-xl bg-dark-900/40 hover:bg-dark-900 border border-dark-850 hover:border-dark-800 text-xs font-semibold text-slate-300 transition duration-150 group cursor-pointer"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-slate-500 group-hover:text-primary-400 transition">🔒</span>
                    <span>Change Account Password</span>
                  </div>
                  <span className="text-slate-500 text-[10px] transition-transform duration-200" style={{ transform: showPasswordSection ? 'rotate(90deg)' : 'none' }}>
                    ▶
                  </span>
                </button>

                {showPasswordSection && (
                  <form onSubmit={handlePasswordChangeSubmit} className="space-y-4 pt-2 px-1">
                    {passwordError && (
                      <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs font-medium">
                        {passwordError}
                      </div>
                    )}
                    {passwordSuccess && (
                      <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-medium">
                        {passwordSuccess}
                      </div>
                    )}

                    <div className="space-y-3 text-xs">
                      <div>
                        <label className="block text-slate-400 font-semibold mb-1.5 uppercase tracking-wider text-[10px]">Current Password</label>
                        <input
                          type="password"
                          required
                          value={currentPassword}
                          onChange={(e) => { setCurrentPassword(e.target.value); setPasswordError(''); }}
                          placeholder="••••••••"
                          className="w-full px-3.5 py-2.5 rounded-lg bg-dark-900 border border-dark-850 text-white outline-none focus:border-primary-500 transition"
                        />
                      </div>
                      <div>
                        <label className="block text-slate-400 font-semibold mb-1.5 uppercase tracking-wider text-[10px]">New Password (min 6 chars)</label>
                        <input
                          type="password"
                          required
                          value={newPassword}
                          onChange={(e) => { setNewPassword(e.target.value); setPasswordError(''); }}
                          placeholder="••••••••"
                          className="w-full px-3.5 py-2.5 rounded-lg bg-dark-900 border border-dark-850 text-white outline-none focus:border-primary-500 transition"
                        />
                      </div>
                      <div>
                        <label className="block text-slate-400 font-semibold mb-1.5 uppercase tracking-wider text-[10px]">Confirm New Password</label>
                        <input
                          type="password"
                          required
                          value={confirmPassword}
                          onChange={(e) => { setConfirmPassword(e.target.value); setPasswordError(''); }}
                          placeholder="••••••••"
                          className="w-full px-3.5 py-2.5 rounded-lg bg-dark-900 border border-dark-850 text-white outline-none focus:border-primary-500 transition"
                        />
                      </div>
                      <button
                        type="submit"
                        disabled={changingPassword || !currentPassword || !newPassword || !confirmPassword}
                        className="w-full py-2.5 mt-2 rounded-xl bg-primary-600 hover:bg-primary-500 disabled:opacity-40 disabled:hover:bg-primary-600 text-white font-semibold text-xs transition duration-150 flex items-center justify-center gap-1.5 shadow-md shadow-primary-500/10 cursor-pointer"
                      >
                        {changingPassword ? 'Updating...' : 'Update Password'}
                      </button>
                    </div>
                  </form>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default Sidebar;
