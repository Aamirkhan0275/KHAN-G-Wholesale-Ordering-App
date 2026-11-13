# KHAN G Android app (APK)

The Android app is a small native shell (`android/`, Java, no third-party libraries, ~45 KB) that opens the KHAN G web app full-screen. Every screen is the same responsive web app that the automated tests check on all screen sizes. Server-side changes therefore reach phones without a new APK.

| | |
|---|---|
| Package | `pk.khang.wholesale` (test build: `pk.khang.wholesale.test`) |
| Android | 7.0 (API 24) and newer; target API 34 |
| Permissions | Internet; storage only on Android ≤ 9, to save invoice PDFs/CSVs to Downloads |
| Size | ≈ 45 KB |

## What the app does

- Opens the configured KHAN G server. Pages of that server stay inside the app. WhatsApp click-to-chat links (`wa.me`), phone calls and other websites open in their own apps. Ordering via WhatsApp therefore opens WhatsApp directly.
- **Invoice PDFs and CSV exports** download with the signed-in session to *Downloads*, and a notification lets you open them.
- **Product photo upload** (admin) uses the phone’s file picker or camera.
- Sign-in lasts 30 days (cookies are kept), the same as in the browser.
- **No internet:** screens already loaded open from the app cache; otherwise a bilingual *No connection* screen offers **Try again**.
- **Android back button** goes back a page; on the first page it closes the app.
- Supports right-to-left (Urdu), dark mode (follows the web app setting) and the phone’s font-size setting.

## Two APKs

| File | For | Server address |
|---|---|---|
| `KHAN-G.apk` (release, signed with the KHAN G key) | Shopkeepers and the owner | **HTTPS only** |
| `KHAN-G-test.apk` (debug key, separate app id) | Testing on a phone against a laptop on the same Wi-Fi, e.g. `http://192.168.1.5:8787` | http or https |

## Server address

The app needs the online address of the KHAN G server (see `docs/DEPLOYMENT.md`).

- **Built in (recommended for shops):** `scripts/build-android.sh https://app.your-domain.pk` writes the address into the APK. Shopkeepers install it and sign in; there is nothing to type.
- **Not built in (the current APK):** on first launch the app shows a short English/Urdu setup screen asking for the address. It is entered once. To change it later, use *Server address* on the no-connection screen.

## Building

Requirements: JDK 17+, Android SDK with `platforms;android-34` and `build-tools;34.0.0`.

```bash
export ANDROID_HOME=$HOME/android-sdk
export KHANG_KEYSTORE=/secure/place/khang-release.jks
export KHANG_KEYSTORE_PASSWORD='…'
scripts/build-android.sh https://app.your-domain.pk     # -> dist-android/KHAN-G.apk + KHAN-G-test.apk
```

Raise `khangVersionCode` (and `khangVersionName`) in `android/gradle.properties` for every new APK you give out. Android only installs an update if the version code is higher **and** the APK is signed with the same key.

### The signing key — keep it safe

`khang-release.jks` and its password prove that an update really comes from KHAN G. **If they are lost, phones cannot update the app; it must be uninstalled and installed again.** Keep a copy in two safe places (not in git and not in chat). The Play Store also needs this key, or its own Play App Signing.

Key fingerprint (SHA-256) of the key used for the first build:
`DC:D7:EA:B0:DE:DC:4C:01:F4:05:CE:98:09:40:08:35:AF:EB:DD:83:9A:F8:4A:E7:37:67:D1:F5:8E:41:92:03`

## Giving the app to shops

- **Direct (free):** send `KHAN-G.apk` on WhatsApp or by link. On the phone: open it → allow *Install unknown apps* for WhatsApp/Files when Android asks → Install.
- **Google Play (owner decision, one-time US$25 developer fee):** Play requires an **AAB** (`./gradlew bundleRelease`), a privacy policy URL, the data-safety form and screenshots. With a live HTTPS domain, a Trusted Web Activity (Bubblewrap/PWABuilder) is an alternative package that Play also accepts.
- **iPhone:** an APK is Android-only. iPhone users install the web app from Safari (*Share → Add to Home Screen*); see the README.

## Testing status

See TEST_REPORT.md → *Android app*. In short: the APKs are built, signed and checked (signature, package, permissions, cleartext setting), and the web app’s in-app mode is covered by the browser tests. **They have not yet been run on a real phone or emulator**: this environment has no Android emulator support, and the team’s test phone was offline.
