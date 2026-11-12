# Setup (one time)

1. **Firebase console > Authentication > Sign-in method**: enable Email/Password.
2. **Authentication > Users > Add user**, twice: one for you (the app), one for the meter. Copy each user's UID.
3. **Firestore > Rules**: paste `firestore.rules`, replace `OWNER_UID` and `DEVICE_UID`, publish.
4. Open the app, sign in as yourself, Home > "ESP32 setup", enter Wi-Fi and the meter user's login, download `esp32_energy_meter.ino`.
5. Arduino IDE: put the file in a folder called `esp32_energy_meter`. Install libraries ArduinoJson (7.x), PZEM-004T-v30, LiquidCrystal I2C. Board "ESP32 Dev Module". Upload.
6. Wire GPIO25 to the mains relay push button (to GND). If you have not fitted it, set `PIN_BTN_RELAY` to -1.

Run `npm install --legacy-peer-deps`, `npm run dev`, `npm test`, `npm run lint`.

## Deploy to Firebase Hosting
```
npm install --legacy-peer-deps
npm run build
npm i -g firebase-tools
firebase login
firebase deploy --only hosting          # the app
firebase deploy --only firestore        # rules; do this only after replacing OWNER_UID / DEVICE_UID
```
Also add your hosting domain under Authentication > Settings > Authorized domains if sign-in is refused.
