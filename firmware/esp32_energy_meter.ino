/*
  Smart Energy Meter - ESP32 firmware v2.0
  ESP32 + PZEM-004T v3 + relay/SSR + 20x4 I2C LCD + 3 LEDs + buzzer + 2 buttons

  Libraries (Arduino IDE > Library Manager):
    - ArduinoJson (version 7.x) by Benoit Blanchon
    - PZEM-004T-v30 by Jakub Mandula
    - LiquidCrystal I2C (any version that has init() or begin())
  Board: "ESP32 Dev Module" (NOT "ESP32 Wrover Module", it takes GPIO16/17 that the PZEM needs)

  What runs where
    Core 1 (loop):  PZEM reading, protection (OV / UV / OC), relay, batch timer,
                    LEDs, buzzer, buttons, LCD. Never waits for the network.
    Core 0 (task):  Wi-Fi, sign-in, Firestore telemetry/commands/settings/history.
  Protection keeps working with no Wi-Fi and no internet.

  Wiring
    PZEM TX -> GPIO16 (through the 1k + 2k divider)    PZEM RX <- GPIO17
    LCD SDA GPIO21, SCL GPIO22 (5 V)
    Relay IN GPIO26  | Green LED GPIO32 | Red LED GPIO33 | Buzzer (NPN base via 1k) GPIO4
    Batch start/stop button GPIO27 to GND | Mains relay button GPIO25 to GND
    Yellow LED: 3V3 -> 220 ohm -> LED -> GND (always on while powered)

  Buttons
    Batch button  short: start (last duration) or stop the batch    long (1.5 s): clear DONE / STOPPED / INTERRUPTED
    Mains button  short: relay on/off, or reset a trip if readings are normal
    Any press while the buzzer is sounding only silences it.

  Fill in the 7 tokens below (or use "ESP32 Setup" in the app, which does it for you).
*/

#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <Preferences.h>
#include <Wire.h>
#include <time.h>
#include <LiquidCrystal_I2C.h>
#include <PZEM004Tv30.h>

#define FW_VERSION "2.0"

// ============================================================
//  SETTINGS YOU MAY EDIT
// ============================================================
const char* WIFI_SSID            = "__WIFI_SSID__";
const char* WIFI_PASSWORD        = "__WIFI_PASSWORD__";
const char* FIREBASE_PROJECT_ID  = "__FIREBASE_PROJECT_ID__";
const char* FIRESTORE_DATABASE_ID = "__FIRESTORE_DATABASE_ID__";
const char* FIREBASE_API_KEY     = "__FIREBASE_API_KEY__";
const char* DEVICE_EMAIL         = "__DEVICE_EMAIL__";      // Firebase Auth user made for this meter
const char* DEVICE_PASSWORD      = "__DEVICE_PASSWORD__";
const char* DEVICE_ID            = "ESP32_METER_01";        // must match the app

#define RELAY_ACTIVE_LOW 1      // 1 = low-trigger relay/SSR (LOW switches the load ON), 0 = high-trigger

const long TZ_OFFSET_SEC = 2 * 3600;   // Zambia, UTC+2. Must match UTC_OFFSET_HOURS in the app.

// ---- Pins ----
const int PIN_SDA = 21, PIN_SCL = 22;
const int PIN_RELAY = 26;
const int PIN_GREEN = 32, PIN_RED = 33;
const int PIN_BUZZER = 4;
const int PIN_BTN_BATCH = 27;
const int PIN_BTN_RELAY = 25;     // set to -1 if you have not fitted the mains button
#define PZEM_RX_PIN 16
#define PZEM_TX_PIN 17

// ---- Protection defaults (the app can change them; saved on the device) ----
const float DEF_OV = 250.0f, DEF_UV = 180.0f, DEF_OC = 15.0f;
const uint32_t OV_DELAY_MS = 1000;        // voltage must stay too high this long
const uint32_t UV_DELAY_MS = 3000;        // ...too low this long
const uint32_t OC_DELAY_MS = 2000;        // ...current too high this long (lets motors start)
const float    OC_INSTANT_FACTOR = 1.5f;  // current above limit x 1.5 trips almost at once
const uint32_t SENSOR_FAIL_TRIP_MS = 10000; // PZEM silent this long while the relay is ON: cut the load
const bool     REQUIRE_SENSOR_TO_ENERGIZE = true;
const float    MIN_VALID_VOLTS = 50.0f;   // below this the reading is treated as "no mains"

// ---- Batches ----
const bool     RELAY_OFF_AT_BATCH_END = true;
const uint16_t DEFAULT_BATCH_MIN = 30;     // used by the batch button the first time

// ---- Timing ----
const uint32_t READ_MS      = 500;
const uint32_t TELEMETRY_MS = 5000;
const uint32_t COMMAND_MS   = 2000;
const uint32_t SETTINGS_MS  = 10000;
const uint32_t HISTORY_MS   = 300000;
const uint32_t PAGE_MS      = 4000;
const uint32_t HTTP_TIMEOUT_MS = 6000;
const uint32_t COMMAND_MAX_AGE_S = 60;     // older commands are ignored (never start a load late)

// ---- Buzzer ----
const uint8_t BUZZER_ON = HIGH, BUZZER_OFF = LOW;
const uint32_t DONE_REPEAT_EVERY_MS = 30000, DONE_REPEAT_FOR_MS = 300000;
const uint32_t ALARM_FOR_MS = 600000;
const uint16_t PAT_BOOT[]      = {120};
const uint16_t PAT_DONE[]      = {600, 250, 600, 250, 600};
const uint16_t PAT_STOPPED[]   = {150, 150, 150};
const uint16_t PAT_ALARM[]     = {100, 100, 100, 100, 100, 500};
const uint16_t PAT_CLICK[]     = {40};

// ============================================================
//  Types and shared state
// ============================================================
enum BatchState : uint8_t { B_IDLE, B_RUNNING, B_DONE, B_STOPPED, B_INTERRUPTED };
const char* const BATCH_NAMES[] = {"IDLE", "RUNNING", "DONE", "STOPPED", "INTERRUPTED"};

struct Snapshot {                    // main loop -> network task
  float v, a, w, kwh, pf, hz;        // NAN when unknown
  bool pzemOk, relayOn, tripActive;
  char tripReason[16];
  uint8_t bstate;
  char bname[24];
  int bSecLeft, bTotalMin;
  float bKwh;
  float ov, uv, oc;
  bool muted;
  float dayKwh;
  float hourKwh[24];
  int dayKey;                        // yyyymmdd, 0 until the clock is set
  char lastCmd[20], lastCmdResult[24];
};

