import React, { useState, useEffect } from 'react';
import Logo from './Logo';

const LOADING_STATUSES = [
  'Establishing secure gateway...',
  'Syncing academic rosters...',
  'Initializing ledger balances...',
  'Connecting chat socket.io...',
  'Compiling live schedules...',
  'Securing access credentials...',
  'Assembling dashboard components...'
];

const Preloader = ({ loading, onFinished }) => {
  const [progress, setProgress] = useState(0);
  const [statusIndex, setStatusIndex] = useState(0);
  const [fadeOut, setFadeOut] = useState(false);
  const [shouldRender, setShouldRender] = useState(true);

  // 1. Progress Bar Logic
  useEffect(() => {
    let interval;
    if (loading) {
      // Increment progress exponentially up to 90%
      interval = setInterval(() => {
        setProgress(prev => {
          if (prev >= 90) {
            // Very slow crawl at the end
            return Math.min(prev + 0.5, 98);
          }
          const diff = Math.max((100 - prev) * 0.15, 1);
          return Math.min(prev + diff, 90);
        });
      }, 150);
    } else {
      // When loading finishes, speed up to 100%
      setProgress(100);
    }

    return () => clearInterval(interval);
  }, [loading]);

  // 2. Cycle Status Text
  useEffect(() => {
    const statusInterval = setInterval(() => {
      setStatusIndex(prev => (prev + 1) % LOADING_STATUSES.length);
    }, 1200);

    return () => clearInterval(statusInterval);
  }, []);

  // 3. Handle fadeOut when progress hits 100%
  useEffect(() => {
    if (progress === 100) {
      const finishTimeout = setTimeout(() => {
        setFadeOut(true);
      }, 400); // Wait for progress bar animation to complete

      const unmountTimeout = setTimeout(() => {
        setShouldRender(false);
        if (onFinished) onFinished();
      }, 900); // 400ms delay + 500ms fadeOut duration

      return () => {
        clearTimeout(finishTimeout);
        clearTimeout(unmountTimeout);
      };
    }
  }, [progress, onFinished]);

  if (!shouldRender) return null;

  return (
    <div 
      className={`fixed inset-0 z-[9999] flex flex-col items-center justify-center bg-dark-950 text-slate-100 overflow-hidden transition-all duration-500 ease-in-out ${
        fadeOut ? 'opacity-0 scale-95 pointer-events-none' : 'opacity-100'
      }`}
    >
      {/* Decorative Glow Elements */}
      <div className="absolute top-1/4 left-1/4 w-[400px] h-[400px] rounded-full bg-primary-600/10 blur-[130px] animate-pulse-slow pointer-events-none" />
      <div className="absolute bottom-1/4 right-1/4 w-[400px] h-[400px] rounded-full bg-indigo-600/10 blur-[130px] animate-pulse-slow pointer-events-none" />
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-gradient-to-tr from-primary-500/5 to-indigo-500/5 rounded-full blur-[100px] pointer-events-none" />

      {/* Main Glassmorphic Card Container */}
      <div className="glass-card p-10 md:p-12 rounded-3xl flex flex-col items-center max-w-md w-[90%] mx-auto z-10 border border-white/5 relative overflow-hidden">
        {/* Subtle diagonal sheen reflex overlay */}
        <div className="absolute -inset-[100%] bg-gradient-to-tr from-transparent via-white/[0.02] to-transparent rotate-45 pointer-events-none" />

        {/* Orbiting Ring Loader Container */}
        <div className="relative w-32 h-32 mb-8 flex items-center justify-center">
          {/* Neon spinning outer ring */}
          <div className="absolute inset-0 rounded-full border-2 border-primary-500/10 border-t-primary-500 animate-spin" style={{ animationDuration: '1.5s' }} />
          {/* Inner opposite spinning ring */}
          <div className="absolute inset-2 rounded-full border-2 border-indigo-500/10 border-b-indigo-500 animate-spin" style={{ animationDuration: '2.5s', animationDirection: 'reverse' }} />
          
          {/* Glowing central node */}
          <div className="absolute inset-4 bg-dark-950/80 rounded-full border border-white/5 flex items-center justify-center shadow-inner">
            <Logo size={55} showGlow={true} />
          </div>
        </div>

        {/* Logotype */}
        <h1 className="text-3xl font-extrabold tracking-tight font-sans text-transparent bg-clip-text bg-gradient-to-r from-white via-slate-200 to-indigo-200 mb-1">
          EduStride
        </h1>
        <p className="text-xs font-semibold text-primary-400 tracking-widest uppercase mb-8">
          ERP & LMS Platform
        </p>

        {/* Progress Display */}
        <div className="w-full flex items-center justify-between mb-2">
          <span className="text-[10px] font-bold text-slate-500 tracking-wider uppercase">
            System loading
          </span>
          <span className="text-sm font-bold text-indigo-400 font-mono">
            {Math.round(progress)}%
          </span>
        </div>

        {/* Progress Bar Track */}
        <div className="w-full h-1.5 bg-dark-900 rounded-full border border-white/5 overflow-hidden relative">
          {/* Glowing active bar */}
          <div 
            className="h-full bg-gradient-to-r from-indigo-500 to-primary-500 rounded-full transition-all duration-300 ease-out relative"
            style={{ width: `${progress}%` }}
          >
            {/* Pulsing light tip */}
            <div className="absolute right-0 top-0 bottom-0 w-2 bg-white shadow-[0_0_8px_#ffffff] rounded-full animate-pulse" />
          </div>
        </div>

        {/* Status Text (fade transitions simulated via index state) */}
        <div className="mt-6 h-6 flex items-center justify-center">
          <p className="text-xs font-semibold text-slate-400 tracking-wide animate-pulse">
            {LOADING_STATUSES[statusIndex]}
          </p>
        </div>
      </div>

      {/* Footer Branding */}
      <div className="absolute bottom-8 text-[10px] font-bold tracking-widest text-slate-600 uppercase z-10">
        Enterprise Edition • v1.0.0
      </div>
    </div>
  );
};

export default Preloader;
