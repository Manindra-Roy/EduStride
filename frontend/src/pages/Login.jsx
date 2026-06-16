import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Mail, Lock, ArrowRight, GraduationCap } from 'lucide-react';
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
    <div className="min-h-screen flex items-center justify-center bg-dark-950 px-4 relative overflow-hidden">
      {/* Background glow design */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full bg-primary-600/10 blur-[150px] pointer-events-none" />

      <div className="w-full max-w-md z-10">
        {/* Logo */}
        <div className="flex flex-col items-center mb-8">
          <div className="bg-primary-600/10 p-2 rounded-2xl border border-primary-500/20 glow-indigo mb-3">
            <Logo size={56} className="bg-dark-900/30 rounded-xl" />
          </div>
          <h2 className="text-3xl font-extrabold text-white tracking-tight font-outfit">Welcome Back</h2>
          <p className="text-slate-400 mt-1 text-sm font-medium">EduStride ERP & LMS Suite</p>
        </div>

        {/* Card */}
        <div className="glass-panel p-8 rounded-2xl border border-dark-800 shadow-2xl relative">
          <div className="absolute inset-0 bg-gradient-to-b from-white/5 to-transparent pointer-events-none rounded-2xl" />

          {error && (
            <div className="mb-6 p-4 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-300 text-sm font-medium">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-5 relative">
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
              <div className="flex justify-between items-center mb-2">
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400">Password</label>
              </div>
              <div className="relative">
                <span className="absolute inset-y-0 left-0 pl-3.5 flex items-center text-slate-500">
                  <Lock size={18} />
                </span>
                <input
                  type="password"
                  required
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full pl-11 pr-4 py-3 rounded-xl bg-dark-900 border border-dark-800 focus:border-primary-500 focus:ring-1 focus:ring-primary-500 text-white placeholder-slate-500 transition duration-150 outline-none text-sm"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="w-full mt-6 py-3 rounded-xl bg-primary-600 hover:bg-primary-500 active:bg-primary-750 text-white font-medium text-sm transition duration-150 flex items-center justify-center gap-2 shadow-lg hover:shadow-primary-500/10"
            >
              {submitting ? (
                <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                <>
                  <span>Sign In</span>
                  <ArrowRight size={16} />
                </>
              )}
            </button>
          </form>
        </div>

        {/* Footer Link */}
        <p className="text-center text-slate-400 text-sm mt-6">
          Need student access?{' '}
          <Link to="/register" className="text-primary-400 hover:text-primary-300 font-semibold transition">
            Register Student Profile
          </Link>
        </p>

        <Footer className="border-t-0 mt-8 pt-4 justify-center sm:flex-col sm:gap-2 opacity-75" />
      </div>
    </div>
  );
};

export default Login;