enum CmdType : uint8_t { CMD_NONE, CMD_SET_RELAY, CMD_START_BATCH, CMD_STOP_BATCH, CMD_EXTEND_BATCH, CMD_RESET_TRIP, CMD_ACK_BATCH };
struct PendingCmd { bool valid; CmdType type; bool relayOn; char name[24]; int minutes; };

struct NewSettings { bool valid; float ov, uv, oc; bool muted; };

struct BatchRecord { char name[24]; uint32_t startedAt; uint16_t plannedMin; uint32_t actualS; float kwh; char reason[14]; };
struct DayRecord { bool valid; int key; float kwh; float hour[24]; };

SemaphoreHandle_t mtx;
Snapshot shared;                     // protected by mtx
PendingCmd pendingCmd;               // protected by mtx
NewSettings pendingSettings;         // protected by mtx
BatchRecord batchQueue[4]; int batchQueueN = 0;   // protected by mtx
DayRecord finalDay;                  // protected by mtx
volatile bool cloudOk = false;
volatile uint32_t lastCloudOkMs = 0;

struct Lock { Lock() { xSemaphoreTake(mtx, portMAX_DELAY); } ~Lock() { xSemaphoreGive(mtx); } };

// ============================================================
//  Hardware objects and main-loop state
// ============================================================
PZEM004Tv30 pzem(Serial2, PZEM_RX_PIN, PZEM_TX_PIN);
LiquidCrystal_I2C *lcd = nullptr;
Preferences prefs;

float volts = NAN, amps = NAN, watts = NAN, energyKwh = NAN, pfv = NAN, hz = NAN;
bool pzemOk = false;
bool relayOn = false;
float limOv = DEF_OV, limUv = DEF_UV, limOc = DEF_OC;
bool muted = false;

bool tripActive = false;
char tripReason[16] = "";
uint32_t ovSince = 0, uvSince = 0, ocSince = 0, sensorFailSince = 0;

BatchState bstate = B_IDLE;
char bname[24] = "";
uint32_t bStartMs = 0, bPlannedMs = 0;
float bStartKwh = NAN, bIntKwh = 0, bKwh = 0;
uint32_t bStartEpoch = 0;
uint16_t bPlannedMin = 0;
bool bootInterruptedPending = false;
char bootBatchName[24] = "";
float bootBatchStartKwh = NAN;
uint16_t bootBatchPlanned = 0;

char lastCmdName[20] = "", lastCmdResult[24] = "";

// energy buckets
int dayKey = 0, hourIdx = 0;
float dayStartKwh = NAN, hourStartKwh = NAN;
float hourKwh[24] = {0};
float dayKwhNow = 0;
uint32_t lastBucketSave = 0;

// ============================================================
//  LCD
// ============================================================
template <int N> struct Rank : Rank<N - 1> {};
template <> struct Rank<0> {};
template <typename T> auto lcdStart(T *l, Rank<2>) -> decltype(l->init(), void()) { l->init(); }
template <typename T> auto lcdStart(T *l, Rank<1>) -> decltype(l->begin(20, 4), void()) { l->begin(20, 4); }
template <typename T> auto lcdStart(T *l, Rank<0>) -> decltype(l->begin(), void()) { l->begin(); }

void lcdLine(uint8_t row, const char *text) {     // always writes 20 characters, so nothing stale is left
  char buf[21];
  snprintf(buf, sizeof(buf), "%-20.20s", text);
  lcd->setCursor(0, row);
  lcd->print(buf);
}

uint8_t findLcdAddress() {
  for (uint8_t a : {0x27, 0x3F}) {
    Wire.beginTransmission(a);
    if (Wire.endTransmission() == 0) return a;
  }
  Serial.println("LCD not found at 0x27 or 0x3F, using 0x27");
  return 0x27;
}

// ============================================================
//  Relay, LEDs, buzzer
// ============================================================
#if RELAY_ACTIVE_LOW
  #define RELAY_ON_LEVEL LOW
  #define RELAY_OFF_LEVEL HIGH
#else
  #define RELAY_ON_LEVEL HIGH
  #define RELAY_OFF_LEVEL LOW
#endif

void setRelay(bool on) {
  relayOn = on;
  digitalWrite(PIN_RELAY, on ? RELAY_ON_LEVEL : RELAY_OFF_LEVEL);
}

struct Buzzer {
  const uint16_t *pat = nullptr; uint8_t len = 0, idx = 0;
  bool running = false, waiting = false, repeat = false;
  uint32_t stepEnd = 0, patStart = 0, groupStart = 0, nextStart = 0, gapMs = 0, forMs = 0;
} bz;

bool reached(uint32_t now, uint32_t t) { return (int32_t)(now - t) >= 0; }
void silenceBuzzer() { bz.running = false; bz.waiting = false; digitalWrite(PIN_BUZZER, BUZZER_OFF); }

void startPattern(const uint16_t *p, uint8_t n, bool repeat = false, uint32_t gapMs = 0, uint32_t forMs = 0) {
  silenceBuzzer();
  if (muted) return;
  uint32_t now = millis();
  bz.pat = p; bz.len = n; bz.idx = 0; bz.repeat = repeat; bz.gapMs = gapMs; bz.forMs = forMs;
  bz.groupStart = bz.patStart = now; bz.running = true; bz.waiting = false;
  digitalWrite(PIN_BUZZER, BUZZER_ON);
  bz.stepEnd = now + p[0];
}

void updateBuzzer() {
  if (!bz.running) return;
  uint32_t now = millis();
  if (bz.waiting) {
    if (reached(now, bz.nextStart)) {
      bz.waiting = false; bz.idx = 0; bz.patStart = now;
      digitalWrite(PIN_BUZZER, BUZZER_ON);
      bz.stepEnd = now + bz.pat[0];
    }
    return;
  }
  if (!reached(now, bz.stepEnd)) return;
  bz.idx++;
  if (bz.idx >= bz.len) {
    digitalWrite(PIN_BUZZER, BUZZER_OFF);
    bool again = bz.repeat && (bz.forMs == 0 || (now - bz.groupStart) < bz.forMs);
    if (again) { bz.waiting = true; bz.nextStart = bz.patStart + bz.gapMs; if (reached(now, bz.nextStart)) bz.nextStart = now; }
    else bz.running = false;
    return;
  }
  digitalWrite(PIN_BUZZER, (bz.idx % 2 == 0) ? BUZZER_ON : BUZZER_OFF);
  bz.stepEnd = now + bz.pat[bz.idx];
}

