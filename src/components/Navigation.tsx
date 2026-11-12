import React from 'react';
import { BarChart3, Home, ShieldAlert, Timer, Wallet, type LucideIcon } from 'lucide-react';
import { ActiveTab } from '../types';

export const TABS: { key: ActiveTab; label: string; Icon: LucideIcon }[] = [
  { key: 'home', label: 'Home', Icon: Home },
  { key: 'cost', label: 'Cost', Icon: Wallet },
  { key: 'batch', label: 'Batch', Icon: Timer },
  { key: 'limits', label: 'Limits', Icon: ShieldAlert },
  { key: 'graphs', label: 'Graphs', Icon: BarChart3 },
];

type Props = { currentTab: ActiveTab; onTabChange: (t: ActiveTab) => void };

/** Phone: bottom bar with icons. Hidden on laptops, where the sidebar is used instead. */
export const Navigation: React.FC<Props> = ({ currentTab, onTabChange }) => (
  <nav aria-label="Main" className="lg:hidden fixed bottom-0 left-0 right-0 max-w-md mx-auto flex bg-white border-t border-[#cccccc] z-50">
    {TABS.map(({ key, label, Icon }) => {
      const active = key === currentTab;
      return (
        <button key={key} onClick={() => onTabChange(key)} aria-current={active ? 'page' : undefined}
          className={`flex-1 min-h-16 flex flex-col items-center justify-center gap-0.5 text-[12px] border-t-[3px] ${active ? 'text-[#1a5fb4] font-bold border-[#1a5fb4]' : 'text-[#555555] border-white'}`}>
          <Icon size={22} strokeWidth={active ? 2.4 : 2} aria-hidden="true" />
          {label}
        </button>
      );
    })}
  </nav>
);

/** Laptop: fixed left sidebar. */
export const Sidebar: React.FC<Props & { brand: React.ReactNode; online: boolean; email: string | null; onSignOut: () => void; onSetup: () => void }> = ({
  currentTab, onTabChange, brand, online, email, onSignOut, onSetup,
}) => (
  <aside className="hidden lg:flex fixed inset-y-0 left-0 w-64 flex-col bg-white border-r border-[#cccccc] z-40">
    <div className="h-20 px-5 flex items-center border-b border-[#eeeeee]">{brand}</div>
    <nav aria-label="Main" className="flex-1 p-3 flex flex-col gap-1">
      {TABS.map(({ key, label, Icon }) => {
        const active = key === currentTab;
        return (
          <button key={key} onClick={() => onTabChange(key)} aria-current={active ? 'page' : undefined}
            className={`flex items-center gap-3 min-h-12 px-3 rounded-md text-left text-base ${active ? 'bg-[#e8f0fb] text-[#1a5fb4] font-bold' : 'text-[#333333] hover:bg-[#f4f5f7]'}`}>
            <Icon size={20} strokeWidth={active ? 2.4 : 2} aria-hidden="true" />
            {label}
          </button>
        );
      })}
    </nav>
    <div className="p-4 border-t border-[#eeeeee] text-sm flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <span className={`inline-block w-2.5 h-2.5 rounded-full ${online ? 'bg-[#2e7d32]' : 'bg-[#b3261e]'}`} aria-hidden="true" />
        <span className="font-bold">{online ? 'Meter online' : 'Meter offline'}</span>
      </div>
      <button onClick={onSetup} className="text-left text-[#1a5fb4] underline min-h-9">ESP32 setup</button>
      <button onClick={onSignOut} className="text-left text-[#555555] underline min-h-9 truncate" title={email ?? ''}>Sign out{email ? ` (${email})` : ''}</button>
    </div>
  </aside>
);
