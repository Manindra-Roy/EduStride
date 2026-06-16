import React from 'react';

const Footer = ({ className = "" }) => {
  const hasMarginTop = className.split(' ').some(c => c.startsWith('mt-'));
  const marginClass = hasMarginTop ? '' : 'mt-12';

  return (
    <footer className={`${marginClass} pt-6 pb-4 border-t border-dark-800/40 w-full flex flex-col sm:flex-row items-center justify-between gap-3 text-slate-400 text-xs z-10 ${className}`}>
      <div className="flex items-center gap-2">
        <span className="w-1.5 h-1.5 rounded-full bg-primary-500 animate-pulse-slow" />
        <span className="font-semibold text-slate-350 font-outfit tracking-wide">© 2026 EduStride</span>
        <span className="text-slate-600">|</span>
        <span className="text-slate-500">All rights reserved.</span>
      </div>
      <div className="flex items-center gap-1.5">
        <span className="text-slate-500">Architected by</span>
        <a 
          href="https://manindra.in" 
          target="_blank" 
          rel="noopener noreferrer" 
          className="text-primary-400 hover:text-primary-300 font-bold transition-all duration-200 hover:underline decoration-primary-500/40 hover:scale-105 inline-block"
        >
          manindra.in
        </a>
      </div>
    </footer>
  );
};

export default Footer;
