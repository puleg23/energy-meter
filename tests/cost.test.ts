import { addDays, checkLimits, cycleStartFor, hourlyWatts, lastSevenDays, localDateKey, nextCycleStart, summariseCycle } from '../src/utils/cost';
import { DEFAULT_SETTINGS, LIMIT_RANGES, type DayRecord } from '../src/types';

let fails = 0;
const eq = (name: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) { fails++; console.log(`FAIL ${name}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`); } else console.log(`ok   ${name}`);
};
const near = (name: string, got: number | null, want: number, tol = 1e-6) => {
  const ok = got != null && Math.abs(got - want) <= tol;
  if (!ok) { fails++; console.log(`FAIL ${name}: got ${got} want ${want}`); } else console.log(`ok   ${name}`);
};

// UTC+2: 2026-11-12 22:30 UTC is already 2026-11-13 locally
eq('date key crosses midnight at +2', localDateKey(Date.UTC(2026, 10, 12, 22, 30)), '2026-11-13');
eq('date key before midnight', localDateKey(Date.UTC(2026, 10, 12, 21, 59)), '2026-11-12');
eq('addDays across month', addDays('2026-01-31', 1), '2026-02-01');
eq('addDays negative across year', addDays('2026-01-01', -1), '2025-12-31');

eq('cycle: bill day 1', cycleStartFor('2026-11-12', 1, null), '2026-11-01');
eq('cycle: bill day 20 before it', cycleStartFor('2026-11-12', 20, null), '2026-10-20');
eq('cycle: bill day 20 in January wraps year', cycleStartFor('2026-01-05', 20, null), '2025-12-20');
eq('cycle: bill day clamped to 28', cycleStartFor('2026-02-27', 31, null), '2026-01-28');
eq('cycle: manual restart wins', cycleStartFor('2026-11-12', 1, '2026-11-05'), '2026-11-05');
eq('cycle: old manual ignored', cycleStartFor('2026-11-12', 1, '2026-10-05'), '2026-11-01');
eq('cycle: future manual ignored', cycleStartFor('2026-11-12', 1, '2026-11-20'), '2026-11-01');
eq('next cycle from natural', nextCycleStart('2026-11-01', 1), '2026-12-01');
eq('next cycle December wraps', nextCycleStart('2026-12-20', 20), '2027-01-20');
eq('next cycle from manual mid-month', nextCycleStart('2026-11-05', 20), '2026-11-20');

const day = (date: string, kwh: number): DayRecord => ({ date, kwh, hours: Array(24).fill(kwh / 24) });
const now = Date.UTC(2026, 10, 12, 10, 0); // 12:00 local, 2026-11-12
const hist = [day('2026-11-01', 4), day('2026-11-02', 6), day('2026-11-03', 5), day('2026-10-31', 99), day('2026-11-12', 1.2)];
const s = { ...DEFAULT_SETTINGS, ratePerKwh: 2, fixedCharge: 10, monthlyBudget: 100, billDay: 1 };
const c = summariseCycle(hist, 3, s, now);
eq('cycle excludes previous month and stored today', c.completeDays, 3);
near('cycle kwh = past days + live today', c.kwh, 4 + 6 + 5 + 3);
near('cycle cost = kwh*rate + fixed', c.cost, 18 * 2 + 10);
eq('cycle length November', c.lengthDays, 30);
const frac = 0.5; // 12:00 local
near('daily average over days with data', c.dailyAvgKwh, 18 / (3 + frac));
near('prediction = so far + avg * remaining', c.predictedKwh, 18 + (18 / 3.5) * (30 - (11 + frac)), 1e-9);
eq('reliable with 3 full days', c.reliable, true);

const none = summariseCycle([], 0.4, s, Date.UTC(2026, 10, 1, 0, 30)); // 02:30 local on cycle day 1
eq('no prediction on first hours', none.predictedCost, null);
eq('no prediction without a full day even after 1 day elapsed', summariseCycle([], 2, s, Date.UTC(2026, 10, 3, 10, 0)).predictedCost, null);
const one = summariseCycle([day('2026-11-01', 5)], 1, s, Date.UTC(2026, 10, 2, 10, 0));
eq('one full day: prediction present but flagged', [one.predictedCost != null, one.reliable], [true, false]);

const week = lastSevenDays(hist, 3, now);
eq('week has 7 entries, ends today', [week.length, week[6].date, week[6].kwh], [7, '2026-11-12', 3]);
eq('missing day is null, not zero', week.find((d) => d.date === '2026-11-10')?.kwh, null);
eq('hourly watts: 4.8 kWh/day -> 200 W', hourlyWatts(day('2026-11-01', 4.8))[5], 200);
eq('hourly watts: no record -> zeros', hourlyWatts(undefined).every((w) => w === 0), true);

eq('limits ok', checkLimits(250, 180, 15, LIMIT_RANGES).ok, true);
eq('limits: uv too close to ov', checkLimits(250, 245, 15, LIMIT_RANGES).ok, false);
eq('limits: ov out of range', checkLimits(320, 180, 15, LIMIT_RANGES).ok, false);
eq('limits: NaN rejected', checkLimits(NaN, 180, 15, LIMIT_RANGES).ok, false);
eq('limits: oc zero rejected', checkLimits(250, 180, 0, LIMIT_RANGES).ok, false);

if (fails) { console.log(`${fails} FAILED`); process.exit(1); }
console.log('all passed');
