import React from 'react';

const Logo = ({ className = "w-10 h-10", size = 40, showGlow = true }) => {
  return (
    <div 
      className={`relative flex items-center justify-center ${className}`} 
      style={{ width: size, height: size }}
    >
      {/* Outer Glow Background */}
      {showGlow && (
        <div className="absolute inset-0 bg-primary-500/15 rounded-xl blur-md pointer-events-none animate-pulse-slow" />
      )}
      
      {/* SVG Icon */}
      <svg
        viewBox="0 0 100 100"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="w-full h-full relative z-10 filter drop-shadow-[0_2px_8px_rgba(0,0,0,0.5)]"
      >
        <defs>
          {/* Indigo/Violet Gradient for Left Page & E arms */}
          <linearGradient id="logo-indigo-grad" x1="15" y1="20" x2="85" y2="80" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#a5b4fc" /> {/* indigo-300 */}
            <stop offset="50%" stopColor="#6366f1" /> {/* indigo-500 */}
            <stop offset="100%" stopColor="#4338ca" /> {/* indigo-700 */}
          </linearGradient>
          
          {/* Vibrant Gold/Amber Gradient for Arrow */}
          <linearGradient id="logo-gold-grad" x1="28" y1="82" x2="92" y2="18" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#d97706" /> {/* amber-600 */}
            <stop offset="40%" stopColor="#fbbf24" /> {/* amber-400 */}
            <stop offset="100%" stopColor="#fef08a" /> {/* yellow-200 */}
          </linearGradient>

          {/* Soft Shadow for layered depth */}
          <filter id="logo-shadow" x="-10%" y="-10%" width="120%" height="120%">
            <feDropShadow dx="0" dy="1.5" stdDeviation="1.5" floodColor="#000000" floodOpacity="0.5" />
          </filter>
        </defs>

        {/* Left Book Page */}
        <path
          d="M 45 25 
             C 32 20, 20 24, 15 32 
             C 15 45, 15 65, 15 72 
             C 20 78, 32 80, 45 75 
             Z"
          fill="url(#logo-indigo-grad)"
          opacity="0.9"
          filter="url(#logo-shadow)"
        />
        
        {/* Left Page inner line highlight (sheen) */}
        <path
          d="M 40 29 
             C 31 27, 22 30, 20 36 
             C 20 45, 20 62, 20 67"
          stroke="#ffffff"
          strokeWidth="2"
          strokeLinecap="round"
          opacity="0.35"
        />

        {/* Right Book Page / E Arms (three horizontal tabs) */}
        {/* Top Arm */}
        <path
          d="M 48 27
             C 58 25, 68 27, 78 31
             C 78 35, 78 38, 78 39
             C 68 36, 58 34, 48 35
             Z"
          fill="url(#logo-indigo-grad)"
          filter="url(#logo-shadow)"
        />

        {/* Middle Arm */}
        <path
          d="M 48 48
             C 58 47, 65 49, 68 52
             C 68 56, 68 58, 68 59
             C 65 56, 58 55, 48 56
             Z"
          fill="url(#logo-indigo-grad)"
          filter="url(#logo-shadow)"
        />

        {/* Bottom Arm */}
        <path
          d="M 48 69
             C 58 69, 68 71, 78 75
             C 78 79, 78 81, 78 82
             C 68 78, 58 77, 48 77
             Z"
          fill="url(#logo-indigo-grad)"
          filter="url(#logo-shadow)"
        />

        {/* Book Spine (Vertical Divider) */}
        <path
          d="M 45 20 C 47 20, 47 80, 45 80 C 43 80, 43 20, 45 20 Z"
          fill="#a5b4fc"
          opacity="0.9"
        />

        {/* Main Golden Arrow */}
        <path
          d="M 28 78 
             L 76 30 
             L 70 24 
             L 92 18 
             L 86 40 
             L 80 34 
             L 32 82 
             Z"
          fill="url(#logo-gold-grad)"
          filter="url(#logo-shadow)"
        />
        
        {/* Glow point/highlight at arrow tip */}
        <circle cx="92" cy="18" r="2" fill="#ffffff" opacity="0.9" />
      </svg>
    </div>
  );
};

export default Logo;
