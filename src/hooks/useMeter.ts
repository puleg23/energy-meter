import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  collection, doc, limit, onSnapshot, orderBy, query, serverTimestamp, setDoc, type DocumentData,
} from 'firebase/firestore';
import { db } from '../firebase';
import {
  BatchRecord, BatchState, DEFAULT_SETTINGS, DEVICE_ID, DayRecord, Settings, Telemetry,
} from '../types';
import { localDateKey, summariseCycle } from '../utils/cost';

const OFFLINE_AFTER_MS = 20_000; // the meter reports every 5 s

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const str = (v: unknown, d = ''): string => (typeof v === 'string' ? v : d);
const BATCH_STATES: BatchState[] = ['IDLE', 'RUNNING', 'DONE', 'STOPPED', 'INTERRUPTED'];

function parseTelemetry(d: DocumentData): Telemetry {
  const bs = str(d.batch_state, 'IDLE') as BatchState;
  return {
    voltage: num(d.voltage), current: num(d.current), power: num(d.power), energy: num(d.energy),
    pf: num(d.pf), frequency: num(d.frequency),
    relayOn: d.relay_state === 'ON',
    pzemConnected: d.pzem_connected === true,
    tripActive: d.trip_active === true,
    tripReason: str(d.trip_reason),
    batchState: BATCH_STATES.includes(bs) ? bs : 'IDLE',
    batchName: str(d.batch_name),
    batchSecondsLeft: num(d.batch_seconds_left) ?? 0,
    batchTotalMin: num(d.batch_total_min) ?? 0,
    batchKwhUsed: num(d.batch_kwh_used) ?? 0,
    limitOv: num(d.limit_ov), limitUv: num(d.limit_uv), limitOc: num(d.limit_oc),
    buzzerMuted: d.buzzer_muted === true,
    dayKwh: num(d.day_kwh),
    wifiRssi: num(d.wifi_rssi), uptimeS: num(d.uptime_s),
    lastCmd: str(d.last_cmd), lastCmdResult: str(d.last_cmd_result), fw: str(d.fw),
    deviceTime: num(d.device_time),
  };
}

function parseSettings(d: DocumentData | undefined): Settings {
  const s = { ...DEFAULT_SETTINGS };
  if (!d) return s;
  s.overVoltage = num(d.over_voltage) ?? s.overVoltage;
  s.underVoltage = num(d.under_voltage) ?? s.underVoltage;
  s.overCurrent = num(d.over_current) ?? s.overCurrent;
  s.buzzerMuted = d.buzzer_muted === true;
  s.ratePerKwh = num(d.rate_per_kwh) ?? s.ratePerKwh;
  s.fixedCharge = num(d.fixed_charge) ?? s.fixedCharge;
  s.billDay = num(d.bill_day) ?? s.billDay;
  s.monthlyBudget = num(d.monthly_budget) ?? s.monthlyBudget;
  s.cycleStart = typeof d.cycle_start === 'string' && d.cycle_start ? d.cycle_start : null;
  return s;
}

function parseDay(d: DocumentData): DayRecord | null {
  if (typeof d.date !== 'string') return null;
  const hours = Array.from({ length: 24 }, (_, h) => num(d[`h${String(h).padStart(2, '0')}`]) ?? 0);
  return { date: d.date, kwh: num(d.kwh) ?? hours.reduce((a, b) => a + b, 0), hours };
}

export type CommandName = 'SET_RELAY' | 'START_BATCH' | 'STOP_BATCH' | 'EXTEND_BATCH' | 'RESET_TRIP' | 'ACK_BATCH';