void updateIndicators(uint32_t now) {
  digitalWrite(PIN_GREEN, bstate == B_RUNNING ? HIGH : LOW);
  bool red;
  if (tripActive || bstate == B_INTERRUPTED) red = (now / 300) % 2 == 0;
  else red = (bstate == B_DONE || bstate == B_STOPPED);
  digitalWrite(PIN_RED, red ? HIGH : LOW);
}

// ============================================================
//  Small helpers
// ============================================================
bool timeValid() { return time(nullptr) > 1700000000; }

void setLastCmd(const char* name, const char* result) {
  strlcpy(lastCmdName, name, sizeof(lastCmdName));
  strlcpy(lastCmdResult, result, sizeof(lastCmdResult));
  Serial.printf("Command %s -> %s\n", name, result);
}

bool voltageOk() { return !isnan(volts) && volts >= limUv && volts <= limOv; }

// Returns nullptr when the load may be switched on, otherwise the reason.
const char* whyNotEnergize() {
  if (tripActive) return "TRIPPED";
  if (REQUIRE_SENSOR_TO_ENERGIZE && !pzemOk) return "NO_SENSOR";
  if (pzemOk && !voltageOk()) return "VOLTAGE";
  return nullptr;
}

// ============================================================
//  Batches
// ============================================================
void persistBatchRunning(bool running) {
  prefs.putBool("b_run", running);
  if (running) {
    prefs.putString("b_name", bname);
    prefs.putFloat("b_skwh", isnan(bStartKwh) ? -1.0f : bStartKwh);
    prefs.putUShort("b_plan", bPlannedMin);
    prefs.putUInt("b_epoch", bStartEpoch);
  }
}

void queueBatchRecord(const char* name, uint32_t startedAt, uint16_t plannedMin, uint32_t actualS, float kwh, const char* reason) {
  Lock l;
  if (batchQueueN >= 4) { memmove(&batchQueue[0], &batchQueue[1], 3 * sizeof(BatchRecord)); batchQueueN = 3; }
  BatchRecord &r = batchQueue[batchQueueN++];
  strlcpy(r.name, name, sizeof(r.name));
  r.startedAt = startedAt; r.plannedMin = plannedMin; r.actualS = actualS; r.kwh = kwh;
  strlcpy(r.reason, reason, sizeof(r.reason));
}

void endBatch(BatchState result, const char* reason) {
  if (bstate != B_RUNNING) return;
  uint32_t actualS = (millis() - bStartMs) / 1000;
  queueBatchRecord(bname, bStartEpoch, bPlannedMin, actualS, bKwh, reason);
  bstate = result;
  persistBatchRunning(false);
  if (RELAY_OFF_AT_BATCH_END || result == B_INTERRUPTED) setRelay(false);
  if (result == B_DONE) startPattern(PAT_DONE, 5, true, DONE_REPEAT_EVERY_MS, DONE_REPEAT_FOR_MS);
  else if (result == B_STOPPED) startPattern(PAT_STOPPED, 3);
  else startPattern(PAT_ALARM, 6, true, 0, ALARM_FOR_MS);
}

const char* startBatch(const char* name, int minutes) {
  if (bstate == B_RUNNING) return "REJECTED_BUSY";
  const char* why = whyNotEnergize();
  if (why) return why[0] == 'T' ? "REJECTED_TRIPPED" : (why[0] == 'N' ? "REJECTED_NO_SENSOR" : "REJECTED_VOLTAGE");
  if (minutes < 1) minutes = 1;
  if (minutes > 1440) minutes = 1440;
  strlcpy(bname, (name && name[0]) ? name : "Batch", sizeof(bname));
  bPlannedMin = minutes;
  bPlannedMs = (uint32_t)minutes * 60000UL;
  bStartMs = millis();
  bStartKwh = energyKwh;
  bIntKwh = 0; bKwh = 0;
  bStartEpoch = timeValid() ? (uint32_t)time(nullptr) : 0;
  bstate = B_RUNNING;
  setRelay(true);
  silenceBuzzer();
  persistBatchRunning(true);
  prefs.putUShort("last_min", minutes);
  return "OK";
}

void batchTick(uint32_t now, uint32_t dtMs) {
  if (bstate != B_RUNNING) return;
  if (!isnan(watts)) bIntKwh += watts * (float)dtMs / 3.6e9f;
  if (!isnan(energyKwh) && !isnan(bStartKwh) && energyKwh >= bStartKwh) bKwh = energyKwh - bStartKwh;
  else bKwh = bIntKwh;
  if ((uint32_t)(now - bStartMs) >= bPlannedMs) endBatch(B_DONE, "COMPLETED");
}

// ============================================================
//  Protection
// ============================================================
void trip(const char* reason) {
  if (tripActive) return;
  tripActive = true;
  strlcpy(tripReason, reason, sizeof(tripReason));
  setRelay(false);
  if (bstate == B_RUNNING) endBatch(B_INTERRUPTED, "TRIP");
  else startPattern(PAT_ALARM, 6, true, 0, ALARM_FOR_MS);
  Serial.printf("PROTECTION TRIP: %s  V=%.1f I=%.2f\n", reason, volts, amps);
}

void checkProtection(uint32_t now) {
  if (tripActive || !relayOn) { ovSince = uvSince = ocSince = sensorFailSince = 0; return; }

  if (!pzemOk) {
    if (!sensorFailSince) sensorFailSince = now;
    if (now - sensorFailSince >= SENSOR_FAIL_TRIP_MS) trip("SENSOR");
    return;
  }
  sensorFailSince = 0;

  if (volts > limOv) { if (!ovSince) ovSince = now; if (now - ovSince >= OV_DELAY_MS) { trip("OVER_VOLTAGE"); return; } }
  else ovSince = 0;

  if (volts > MIN_VALID_VOLTS && volts < limUv) { if (!uvSince) uvSince = now; if (now - uvSince >= UV_DELAY_MS) { trip("UNDER_VOLTAGE"); return; } }
  else uvSince = 0;

  if (!isnan(amps) && amps > limOc) {
    if (!ocSince) ocSince = now;
    if (amps > limOc * OC_INSTANT_FACTOR || now - ocSince >= OC_DELAY_MS) trip("OVER_CURRENT");
  } else ocSince = 0;
}

