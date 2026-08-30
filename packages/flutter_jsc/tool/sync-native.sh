#!/bin/sh
# Copies the shared native sources (quickjs-ng + fjs core) into the iOS and
# macOS platform dirs. CocoaPods requires all pod sources to live inside the
# platform pod root, so pods build from these copies. Run after any change
# under native/ (Android builds use native/ directly via CMake).
set -e
cd "$(dirname "$0")/.."
for platform in ios macos; do
    rm -rf "$platform/Classes/native"
    mkdir -p "$platform/Classes/native"
    cp -R native/quickjs "$platform/Classes/native/quickjs"
    cp -R native/src "$platform/Classes/native/src"
    cp -R native/include "$platform/Classes/native/include"
done
echo "native sources synced into ios/Classes and macos/Classes"
