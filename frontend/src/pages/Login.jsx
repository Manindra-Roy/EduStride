import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Mail, Lock, ArrowRight, BookOpen, Eye, EyeOff, Smartphone } from 'lucide-react';
import Logo from '../components/Logo';

const Login = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [emailFocused, setEmailFocused] = useState(false);
  const [passwordFocused, setPasswordFocused] = useState(false);
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
    <div className="min-h-screen flex flex-col justify-center items-center bg-[#07080a] text-slate-100 relative px-4 overflow-hidden bg-grid-pattern">
      {/* Background Ambient Glow Nodes */}
      <div className="absolute -top-48 -left-48 w-[500px] h-[500px] rounded-full bg-primary-600/10 blur-[150px] pointer-events-none z-0 animate-pulse-slow" />
      <div className="absolute -bottom-48 -right-48 w-[500px] h-[500px] rounded-full bg-indigo-600/10 blur-[150px] pointer-events-none z-0 animate-pulse-slow" />
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[350px] h-[350px] bg-primary-500/5 rounded-full blur-[100px] pointer-events-none z-0" />

      {/* Central Content Panel */}
      <div className="w-full max-w-[420px] space-y-6 relative z-10">
        
        {/* Centered Brand Presentation */}
        <div className="flex flex-col items-center text-center space-y-3 animate-slideUp" style={{ animationDelay: '0ms' }}>
          <div className="bg-primary-600/10 p-2 rounded-2xl border border-primary-500/20 shadow-lg shadow-primary-500/5 backdrop-blur-md">
            <Logo size={42} className="bg-dark-900/30 rounded-xl" />
          </div>
          <div>
            <h1 className="text-2xl font-black text-white tracking-tight font-outfit">EduStride</h1>
            <span className="text-[10px] uppercase tracking-widest text-slate-450 font-bold block mt-1">Institutional Intranet Portal</span>
          </div>
        </div>

        {/* Floating Glassmorphic Login Card */}
        <div 
          className="glass-panel p-8 rounded-3xl border border-white/5 bg-dark-900/60 backdrop-blur-2xl shadow-2xl relative animate-slideUp shadow-[0_0_80px_-15px_rgba(99,102,241,0.1)]"
          style={{ animationDelay: '100ms' }}
        >
          {/* Subtle reflection overlay line */}
          <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/10 to-transparent pointer-events-none rounded-t-3xl" />

          {error && (
            <div className="mb-6 p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-300 text-[11px] font-semibold text-center select-none animate-fadeIn">
              ⚠️ {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-5 relative">
            {/* Email Field */}
            <div>
              <label className="block text-[9.5px] font-extrabold uppercase tracking-widest text-slate-450 mb-2 flex items-center gap-1.5 select-none">
                <span className="w-1.5 h-1.5 rounded-full bg-primary-500/50" />
                <span>Email Address</span>
              </label>
              <div className="relative group">
                <span className={`absolute inset-y-0 left-0 pl-4 flex items-center transition-colors duration-200 ${emailFocused ? 'text-primary-400' : 'text-slate-500'}`}>
                  <Mail size={16} />
                </span>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  onFocus={() => setEmailFocused(true)}
                  onBlur={() => setEmailFocused(false)}
                  className="w-full pl-12 pr-4 py-3.5 rounded-2xl bg-dark-950/60 border border-dark-800/80 hover:border-dark-700 focus:border-primary-500/80 focus:ring-4 focus:ring-primary-500/5 text-white transition-all duration-300 outline-none text-xs font-semibold focus:bg-dark-950/70"
                />
              </div>
            </div>

            {/* Password Field */}
            <div>
              <label className="block text-[9.5px] font-extrabold uppercase tracking-widest text-slate-450 mb-2 flex items-center gap-1.5 select-none">
                <span className="w-1.5 h-1.5 rounded-full bg-primary-500/50" />
                <span>Password</span>
              </label>
              <div className="relative group">
                <span className={`absolute inset-y-0 left-0 pl-4 flex items-center transition-colors duration-200 ${passwordFocused ? 'text-primary-400' : 'text-slate-550'}`}>
                  <Lock size={16} />
                </span>
                <input
                  type={showPassword ? 'text' : 'password'}
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onFocus={() => setPasswordFocused(true)}
                  onBlur={() => setPasswordFocused(false)}
                  className="w-full pl-12 pr-12 py-3.5 rounded-2xl bg-dark-950/60 border border-dark-800/80 hover:border-dark-700 focus:border-primary-500/80 focus:ring-4 focus:ring-primary-500/5 text-white transition-all duration-300 outline-none text-xs font-semibold focus:bg-dark-950/70"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(prev => !prev)}
                  className="absolute inset-y-0 right-0 pr-4 flex items-center text-slate-500 hover:text-slate-350 transition cursor-pointer"
                  title={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            {/* Submit Button */}
            <button
              type="submit"
              disabled={submitting}
              className="w-full mt-6 py-3.5 rounded-xl bg-gradient-to-r from-primary-600 to-indigo-600 hover:from-primary-500 hover:to-indigo-500 active:scale-[0.98] text-white font-extrabold text-xs uppercase tracking-widest transition duration-150 flex items-center justify-center gap-1.5 shadow-lg hover:shadow-primary-500/10 cursor-pointer border border-primary-500/25"
            >
              {submitting ? (
                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                <>
                  <span>Sign In</span>
                  <ArrowRight size={13} />
                </>
              )}
            </button>
          </form>

        </div>

        {/* Get Mobile App Banner */}
        <div className="animate-slideUp flex justify-center" style={{ animationDelay: '150ms' }}>
          <a
            href="/EduStride.apk"
            download="EduStride.apk"
            className="flex items-center gap-3 px-5 py-3 rounded-2xl border border-primary-500/10 bg-primary-950/20 backdrop-blur-xl hover:bg-primary-950/30 hover:border-primary-500/20 transition-all duration-300 group shadow-md hover:shadow-lg shadow-primary-500/2"
          >
            <span className="p-2 rounded-xl bg-primary-600/10 text-primary-400 group-hover:scale-105 transition-transform duration-300">
              <Smartphone size={18} />
            </span>
            <div className="text-left">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block leading-none mb-1">Get the Mobile Portal</span>
              <span className="text-xs font-black text-white group-hover:text-primary-450 transition-colors">Download Android App</span>
            </div>
          </a>
        </div>

        {/* Footer Navigation & Credits */}
        <div 
          className="text-center animate-slideUp space-y-4"
          style={{ animationDelay: '200ms' }}
        >
          <p className="text-slate-400 text-xs">
            Need student credentials?{' '}
            <Link to="/register" className="text-primary-450 hover:text-primary-350 font-bold transition">
              Create Account
            </Link>
          </p>
          <div className="text-[10px] text-slate-500 font-bold tracking-wider uppercase select-none">
            Platform Architected by{' '}
            <a 
              href="https://manindra.in" 
              target="_blank" 
              rel="noreferrer" 
              className="text-primary-400 hover:text-primary-350 hover:underline transition font-bold"
            >
              manindra.in
            </a>
          </div>
        </div>

      </div>
    </div>
  );
};

export default Login;
