import React from 'react';

/** span: on laptops 'two' takes two columns, 'full' takes the whole row. Phones are always one column. */
const SPAN = { one: '', two: 'lg:col-span-2', full: 'lg:col-span-2 xl:col-span-3' } as const;

export const Card: React.FC<{ title?: string; right?: React.ReactNode; children: React.ReactNode; className?: string; span?: keyof typeof SPAN }> = ({ title, right, children, className = '', span = 'one' }) => (
  <section className={`bg-white border border-[#cccccc] rounded-lg p-3.5 lg:p-5 ${SPAN[span]} ${className}`}>
    {(title || right) && (
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-base font-bold">{title}</h2>
        {right}
      </div>
    )}
    {children}
  </section>
);

export const Btn: React.FC<React.ButtonHTMLAttributes<HTMLButtonElement> & { kind?: 'primary' | 'danger' | 'plain' }> = ({ kind = 'plain', className = '', ...p }) => {
  const style = kind === 'primary' ? 'bg-[#1a5fb4] text-white border-[#1a5fb4]'
    : kind === 'danger' ? 'bg-[#b3261e] text-white border-[#b3261e]'
    : 'bg-white text-[#111111] border-[#999999]';
  return <button {...p} className={`min-h-12 px-4 rounded-md border font-bold text-base whitespace-nowrap ${style} ${className}`} />;
};

export const Banner: React.FC<{ tone: 'bad' | 'warn' | 'ok' | 'info'; children: React.ReactNode }> = ({ tone, children }) => {
  const c = tone === 'bad' ? 'bg-[#fde7e7] border-[#b3261e] text-[#7a1510]'
    : tone === 'warn' ? 'bg-[#fff4d6] border-[#b26a00] text-[#5c3800]'
    : tone === 'ok' ? 'bg-[#e6f2e7] border-[#2e7d32] text-[#1b4d1e]'
    : 'bg-[#e8f0fb] border-[#1a5fb4] text-[#10386b]';
  return <div role="status" className={`border rounded-md px-3 py-2 text-sm lg:col-span-2 xl:col-span-3 ${c}`}>{children}</div>;
};

export const Reading: React.FC<{ label: string; value: string; unit: string; warn?: boolean }> = ({ label, value, unit, warn }) => (
  <div className="border border-[#dddddd] rounded-md p-2.5">
    <div className="text-xs text-[#555555]">{label}</div>
    <div className={`text-2xl font-bold font-mono-nums ${warn ? 'text-[#b3261e]' : ''}`}>
      {value}{value !== 'N/A' && <span className="text-sm font-normal text-[#555555] ml-1">{unit}</span>}
    </div>
  </div>
);

export const Field: React.FC<{ label: string; hint?: string; children: React.ReactNode }> = ({ label, hint, children }) => (
  <label className="block">
    <span className="block text-sm font-bold mb-1">{label}</span>
    {children}
    {hint && <span className="block text-xs text-[#555555] mt-1">{hint}</span>}
  </label>
);

export const inputCls = 'w-full min-h-12 px-3 border border-[#999999] rounded-md text-base bg-white';

export const Page: React.FC<{ title: string; right?: React.ReactNode; children: React.ReactNode }> = ({ title, right, children }) => (
  <div className="pb-24 lg:pb-10">
    <header className="h-14 -mx-4 sm:-mx-5 px-4 sm:px-5 flex items-center justify-between bg-white border-b border-[#cccccc] mb-3 lg:mx-0 lg:px-0 lg:h-20 lg:bg-transparent lg:border-0 lg:mb-1">
      <h1 className="text-lg font-bold lg:text-2xl">{title}</h1>
      {right}
    </header>
    <div className="flex flex-col gap-3 lg:grid lg:grid-cols-2 xl:grid-cols-3 lg:gap-5 lg:items-start">{children}</div>
  </div>
);

export const Toggle: React.FC<{ on: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }> = ({ on, onChange, label, disabled }) => (
  <button type="button" role="switch" aria-checked={on} aria-label={label} disabled={disabled} onClick={() => onChange(!on)}
    className={`relative w-14 h-8 rounded-full border ${on ? 'bg-[#1a5fb4] border-[#1a5fb4]' : 'bg-[#cccccc] border-[#999999]'}`}>
    <span className={`absolute top-0.5 w-6 h-6 rounded-full bg-white transition-all ${on ? 'left-7' : 'left-0.5'}`} />
  </button>
);