export function useMeter() {
  const [telemetry, setTelemetry] = useState<Telemetry | null>(null);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [history, setHistory] = useState<DayRecord[]>([]);
  const [batches, setBatches] = useState<BatchRecord[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [online, setOnline] = useState(false);
  const [pending, setPending] = useState<CommandName | null>(null);

  const lastChange = useRef(0);
  const lastStamp = useRef<string>('');
  const snapshotAt = useRef(0);

  // 1 s ticker drives the online check and the local batch countdown
  useEffect(() => {
    const t = setInterval(() => {
      const n = Date.now();
      setNow(n);
      setOnline(lastChange.current > 0 && n - lastChange.current < OFFLINE_AFTER_MS);
    }, 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const fail = (what: string) => (e: Error) => setError(`${what}: ${e.message}`);

    const u1 = onSnapshot(doc(db, 'devices', DEVICE_ID), (snap) => {
      if (!snap.exists()) { setTelemetry(null); return; }
      const d = snap.data();
      const t = parseTelemetry(d);
      const stamp = `${t.uptimeS}|${t.deviceTime}`;
      const n = Date.now();
      if (stamp !== lastStamp.current) {
        lastStamp.current = stamp;
        // first load: trust the device clock if it is recent, otherwise wait for a fresh report
        if (lastChange.current === 0) {
          const fresh = t.deviceTime ? Math.abs(n / 1000 - t.deviceTime) < OFFLINE_AFTER_MS / 1000 : false;
          if (fresh) lastChange.current = n;
        } else lastChange.current = n;
      }
      snapshotAt.current = n;
      setTelemetry(t);
      setOnline(lastChange.current > 0 && n - lastChange.current < OFFLINE_AFTER_MS);
      setError(null);
    }, fail('Meter data'));

    const u2 = onSnapshot(doc(db, 'settings', DEVICE_ID), (snap) => {
      setSettings(parseSettings(snap.exists() ? snap.data() : undefined));
      setSettingsLoaded(true);
    }, fail('Settings'));

    const u3 = onSnapshot(query(collection(db, 'history_daily'), orderBy('date', 'desc'), limit(70)), (snap) => {
      const rows: DayRecord[] = [];
      snap.forEach((s) => { const r = parseDay(s.data()); if (r) rows.push(r); });
      setHistory(rows);
    }, fail('History'));

    const u4 = onSnapshot(query(collection(db, 'batches'), orderBy('started_at', 'desc'), limit(30)), (snap) => {
      const rows: BatchRecord[] = [];
      snap.forEach((s) => {
        const d = s.data();
        rows.push({
          id: s.id, name: str(d.name, 'Batch'), startedAt: num(d.started_at) ?? 0, plannedMin: num(d.planned_min) ?? 0,
          actualS: num(d.actual_s) ?? 0, kwh: num(d.kwh) ?? 0, endReason: str(d.end_reason),
        });
      });
      setBatches(rows);
    }, fail('Batches'));

    return () => { u1(); u2(); u3(); u4(); };
  }, []);

  /** Seconds left, counted down locally between the 5 s reports. */
  const batchSecondsLeft = useMemo(() => {
    if (!telemetry || telemetry.batchState !== 'RUNNING') return 0;
    const since = snapshotAt.current ? (now - snapshotAt.current) / 1000 : 0;
    return Math.max(0, telemetry.batchSecondsLeft - since);
  }, [telemetry, now]);

  const send = useCallback(async (command: CommandName, extra: Record<string, string | number> = {}) => {
    setPending(command);
    try {
      // setDoc without merge replaces the document, so fields from an older command cannot linger.
      await setDoc(doc(db, 'commands', DEVICE_ID), { command, ...extra, sent_at: serverTimestamp(), nonce: Math.random().toString(36).slice(2) });
      setError(null);
    } catch (e) {
      setError(`Could not send command: ${(e as Error).message}`);
    } finally {
      setTimeout(() => setPending((p) => (p === command ? null : p)), 6000);
    }
  }, []);

  const saveSettings = useCallback(async (patch: Partial<Settings>) => {
    const out: Record<string, unknown> = {};
    if (patch.overVoltage !== undefined) out.over_voltage = patch.overVoltage;
    if (patch.underVoltage !== undefined) out.under_voltage = patch.underVoltage;
    if (patch.overCurrent !== undefined) out.over_current = patch.overCurrent;
    if (patch.buzzerMuted !== undefined) out.buzzer_muted = patch.buzzerMuted;
    if (patch.ratePerKwh !== undefined) out.rate_per_kwh = patch.ratePerKwh;
    if (patch.fixedCharge !== undefined) out.fixed_charge = patch.fixedCharge;
    if (patch.billDay !== undefined) out.bill_day = patch.billDay;
    if (patch.monthlyBudget !== undefined) out.monthly_budget = patch.monthlyBudget;
    if (patch.cycleStart !== undefined) out.cycle_start = patch.cycleStart ?? '';
    // Always send the full protection set so the meter never sees a half-filled document.
    const full = { ...settings, ...patch };
    out.over_voltage = full.overVoltage; out.under_voltage = full.underVoltage;
    out.over_current = full.overCurrent; out.buzzer_muted = full.buzzerMuted;
    try {
      await setDoc(doc(db, 'settings', DEVICE_ID), out, { merge: true });
      setError(null);
      return true;
    } catch (e) {
      setError(`Could not save settings: ${(e as Error).message}`);
      return false;
    }
  }, [settings]);

  const todayKwh = telemetry?.dayKwh ?? 0;
  const cycle = useMemo(() => summariseCycle(history, todayKwh, settings, now), [history, todayKwh, settings, now]);
  const todayKey = localDateKey(now);

  return {
    telemetry, online, settings, settingsLoaded, history, batches, error, pending,
    batchSecondsLeft, cycle, todayKey, todayKwh, now,
    setRelay: (on: boolean) => send('SET_RELAY', { relay_state: on ? 'ON' : 'OFF' }),
    startBatch: (name: string, minutes: number) => send('START_BATCH', { batch_name: name, duration_min: minutes }),
    stopBatch: () => send('STOP_BATCH'),
    extendBatch: (minutes: number) => send('EXTEND_BATCH', { extend_min: minutes }),
    resetTrip: () => send('RESET_TRIP'),
    ackBatch: () => send('ACK_BATCH'),
    saveSettings,
  };
}

export type Meter = ReturnType<typeof useMeter>;
