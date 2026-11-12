import React, { useMemo, useState } from 'react';
import type { Meter } from '../../hooks/useMeter';
import { Banner, Card, Page } from '../ui';
import { hourOfDay, hourlyWatts, lastSevenDays, weekdayShort, fmt } from '../../utils/cost';

const niceMax = (v: number) => {
  if (v <= 0) return 100;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
};

export const GraphsView: React.FC<{ m: Meter }> = ({ m }) => {
  const [day, setDay] = useState<'today' | 'yesterday'>('today');
  const t = m.telemetry;

  const rec = useMemo(() => {
    const key = day === 'today' ? m.todayKey : (() => { const d = new Date(m.now + 2 * 3600_000 - 86400_000); return d.toISOString().slice(0, 10); })();
    return m.history.find((r) => r.date === key);
  }, [m.history, m.todayKey, m.now, day]);

  const watts = hourlyWatts(rec);
  const curHour = hourOfDay(m.now);
  const visible = day === 'today' ? watts.slice(0, curHour + 1) : watts;
  const max = niceMax(Math.max(...watts, 100));
  const W = 330, H = 150, L = 34, R = 322, T = 14, B = 130;
  const x = (h: number) => L + (h / 23) * (R - L);
  const y = (w: number) => B - (w / max) * (B - T);
  const pts = visible.map((w, h) => `${x(h).toFixed(1)},${y(w).toFixed(1)}`).join(' ');
  const hasPower = watts.some((w) => w > 0);
  const peak = hasPower ? watts.indexOf(Math.max(...watts)) : -1;

  const week = lastSevenDays(m.history, m.todayKwh, m.now);
  const wMax = Math.max(...week.map((d) => d.kwh ?? 0), 0.001);
  const best = week.reduce<{ date: string; kwh: number } | null>((a, d) => (d.kwh != null && (!a || d.kwh > a.kwh) ? { date: d.date, kwh: d.kwh } : a), null);

  return (
    <Page title="Graphs">
      {m.error && <Banner tone="bad">{m.error}</Banner>}
      <Card title="Power by hour (W)" right={
        <div className="flex border border-[#999999] rounded overflow-hidden text-sm">
          {(['today', 'yesterday'] as const).map((d) => (
            <button key={d} onClick={() => setDay(d)} aria-label={d === 'today' ? 'Today' : 'Yesterday'} className={`min-h-9 px-2.5 text-[13px] ${day === d ? 'bg-[#1a5fb4] text-white font-bold' : 'bg-white'}`}>{d === 'today' ? 'Today' : 'Yest.'}</button>
          ))}
        </div>}>
        {!rec && <p className="text-sm text-[#555555] mb-2">No history stored for {day} yet. The meter saves it every 5 minutes.</p>}
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img"
          aria-label={hasPower ? `Hourly average power ${day}, peak ${Math.max(...watts)} watts at ${peak}:00` : `No power recorded ${day}`}>
          {[0, 0.5, 1].map((f) => (
            <g key={f}>
              <line x1={L} x2={R} y1={B - f * (B - T)} y2={B - f * (B - T)} stroke="#e5e7eb" />
              <text x={L - 4} y={B - f * (B - T) + 3} fontSize="10" fill="#555555" textAnchor="end">{Math.round(max * f)}</text>
            </g>
          ))}
          {visible.length > 1 && <polyline points={pts} fill="none" stroke="#1a5fb4" strokeWidth="2.5" strokeLinejoin="round" />}
          {visible.length === 1 && <circle cx={x(0)} cy={y(visible[0])} r="3" fill="#1a5fb4" />}
        </svg>
        <div className="flex justify-between text-xs text-[#555555] pl-[34px]"><span>00:00</span><span>06:00</span><span>12:00</span><span>18:00</span><span>23:00</span></div>
        {hasPower && <div className="text-sm text-[#555555] mt-1">Peak: {Math.max(...watts)} W around {String(peak).padStart(2, '0')}:00</div>}
        {day === 'today' && t && t.power != null && <div className="text-xs text-[#555555]">Now: {fmt(t.power, 0)} W (the line shows hourly averages)</div>}
      </Card>

      <Card title="Daily usage, last 7 days (kWh)">
        <div className="flex items-end gap-2 h-28 mt-2" role="img" aria-label={best ? `Highest day ${weekdayShort(best.date)}, ${best.kwh.toFixed(2)} kWh` : 'No daily data yet'}>
          {week.map((d) => (
            <div key={d.date} className="flex-1 flex flex-col justify-end h-full">
              {d.kwh != null && <div className="text-[10px] text-center text-[#555555] font-mono-nums">{d.kwh.toFixed(1)}</div>}
              <div className={d.kwh == null ? 'border-t border-dashed border-[#999999]' : best && d.date === best.date ? 'bg-[#1a5fb4]' : 'bg-[#9db9e0]'}
                style={{ height: d.kwh == null ? 0 : `${Math.max(2, (d.kwh / wMax) * 80)}%` }} />
            </div>
          ))}
        </div>
        <div className="flex gap-2 text-xs text-[#555555] mt-1">
          {week.map((d) => <span key={d.date} className="flex-1 text-center">{weekdayShort(d.date)}</span>)}
        </div>
        {best ? <div className="text-sm text-[#555555] mt-1">Highest: {weekdayShort(best.date)}, {best.kwh.toFixed(2)} kWh</div>
          : <div className="text-sm text-[#555555] mt-1">No daily totals stored yet.</div>}
        <div className="text-xs text-[#555555]">A dashed line means no record for that day.</div>
      </Card>
    </Page>
  );
};
