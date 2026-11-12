import React, { useEffect, useState } from 'react';
import type { Meter } from '../../hooks/useMeter';
import { Banner, Btn, Card, Field, Page, Toggle, inputCls } from '../ui';
import { LIMIT_RANGES } from '../../types';
import { checkLimits } from '../../utils/cost';

export const LimitsView: React.FC<{ m: Meter }> = ({ m }) => {
  const { settings: s, telemetry: t } = m;
  const [ov, setOv] = useState(String(s.overVoltage));
  const [uv, setUv] = useState(String(s.underVoltage));
  const [oc, setOc] = useState(String(s.overCurrent));
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => { setOv(String(s.overVoltage)); setUv(String(s.underVoltage)); setOc(String(s.overCurrent)); }, [s.overVoltage, s.underVoltage, s.overCurrent]);

  const save = async () => {
    const o = parseFloat(ov), u = parseFloat(uv), c = parseFloat(oc);
    const chk = checkLimits(o, u, c, LIMIT_RANGES);
    if (!chk.ok) { setMsg({ ok: false, text: chk.message }); return; }
    const ok = await m.saveSettings({ overVoltage: o, underVoltage: u, overCurrent: c });
    setMsg(ok ? { ok: true, text: 'Saved. The meter picks it up within about 10 seconds.' } : null);
  };

  const confirmed = t && t.limitOv === s.overVoltage && t.limitUv === s.underVoltage && t.limitOc === s.overCurrent;
  const live = m.online && !!t;

  return (
    <Page title="Protection limits">
      {m.error && <Banner tone="bad">{m.error}</Banner>}
      {t?.tripActive && (
        <Banner tone="bad">
          The meter is tripped and the load is off. Fix the cause, then reset.
          <Btn kind="danger" className="w-full mt-2" onClick={m.resetTrip} disabled={!live}>Reset trip</Btn>
        </Banner>
      )}
      <Card title="Cut-off limits">
        <p className="text-sm text-[#555555] mb-3">The meter cuts the load when a limit is exceeded. Limits are stored on the meter, so protection works with no internet.</p>
        <div className="flex flex-col gap-3">
          <Field label="Over-voltage (V)" hint={`${LIMIT_RANGES.overVoltage.min}-${LIMIT_RANGES.overVoltage.max} V. Cuts after 1 s.`}>
            <input className={inputCls} inputMode="decimal" value={ov} onChange={(e) => setOv(e.target.value)} />
          </Field>
          <Field label="Under-voltage (V)" hint={`${LIMIT_RANGES.underVoltage.min}-${LIMIT_RANGES.underVoltage.max} V, at least ${LIMIT_RANGES.minGap} V below over-voltage. Cuts after 3 s.`}>
            <input className={inputCls} inputMode="decimal" value={uv} onChange={(e) => setUv(e.target.value)} />
          </Field>
          <Field label="Over-current (A)" hint={`${LIMIT_RANGES.overCurrent.min}-${LIMIT_RANGES.overCurrent.max} A. Cuts after 2 s, or at once above 1.5 times the limit.`}>
            <input className={inputCls} inputMode="decimal" value={oc} onChange={(e) => setOc(e.target.value)} />
          </Field>
          <Btn kind="primary" onClick={save}>Save limits</Btn>
          {msg && <p className={`text-sm ${msg.ok ? 'text-[#1b4d1e]' : 'text-[#b3261e]'}`} role={msg.ok ? 'status' : 'alert'}>{msg.text}</p>}
          <p className="text-xs text-[#555555]">
            {!t ? 'No report from the meter yet.' : !live ? 'Meter offline: last known limits on the meter are ' : confirmed ? 'Confirmed: the meter is using these limits.' : 'Waiting for the meter to confirm. It currently uses '}
            {t && !confirmed && `${t.limitUv ?? 'N/A'}-${t.limitOv ?? 'N/A'} V, ${t.limitOc ?? 'N/A'} A.`}
          </p>
        </div>
      </Card>

      <Card title="Buzzer">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="font-bold">Mute buzzer</div>
            <div className="text-xs text-[#555555]">Silences all beeps, including trip alarms. LEDs still work.</div>
          </div>
          <Toggle on={s.buzzerMuted} onChange={(v) => m.saveSettings({ buzzerMuted: v })} label="Mute buzzer" />
        </div>
      </Card>
    </Page>
  );
};
