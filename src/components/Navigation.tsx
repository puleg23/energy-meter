import React from 'react';
import { ActiveTab } from '../types';

const TABS: { key: ActiveTab; label: string }[] = [
  { key: 'home', label: 'Home' }, { key: 'cost', label: 'Cost' }, { key: 'batch', label: 'Batch' },
  { key: 'limits', label: 'Limits' }, { key: 'graphs', label: 'Graphs' },
];

export const Navigation: React.FC<{ currentTab: ActiveTab; onTabChange: (t: ActiveTab) => void }> = ({ currentTab, onTabChange }) => (
  <nav className="fixed bottom-0 left-0 right-0 max-w-md mx-auto flex bg-white border-t border-[#cccccc] z-50">
    {TABS.map((t) => {
      const active = t.key === currentTab;
      return (
        <button key={t.key} onClick={() => onTabChange(t.key)} aria-current={active ? 'page' : undefined}
          className={`flex-1 min-h-14 text-[13px] border-t-[3px] ${active ? 'text-[#1a5fb4] font-bold border-[#1a5fb4]' : 'text-[#555555] border-white'}`}>
          {t.label}
        </button>
      );
    })}
  </nav>
);
