export type ActiveTab = 'home' | 'cost' | 'batch' | 'limits' | 'graphs';

export const DEVICE_ID = 'ESP32_METER_01';

/** Must match TZ_OFFSET_SEC in the firmware (Zambia, UTC+2). Day boundaries use this offset. */
export const UTC_OFFSET_HOURS = 2;

export type BatchState = 'IDLE' | 'RUNNING' | 'DONE' | 'STOPPED' | 'INTERRUPTED';

/** What the meter reports. null means "the meter has no reading" and the UI shows N/A. */
export interface Telemetry {
  voltage: number | null;
  current: number | null;
  power: number | null;
  energy: number | null; // lifetime kWh on the PZEM
  pf: number | null;
  frequency: number | null;
  relayOn: boolean;
  pzemConnected: boolean;
  tripActive: boolean;
  tripReason: string;
  batchState: BatchState;
  batchName: string;
  batchSecondsLeft: number;
  batchTotalMin: number;
  batchKwhUsed: number;
  limitOv: number | null;
  limitUv: number | null;
  limitOc: number | null;
  buzzerMuted: boolean;
  dayKwh: number | null;
  wifiRssi: number | null;
  uptimeS: number | null;
  lastCmd: string;
  lastCmdResult: string;
  fw: string;
  deviceTime: number | null;
}

export interface Settings {
  overVoltage: number;
  underVoltage: number;
  overCurrent: number;
  buzzerMuted: boolean;
  ratePerKwh: number;
  fixedCharge: number;
  billDay: number; // 1-28, day the bill cycle starts
  monthlyBudget: number;
  cycleStart: string | null; // YYYY-MM-DD, set by "Start new cycle"; overrides billDay for the current cycle
}

export interface DayRecord {
  date: string; // YYYY-MM-DD
  kwh: number;
  hours: number[]; // 24 values, kWh per hour
}

export interface BatchRecord {
  id: string;
  name: string;
  startedAt: number; // epoch seconds, 0 if unknown
  plannedMin: number;
  actualS: number;
  kwh: number;
  endReason: string;
}

export const DEFAULT_SETTINGS: Settings = {
  overVoltage: 250,
  underVoltage: 180,
  overCurrent: 15,
  buzzerMuted: false,
  ratePerKwh: 1.5,
  fixedCharge: 0,
  billDay: 1,
  monthlyBudget: 350,
  cycleStart: null,
};

/** Same ranges the firmware accepts. Anything outside is ignored by the meter. */
export const LIMIT_RANGES = {
  overVoltage: { min: 200, max: 300 },
  underVoltage: { min: 80, max: 230 },
  overCurrent: { min: 1, max: 60 },
  minGap: 10, // under + 10 <= over
};
