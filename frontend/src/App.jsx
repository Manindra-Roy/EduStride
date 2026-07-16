import React, { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { CallProvider } from './context/CallContext';
import Sidebar from './components/Sidebar';
import Preloader from './components/Preloader';
import Logo from './components/Logo';
import Footer from './components/Footer';
import PageTitleUpdater from './components/PageTitleUpdater';
import { Menu, X } from 'lucide-react';
import { applyThemeAccent, getSavedThemeAccent } from './config/theme';
import axios from 'axios';

// Pages
import Login from './pages/Login';
import Register from './pages/Register';
import Dashboard from './pages/Dashboard';
import ClassGrid from './pages/ClassGrid';
import FeeLedgerPanel from './pages/FeeLedgerPanel';
import LmsDownload from './pages/LmsDownload';
import ClassChat from './pages/ClassChat';
import AutomationsPanel from './pages/AutomationsPanel';

const ProtectedRoute = ({ children, allowedRoles }) => {
  const { user, token, loading } = useAuth();

  if (loading) {
    return <Preloader loading={loading} />;
  }

  if (!token) {
    return <Navigate to="/login" replace />;
  }

  if (allowedRoles && user && !allowedRoles.includes(user.role)) {
    return <Navigate to="/" replace />;
  }

  return children;
};

const Layout = () => {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const location = useLocation();
  const [viewportHeight, setViewportHeight] = useState('100vh');

  const isChatPage = location.pathname === '/chats';

  useEffect(() => {
    if (!window.visualViewport) return;

    const handleResize = () => {
      setViewportHeight(`${window.visualViewport.height}px`);
      // Reset scroll layout offset with delay to override browser's async auto-scroll
      setTimeout(() => {
        window.scrollTo(0, 0);
        document.body.scrollTop = 0;
        document.documentElement.scrollTop = 0;
      }, 30);
    };

    window.visualViewport.addEventListener('resize', handleResize);
    window.visualViewport.addEventListener('scroll', handleResize);
    
    // Initial calculation
    handleResize();

    return () => {
      window.visualViewport.removeEventListener('resize', handleResize);
      window.visualViewport.removeEventListener('scroll', handleResize);
    };
  }, []);

  return (
    <div 
      style={{ height: viewportHeight }}
      className="w-full flex flex-col lg:flex-row bg-[#07080a] text-slate-100 overflow-hidden relative bg-grid-pattern"
    >
      {/* Background Glow Design Elements */}
      <div className="fixed inset-0 pointer-events-none glow-bg z-0" />
      <div className="fixed -top-48 -left-48 w-[600px] h-[600px] rounded-full bg-primary-600/10 blur-[180px] pointer-events-none z-0 animate-pulse" style={{ animationDuration: '8s' }} />
      <div className="fixed -bottom-48 -right-48 w-[600px] h-[600px] rounded-full bg-indigo-600/10 blur-[180px] pointer-events-none z-0 animate-pulse" style={{ animationDuration: '8s' }} />

      {/* Sidebar navigation */}
      <Sidebar isOpen={sidebarOpen} setIsOpen={setSidebarOpen} />
      
      {/* Main Panel Content Container */}
      <div 
        className="flex-1 flex flex-col overflow-hidden z-10 relative h-full"
      >
        {/* Sticky Mobile Header */}
        {!isChatPage && (
          <header className="lg:hidden flex items-center justify-between px-5 py-4 bg-dark-900/40 backdrop-blur-md border-b border-dark-800/80 z-30 shrink-0">
            <div className="flex items-center gap-3">
              <Logo size={32} className="border border-primary-500/20 rounded-lg bg-dark-950/40" />
              <div>
                <span className="text-sm font-bold text-white font-outfit tracking-tight block">EduStride</span>
                <span className="text-[9px] uppercase tracking-wider text-slate-400 font-semibold block leading-none">ERP & LMS</span>
              </div>
            </div>
            
            <button 
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className="p-2 rounded-lg bg-dark-950 border border-dark-800/80 text-slate-350 hover:text-white transition-colors"
            >
              {sidebarOpen ? <X size={18} /> : <Menu size={18} />}
            </button>
          </header>
        )}

        {/* Scrollable Main Area */}
        <main className={`flex-1 relative flex flex-col ${
          isChatPage 
            ? 'p-0 md:p-4 lg:p-6 overflow-hidden' 
            : 'p-4 md:p-6 lg:p-8 overflow-y-auto'
        }`}>
          <div className={`w-full mx-auto flex flex-col ${
            isChatPage 
              ? 'max-w-7xl h-full pb-0' 
              : 'max-w-7xl pb-12'
          }`}>
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/class/:class_level" element={<ClassGrid />} />
              <Route path="/fees" element={<FeeLedgerPanel />} />
              <Route path="/lms" element={<LmsDownload />} />
              <Route path="/chats" element={<ClassChat setAppSidebarOpen={setSidebarOpen} />} />
              <Route path="/register" element={
                <ProtectedRoute allowedRoles={['SuperAdmin', 'Teacher']}>
                  <Register />
                </ProtectedRoute>
              } />
              <Route path="/automations" element={
                <ProtectedRoute allowedRoles={['SuperAdmin']}>
                  <AutomationsPanel />
                </ProtectedRoute>
              } />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
            {!isChatPage && <Footer />}
          </div>
        </main>
      </div>
    </div>
  );
};

const AppContent = () => {
  const { user, loading } = useAuth();
  const [showPreloader, setShowPreloader] = useState(true);

  useEffect(() => {
    const applyActiveTheme = async () => {
      let activeColor = 'indigo'; // hard fallback
      
      try {
        const sysResponse = await axios.get('/api/system/theme');
        if (sysResponse.data.success) {
          activeColor = sysResponse.data.theme_color;
        }
      } catch (err) {
        console.error('Failed to fetch system default theme', err);
      }

      if (user) {
        if (user.theme_color) {
          activeColor = user.theme_color;
        } else {
          // User inherits the system default theme (stored in activeColor)
        }
      } else {
        const localColor = localStorage.getItem('edustride_theme_color');
        if (localColor) {
          activeColor = localColor;
        }
      }

      applyThemeAccent(activeColor);
    };

    applyActiveTheme();

    const handleSystemThemeUpdate = () => {
      applyActiveTheme();
    };

    window.addEventListener('systemThemeUpdated', handleSystemThemeUpdate);
    return () => {
      window.removeEventListener('systemThemeUpdated', handleSystemThemeUpdate);
    };
  }, [user]);

  return (
    <>
      {showPreloader && (
        <Preloader loading={loading} onFinished={() => setShowPreloader(false)} />
      )}
      <Router future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <PageTitleUpdater />
        <CallProvider>
          <Routes>
            <Route path="/login" element={<Login />} />
            {!user ? (
              <Route path="/register" element={<Register />} />
            ) : null}
            <Route path="*" element={
              <ProtectedRoute>
                <Layout />
              </ProtectedRoute>
            } />
          </Routes>
        </CallProvider>
      </Router>
    </>
  );
};

function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}

export default App;