const char* resetTrip() {
  if (!tripActive) return "OK";
  if (!pzemOk || !voltageOk() || (!isnan(amps) && amps > limOc)) return "REJECTED_STILL_FAULT";
  tripActive = false;
  tripReason[0] = 0;
  silenceBuzzer();
  return "OK";
}

// ============================================================
//  PZEM and energy buckets (today / this hour)
// ============================================================
void readPzem() {
  float v = pzem.voltage();
  if (isnan(v)) { pzemOk = false; volts = amps = watts = energyKwh = pfv = hz = NAN; return; }
  pzemOk = true;
  volts = v; amps = pzem.current(); watts = pzem.power(); energyKwh = pzem.energy(); pfv = pzem.pf(); hz = pzem.frequency();
}

void saveBuckets() {
  prefs.putInt("d_key", dayKey);
  prefs.putFloat("d_start", dayStartKwh);
  prefs.putFloat("h_start", hourStartKwh);
  prefs.putInt("h_idx", hourIdx);
  prefs.putBytes("h_kwh", hourKwh, sizeof(hourKwh));
  lastBucketSave = millis();
}

void updateBuckets(uint32_t now) {
  if (!timeValid() || isnan(energyKwh)) return;
  time_t n = time(nullptr);
  struct tm t; localtime_r(&n, &t);
  int key = (t.tm_year + 1900) * 10000 + (t.tm_mon + 1) * 100 + t.tm_mday;

  if (dayKey == 0) {                               // first run after boot: restore or start fresh
    int sk = prefs.getInt("d_key", 0);
    if (sk != 0) {
      dayKey = sk; dayStartKwh = prefs.getFloat("d_start", energyKwh);
      hourStartKwh = prefs.getFloat("h_start", energyKwh); hourIdx = prefs.getInt("h_idx", t.tm_hour);
      if (prefs.getBytes("h_kwh", hourKwh, sizeof(hourKwh)) != sizeof(hourKwh)) memset(hourKwh, 0, sizeof(hourKwh));
      if (hourIdx < 0 || hourIdx > 23) hourIdx = t.tm_hour;
    } else {
      dayKey = key; dayStartKwh = hourStartKwh = energyKwh; hourIdx = t.tm_hour; memset(hourKwh, 0, sizeof(hourKwh));
    }
  }

  if (energyKwh + 0.0005f < dayStartKwh) {         // PZEM energy was reset: start counting again
    dayStartKwh = hourStartKwh = energyKwh;
    memset(hourKwh, 0, sizeof(hourKwh));
  }

  if (key != dayKey) {                             // new day: hand yesterday to the network task
    hourKwh[hourIdx] += energyKwh - hourStartKwh;
    Lock l;
    finalDay.valid = true; finalDay.key = dayKey; finalDay.kwh = energyKwh - dayStartKwh;
    memcpy(finalDay.hour, hourKwh, sizeof(hourKwh));
    dayKey = key; dayStartKwh = hourStartKwh = energyKwh; hourIdx = t.tm_hour; memset(hourKwh, 0, sizeof(hourKwh));
    saveBuckets();
  } else if (t.tm_hour != hourIdx) {               // new hour
    hourKwh[hourIdx] += energyKwh - hourStartKwh;
    hourStartKwh = energyKwh; hourIdx = t.tm_hour;
    saveBuckets();
  }
  dayKwhNow = energyKwh - dayStartKwh;
  if (now - lastBucketSave > 600000UL) saveBuckets();
}

// ============================================================
//  Commands, settings, snapshot
// ============================================================
void publishSnapshot() {
  Lock l;
  Snapshot &s = shared;
  s.v = volts; s.a = amps; s.w = watts; s.kwh = energyKwh; s.pf = pfv; s.hz = hz;
  s.pzemOk = pzemOk; s.relayOn = relayOn; s.tripActive = tripActive;
  strlcpy(s.tripReason, tripReason, sizeof(s.tripReason));
  s.bstate = bstate; strlcpy(s.bname, bname, sizeof(s.bname));
  s.bTotalMin = bPlannedMin; s.bKwh = bKwh;
  s.bSecLeft = 0;
  if (bstate == B_RUNNING) {
    uint32_t el = millis() - bStartMs;
    s.bSecLeft = el >= bPlannedMs ? 0 : (int)((bPlannedMs - el) / 1000);
  }
  s.ov = limOv; s.uv = limUv; s.oc = limOc; s.muted = muted;
  s.dayKwh = dayKwhNow;
  memcpy(s.hourKwh, hourKwh, sizeof(hourKwh));
  s.hourKwh[hourIdx] = hourKwh[hourIdx] + ((isnan(energyKwh) || isnan(hourStartKwh)) ? 0 : energyKwh - hourStartKwh);
  s.dayKey = dayKey;
  strlcpy(s.lastCmd, lastCmdName, sizeof(s.lastCmd));
  strlcpy(s.lastCmdResult, lastCmdResult, sizeof(s.lastCmdResult));
}

void applyCommand(const PendingCmd &c) {
  const char* r = "OK";
  switch (c.type) {
    case CMD_SET_RELAY:
      if (c.relayOn) {
        const char* why = whyNotEnergize();
        if (why) r = why[0] == 'T' ? "REJECTED_TRIPPED" : (why[0] == 'N' ? "REJECTED_NO_SENSOR" : "REJECTED_VOLTAGE");
        else setRelay(true);
      } else {
        if (bstate == B_RUNNING) endBatch(B_STOPPED, "STOPPED");
        setRelay(false);
      }
      setLastCmd("SET_RELAY", r); break;
    case CMD_START_BATCH: r = startBatch(c.name, c.minutes); setLastCmd("START_BATCH", r); break;
    case CMD_STOP_BATCH:
      if (bstate == B_RUNNING) endBatch(B_STOPPED, "STOPPED"); else r = "REJECTED_IDLE";
      setLastCmd("STOP_BATCH", r); break;
    case CMD_EXTEND_BATCH:
      if (bstate == B_RUNNING) {
        int m = c.minutes < 1 ? 1 : (c.minutes > 240 ? 240 : c.minutes);
        bPlannedMs += (uint32_t)m * 60000UL; bPlannedMin += m;
        persistBatchRunning(true);
      } else r = "REJECTED_IDLE";
      setLastCmd("EXTEND_BATCH", r); break;
    case CMD_RESET_TRIP: r = resetTrip(); setLastCmd("RESET_TRIP", r); break;
    case CMD_ACK_BATCH:
      if (bstate == B_DONE || bstate == B_STOPPED || bstate == B_INTERRUPTED) { bstate = B_IDLE; silenceBuzzer(); }
      setLastCmd("ACK_BATCH", "OK"); break;
    default: break;
  }
}

