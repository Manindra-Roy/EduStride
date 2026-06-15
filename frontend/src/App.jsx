import React, { useState } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import Sidebar from './components/Sidebar';
import Preloader from './components/Preloader';
import Logo from './components/Logo';
import { Menu, X } from 'lucide-react';

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

  return (
    <div className="min-h-screen flex flex-col lg:flex-row bg-dark-950 text-slate-100 overflow-hidden relative">
      {/* Background Glow Design Elements */}
      <div className="fixed inset-0 pointer-events-none glow-bg z-0" />
      <div className="fixed -top-48 -left-48 w-[500px] h-[500px] rounded-full bg-primary-600/5 blur-[160px] pointer-events-none z-0" />
      <div className="fixed -bottom-48 -right-48 w-[500px] h-[500px] rounded-full bg-indigo-600/5 blur-[160px] pointer-events-none z-0" />

      {/* Sidebar navigation */}
      <Sidebar isOpen={sidebarOpen} setIsOpen={setSidebarOpen} />
      
      {/* Main Panel Content Container */}
      <div className="flex-1 flex flex-col h-screen overflow-hidden z-10 relative">
        {/* Sticky Mobile Header */}
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

        {/* Scrollable Main Area */}
        <main className="flex-1 p-4 md:p-6 lg:p-8 overflow-y-auto relative flex flex-col">
          <div className="flex-1 max-w-7xl w-full mx-auto pb-12">
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/class/:class_level" element={<ClassGrid />} />
              <Route path="/fees" element={<FeeLedgerPanel />} />
              <Route path="/lms" element={<LmsDownload />} />
              <Route path="/chats" element={<ClassChat />} />
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
          </div>
        </main>
      </div>
    </div>
  );
};

const AppContent = () => {
  const { user, loading } = useAuth();
  const [showPreloader, setShowPreloader] = useState(true);

  return (
    <>
      {showPreloader && (
        <Preloader loading={loading} onFinished={() => setShowPreloader(false)} />
      )}
      <Router>
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
