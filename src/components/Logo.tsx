import React from 'react';

/** EHC Meter mark: a gauge arc with a lightning bolt. */
export const LogoMark: React.FC<{ size?: number; className?: string }> = ({ size = 40, className = '' }) => (
  <svg width={size} height={size} viewBox="0 0 48 48" role="img" aria-label="EHC Meter logo" className={className}>
    <rect width="48" height="48" rx="11" fill="#1a5fb4" />
    <path d="M9.5 32a14.5 14.5 0 0 1 29 0" fill="none" stroke="#fff" strokeWidth="3.4" strokeLinecap="round" />
    <path d="M26 11 16.5 27H23l-2 11 10.5-16H25z" fill="#ffd23f" />
  </svg>
);

export const Brand: React.FC<{ size?: number; stacked?: boolean; light?: boolean }> = ({ size = 36, stacked = false, light = false }) => (
  <div className={`flex ${stacked ? 'flex-col items-center text-center' : 'items-center'} gap-2.5`}>
    <LogoMark size={size} />
    <span className={`font-extrabold tracking-tight leading-none ${stacked ? 'text-2xl' : 'text-lg'} ${light ? 'text-white' : 'text-[#111111]'}`}>
      EHC <span className="text-[#1a5fb4]">Meter</span>
    </span>
  </div>
);