void saveSettings() {
  prefs.putFloat("ov", limOv); prefs.putFloat("uv", limUv); prefs.putFloat("oc", limOc); prefs.putBool("muted", muted);
}

void handlePending() {
  PendingCmd c; NewSettings s;
  { Lock l; c = pendingCmd; pendingCmd.valid = false; s = pendingSettings; pendingSettings.valid = false; }
  if (s.valid) {
    bool limitsOk = s.ov >= 200 && s.ov <= 300 && s.uv >= 80 && s.uv <= 230 && s.uv + 10 <= s.ov && s.oc >= 1 && s.oc <= 60;
    if (limitsOk) { limOv = s.ov; limUv = s.uv; limOc = s.oc; }
    else Serial.println("Ignored settings outside safe ranges");
    if (s.muted != muted) { muted = s.muted; if (muted) silenceBuzzer(); }
    saveSettings();
  }
  if (c.valid) applyCommand(c);
}

// ============================================================
//  Buttons
// ============================================================
struct Btn { int pin; bool last; uint32_t changed, pressedAt; bool longDone; };
Btn btnBatch = {PIN_BTN_BATCH, HIGH, 0, 0, false};
Btn btnRelay = {PIN_BTN_RELAY, HIGH, 0, 0, false};

// returns 0 none, 1 short press, 2 long press
int pollButton(Btn &b, uint32_t now) {
  if (b.pin < 0) return 0;
  bool lv = digitalRead(b.pin);
  int ev = 0;
  if (lv != b.last && now - b.changed > 40) {
    b.changed = now; b.last = lv;
    if (lv == LOW) { b.pressedAt = now; b.longDone = false; }
    else if (!b.longDone && now - b.pressedAt < 1500) ev = 1;
  }
  if (lv == LOW && !b.longDone && now - b.pressedAt >= 1500) { b.longDone = true; ev = 2; }
  return ev;
}

void handleButtons(uint32_t now) {
  int eb = pollButton(btnBatch, now);
  int er = pollButton(btnRelay, now);
  if (!eb && !er) return;

  if (bz.running && !bz.waiting && digitalRead(PIN_BUZZER) == BUZZER_ON) { silenceBuzzer(); return; }
  bool alarming = bz.running;
  if (alarming) silenceBuzzer();                         // first press only quiets the alarm
  if (alarming && eb == 1) return;

  if (eb == 1) {
    if (bstate == B_RUNNING) { endBatch(B_STOPPED, "STOPPED"); setLastCmd("BUTTON_STOP", "OK"); }
    else {
      uint16_t m = prefs.getUShort("last_min", DEFAULT_BATCH_MIN);
      const char* r = startBatch("Local batch", m);
      setLastCmd("BUTTON_START", r);
      if (strcmp(r, "OK") != 0) startPattern(PAT_CLICK, 1);
    }
  } else if (eb == 2) {
    if (bstate == B_DONE || bstate == B_STOPPED || bstate == B_INTERRUPTED) { bstate = B_IDLE; silenceBuzzer(); }
  }

  if (er == 1) {
    if (tripActive) { const char* r = resetTrip(); setLastCmd("BUTTON_RESET", r); }
    else if (bstate == B_RUNNING) { endBatch(B_STOPPED, "STOPPED"); setRelay(false); setLastCmd("BUTTON_STOP", "OK"); }
    else if (relayOn) { setRelay(false); setLastCmd("BUTTON_RELAY", "OFF"); }
    else {
      const char* why = whyNotEnergize();
      if (why) { startPattern(PAT_CLICK, 1); setLastCmd("BUTTON_RELAY", why); }
      else { setRelay(true); setLastCmd("BUTTON_RELAY", "ON"); }
    }
  }
}

// ============================================================
//  LCD pages
// ============================================================
void drawLcd(uint32_t now) {
  char b[40];
  Snapshot s;
  { Lock l; s = shared; }

  if (tripActive) {
    lcdLine(0, "!! PROTECTION TRIP !");
    snprintf(b, sizeof(b), "Reason:%s", strcmp(tripReason, "OVER_VOLTAGE") == 0 ? "OVER VOLT" : strcmp(tripReason, "UNDER_VOLTAGE") == 0 ? "UNDER VOLT" : strcmp(tripReason, "OVER_CURRENT") == 0 ? "OVER CURR" : "NO SENSOR");
    lcdLine(1, b);
    if (pzemOk) snprintf(b, sizeof(b), "V:%.0f  I:%.2fA", volts, amps); else snprintf(b, sizeof(b), "Check PZEM wiring");
    lcdLine(2, b);
    lcdLine(3, "Press MAINS to reset");
    return;
  }
  if (!pzemOk) {
    lcdLine(0, "PZEM DISCONNECTED!");
    lcdLine(1, "Check RX/TX and 5V");
    snprintf(b, sizeof(b), "Relay:%s", relayOn ? "ON" : "OFF"); lcdLine(2, b);
    snprintf(b, sizeof(b), "Cloud:%s", cloudOk ? "OK" : "--"); lcdLine(3, b);
    return;
  }
  uint32_t page = (now / PAGE_MS) % 2;
  if (page == 0) {
    snprintf(b, sizeof(b), "V:%5.1fV  I:%5.2fA", volts, amps); lcdLine(0, b);
    snprintf(b, sizeof(b), "P:%6.1fW PF:%.2f", watts, isnan(pfv) ? 0.0f : pfv); lcdLine(1, b);
    snprintf(b, sizeof(b), "Today:%7.3f kWh", dayKwhNow); lcdLine(2, b);
    snprintf(b, sizeof(b), "Total:%7.2f kWh", energyKwh); lcdLine(3, b);
  } else {
    snprintf(b, sizeof(b), "Relay:%-3s Cloud:%s", relayOn ? "ON" : "OFF", cloudOk ? "OK" : "--"); lcdLine(0, b);
    if (bstate == B_RUNNING) {
      int sec = s.bSecLeft;
      snprintf(b, sizeof(b), "Batch:%.13s", bname); lcdLine(1, b);
      snprintf(b, sizeof(b), "Left: %02d:%02d:%02d", sec / 3600, (sec / 60) % 60, sec % 60); lcdLine(2, b);
      snprintf(b, sizeof(b), "Used:%.3f kWh", bKwh); lcdLine(3, b);
    } else {
      snprintf(b, sizeof(b), "Batch:%s", BATCH_NAMES[bstate]); lcdLine(1, b);
      snprintf(b, sizeof(b), "Volt %.0f-%.0fV", limUv, limOv); lcdLine(2, b);
      snprintf(b, sizeof(b), "Max current:%.0fA%s", limOc, muted ? " M" : ""); lcdLine(3, b);
    }
  }
}

