import React from 'react';

const Logo = ({ className = "w-10 h-10", size = 40, showGlow = true }) => {
  return (
    <div 
      className={`relative flex items-center justify-center group ${className} overflow-hidden rounded-xl`} 
      style={{ width: size, height: size }}
    >
      {/* Outer Glow Background */}
      {showGlow && (
        <div className="absolute inset-0 bg-gradient-to-tr from-primary-500/10 to-indigo-500/20 blur-md pointer-events-none transition-all duration-500 group-hover:from-primary-500/20 group-hover:to-indigo-500/30 group-hover:scale-110" />
      )}
      
      {/* 3D Glassmorphic Brand Logo Image */}
      <img
        src="/favicon.jpg"
        alt="EduStride Logo"
        className="w-full h-full object-cover relative z-10 transition-transform duration-300 ease-out group-hover:scale-105"
      />
    </div>
  );
};

export default Logo;
