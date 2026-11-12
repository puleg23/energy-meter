import firmwareSource from '../../firmware/esp32_energy_meter.ino?raw';
import { projectConfig } from '../firebase';

export const FIRMWARE_FILE = 'esp32_energy_meter.ino';

const cString = (s: string) => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/[\r\n]/g, '');

export interface FirmwareInputs { ssid: string; wifiPassword: string; deviceEmail: string; devicePassword: string }

/** The firmware text with the project values and the entered credentials filled in. */
export function buildFirmware(i: FirmwareInputs): string {
  const map: Record<string, string> = {
    __WIFI_SSID__: i.ssid,
    __WIFI_PASSWORD__: i.wifiPassword,
    __FIREBASE_PROJECT_ID__: projectConfig.projectId,
    __FIRESTORE_DATABASE_ID__: projectConfig.firestoreDatabaseId,
    __FIREBASE_API_KEY__: projectConfig.apiKey,
    __DEVICE_EMAIL__: i.deviceEmail,
    __DEVICE_PASSWORD__: i.devicePassword,
  };
  let out = firmwareSource;
  for (const [k, v] of Object.entries(map)) if (v) out = out.split(k).join(cString(v));
  return out;
}

export function missingFields(i: FirmwareInputs): string[] {
  const m: string[] = [];
  if (!i.ssid) m.push('Wi-Fi name'); if (!i.wifiPassword) m.push('Wi-Fi password');
  if (!i.deviceEmail) m.push('device email'); if (!i.devicePassword) m.push('device password');
  return m;
}