// ============================================================
//  Network task (core 0): Wi-Fi, Firebase sign-in, Firestore
// ============================================================
String idToken, refreshToken;
uint32_t tokenExpiryMs = 0;
String lastCmdId;

String docUrl(const String &path) {
  return String("https://firestore.googleapis.com/v1/projects/") + FIREBASE_PROJECT_ID + "/databases/" + FIRESTORE_DATABASE_ID + "/documents/" + path;
}

// NOTE: setInsecure() skips certificate checking. Traffic is still encrypted and every call carries
// a signed-in token, but for a hardened build pin Google's root certificate with client.setCACert().
int httpRequest(const char* method, const String &url, const String &body, String &out, const char* ctype = "application/json", bool auth = true) {
  WiFiClientSecure client;
  client.setInsecure();
  HTTPClient http;
  if (!http.begin(client, url)) return -1;
  http.setConnectTimeout(5000);
  http.setTimeout(HTTP_TIMEOUT_MS);
  http.addHeader("Content-Type", ctype);
  if (auth && idToken.length()) http.addHeader("Authorization", String("Bearer ") + idToken);
  int code = http.sendRequest(method, (uint8_t*)body.c_str(), body.length());
  if (code > 0) out = http.getString();
  http.end();
  return code;
}

bool storeTokens(JsonDocument &d, const char* idKey, const char* refKey, const char* expKey) {
  const char* id = d[idKey]; const char* rf = d[refKey]; const char* ex = d[expKey];
  if (!id || !rf) return false;
  idToken = id; refreshToken = rf;
  long secs = ex ? atol(ex) : 3600;
  if (secs < 600) secs = 600;
  tokenExpiryMs = millis() + (uint32_t)(secs - 300) * 1000UL;
  return true;
}

bool authSignIn() {
  JsonDocument req; req["email"] = DEVICE_EMAIL; req["password"] = DEVICE_PASSWORD; req["returnSecureToken"] = true;
  String body, out; serializeJson(req, body);
  int code = httpRequest("POST", String("https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=") + FIREBASE_API_KEY, body, out, "application/json", false);
  if (code != 200) { Serial.printf("Sign-in failed (%d)\n", code); return false; }
  JsonDocument d; if (deserializeJson(d, out)) return false;
  return storeTokens(d, "idToken", "refreshToken", "expiresIn");
}

bool authRefresh() {
  String body = String("grant_type=refresh_token&refresh_token=") + refreshToken, out;
  int code = httpRequest("POST", String("https://securetoken.googleapis.com/v1/token?key=") + FIREBASE_API_KEY, body, out, "application/x-www-form-urlencoded", false);
  if (code != 200) return false;
  JsonDocument d; if (deserializeJson(d, out)) return false;
  return storeTokens(d, "id_token", "refresh_token", "expires_in");
}

bool ensureAuth() {
  if (idToken.length() && (int32_t)(millis() - tokenExpiryMs) < 0) return true;
  if (refreshToken.length() && authRefresh()) return true;
  idToken = ""; refreshToken = "";
  return authSignIn();
}

void noteHttpResult(int code) {
  if (code == 200) { cloudOk = true; lastCloudOkMs = millis(); }
  else {
    cloudOk = false;
    if (code == 401 || code == 403) { idToken = ""; refreshToken = ""; }   // sign in again next round
  }
}

// ---- reading fields from Firestore REST documents ----
float fnum(JsonVariantConst fields, const char* key, float def) {
  JsonVariantConst v = fields[key];
  if (v.isNull()) return def;
  JsonVariantConst dv = v["doubleValue"];
  if (!dv.isNull()) return dv.as<float>();
  JsonVariantConst iv = v["integerValue"];
  if (iv.is<const char*>()) return (float)atof(iv.as<const char*>());
  if (!iv.isNull()) return iv.as<float>();
  return def;
}
bool fbool(JsonVariantConst fields, const char* key, bool def) {
  JsonVariantConst v = fields[key]["booleanValue"];
  return v.isNull() ? def : v.as<bool>();
}
const char* fstr(JsonVariantConst fields, const char* key) {
  const char* s = fields[key]["stringValue"];
  return s ? s : "";
}

// Seconds since 1970 for "2026-11-12T11:13:00.123Z"
uint32_t parseIsoUtc(const char* s) {
  int Y, M, D, h, m, sec;
  if (!s || sscanf(s, "%d-%d-%dT%d:%d:%d", &Y, &M, &D, &h, &m, &sec) != 6) return 0;
  Y -= M <= 2;
  long era = (Y >= 0 ? Y : Y - 399) / 400;
  unsigned yoe = (unsigned)(Y - era * 400);
  unsigned doy = (153 * (M + (M > 2 ? -3 : 9)) + 2) / 5 + D - 1;
  unsigned doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
  long days = era * 146097 + (long)doe - 719468;
  return (uint32_t)(days * 86400L + h * 3600L + m * 60L + sec);
}

