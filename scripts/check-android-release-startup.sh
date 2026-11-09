#!/usr/bin/env bash
set -euo pipefail

apk="${1:?Pass the release APK to validate}"
report="${2:-release-startup}"
[[ "$report" =~ ^[a-z0-9-]+$ ]]
adb_bin="${ADB_BIN:-adb}"
serial="${ANDROID_SERIAL:-emulator-${EMULATOR_PORT:-5554}}"
package=ru.genesis.calendar
case "$serial" in
  emulator-*) ;;
  *) printf 'Release startup validation requires an isolated emulator.\n' >&2; exit 2 ;;
esac
test -s "$apk"
adb_command=("$adb_bin" -s "$serial")
"${adb_command[@]}" wait-for-device
"${adb_command[@]}" install -r "$apk"
"${adb_command[@]}" logcat -c
"${adb_command[@]}" shell am force-stop "$package"
"${adb_command[@]}" shell am start -W -n "$package/.MainActivity"
sleep 15
if ! "${adb_command[@]}" shell pidof "$package" >/dev/null; then
  "${adb_command[@]}" logcat -d -s AndroidRuntime:E
  printf 'Release APK exited during startup.\n' >&2
  exit 1
fi
crashes="$("${adb_command[@]}" logcat -d -s AndroidRuntime:E)"
if printf '%s\n' "$crashes" | grep -Eq 'FATAL EXCEPTION|VerifyError'; then
  printf '%s\n' "$crashes" >&2
  exit 1
fi
"${adb_command[@]}" shell dumpsys activity activities \
  | grep -E '(mResumedActivity|topResumedActivity).*ru\.genesis\.calendar/\.MainActivity'
mkdir -p android/app/build/reports
"${adb_command[@]}" exec-out screencap -p > "android/app/build/reports/$report.png"
"${adb_command[@]}" shell am force-stop "$package"
printf 'Release APK initialized successfully and survived startup on %s.\n' "$serial"
