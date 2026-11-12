import { DayRecord, Settings, UTC_OFFSET_HOURS } from '../types';

const pad = (n: number) => String(n).padStart(2, '0');

/** Calendar date in the meter's time zone as YYYY-MM-DD. */
export function localDateKey(nowMs: number): string {
  const d = new Date(nowMs + UTC_OFFSET_HOURS * 3600_000);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

export function hourOfDay(nowMs: number): number {
  return new Date(nowMs + UTC_OFFSET_HOURS * 3600_000).getUTCHours();
}

/** Fraction of the local day that has passed, 0..1. */
export function dayFraction(nowMs: number): number {
  const d = new Date(nowMs + UTC_OFFSET_HOURS * 3600_000);
  return (d.getUTCHours() * 3600 + d.getUTCMinutes() * 60 + d.getUTCSeconds()) / 86400;
}

function dateFromKey(key: string): number {
  const [y, m, d] = key.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

export function addDays(key: string, days: number): string {
  const t = new Date(dateFromKey(key) + days * 86400_000);
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

export function daysBetween(fromKey: string, toKey: string): number {
  return Math.round((dateFromKey(toKey) - dateFromKey(fromKey)) / 86400_000);
}

/** First day of the bill cycle that contains `todayKey`. */
export function cycleStartFor(todayKey: string, billDay: number, manualStart: string | null): string {
  const bd = Math.min(28, Math.max(1, Math.round(billDay) || 1));
  const [y, m, d] = todayKey.split('-').map(Number);
  let sy = y, sm = m;
  if (d < bd) { sm -= 1; if (sm === 0) { sm = 12; sy -= 1; } }
  const natural = `${sy}-${pad(sm)}-${pad(bd)}`;
  // A manual restart only counts while it sits inside the natural cycle or later (never in the future).
  if (manualStart && manualStart > natural && manualStart <= todayKey) return manualStart;
  return natural;
}

/** Next cycle start after `startKey`, following the bill day. */
export function nextCycleStart(startKey: string, billDay: number): string {
  const bd = Math.min(28, Math.max(1, Math.round(billDay) || 1));
  const [y, m] = startKey.split('-').map(Number);
  let ny = y, nm = m + 1;
  if (nm === 13) { nm = 1; ny += 1; }
  // when startKey is a manual date in the middle of a month, the next natural start is the next bill day after it
  const candidateSameMonth = `${y}-${pad(m)}-${pad(bd)}`;
  if (candidateSameMonth > startKey) return candidateSameMonth;
  return `${ny}-${pad(nm)}-${pad(bd)}`;
}

export interface CycleSummary {
  startKey: string;
  endKey: string; // exclusive: first day of the next cycle
  lengthDays: number;
  elapsedDays: number; // fractional days elapsed in the cycle (>0)
  completeDays: number; // days with a stored record before today
  kwh: number;
  cost: number;
  dailyAvgKwh: number | null;
  predictedKwh: number | null;
  predictedCost: number | null;
  budgetUsedPct: number; // of actual spend so far
  predictedBudgetPct: number | null;
  reliable: boolean; // at least 2 full days of data
}

export function cost(kwh: number, s: Pick<Settings, 'ratePerKwh'>): number {
  return kwh * s.ratePerKwh;
}

/**
 * Month-to-date summary from stored daily records plus the live "today" figure from the meter.
 * Today's stored record can lag by up to 5 minutes, so the live value replaces it.
 */
export function summariseCycle(
  history: DayRecord[],
  todayKwh: number,
  s: Settings,
  nowMs: number,
): CycleSummary {
  const today = localDateKey(nowMs);
  const startKey = cycleStartFor(today, s.billDay, s.cycleStart);
  const endKey = nextCycleStart(startKey, s.billDay);
  const lengthDays = Math.max(1, daysBetween(startKey, endKey));

  let pastKwh = 0;
  let completeDays = 0;
  for (const r of history) {
    if (r.date >= startKey && r.date < today) { pastKwh += r.kwh; completeDays += 1; }
  }
  const kwh = pastKwh + Math.max(0, todayKwh);
  const elapsedDays = Math.min(lengthDays, daysBetween(startKey, today) + Math.max(dayFraction(nowMs), 0.01));
  const reliable = completeDays >= 2;
  const variable = kwh * s.ratePerKwh;
  const spent = variable + s.fixedCharge;

  let dailyAvgKwh: number | null = null;
  let predictedKwh: number | null = null;
  let predictedCost: number | null = null;
  let predictedBudgetPct: number | null = null;
  if (completeDays >= 1) {
    // average over days that actually have data: complete days + the part of today that has passed
    const basisDays = Math.max(completeDays + dayFraction(nowMs), 0.25);
    dailyAvgKwh = kwh / basisDays;
    const remaining = Math.max(0, lengthDays - elapsedDays);
    predictedKwh = kwh + dailyAvgKwh * remaining;
    predictedCost = predictedKwh * s.ratePerKwh + s.fixedCharge;
    predictedBudgetPct = s.monthlyBudget > 0 ? (predictedCost / s.monthlyBudget) * 100 : null;
  }
  return {
    startKey, endKey, lengthDays, elapsedDays, completeDays, kwh, cost: spent,
    dailyAvgKwh, predictedKwh, predictedCost,
    budgetUsedPct: s.monthlyBudget > 0 ? (spent / s.monthlyBudget) * 100 : 0,
    predictedBudgetPct, reliable,
  };
}

/** Seven daily totals ending today (oldest first). Missing days are null so the chart shows a gap, not a zero. */
export function lastSevenDays(history: DayRecord[], todayKwh: number, nowMs: number): { date: string; kwh: number | null }[] {
  const today = localDateKey(nowMs);
  const out: { date: string; kwh: number | null }[] = [];
  for (let i = 6; i >= 0; i--) {
    const date = addDays(today, -i);
    if (date === today) { out.push({ date, kwh: Math.max(0, todayKwh) }); continue; }
    const rec = history.find((r) => r.date === date);
    out.push({ date, kwh: rec ? rec.kwh : null });
  }
  return out;
}

/** Average power in watts for each hour of a day record (kWh in one hour equals average kW). */
export function hourlyWatts(rec: DayRecord | undefined): number[] {
  return Array.from({ length: 24 }, (_, h) => Math.round((rec?.hours[h] ?? 0) * 1000));
}

export function weekdayShort(dateKey: string): string {
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][new Date(dateFromKey(dateKey)).getUTCDay()];
}

export function money(n: number | null | undefined): string {
  if (n == null || !isFinite(n)) return 'N/A';
  return `ZMW ${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function fmt(n: number | null | undefined, digits = 1, unit = ''): string {
  if (n == null || !isFinite(n)) return 'N/A';
  return `${n.toFixed(digits)}${unit}`;
}

export function clock(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}`;
}

export interface LimitCheck { ok: boolean; message: string }
export function checkLimits(ov: number, uv: number, oc: number, r: { overVoltage: {min:number;max:number}; underVoltage: {min:number;max:number}; overCurrent: {min:number;max:number}; minGap: number }): LimitCheck {
  if (![ov, uv, oc].every((n) => Number.isFinite(n))) return { ok: false, message: 'Enter all three limits as numbers.' };
  if (ov < r.overVoltage.min || ov > r.overVoltage.max) return { ok: false, message: `Over-voltage must be ${r.overVoltage.min}-${r.overVoltage.max} V.` };
  if (uv < r.underVoltage.min || uv > r.underVoltage.max) return { ok: false, message: `Under-voltage must be ${r.underVoltage.min}-${r.underVoltage.max} V.` };
  if (uv + r.minGap > ov) return { ok: false, message: `Under-voltage must be at least ${r.minGap} V below over-voltage.` };
  if (oc < r.overCurrent.min || oc > r.overCurrent.max) return { ok: false, message: `Over-current must be ${r.overCurrent.min}-${r.overCurrent.max} A.` };
  return { ok: true, message: '' };
}