void pollCommand() {
  String out;
  int code = httpRequest("GET", docUrl(String("commands/") + DEVICE_ID), "", out);
  if (code == 404) { cloudOk = true; lastCloudOkMs = millis(); return; }
  noteHttpResult(code);
  if (code != 200) return;
  JsonDocument d; if (deserializeJson(d, out)) return;
  const char* upd = d["updateTime"];
  if (!upd || lastCmdId == upd) return;
  if (!timeValid()) return;                               // cannot judge the age yet; try again next poll

  lastCmdId = upd;
  prefs.putString("last_cmd", lastCmdId);
  JsonVariantConst f = d["fields"];
  const char* cmd = fstr(f, "command");
  uint32_t age = (uint32_t)time(nullptr) - parseIsoUtc(upd);
  if (!cmd[0] || strcmp(cmd, "NONE") == 0) return;
  if ((int32_t)age > (int32_t)COMMAND_MAX_AGE_S) { Lock l; setLastCmd(cmd, "IGNORED_STALE"); return; }

  PendingCmd c = {}; c.valid = true;
  if (!strcmp(cmd, "SET_RELAY")) { c.type = CMD_SET_RELAY; c.relayOn = !strcmp(fstr(f, "relay_state"), "ON"); }
  else if (!strcmp(cmd, "START_BATCH")) { c.type = CMD_START_BATCH; strlcpy(c.name, fstr(f, "batch_name"), sizeof(c.name)); c.minutes = (int)fnum(f, "duration_min", 0); }
  else if (!strcmp(cmd, "STOP_BATCH")) c.type = CMD_STOP_BATCH;
  else if (!strcmp(cmd, "EXTEND_BATCH")) { c.type = CMD_EXTEND_BATCH; c.minutes = (int)fnum(f, "extend_min", 15); }
  else if (!strcmp(cmd, "RESET_TRIP")) c.type = CMD_RESET_TRIP;
  else if (!strcmp(cmd, "ACK_BATCH")) c.type = CMD_ACK_BATCH;
  else return;
  Lock l; pendingCmd = c;
}

void pollSettings() {
  String out;
  int code = httpRequest("GET", docUrl(String("settings/") + DEVICE_ID), "", out);
  if (code == 404) return;
  noteHttpResult(code);
  if (code != 200) return;
  JsonDocument d; if (deserializeJson(d, out)) return;
  JsonVariantConst f = d["fields"];
  NewSettings s = {};
  s.valid = true;
  s.ov = fnum(f, "over_voltage", DEF_OV); s.uv = fnum(f, "under_voltage", DEF_UV); s.oc = fnum(f, "over_current", DEF_OC);
  s.muted = fbool(f, "buzzer_muted", false);
  Lock l; pendingSettings = s;
}

// ---- writing documents ----
void putNum(JsonObject f, const char* k, float v) { if (isnan(v) || isinf(v)) f[k]["nullValue"] = nullptr; else f[k]["doubleValue"] = v; }
void putInt(JsonObject f, const char* k, long v) { f[k]["integerValue"] = String(v); }
void putStr(JsonObject f, const char* k, const char* v) { f[k]["stringValue"] = v; }
void putBool(JsonObject f, const char* k, bool v) { f[k]["booleanValue"] = v; }

int patchDoc(const String &path, JsonDocument &doc) {
  String body, out; serializeJson(doc, body);
  return httpRequest("PATCH", docUrl(path), body, out);
}

void pushTelemetry() {
  Snapshot s; { Lock l; s = shared; }
  JsonDocument doc; JsonObject f = doc["fields"].to<JsonObject>();
  putNum(f, "voltage", s.v); putNum(f, "current", s.a); putNum(f, "power", s.w);
  putNum(f, "energy", s.kwh); putNum(f, "pf", s.pf); putNum(f, "frequency", s.hz);
  putStr(f, "relay_state", s.relayOn ? "ON" : "OFF");
  putBool(f, "pzem_connected", s.pzemOk);
  putBool(f, "trip_active", s.tripActive); putStr(f, "trip_reason", s.tripReason);
  putStr(f, "batch_state", BATCH_NAMES[s.bstate]);
  putBool(f, "batch_active", s.bstate == B_RUNNING);
  putStr(f, "batch_name", s.bname);
  putInt(f, "batch_seconds_left", s.bSecLeft);
  putInt(f, "batch_time_left", (s.bSecLeft + 59) / 60);
  putInt(f, "batch_total_min", s.bTotalMin);
  putNum(f, "batch_kwh_used", s.bKwh);
  putNum(f, "limit_ov", s.ov); putNum(f, "limit_uv", s.uv); putNum(f, "limit_oc", s.oc);
  putBool(f, "buzzer_muted", s.muted);
  putNum(f, "day_kwh", s.dayKwh);
  putStr(f, "last_cmd", s.lastCmd); putStr(f, "last_cmd_result", s.lastCmdResult);
  putInt(f, "wifi_rssi", WiFi.RSSI());
  putInt(f, "uptime_s", (long)(millis() / 1000));
  putInt(f, "device_time", timeValid() ? (long)time(nullptr) : 0);
  putStr(f, "fw", FW_VERSION);
  noteHttpResult(patchDoc(String("devices/") + DEVICE_ID, doc));
}

String dayId(int key) {
  char b[12]; snprintf(b, sizeof(b), "%04d-%02d-%02d", key / 10000, (key / 100) % 100, key % 100);
  return String(b);
}

int pushDay(int key, float kwh, const float *hours) {
  JsonDocument doc; JsonObject f = doc["fields"].to<JsonObject>();
  putStr(f, "date", dayId(key).c_str());
  putNum(f, "kwh", kwh);
  for (int h = 0; h < 24; h++) { char k[5]; snprintf(k, sizeof(k), "h%02d", h); putNum(f, k, hours[h] < 0 ? 0 : hours[h]); }
  return patchDoc(String("history_daily/") + dayId(key), doc);
}

int pushBatchRecord(const BatchRecord &r) {
  JsonDocument doc; JsonObject f = doc["fields"].to<JsonObject>();
  putStr(f, "name", r.name);
  putInt(f, "started_at", r.startedAt);
  putInt(f, "planned_min", r.plannedMin);
  putInt(f, "actual_s", r.actualS);
  putNum(f, "kwh", r.kwh);
  putStr(f, "end_reason", r.reason);
  putInt(f, "ended_at", timeValid() ? (long)time(nullptr) : 0);
  char id[32]; snprintf(id, sizeof(id), "b_%lu_%lu", (unsigned long)(r.startedAt ? r.startedAt : (uint32_t)time(nullptr)), (unsigned long)millis());
  return patchDoc(String("batches/") + id, doc);
}

