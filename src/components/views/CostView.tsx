import React, { useEffect, useState } from 'react';
import type { Meter } from '../../hooks/useMeter';
import { Banner, Btn, Card, Field, Page, inputCls } from '../ui';
import { fmt, money } from '../../utils/cost';

export const CostView: React.FC<{ m: Meter }> = ({ m }) => {
  const { settings: s, cycle: c, telemetry: t } = m;
  const [rate, setRate] = useState(String(s.ratePerKwh));
  const [fixed, setFixed] = useState(String(s.fixedCharge));
  const [billDay, setBillDay] = useState(String(s.billDay));
  const [budget, setBudget] = useState(String(s.monthlyBudget));
  const [msg, setMsg] = useState('');
  const [confirmReset, setConfirmReset] = useState(false);

  useEffect(() => {
    setRate(String(s.ratePerKwh)); setFixed(String(s.fixedCharge)); setBillDay(String(s.billDay)); setBudget(String(s.monthlyBudget));
  }, [s.ratePerKwh, s.fixedCharge, s.billDay, s.monthlyBudget]);

  const todayKwh = m.todayKwh;
  const todayCost = todayKwh * s.ratePerKwh;
  const haveData = t != null;

  const save = async () => {
    const r = parseFloat(rate), f = parseFloat(fixed), d = parseInt(billDay, 10), b = parseFloat(budget);
    if (!(r >= 0 && r < 1000) || !(f >= 0 && f < 100000) || !(d >= 1 && d <= 28) || !(b >= 0 && b < 10_000_000)) {
      setMsg('Check the numbers: rate and charge must be 0 or more, bill day 1-28.'); return;
    }
    const ok = await m.saveSettings({ ratePerKwh: r, fixedCharge: f, billDay: d, monthlyBudget: b });
    setMsg(ok ? 'Saved.' : '');
  };

  const startNewCycle = async () => {
    const ok = await m.saveSettings({ cycleStart: m.todayKey });
    setConfirmReset(false);
    setMsg(ok ? 'New cycle started today.' : '');
  };

  const pct = Math.min(100, Math.max(0, c.budgetUsedPct));
  const predPct = c.predictedBudgetPct;
  return (
    <Page title="Cost">
      {m.error && <Banner tone="bad">{m.error}</Banner>}
      {!haveData && <Banner tone="info">Waiting for the first report from the meter. Figures below use 0 kWh until then.</Banner>}

      <Card title="Today">
        <div className="flex justify-between items-end">
          <div><div className="text-3xl font-bold font-mono-nums">{fmt(todayKwh, 3)}<span className="text-sm font-normal text-[#555555]"> kWh</span></div></div>
          <div className="text-xl font-bold font-mono-nums">{money(todayCost)}</div>
        </div>
      </Card>

      <Card title="This bill cycle">
        <div className="text-xs text-[#555555] mb-2">From {c.startKey} ({c.lengthDays}-day cycle, ends before {c.endKey})</div>
        <div className="flex justify-between items-end">
          <div className="text-3xl font-bold font-mono-nums">{fmt(c.kwh, 2)}<span className="text-sm font-normal text-[#555555]"> kWh</span></div>
          <div className="text-xl font-bold font-mono-nums">{money(c.cost)}</div>
        </div>
        {s.fixedCharge > 0 && <div className="text-xs text-[#555555] mt-1">Includes the fixed charge of {money(s.fixedCharge)}.</div>}
        <div className="mt-3" aria-label={`Budget used ${pct.toFixed(0)} percent`}>
          <div className="h-3 bg-[#e5e7eb] rounded"><div className={`h-3 rounded ${pct >= 100 ? 'bg-[#b3261e]' : 'bg-[#1a5fb4]'}`} style={{ width: `${pct}%` }} /></div>
          <div className="text-xs text-[#555555] mt-1">{pct.toFixed(0)}% of your {money(s.monthlyBudget)} budget spent</div>
        </div>
      </Card>

      <Card title="End-of-cycle prediction">
        {c.predictedCost == null ? (
          <p className="text-sm text-[#555555]">Not enough data yet. The prediction appears after the first full day of readings.</p>
        ) : (
          <>
            <div className="text-3xl font-bold font-mono-nums">{money(c.predictedCost)}</div>
            <div className="text-sm text-[#555555]">about {fmt(c.predictedKwh, 1)} kWh at {fmt(c.dailyAvgKwh, 2)} kWh per day</div>
            {predPct != null && (
              <div className={`mt-2 text-sm font-bold ${predPct > 100 ? 'text-[#b3261e]' : 'text-[#1b4d1e]'}`}>
                {predPct > 100 ? `Over budget by ${money(c.predictedCost - s.monthlyBudget)}` : `${money(s.monthlyBudget - c.predictedCost)} under budget`}
              </div>
            )}
            {!c.reliable && <div className="mt-2"><Banner tone="warn">Based on {c.completeDays} full day{c.completeDays === 1 ? '' : 's'} of data. It gets more accurate after a few days.</Banner></div>}
          </>
        )}
      </Card>

      <Card title="Tariff settings">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Rate (ZMW per kWh)"><input className={inputCls} inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} /></Field>
          <Field label="Fixed charge (ZMW)"><input className={inputCls} inputMode="decimal" value={fixed} onChange={(e) => setFixed(e.target.value)} /></Field>
          <Field label="Bill day (1-28)"><input className={inputCls} inputMode="numeric" value={billDay} onChange={(e) => setBillDay(e.target.value)} /></Field>
          <Field label="Monthly budget (ZMW)"><input className={inputCls} inputMode="decimal" value={budget} onChange={(e) => setBudget(e.target.value)} /></Field>
        </div>
        <div className="flex gap-2 mt-3">
          <Btn kind="primary" className="flex-1" onClick={save}>Save tariff</Btn>
        </div>
        {msg && <p className="text-sm mt-2" role="status">{msg}</p>}
        <div className="border-t border-[#eeeeee] mt-4 pt-3">
          {!confirmReset ? (
            <Btn className="w-full" onClick={() => setConfirmReset(true)}>Start new cycle today</Btn>
          ) : (
            <div>
              <p className="text-sm mb-2">Start a new bill cycle on {m.todayKey}? Month figures restart from zero. Stored history is kept.</p>
              <div className="flex gap-2"><Btn kind="danger" className="flex-1" onClick={startNewCycle}>Yes, start new</Btn><Btn className="flex-1" onClick={() => setConfirmReset(false)}>Cancel</Btn></div>
            </div>
          )}
        </div>
      </Card>
    </Page>
  );
};
