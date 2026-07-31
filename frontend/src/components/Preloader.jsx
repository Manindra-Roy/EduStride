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
  const [progress, setProgress] = useState(15);
  const [statusIndex, setStatusIndex] = useState(0);
  const [fadeOut, setFadeOut] = useState(false);
  const [shouldRender, setShouldRender] = useState(true);

  // 1. Smooth Progress Interpolation Logic
  useEffect(() => {
    let interval;
    if (loading) {
      interval = setInterval(() => {
        setProgress(prev => {
          if (prev >= 88) {
            return Math.min(prev + 0.3, 96);
          }
          const diff = Math.max((100 - prev) * 0.22, 1.5);
          return Math.min(prev + diff, 88);
        });
      }, 90);
    } else {
      setProgress(100);
    }

    return () => clearInterval(interval);
  }, [loading]);

  // 2. Cycle Status Text smoothly
  useEffect(() => {
    const statusInterval = setInterval(() => {
      setStatusIndex(prev => (prev + 1) % LOADING_STATUSES.length);
    }, 1000);

    return () => clearInterval(statusInterval);
  }, []);

  // 3. Ultra-smooth fadeOut when progress reaches 100%
  useEffect(() => {
    if (progress === 100) {
      const finishTimeout = setTimeout(() => {
        setFadeOut(true);
      }, 150);

      const unmountTimeout = setTimeout(() => {
        setShouldRender(false);
        if (onFinished) onFinished();
      }, 550);

      return () => {
        clearTimeout(finishTimeout);
        clearTimeout(unmountTimeout);
      };
    }
  }, [progress, onFinished]);

  if (!shouldRender) return null;

  return (
    <div 
      className={`fixed inset-0 z-[9999] flex flex-col items-center justify-center bg-[#07080a] bg-grid-pattern text-slate-100 overflow-hidden transition-all duration-400 ease-[cubic-bezier(0.16,1,0.3,1)] ${
        fadeOut ? 'opacity-0 scale-[1.03] filter blur-md pointer-events-none' : 'opacity-100 scale-100'
      }`}
    >
      {/* Ambient Neon Background Glow Spheres */}
      <div className="absolute top-1/4 left-1/3 w-[450px] h-[450px] rounded-full bg-primary-600/15 blur-[140px] animate-pulse-slow pointer-events-none" />
      <div className="absolute bottom-1/4 right-1/3 w-[450px] h-[450px] rounded-full bg-indigo-600/15 blur-[140px] animate-pulse-slow pointer-events-none" />
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[650px] h-[650px] bg-gradient-to-tr from-primary-500/10 via-indigo-500/5 to-emerald-500/5 rounded-full blur-[110px] pointer-events-none" />

      {/* Main Glassmorphic Card Container */}
      <div className="glass-card p-8 md:p-10 rounded-3xl flex flex-col items-center max-w-sm w-[90%] mx-auto z-10 border border-dark-800/80 shadow-2xl relative overflow-hidden backdrop-blur-2xl">
        {/* Diagonal Sheen Reflex */}
        <div className="absolute -inset-[100%] bg-gradient-to-tr from-transparent via-white/[0.03] to-transparent rotate-45 pointer-events-none" />

        {/* Live Status Pill Badge */}
        <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-[9px] font-mono font-extrabold uppercase tracking-widest mb-6 shadow-sm select-none">
          <span className="relative flex h-1.5 w-1.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500"></span>
          </span>
          <span>Encrypted Gateway Active</span>
        </div>

        {/* Orbiting Triple Ring Loader */}
        <div className="relative w-28 h-28 mb-6 flex items-center justify-center select-none">
          {/* Outer dashed slow orbit */}
          <div className="absolute -inset-2 rounded-full border border-dashed border-primary-500/25 animate-spin" style={{ animationDuration: '14s' }} />
          {/* Neon spinning outer ring */}
          <div className="absolute inset-0 rounded-full border-2 border-primary-500/15 border-t-primary-500 animate-spin" style={{ animationDuration: '1.4s' }} />
          {/* Inner opposite spinning ring */}
          <div className="absolute inset-2.5 rounded-full border-2 border-indigo-500/15 border-b-indigo-400 animate-spin" style={{ animationDuration: '2.2s', animationDirection: 'reverse' }} />
          
          {/* Glowing central node */}
          <div className="absolute inset-5 bg-dark-950/90 rounded-2xl border border-dark-800 flex items-center justify-center shadow-2xl shadow-primary-950/50">
            <Logo size={46} showGlow={true} />
          </div>
        </div>

        {/* Logotype */}
        <h1 className="text-2xl font-extrabold tracking-tight font-outfit text-white mb-0.5">
          EduStride
        </h1>
        <p className="text-[10px] font-bold text-primary-400 tracking-widest uppercase mb-7 font-mono">
          Enterprise ERP & LMS Portal
        </p>

        {/* Progress Tracker Header */}
        <div className="w-full flex items-center justify-between mb-2 select-none">
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] font-bold text-slate-400 tracking-wider uppercase font-outfit">
              Initializing
            </span>
            <span className="text-[9px] font-mono font-extrabold bg-dark-900 border border-dark-800 px-1.5 py-0.2 rounded text-slate-400">
              {statusIndex + 1}/{LOADING_STATUSES.length}
            </span>
          </div>
          <span className="text-xs font-bold text-emerald-400 font-mono">
            {Math.round(progress)}%
          </span>
        </div>

        {/* Liquid Shimmer Progress Bar Track */}
        <div className="w-full h-2 bg-dark-950 rounded-full border border-dark-800 overflow-hidden relative p-0.5 shadow-inner">
          <div 
            className="h-full bg-gradient-to-r from-indigo-500 via-primary-500 to-emerald-400 rounded-full transition-all duration-200 ease-out relative"
            style={{ width: `${progress}%` }}
          >
            {/* Pulsing glowing tip */}
            <div className="absolute right-0 top-0 bottom-0 w-2.5 bg-white shadow-[0_0_10px_#ffffff] rounded-full animate-pulse" />
          </div>
        </div>

        {/* Status Text Stream */}
        <div className="mt-5 h-5 flex items-center justify-center text-center">
          <p 
            key={statusIndex}
            className="text-[11px] font-medium text-slate-400 tracking-wide font-outfit animate-fadeIn truncate max-w-[260px]"
          >
            {LOADING_STATUSES[statusIndex]}
          </p>
        </div>
      </div>

      {/* Footer System Spec */}
      <div className="absolute bottom-6 text-[9px] font-bold tracking-widest text-slate-550 uppercase z-10 font-mono select-none">
        EduStride Platform • Encrypted Core v1.0.0
      </div>
    </div>
  );
};

export default Preloader;
