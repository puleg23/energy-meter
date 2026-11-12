import React, { useState } from 'react';
import { Btn, Field, inputCls } from './ui';
import { buildFirmware, FIRMWARE_FILE, missingFields } from '../utils/firmware';

export const SetupModal: React.FC<{ open: boolean; onClose: () => void }> = ({ open, onClose }) => {
  const [ssid, setSsid] = useState('');
  const [wifiPassword, setWifiPassword] = useState('');
  const [deviceEmail, setDeviceEmail] = useState('');
  const [devicePassword, setDevicePassword] = useState('');
  const [msg, setMsg] = useState('');
  if (!open) return null;

  const inputs = { ssid, wifiPassword, deviceEmail, devicePassword };
  const missing = missingFields(inputs);

  const download = () => {
    if (missing.length) { setMsg(`Fill in: ${missing.join(', ')}.`); return; }
    const blob = new Blob([buildFirmware(inputs)], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = FIRMWARE_FILE; a.click();
    URL.revokeObjectURL(a.href);
    setMsg('Downloaded. It contains your passwords, so do not share or upload it.');
  };

  return (
    <div className="fixed inset-0 z-[60] bg-black/40 flex items-end sm:items-center justify-center" role="dialog" aria-modal="true" aria-label="ESP32 setup">
      <div className="bg-white w-full max-w-md max-h-[92vh] overflow-y-auto rounded-t-xl sm:rounded-xl p-4">
        <div className="flex justify-between items-center mb-2">
          <h2 className="text-lg font-bold">ESP32 setup</h2>
          <button onClick={onClose} className="min-h-11 px-3 font-bold" aria-label="Close">Close</button>
        </div>
        <ol className="text-sm list-decimal pl-5 space-y-1 mb-3">
          <li>In the Firebase console, turn on Email/Password sign-in, then create two users: one for you and one for the meter.</li>
          <li>Put both user IDs (UIDs) into <code>firestore.rules</code> and publish the rules.</li>
          <li>Enter the Wi-Fi and the meter user's login below and download the sketch.</li>
          <li>Put the file in a folder named <code>esp32_energy_meter</code>, open it in Arduino IDE, choose board "ESP32 Dev Module" and upload.</li>
        </ol>
        <div className="flex flex-col gap-3">
          <Field label="Wi-Fi name"><input className={inputCls} value={ssid} onChange={(e) => setSsid(e.target.value)} autoComplete="off" /></Field>
          <Field label="Wi-Fi password"><input className={inputCls} type="password" value={wifiPassword} onChange={(e) => setWifiPassword(e.target.value)} autoComplete="off" /></Field>
          <Field label="Meter user email"><input className={inputCls} type="email" value={deviceEmail} onChange={(e) => setDeviceEmail(e.target.value)} autoComplete="off" /></Field>
          <Field label="Meter user password"><input className={inputCls} type="password" value={devicePassword} onChange={(e) => setDevicePassword(e.target.value)} autoComplete="off" /></Field>
          <Btn kind="primary" onClick={download}>Download {FIRMWARE_FILE}</Btn>
          {msg && <p className="text-sm" role="status">{msg}</p>}
          <p className="text-xs text-[#555555]">Nothing you type here is saved or sent anywhere. The file is built in your browser.</p>
        </div>
      </div>
    </div>
  );
};
