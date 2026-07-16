import React from 'react';

const Logo = ({ className = "w-10 h-10", size = 40, showGlow = true }) => {
  return (
    <div 
      className={`relative flex items-center justify-center group ${className}`} 
      style={{ width: size, height: size }}
    >
      {/* Outer Glow Background - enhances dark mode aesthetics */}
      {showGlow && (
        <div className="absolute inset-0 bg-gradient-to-tr from-primary-500/10 to-indigo-500/20 rounded-xl blur-md pointer-events-none transition-all duration-500 group-hover:from-primary-500/20 group-hover:to-indigo-500/30 group-hover:scale-110" />
      )}
      
      {/* SVG Icon */}
      <svg
        viewBox="0 0 100 100"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="w-full h-full relative z-10 filter drop-shadow-[0_4px_10px_rgba(0,0,0,0.6)] transition-transform duration-300 ease-out group-hover:scale-105"
      >
        <defs>
          {/* Primary Indigo/Violet Gradient (Left/Base cap faces) */}
          <linearGradient id="logo-indigo-light" x1="10" y1="10" x2="90" y2="90" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#a5b4fc" /> {/* indigo-300 */}
            <stop offset="50%" stopColor="#6366f1" /> {/* indigo-500 */}
            <stop offset="100%" stopColor="#4f46e5" /> {/* indigo-600 */}
          </linearGradient>

          {/* Darker Indigo/Purple Gradient (For 3D depth and backing pages) */}
          <linearGradient id="logo-indigo-dark" x1="10" y1="10" x2="90" y2="90" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#4f46e5" /> {/* indigo-600 */}
            <stop offset="70%" stopColor="#312e81" /> {/* indigo-900 */}
            <stop offset="100%" stopColor="#1e1b4b" /> {/* indigo-950 */}
          </linearGradient>

          {/* Premium Metallic Gold Gradient for Highlights, Tassel & Bookmark */}
          <linearGradient id="logo-gold" x1="20" y1="80" x2="80" y2="20" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#d97706" /> {/* amber-600 */}
            <stop offset="40%" stopColor="#f59e0b" /> {/* amber-500 */}
            <stop offset="75%" stopColor="#fbbf24" /> {/* amber-400 */}
            <stop offset="100%" stopColor="#fef08a" /> {/* yellow-200 */}
          </linearGradient>

          {/* Technical Accent Glow (Dashed outer circle) */}
          <linearGradient id="logo-accent-glow" x1="0" y1="0" x2="100" y2="100" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#818cf8" stopOpacity="0.6" />
            <stop offset="50%" stopColor="#fbbf24" stopOpacity="0.4" />
            <stop offset="100%" stopColor="#f43f5e" stopOpacity="0.1" />
          </linearGradient>

          {/* High-fidelity Edge Highlight Gradient */}
          <linearGradient id="logo-edge-highlight" x1="50" y1="12" x2="50" y2="36" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#ffffff" stopOpacity="0.8" />
            <stop offset="100%" stopColor="#ffffff" stopOpacity="0.0" />
          </linearGradient>

          {/* Drop shadow for layered parts */}
          <filter id="logo-depth-shadow" x="-20%" y="-20%" width="140%" height="140%">
            <feDropShadow dx="0" dy="3" stdDeviation="2.5" floodColor="#000000" floodOpacity="0.5" />
          </filter>
        </defs>

        {/* 1. FUTURISTIC BACKGROUND GRID & ORBIT */}
        {/* Dash ring representing structured learning and progress tracks */}
        <circle 
          cx="50" 
          cy="50" 
          r="45" 
          stroke="url(#logo-accent-glow)" 
          strokeWidth="1.2" 
          strokeDasharray="4 6" 
          className="origin-center transition-all duration-700 group-hover:rotate-45"
        />
        
        {/* Subtle inner alignment circle */}
        <circle 
          cx="50" 
          cy="50" 
          r="41" 
          stroke="#6366f1" 
          strokeWidth="0.75" 
          strokeDasharray="1 15"
          opacity="0.3" 
        />

        {/* 2. THE OPEN BOOK WINGS (The "Stride" progression steps) */}
        {/* Background page layers (deep depth) */}
        <g opacity="0.55" filter="url(#logo-depth-shadow)">
          {/* Left Dark Wing */}
          <path
            d="M 50 84 C 36 78, 22 76, 14 78 L 8 58 C 22 57, 36 59, 50 65 Z"
            fill="url(#logo-indigo-dark)"
          />
          {/* Right Dark Wing */}
          <path
            d="M 50 84 C 64 78, 78 76, 86 78 L 92 58 C 78 57, 64 59, 50 65 Z"
            fill="url(#logo-indigo-dark)"
          />
        </g>

        {/* Foreground page layers (Vibrant, floating look) */}
        <g 
          filter="url(#logo-depth-shadow)" 
          className="transition-transform duration-300 ease-out group-hover:translate-y-[1px]"
        >
          {/* Left Active Page/Chevron */}
          <path
            d="M 50 80 C 38 75, 26 73, 18 74 L 12 54 C 24 53, 38 55, 50 60 Z"
            fill="url(#logo-indigo-light)"
            stroke="url(#logo-edge-highlight)"
            strokeWidth="0.5"
          />
          {/* Right Active Page/Chevron */}
          <path
            d="M 50 80 C 62 75, 74 73, 82 74 L 88 54 C 76 53, 62 55, 50 60 Z"
            fill="url(#logo-indigo-light)"
            stroke="url(#logo-edge-highlight)"
            strokeWidth="0.5"
          />
        </g>

        {/* 3. GRADUATION CAP (Premium 3D Faceted Mortarboard) */}
        <g 
          filter="url(#logo-depth-shadow)"
          className="transition-transform duration-300 ease-out group-hover:-translate-y-[1.5px]"
        >
          {/* Skullcap base */}
          <path
            d="M 33 29 L 33 37 C 33 44, 67 44, 67 37 L 67 29 Z"
            fill="url(#logo-indigo-dark)"
          />
          
          {/* Left Cap Facet (Slightly darker shade for 3D creasing) */}
          <path
            d="M 50 12 L 14 24 L 50 36 Z"
            fill="url(#logo-indigo-dark)"
          />
          
          {/* Right Cap Facet (Lighter gradient face) */}
          <path
            d="M 50 12 L 86 24 L 50 36 Z"
            fill="url(#logo-indigo-light)"
          />
          
          {/* Glowing central seam highlight */}
          <line
            x1="50"
            y1="12"
            x2="50"
            y2="36"
            stroke="url(#logo-edge-highlight)"
            strokeWidth="1"
            opacity="0.4"
          />
        </g>

        {/* 4. THE GOLDEN TASSEL */}
        <g className="transition-all duration-500 ease-out origin-[50px_24px] group-hover:rotate-[3deg]">
          {/* Center Button */}
          <circle 
            cx="50" 
            cy="24" 
            r="3.5" 
            fill="url(#logo-gold)" 
            filter="url(#logo-depth-shadow)"
          />
          
          {/* Hanging Ribbon (Sleek S-Curve) */}
          <path
            d="M 50 24 C 68 24, 85 27, 85 31 C 85 35, 89 38, 89 44 L 89 54"
            stroke="url(#logo-gold)"
            strokeWidth="2.5"
            strokeLinecap="round"
            fill="none"
          />
          
          {/* Tassel Fringe Shield */}
          <path
            d="M 86 54 L 92 54 L 89 64 Z"
            fill="url(#logo-gold)"
            filter="url(#logo-depth-shadow)"
          />
        </g>

        {/* 5. CENTER GLOWING BOOKMARK / ARROW (Downwards stride anchor) */}
        <g filter="url(#logo-depth-shadow)">
          <path
            d="M 47.5 60 L 47.5 81 L 50 86 L 52.5 81 L 52.5 60 Z"
            fill="url(#logo-gold)"
            stroke="#ffffff"
            strokeWidth="0.5"
            opacity="0.95"
            className="transition-all duration-300 group-hover:translate-y-[2px]"
          />
        </g>
      </svg>
    </div>
  );
};

export default Logo;
