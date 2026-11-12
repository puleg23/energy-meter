# Setup (one time)

1. **Firebase console > Authentication > Sign-in method:** turn on **Email/Password**.
2. **Authentication > Users > Add user:** create the meter's login, email `meter01@energymeter.app` and a password you choose. (If you pick another email, change it in `firestore.rules` too.)
3. **Firestore Database:** open the database `ai-studio-energymetercostm-34010999-bb33-49a0-b4b4-82d15340dd53` (pick it in the dropdown), **Rules** tab, paste `firestore.rules`, **Publish**.
   By default any signed-in user except the meter can use the app. To lock it to you, put your email (lower case) in `ownerEmail()` in the rules.
4. **Host the app** (below), open it, **Create account** (or sign in) as yourself.
5. In the app: Home > "ESP32 setup", enter Wi-Fi and the meter login, download `esp32_energy_meter.ino`.
6. Arduino IDE: put the file in a folder called `esp32_energy_meter`. Install ArduinoJson (7.x), PZEM-004T-v30, LiquidCrystal I2C. Board "ESP32 Dev Module". Upload.
7. Wire GPIO25 to the mains relay push button (to GND). If it is not fitted, set `PIN_BTN_RELAY` to -1.

The meter shows as online in the app within about 10 seconds. If the Serial Monitor says "Sign-in failed", check the meter email and password; the firmware waits longer between tries (up to 10 min) so Firebase does not block it.

## Run locally
`npm install --legacy-peer-deps`, `npm run dev`, `npm test`, `npm run lint`.

## Host on Firebase App Hosting (console, no command line)
Firebase console > App Hosting > Get started > connect the GitHub repo `energy-meter`, branch `main`, root `/`. Backend ID e.g. `energy-meter`, leave the Node runtime, no environment variables. Each push to `main` redeploys. Then add the new domain under Authentication > Settings > Authorized domains.

## Or Firebase Hosting with the command line
```
npm install --legacy-peer-deps
npm run build
npm i -g firebase-tools
firebase login
firebase deploy --only hosting
firebase deploy --only firestore
```
The GitHub workflow runs lint, tests and build on every push, and deploys to Hosting only if a `FIREBASE_SERVICE_ACCOUNT` secret exists.