void pushPending() {
  DayRecord fd = {}; BatchRecord br; bool haveBr = false;
  { Lock l; if (finalDay.valid) { fd = finalDay; finalDay.valid = false; }
    if (batchQueueN > 0) { br = batchQueue[0]; memmove(&batchQueue[0], &batchQueue[1], (batchQueueN - 1) * sizeof(BatchRecord)); batchQueueN--; haveBr = true; } }
  if (fd.valid) {
    int code = pushDay(fd.key, fd.kwh, fd.hour);
    noteHttpResult(code);
    if (code != 200) { Lock l; if (!finalDay.valid) { finalDay = fd; } }      // retry later
  }
  if (haveBr) {
    int code = pushBatchRecord(br);
    noteHttpResult(code);
    if (code != 200) { Lock l; if (batchQueueN < 4) { memmove(&batchQueue[1], &batchQueue[0], batchQueueN * sizeof(BatchRecord)); batchQueue[0] = br; batchQueueN++; } }
  }
}

void netTask(void*) {
  uint32_t lastTele = 0, lastCmd = 0, lastSet = 0, lastHist = 0, lastWifiTry = 0;
  bool ntpStarted = false;
  for (;;) {
    uint32_t now = millis();
    if (WiFi.status() != WL_CONNECTED) {
      cloudOk = false;
      if (now - lastWifiTry > 15000) { lastWifiTry = now; WiFi.disconnect(); WiFi.begin(WIFI_SSID, WIFI_PASSWORD); }
      vTaskDelay(pdMS_TO_TICKS(500));
      continue;
    }
    if (!ntpStarted) { configTime(TZ_OFFSET_SEC, 0, "pool.ntp.org", "time.google.com"); ntpStarted = true; }
    if (!ensureAuth()) { cloudOk = false; vTaskDelay(pdMS_TO_TICKS(5000)); continue; }

    if (now - lastCmd >= COMMAND_MS)   { lastCmd = now;  pollCommand(); }
    if (now - lastSet >= SETTINGS_MS)  { lastSet = now;  pollSettings(); }
    if (now - lastTele >= TELEMETRY_MS) { lastTele = now; pushTelemetry(); }
    pushPending();
    if (now - lastHist >= HISTORY_MS && timeValid()) {
      lastHist = now;
      Snapshot s; { Lock l; s = shared; }
      if (s.dayKey != 0) noteHttpResult(pushDay(s.dayKey, s.dayKwh, s.hourKwh));
    }
    if (cloudOk && now - lastCloudOkMs > 30000) cloudOk = false;
    vTaskDelay(pdMS_TO_TICKS(50));
  }
}

// ============================================================
//  Setup and loop
// ============================================================
void setup() {
  digitalWrite(PIN_RELAY, RELAY_OFF_LEVEL);
  pinMode(PIN_RELAY, OUTPUT);
  setRelay(false);                       // always start with the load OFF
  pinMode(PIN_GREEN, OUTPUT); pinMode(PIN_RED, OUTPUT); pinMode(PIN_BUZZER, OUTPUT);
  digitalWrite(PIN_GREEN, LOW); digitalWrite(PIN_RED, LOW); digitalWrite(PIN_BUZZER, BUZZER_OFF);
  pinMode(PIN_BTN_BATCH, INPUT_PULLUP);
  if (PIN_BTN_RELAY >= 0) pinMode(PIN_BTN_RELAY, INPUT_PULLUP);

  Serial.begin(115200);
  Serial.println("\n--- Smart Energy Meter v" FW_VERSION " ---");

  mtx = xSemaphoreCreateMutex();
  prefs.begin("meter", false);
  limOv = prefs.getFloat("ov", DEF_OV); limUv = prefs.getFloat("uv", DEF_UV); limOc = prefs.getFloat("oc", DEF_OC);
  muted = prefs.getBool("muted", false);
  lastCmdId = prefs.getString("last_cmd", "");

  if (prefs.getBool("b_run", false)) {   // a batch was running when power or the board was lost
    bootInterruptedPending = true;
    prefs.getString("b_name", bootBatchName, sizeof(bootBatchName));
    bootBatchStartKwh = prefs.getFloat("b_skwh", -1.0f);
    bootBatchPlanned = prefs.getUShort("b_plan", 0);
    bStartEpoch = prefs.getUInt("b_epoch", 0);
    strlcpy(bname, bootBatchName, sizeof(bname));
    bPlannedMin = bootBatchPlanned;
    bstate = B_INTERRUPTED;
    prefs.putBool("b_run", false);
  }

  Wire.begin(PIN_SDA, PIN_SCL);
  lcd = new LiquidCrystal_I2C(findLcdAddress(), 20, 4);
  lcdStart(lcd, Rank<2>{});
  lcd->backlight(); lcd->clear();
  lcdLine(0, "   SMART METER");
  lcdLine(1, "  Starting v" FW_VERSION);
  if (WIFI_SSID[0] == '_' || DEVICE_EMAIL[0] == '_') lcdLine(3, "Edit Wi-Fi settings!");

  WiFi.persistent(false);
  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  xTaskCreatePinnedToCore(netTask, "net", 16384, nullptr, 1, nullptr, 0);

  startPattern(PAT_BOOT, 1);
  delay(1200);
  lcd->clear();
  if (bstate == B_INTERRUPTED) startPattern(PAT_ALARM, 6, true, 0, ALARM_FOR_MS);
}

void loop() {
  static uint32_t lastRead = 0, lastLcd = 0, lastReadMs = 0;
  uint32_t now = millis();

  if (now - lastRead >= READ_MS) {
    uint32_t dt = now - lastReadMs; lastReadMs = now; lastRead = now;
    readPzem();
    updateBuckets(now);
    batchTick(now, dt);
    checkProtection(now);

    if (bootInterruptedPending && timeValid() && (pzemOk || now > 60000)) {   // record the batch that power loss cut short
      bootInterruptedPending = false;
      float used = (!isnan(energyKwh) && bootBatchStartKwh >= 0 && energyKwh >= bootBatchStartKwh) ? energyKwh - bootBatchStartKwh : 0;
      queueBatchRecord(bootBatchName, bStartEpoch, bootBatchPlanned, 0, used, "INTERRUPTED");
    }
    publishSnapshot();
  }

  handlePending();
  handleButtons(now);
  updateBuzzer();
  updateIndicators(now);
  if (now - lastLcd >= 500) { lastLcd = now; drawLcd(now); }
  delay(2);
}
