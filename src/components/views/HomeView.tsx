import React from 'react';
import type { Meter } from '../../hooks/useMeter';
import { Banner, Btn, Card, Page, Reading } from '../ui';
import { fmt } from '../../utils/cost';

const TRIP_TEXT: Record<string, string> = {
  OVER_VOLTAGE: 'Over-voltage', UNDER_VOLTAGE: 'Under-voltage', OVER_CURRENT: 'Over-current', SENSOR: 'Sensor not responding',
};
export const RESULT_TEXT: Record<string, string> = {
  REJECTED_TRIPPED: 'Refused: the meter is tripped. Reset the trip first.',
  REJECTED_NO_SENSOR: 'Refused: the PZEM sensor is not responding.',
  REJECTED_VOLTAGE: 'Refused: mains voltage is outside the limits.',
  REJECTED_BUSY: 'Refused: a batch is already running.',
  REJECTED_IDLE: 'Refused: no batch is running.',
  REJECTED_STILL_FAULT: 'Refused: the fault is still present.',
  IGNORED_STALE: 'Ignored: the command arrived too late (meter was offline).',
};

export const HomeView: React.FC<{ m: Meter; onOpenSetup: () => void }> = ({ m, onOpenSetup }) => {
  const t = m.telemetry;
  const live = m.online && !!t;
  const outOfRange = (v: number | null, lo: number | null, hi: number | null) => v != null && lo != null && hi != null && (v < lo || v > hi);
  const vBad = !!outOfRange(t?.voltage ?? null, t?.limitUv ?? null, t?.limitOv ?? null);
  const iBad = !!(t && t.current != null && t.limitOc != null && t.current > t.limitOc);
  const stale = !live;
  const show = (n: number | null | undefined, d: number) => (stale || !t?.pzemConnected ? 'N/A' : fmt(n, d));
  const lastResult = t?.lastCmdResult && RESULT_TEXT[t.lastCmdResult];

  return (
    <Page title="Home" right={
      <span className={`text-xs font-bold px-2 py-1 rounded ${live ? 'bg-[#e6f2e7] text-[#1b4d1e]' : 'bg-[#fde7e7] text-[#7a1510]'}`}>
        {live ? 'Meter online' : 'Meter offline'}
      </span>}>
      {m.error && <Banner tone="bad">{m.error}</Banner>}
      {!t && <Banner tone="info">No data from the meter yet. If this is a new setup, <button className="underline font-bold" onClick={onOpenSetup}>set up the ESP32</button>.</Banner>}
      {t?.tripActive && (
        <Banner tone="bad"><b>Protection tripped:</b> {TRIP_TEXT[t.tripReason] ?? t.tripReason}. The load is switched off.</Banner>
      )}
      {live && !t.pzemConnected && <Banner tone="warn">PZEM sensor not responding. Check its wiring and 5 V supply. The load is cut after 10 s.</Banner>}
      {stale && t && <Banner tone="warn">The meter has not reported for over 20 s. Readings below are hidden because they may be out of date.</Banner>}
      {live && lastResult && <Banner tone="warn">Last command: {lastResult}</Banner>}

      <Card title="Live readings" span="two">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 lg:gap-4">
          <Reading label="Voltage" value={show(t?.voltage, 1)} unit="V" warn={!stale && vBad} />
          <Reading label="Current" value={show(t?.current, 2)} unit="A" warn={!stale && iBad} />
          <Reading label="Power" value={show(t?.power, 1)} unit="W" />
          <Reading label="Power factor" value={show(t?.pf, 2)} unit="" />
        </div>
        <div className="text-xs text-[#555555] mt-2">
          Frequency {show(t?.frequency, 1)}{show(t?.frequency, 1) !== 'N/A' && ' Hz'} | Energy total {show(t?.energy, 2)}{show(t?.energy, 2) !== 'N/A' && ' kWh'}
        </div>
      </Card>

      <Card title="Mains relay">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-xl font-bold">{stale ? 'Unknown' : t?.relayOn ? 'ON' : 'OFF'}</div>
            <div className="text-xs text-[#555555]">{t?.batchState === 'RUNNING' ? 'A batch is running. Turning off stops it.' : 'Switches the load connected to the meter.'}</div>
          </div>
          {t?.tripActive ? (
            <Btn kind="danger" onClick={m.resetTrip} disabled={!live || m.pending === 'RESET_TRIP'}>Reset trip</Btn>
          ) : (
            <Btn kind={t?.relayOn ? 'danger' : 'primary'} onClick={() => m.setRelay(!t?.relayOn)} disabled={!live || m.pending === 'SET_RELAY'}>
              {m.pending === 'SET_RELAY' ? 'Sending...' : t?.relayOn ? 'Turn OFF' : 'Turn ON'}
            </Btn>
          )}
        </div>
      </Card>

      <Card title="System status">
        <ul className="text-sm divide-y divide-[#eeeeee]">
          <Row k="Wi-Fi / cloud" v={live ? `Connected${t?.wifiRssi != null ? ` (${t.wifiRssi} dBm)` : ''}` : 'Offline'} bad={!live} />
          <Row k="PZEM sensor" v={live ? (t?.pzemConnected ? 'Connected' : 'Not responding') : 'Unknown'} bad={live && !t?.pzemConnected} />
          <Row k="Today" v={`${fmt(t?.dayKwh, 3)}${t?.dayKwh != null ? ' kWh' : ''}`} />
          <Row k="Batch" v={t ? (t.batchState === 'RUNNING' ? `${t.batchName} (running)` : t.batchState.toLowerCase()) : 'N/A'} />
          <Row k="Firmware" v={t?.fw ? `v${t.fw}` : 'N/A'} />
        </ul>
      </Card>

      <Card title="Quick alerts">
        {live && t && !t.tripActive && !vBad && !iBad && t.pzemConnected && t.batchState !== 'DONE' && t.batchState !== 'INTERRUPTED' ? (
          <p className="text-sm text-[#1b4d1e]">All normal.</p>
        ) : (
          <ul className="text-sm list-disc pl-5 space-y-1">
            {!live && <li>Meter offline.</li>}
            {live && t?.tripActive && <li>Tripped: {TRIP_TEXT[t.tripReason] ?? t.tripReason}.</li>}
            {live && vBad && !t?.tripActive && <li>Voltage {fmt(t?.voltage, 1)} V is outside {t?.limitUv}-{t?.limitOv} V.</li>}
            {live && iBad && !t?.tripActive && <li>Current {fmt(t?.current, 2)} A is above the {t?.limitOc} A limit.</li>}
            {live && t && !t.pzemConnected && <li>PZEM sensor not responding.</li>}
            {live && t?.batchState === 'DONE' && <li>Batch "{t.batchName}" is done.</li>}
            {live && t?.batchState === 'INTERRUPTED' && <li>Batch "{t.batchName}" was interrupted.</li>}
          </ul>
        )}
      </Card>
      <button onClick={onOpenSetup} className="lg:hidden text-sm text-[#1a5fb4] underline self-start min-h-11">ESP32 setup</button>
    </Page>
  );
};

const Row: React.FC<{ k: string; v: string; bad?: boolean }> = ({ k, v, bad }) => (
  <li className="flex justify-between py-2"><span className="text-[#555555]">{k}</span><span className={`font-bold ${bad ? 'text-[#b3261e]' : ''}`}>{v}</span></li>
);
