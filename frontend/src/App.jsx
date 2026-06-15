import React, { useState } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import Sidebar from './components/Sidebar';
import Preloader from './components/Preloader';

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
  return (
    <div className="min-h-screen flex bg-dark-950 text-slate-100 overflow-hidden">
      {/* Background Glow Design Elements */}
      <div className="fixed inset-0 pointer-events-none glow-bg z-0" />
      <div className="fixed -top-48 -left-48 w-[500px] h-[500px] rounded-full bg-primary-600/5 blur-[160px] pointer-events-none z-0" />
      <div className="fixed -bottom-48 -right-48 w-[500px] h-[500px] rounded-full bg-indigo-600/5 blur-[160px] pointer-events-none z-0" />

      {/* Sidebar navigation */}
      <Sidebar />
      
      {/* Main Panel Content */}
      <main className="flex-1 p-4 md:p-6 lg:p-8 overflow-y-auto z-10 h-screen relative flex flex-col">
        <div className="flex-1 max-w-7xl w-full mx-auto pb-12">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/class/:class_level" element={<ClassGrid />} />
            <Route path="/fees" element={<FeeLedgerPanel />} />
            <Route path="/lms" element={<LmsDownload />} />
            <Route path="/chats" element={<ClassChat />} />
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
  );
};

const AppContent = () => {
  const { loading } = useAuth();
  const [showPreloader, setShowPreloader] = useState(true);

  return (
    <>
      {showPreloader && (
        <Preloader loading={loading} onFinished={() => setShowPreloader(false)} />
      )}
      <Router>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
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
