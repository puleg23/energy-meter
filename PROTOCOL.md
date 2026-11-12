# Meter <-> app protocol

All documents live in the Firestore database named in `firebase-applet-config.json`. Both the app (owner account) and the ESP32 (device account) sign in with Firebase Auth email/password. Rules in `firestore.rules` decide who may write what.

| Collection / doc | Written by | Purpose |
|---|---|---|
| `devices/ESP32_METER_01` | meter, every 5 s | readings, relay, trip, batch, limits in use, status |
| `commands/ESP32_METER_01` | app | one command at a time |
| `settings/ESP32_METER_01` | app | protection limits, buzzer mute, tariff, bill cycle |
| `history_daily/YYYY-MM-DD` | meter, every 5 min and at midnight | `date`, `kwh`, `h00`..`h23` (kWh per hour) |
| `batches/{id}` | meter, when a batch ends | `name`, `started_at`, `planned_min`, `actual_s`, `kwh`, `end_reason` |

Day boundaries use UTC+2 in both the app (`UTC_OFFSET_HOURS`) and the firmware (`TZ_OFFSET_SEC`). Change both together.

## Telemetry fields (`devices/...`)
`voltage current power energy pf frequency` are numbers, or `null` when the PZEM cannot be read (the app shows N/A, never a made-up number).
`relay_state` ON/OFF, `pzem_connected`, `trip_active`, `trip_reason` (OVER_VOLTAGE, UNDER_VOLTAGE, OVER_CURRENT, SENSOR),
`batch_state` (IDLE, RUNNING, DONE, STOPPED, INTERRUPTED), `batch_name`, `batch_seconds_left`, `batch_total_min`, `batch_kwh_used`,
`limit_ov limit_uv limit_oc buzzer_muted` (what the meter is really using), `day_kwh`, `wifi_rssi`, `uptime_s`, `device_time`,
`last_cmd`, `last_cmd_result`, `fw`.

The app calls the meter online while `uptime_s`/`device_time` keep changing (updated within 20 s).

## Commands (`commands/...`)
The app replaces the whole document each time:
`command` = `SET_RELAY` (+`relay_state` ON/OFF) | `START_BATCH` (+`batch_name`, `duration_min`) | `STOP_BATCH` | `EXTEND_BATCH` (+`extend_min`) | `RESET_TRIP` | `ACK_BATCH`, plus `sent_at` (server time) and `nonce`.

The meter polls every 2 s, runs a command once (it remembers the document's `updateTime`, also across reboots), and ignores any command older than 60 s so a load is never switched on late. Result is reported in `last_cmd_result` (`OK` or `REJECTED_*` / `IGNORED_STALE`). Nothing needs to clear the command afterwards.

## Settings (`settings/...`)
`over_voltage under_voltage over_current buzzer_muted` are read by the meter every 10 s, checked against safe ranges (OV 200-300 V, UV 80-230 V and at least 10 V below OV, OC 1-60 A) and saved in its flash.
`rate_per_kwh fixed_charge bill_day monthly_budget cycle_start` are used by the app only.
