import React, { useState, useEffect, useRef } from 'react';
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
import TimetablePage from './pages/TimetablePage';
import SpecialBatchesPanel from './pages/SpecialBatchesPanel';
import BiometricGatePanel from './pages/BiometricGatePanel';

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, errorMessage: '' };
  }

  static getDerivedStateFromError(error) {
    return {
      hasError: true,
      errorMessage: error?.message || 'An unexpected rendering error occurred.'
    };
  }

  componentDidCatch(error, errorInfo) {
    console.error('App ErrorBoundary caught error:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-[100dvh] flex items-center justify-center bg-[#07080a] text-slate-100 p-6">
          <div className="glass-panel max-w-md w-full p-6 rounded-2xl border border-rose-500/30 text-center space-y-4 shadow-2xl">
            <div className="w-12 h-12 rounded-2xl bg-rose-500/15 border border-rose-500/30 text-rose-400 flex items-center justify-center mx-auto text-xl font-bold">
              !
            </div>
            <div className="space-y-1.5">
              <h2 className="text-lg font-bold text-white font-outfit">Something went wrong</h2>
              <p className="text-xs text-slate-400 leading-relaxed">
                {this.state.errorMessage}
              </p>
            </div>
            <div className="flex items-center justify-center gap-2 pt-2">
              <button
                type="button"
                onClick={() => window.location.assign('/')}
                className="px-4 py-2 rounded-xl bg-dark-900 hover:bg-dark-800 border border-dark-800 text-xs font-semibold text-slate-200 transition cursor-pointer"
              >
                Go Home
              </button>
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="px-4 py-2 rounded-xl bg-primary-600 hover:bg-primary-500 text-xs font-bold text-white transition cursor-pointer"
              >
                Reload Portal
              </button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

const ProtectedRoute = ({ children, allowedRoles }) => {
  const { user, token, loading } = useAuth();

  if (loading) {
    return null;
  }

  if (!token || !user) {
    return <Navigate to="/login" replace />;
  }

  if (allowedRoles && !allowedRoles.includes(user.role)) {
    return <Navigate to="/" replace />;
  }

  return children;
};

const Layout = () => {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const location = useLocation();
  const [viewportHeight, setViewportHeight] = useState('100dvh');
  const mainRef = useRef(null);

  const isChatPage = location.pathname === '/chats';

  // Scroll to top on route change (except when staying on chat)
  useEffect(() => {
    if (!isChatPage) {
      window.scrollTo(0, 0);
      document.body.scrollTop = 0;
      document.documentElement.scrollTop = 0;
      if (mainRef.current) {
        mainRef.current.scrollTop = 0;
      }
    }
  }, [location.pathname, isChatPage]);

  useEffect(() => {
    if (!isChatPage || !window.visualViewport) return;

    const handleResize = () => {
      setViewportHeight(`${window.visualViewport.height}px`);
    };

    window.visualViewport.addEventListener('resize', handleResize);
    handleResize();

    return () => {
      window.visualViewport.removeEventListener('resize', handleResize);
    };
  }, [isChatPage]);

  return (
    <div 
      style={{ height: isChatPage ? viewportHeight : undefined }}
      className={`w-full flex flex-col lg:flex-row bg-[#07080a] text-slate-100 relative bg-grid-pattern ${
        isChatPage ? 'h-[100dvh] overflow-hidden' : 'min-h-[100dvh] lg:h-[100dvh] lg:overflow-hidden'
      }`}
    >
      {/* Background Glow Design Elements */}
      <div className="fixed inset-0 pointer-events-none glow-bg z-0" />
      <div className="fixed -top-48 -left-48 w-[600px] h-[600px] rounded-full bg-primary-600/10 blur-[180px] pointer-events-none z-0 animate-pulse" style={{ animationDuration: '8s' }} />
      <div className="fixed -bottom-48 -right-48 w-[600px] h-[600px] rounded-full bg-indigo-600/10 blur-[180px] pointer-events-none z-0 animate-pulse" style={{ animationDuration: '8s' }} />

      {/* Sidebar navigation */}
      <Sidebar isOpen={sidebarOpen} setIsOpen={setSidebarOpen} />
      
      {/* Main Panel Content Container */}
      <div 
        className={`flex-1 flex flex-col z-10 relative ${
          isChatPage ? 'h-full overflow-hidden' : 'min-h-full lg:h-full lg:overflow-hidden'
        }`}
      >
        {/* Sticky Mobile Header */}
        {!isChatPage && (
          <header className="lg:hidden sticky top-0 flex items-center justify-between px-4 sm:px-5 py-3.5 sm:py-4 bg-dark-900/80 backdrop-blur-md border-b border-dark-800/80 z-30 shrink-0">
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
              aria-label={sidebarOpen ? "Close menu" : "Open menu"}
            >
              {sidebarOpen ? <X size={18} /> : <Menu size={18} />}
            </button>
          </header>
        )}

        {/* Scrollable Main Area */}
        <main 
          ref={mainRef}
          className={`flex-1 relative flex flex-col ${
            isChatPage 
              ? 'p-0 md:p-4 lg:p-6 overflow-hidden' 
              : 'p-3 sm:p-5 md:p-6 lg:p-8 lg:overflow-y-auto'
          }`}
        >
          <div className={`w-full mx-auto flex flex-col ${
            isChatPage 
              ? 'max-w-7xl h-full pb-0' 
              : 'max-w-7xl pb-8 sm:pb-12'
          }`}>
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/special-batches" element={
                <ProtectedRoute allowedRoles={['SuperAdmin', 'Teacher']}>
                  <SpecialBatchesPanel />
                </ProtectedRoute>
              } />
              <Route path="/timetable" element={
                <ProtectedRoute allowedRoles={['SuperAdmin', 'Teacher']}>
                  <TimetablePage />
                </ProtectedRoute>
              } />
              <Route path="/class/:class_level" element={<ClassGrid />} />
              <Route path="/fees" element={<FeeLedgerPanel />} />
              <Route path="/lms" element={<LmsDownload />} />
              <Route path="/biometric-gate" element={<BiometricGatePanel />} />
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
  const { user, token, loading } = useAuth();
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
            {!loading && !user && !token ? (
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
    <ErrorBoundary>
      <AuthProvider>
        <AppContent />
      </AuthProvider>
    </ErrorBoundary>
  );
}

export default App;
