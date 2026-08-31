#!/usr/bin/env bash
# Rebuilds every prebuilt artifact this package ships (Android .so +
# Apple xcframework). macOS only — the xcframework needs Xcode.
set -euo pipefail
cd "$(dirname "$0")"
./build-android.sh
./build-apple.sh
