import React, { useState, useEffect } from 'react';
import Logo from './Logo';

const LOADING_STATUSES = [
  'Connecting secure gateway...',
  'Syncing academic data...',
  'Preparing portal workspace...',
  'Ready'
];

const Preloader = ({ loading, onFinished }) => {
  const [progress, setProgress] = useState(15);
  const [statusIndex, setStatusIndex] = useState(0);
  const [fadeOut, setFadeOut] = useState(false);
  const [shouldRender, setShouldRender] = useState(true);

  // Smooth Progress Interpolation Logic
  useEffect(() => {
    let interval;
    if (loading) {
      interval = setInterval(() => {
        setProgress(prev => {
          if (prev >= 88) {
            return Math.min(prev + 0.4, 96);
          }
          const diff = Math.max((100 - prev) * 0.22, 1.8);
          return Math.min(prev + diff, 88);
        });
      }, 70);
    } else {
      setProgress(100);
    }

    return () => clearInterval(interval);
  }, [loading]);

  // Cycle Status Text smoothly
  useEffect(() => {
    const statusInterval = setInterval(() => {
      setStatusIndex(prev => (prev + 1) % (LOADING_STATUSES.length - 1));
    }, 1200);

    return () => clearInterval(statusInterval);
  }, []);

  // Ultra-smooth fadeOut when progress reaches 100%
  useEffect(() => {
    if (progress === 100) {
      setStatusIndex(LOADING_STATUSES.length - 1);
      const finishTimeout = setTimeout(() => {
        setFadeOut(true);
      }, 200);

      const unmountTimeout = setTimeout(() => {
        setShouldRender(false);
        if (onFinished) onFinished();
      }, 650);

      return () => {
        clearTimeout(finishTimeout);
        clearTimeout(unmountTimeout);
      };
    }
  }, [progress, onFinished]);

  if (!shouldRender) return null;

  return (
    <div 
      className={`fixed inset-0 z-[9999] flex flex-col items-center justify-center bg-[#050507] text-slate-100 overflow-hidden transition-all duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] select-none ${
        fadeOut ? 'opacity-0 scale-[1.02] filter blur-md pointer-events-none' : 'opacity-100 scale-100'
      }`}
    >
      {/* Soft Ambient Center Glow */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] bg-primary-600/12 rounded-full blur-[160px] pointer-events-none animate-pulse-glow" />

      {/* Cinematic Centerpiece */}
      <div className="relative z-10 flex flex-col items-center max-w-sm w-full px-6 text-center">
        
        {/* Pulsing Glowing Logo Emblem */}
        <div className="relative mb-5 flex items-center justify-center">
          <div className="absolute inset-0 rounded-2xl bg-primary-500/25 blur-xl animate-pulse-glow" />
          <div className="relative z-10 p-1 bg-dark-950/90 rounded-2xl border border-white/10 shadow-2xl backdrop-blur-2xl">
            <Logo size={64} showGlow={false} />
          </div>
        </div>

        {/* Brand Name & Subtitle */}
        <h1 className="text-2.5xl font-black font-outfit text-white tracking-tight mb-1">
          EduStride
        </h1>
        <p className="text-xs text-slate-400 font-medium tracking-wide mb-8 font-sans">
          Enterprise ERP & LMS Portal
        </p>

        {/* Razor-Thin 2px Glowing Progress Track */}
        <div className="w-52 h-[2px] bg-slate-800/60 rounded-full overflow-hidden relative mb-4">
          <div 
            className="h-full bg-gradient-to-r from-indigo-500 via-purple-500 to-emerald-400 rounded-full transition-all duration-200 ease-out shadow-[0_0_12px_rgba(99,102,241,0.6)]"
            style={{ width: `${progress}%` }}
          />
        </div>

        {/* Status Text */}
        <div className="h-5 flex items-center justify-center">
          <p 
            key={statusIndex}
            className="text-xs font-normal text-slate-400 tracking-wide font-sans animate-fadeIn"
          >
            {LOADING_STATUSES[statusIndex]}
          </p>
        </div>
      </div>

      {/* Micro Specs Footer */}
      <div className="absolute bottom-7 text-[10px] font-mono text-slate-600 tracking-widest uppercase z-10 select-none flex items-center gap-3">
        <span>EduStride Core</span>
        <span>•</span>
        <span>SSL Encrypted</span>
      </div>
    </div>
  );
};

export default Preloader;
