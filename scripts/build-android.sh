#!/usr/bin/env bash
# Builds the KHAN G Android APKs.
#   ANDROID_HOME=/path/to/android-sdk \
#   KHANG_KEYSTORE=/path/khang-release.jks KHANG_KEYSTORE_PASSWORD=... \
#   scripts/build-android.sh https://app.your-domain.pk
# Without a server address the app asks for it on first launch.
# Without KHANG_KEYSTORE the release APK is unsigned (only the test APK is installable).
set -euo pipefail
cd "$(dirname "$0")/../android"
SERVER="${1:-}"
: "${ANDROID_HOME:?set ANDROID_HOME to your Android SDK (platforms;android-34, build-tools;34.0.0)}"
echo "sdk.dir=$ANDROID_HOME" > local.properties
./gradlew --no-daemon -q -PkhangServerUrl="$SERVER" assembleRelease assembleDebug
mkdir -p ../dist-android
cp app/build/outputs/apk/release/app-release*.apk ../dist-android/KHAN-G.apk
cp app/build/outputs/apk/debug/app-debug.apk ../dist-android/KHAN-G-test.apk
echo "APKs in dist-android/: KHAN-G.apk (shops, HTTPS only), KHAN-G-test.apk (testing, allows http)"
