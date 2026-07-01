import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Mail, Lock, ArrowRight, Sparkles, BookOpen, MessageSquare, CreditCard, ShieldCheck } from 'lucide-react';
import Logo from '../components/Logo';
import Footer from '../components/Footer';

const Login = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);

    const result = await login(email, password);
    setSubmitting(false);

    if (result.success) {
      navigate('/');
    } else {
      setError(result.message);
    }
  };

  return (
    <div className="min-h-screen flex bg-dark-950 text-slate-100 relative overflow-hidden">
      {/* Background Glows */}
      <div className="absolute -top-48 -left-48 w-[500px] h-[500px] rounded-full bg-primary-600/10 blur-[160px] pointer-events-none z-0" />
      <div className="absolute -bottom-48 -right-48 w-[500px] h-[500px] rounded-full bg-indigo-600/10 blur-[160px] pointer-events-none z-0" />

      {/* Left Column (Brand Presentation & Feature Showcase) - Only visible on desktop */}
      <div className="hidden lg:flex lg:w-1/2 bg-dark-900/30 border-r border-dark-850 p-12 flex-col justify-between relative z-10 overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_30%,rgba(99,102,241,0.05),transparent_50%)] pointer-events-none" />
        
        {/* Header Branding */}
        <div className="flex items-center gap-3">
          <div className="bg-primary-600/15 p-1.5 rounded-xl border border-primary-500/25 glow-indigo">
            <Logo size={36} className="bg-dark-950/40 rounded-lg" />
          </div>
          <div>
            <span className="text-base font-extrabold text-white tracking-tight block font-outfit">EduStride</span>
            <span className="text-[9px] uppercase tracking-wider text-slate-400 font-bold block leading-none">ERP & LMS Suite</span>
          </div>
        </div>

        {/* Feature Showcase Grid */}
        <div className="space-y-8 my-auto max-w-lg">
          <div className="space-y-3">
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-primary-500/10 text-primary-400 border border-primary-500/20 uppercase tracking-wider">
              <Sparkles size={12} className="animate-spin-slow" />
              <span>Next-Gen Institution Management</span>
            </div>
            <h1 className="text-4xl font-extrabold tracking-tight text-white font-outfit leading-tight">
              Powering academic journeys with digital stride.
            </h1>
            <p className="text-slate-450 text-xs sm:text-sm leading-relaxed">
              Experience a unified digital environment to manage attendance matrices, distribute syllabus materials, secure ledger systems, and communicate in real-time.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="glass-panel p-4 rounded-xl border border-dark-800 space-y-2 hover:border-dark-700 transition">
              <MessageSquare className="text-primary-450" size={20} />
              <h4 className="text-xs font-bold text-white uppercase tracking-wider">Interactive Class Chat</h4>
              <p className="text-[10px] text-slate-450 leading-relaxed">Real-time room messaging with study handouts & active call systems.</p>
            </div>
            <div className="glass-panel p-4 rounded-xl border border-dark-800 space-y-2 hover:border-dark-700 transition">
              <CreditCard className="text-emerald-455" size={20} />
              <h4 className="text-xs font-bold text-white uppercase tracking-wider">Tuition Fees Audit</h4>
              <p className="text-[10px] text-slate-455 leading-relaxed">Seamless student invoices, compliant ledger records & Stripe webhook checkout.</p>
            </div>
            <div className="glass-panel p-4 rounded-xl border border-dark-800 space-y-2 hover:border-dark-700 transition">
              <BookOpen className="text-sky-455" size={20} />
              <h4 className="text-xs font-bold text-white uppercase tracking-wider">LMS Handout Hub</h4>
              <p className="text-[10px] text-slate-455 leading-relaxed">Upload study materials, notes logs, syllabus trackers & class checklists.</p>
            </div>
            <div className="glass-panel p-4 rounded-xl border border-dark-800 space-y-2 hover:border-dark-700 transition">
              <ShieldCheck className="text-indigo-455" size={20} />
              <h4 className="text-xs font-bold text-white uppercase tracking-wider">Secure Access Panel</h4>
              <p className="text-[10px] text-slate-455 leading-relaxed">Strict role authorizations for student rosters, grading & cron mailers.</p>
            </div>
          </div>
        </div>

        {/* Footer Brand Info */}
        <div className="text-slate-500 text-[11px] font-mono">
          © {new Date().getFullYear()} EduStride Institution System. Version 1.0.0
        </div>
      </div>

      {/* Right Column (Login Form Area) */}
      <div className="w-full lg:w-1/2 flex flex-col justify-center items-center px-6 relative z-10 py-12">
        <div className="w-full max-w-sm space-y-8">
          
          {/* Mobile Header Branding (Only visible on mobile) */}
          <div className="flex flex-col items-center text-center lg:hidden space-y-3">
            <div className="bg-primary-600/15 p-2 rounded-2xl border border-primary-500/25 glow-indigo">
              <Logo size={48} className="bg-dark-900/30 rounded-xl" />
            </div>
            <h2 className="text-2xl font-extrabold text-white tracking-tight font-outfit">EduStride ERP</h2>
            <p className="text-slate-400 text-xs font-medium uppercase tracking-wider">Unified Institution Management System</p>
          </div>

          <div className="space-y-2 text-center lg:text-left animate-fadeIn">
            <h2 className="text-2xl font-extrabold text-white font-outfit tracking-tight">Access Intranet Dashboard</h2>
            <p className="text-slate-400 text-xs">Enter credentials to authenticate into the institution intranet portal.</p>
          </div>

          {/* Form container */}
          <div className="glass-panel p-6 sm:p-8 rounded-2xl border border-dark-800 shadow-2xl relative">
            <div className="absolute inset-0 bg-gradient-to-b from-white/5 to-transparent pointer-events-none rounded-2xl" />

            {error && (
              <div className="mb-6 p-4 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-300 text-xs font-medium">
                {error}
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-5 relative">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">Email Address</label>
                <div className="relative">
                  <span className="absolute inset-y-0 left-0 pl-3.5 flex items-center text-slate-500">
                    <Mail size={16} />
                  </span>
                  <input
                    type="email"
                    required
                    placeholder="name@institution.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full pl-11 pr-4 py-3 rounded-xl bg-dark-900/60 border border-dark-800 focus:border-primary-500 focus:ring-1 focus:ring-primary-500 text-white placeholder-slate-550 transition duration-150 outline-none text-xs font-medium"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">Password</label>
                <div className="relative">
                  <span className="absolute inset-y-0 left-0 pl-3.5 flex items-center text-slate-550">
                    <Lock size={16} />
                  </span>
                  <input
                    type="password"
                    required
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full pl-11 pr-4 py-3 rounded-xl bg-dark-900/60 border border-dark-800 focus:border-primary-500 focus:ring-1 focus:ring-primary-500 text-white placeholder-slate-550 transition duration-150 outline-none text-xs font-medium"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={submitting}
                className="w-full mt-6 py-3 rounded-xl bg-primary-600 hover:bg-primary-500 active:bg-primary-750 text-white font-bold text-xs uppercase tracking-wide transition duration-150 flex items-center justify-center gap-1.5 shadow-lg hover:shadow-primary-500/10"
              >
                {submitting ? (
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                ) : (
                  <>
                    <span>Sign In</span>
                    <ArrowRight size={14} />
                  </>
                )}
              </button>
            </form>
          </div>

          {/* Registration Trigger Footer */}
          <div className="text-center animate-fadeIn space-y-4">
            <p className="text-slate-400 text-xs">
              Need student credentials?{' '}
              <Link to="/register" className="text-primary-400 hover:text-primary-300 font-bold transition">
                Create Account
              </Link>
            </p>
            <div className="text-[10px] text-slate-500 font-medium">
              Architected by{' '}
              <a 
                href="https://manindra.in" 
                target="_blank" 
                rel="noreferrer" 
                className="text-primary-400 hover:text-primary-350 hover:underline transition"
              >
                manindra.in
              </a>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
};

export default Login;
