import React, { useState } from 'react';
import type { Meter } from '../../hooks/useMeter';
import { Banner, Btn, Card, Field, Page, inputCls } from '../ui';
import { clock, fmt, money } from '../../utils/cost';
import { RESULT_TEXT } from './HomeView';

const END_TEXT: Record<string, string> = { COMPLETED: 'Completed', STOPPED: 'Stopped early', TRIP: 'Interrupted by trip', INTERRUPTED: 'Interrupted (power loss)' };

function when(epoch: number): string {
  if (!epoch) return 'time unknown';
  return new Date(epoch * 1000).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Lusaka' });
}

export const BatchView: React.FC<{ m: Meter }> = ({ m }) => {
  const t = m.telemetry;
  const live = m.online && !!t;
  const [name, setName] = useState('');
  const [hours, setHours] = useState('0');
  const [mins, setMins] = useState('30');
  const [err, setErr] = useState('');

  const start = () => {
    const total = Math.round((parseInt(hours, 10) || 0) * 60 + (parseInt(mins, 10) || 0));
    if (total < 1 || total > 1440) { setErr('Enter a duration between 1 minute and 24 hours.'); return; }
    if (!name.trim()) { setErr('Give the batch a name.'); return; }
    setErr('');
    m.startBatch(name.trim().slice(0, 23), total);
  };

  const running = t?.batchState === 'RUNNING';
  const finished = t && ['DONE', 'STOPPED', 'INTERRUPTED'].includes(t.batchState);
  const total = (t?.batchTotalMin ?? 0) * 60;
  const progress = running && total > 0 ? Math.min(100, ((total - m.batchSecondsLeft) / total) * 100) : 0;
  const rejected = t?.lastCmdResult && RESULT_TEXT[t.lastCmdResult];
  const rate = m.settings.ratePerKwh;

  return (
    <Page title="Batch">
      {m.error && <Banner tone="bad">{m.error}</Banner>}
      {!live && <Banner tone="warn">The meter is offline. Batch controls are disabled.</Banner>}
      {rejected && (t?.lastCmd === 'START_BATCH' || t?.lastCmd === 'STOP_BATCH' || t?.lastCmd === 'EXTEND_BATCH') && <Banner tone="warn">Last command: {rejected}</Banner>}

      {running && t && (
        <Card title={t.batchName || 'Batch'} right={<span className="text-xs font-bold bg-[#e6f2e7] text-[#1b4d1e] px-2 py-1 rounded">RUNNING</span>}>
          <div className="text-4xl font-bold font-mono-nums text-center py-2" aria-live="off">{clock(m.batchSecondsLeft)}</div>
          <div className="h-3 bg-[#e5e7eb] rounded"><div className="h-3 bg-[#1a5fb4] rounded" style={{ width: `${progress}%` }} /></div>
          <div className="flex justify-between text-sm mt-3">
            <span>Used: <b className="font-mono-nums">{fmt(t.batchKwhUsed, 3)} kWh</b></span>
            <span>Cost: <b className="font-mono-nums">{money(t.batchKwhUsed * rate)}</b></span>
          </div>
          <div className="flex gap-2 mt-3">
            <Btn className="flex-1" onClick={() => m.extendBatch(15)} disabled={!live || m.pending === 'EXTEND_BATCH'}>+15 min</Btn>
            <Btn kind="danger" className="flex-1" onClick={m.stopBatch} disabled={!live || m.pending === 'STOP_BATCH'}>Stop batch</Btn>
          </div>
        </Card>
      )}

      {finished && t && (
        <Card title={t.batchName || 'Batch'}>
          <Banner tone={t.batchState === 'DONE' ? 'ok' : 'warn'}>
            {t.batchState === 'DONE' ? 'Batch finished.' : t.batchState === 'STOPPED' ? 'Batch was stopped early.' : 'Batch was interrupted before it finished.'}
            {' '}Used {fmt(t.batchKwhUsed, 3)} kWh ({money(t.batchKwhUsed * rate)}).
          </Banner>
          <Btn className="w-full mt-3" onClick={m.ackBatch} disabled={!live || m.pending === 'ACK_BATCH'}>OK, clear (stops the buzzer)</Btn>
        </Card>
      )}

      {!running && (
        <Card title="Start a batch">
          <div className="flex flex-col gap-3">
            <Field label="Batch name"><input className={inputCls} value={name} maxLength={23} onChange={(e) => setName(e.target.value)} placeholder="e.g. Bread oven run" /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Hours"><input className={inputCls} inputMode="numeric" value={hours} onChange={(e) => setHours(e.target.value)} /></Field>
              <Field label="Minutes"><input className={inputCls} inputMode="numeric" value={mins} onChange={(e) => setMins(e.target.value)} /></Field>
            </div>
            {err && <p className="text-sm text-[#b3261e]" role="alert">{err}</p>}
            <Btn kind="primary" onClick={start} disabled={!live || m.pending === 'START_BATCH' || !!t?.tripActive}>
              {m.pending === 'START_BATCH' ? 'Sending...' : 'Start batch (switches the load ON)'}
            </Btn>
            {t?.tripActive && <p className="text-sm text-[#b3261e]">Reset the protection trip on the Home tab before starting.</p>}
          </div>
        </Card>
      )}

      <Card title="Batch history" span="full">
        {m.batches.length === 0 ? (
          <p className="text-sm text-[#555555]">No finished batches yet.</p>
        ) : (
          <ul className="divide-y divide-[#eeeeee]">
            {m.batches.map((b) => (
              <li key={b.id} className="py-2.5 flex justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-bold truncate">{b.name}</div>
                  <div className="text-xs text-[#555555]">{when(b.startedAt)} | {Math.round(b.actualS / 60)} of {b.plannedMin} min | {END_TEXT[b.endReason] ?? b.endReason}</div>
                </div>
                <div className="text-right shrink-0">
                  <div className="font-bold font-mono-nums">{fmt(b.kwh, 3)} kWh</div>
                  <div className="text-xs text-[#555555] font-mono-nums">{money(b.kwh * rate)}</div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </Page>
  );
};
