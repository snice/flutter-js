#!/usr/bin/env bash
# Builds android/src/main/jniLibs/<abi>/libfjs.so from native/ for every ABI the
# plugin ships, then strips them. Run once per native/ change and commit.
#
# Needs ANDROID_NDK_HOME (or ANDROID_NDK_ROOT / ANDROID_HOME with an ndk/ dir).
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT=$(pwd)
OUT="$ROOT/build/android"
JNILIBS="$ROOT/android/src/main/jniLibs"
API=21
ABIS=(armeabi-v7a arm64-v8a x86_64)

NDK=${ANDROID_NDK_HOME:-${ANDROID_NDK_ROOT:-}}
if [ -z "$NDK" ] && [ -n "${ANDROID_HOME:-}" ]; then
    NDK=$(ls -d "$ANDROID_HOME"/ndk/* 2>/dev/null | sort -V | tail -1 || true)
fi
if [ -z "$NDK" ] || [ ! -f "$NDK/build/cmake/android.toolchain.cmake" ]; then
    echo "error: Android NDK not found; set ANDROID_NDK_HOME" >&2
    exit 1
fi

HOST_TAG=$(uname -s | tr '[:upper:]' '[:lower:]')-x86_64
[ "$(uname -s)" = "Darwin" ] && HOST_TAG=darwin-x86_64
STRIP="$NDK/toolchains/llvm/prebuilt/$HOST_TAG/bin/llvm-strip"

rm -rf "$OUT" "$JNILIBS"
for abi in "${ABIS[@]}"; do
    echo "==> building $abi"
    cmake -S "$ROOT/native" -B "$OUT/$abi" \
        -DCMAKE_TOOLCHAIN_FILE="$NDK/build/cmake/android.toolchain.cmake" \
        -DANDROID_ABI="$abi" \
        -DANDROID_PLATFORM="android-$API" \
        -DANDROID_STL=c++_static \
        -DCMAKE_BUILD_TYPE=Release \
        -DFJS_BUILD_TESTS=OFF \
        >/dev/null
    cmake --build "$OUT/$abi" --target fjs -j"$(getconf _NPROCESSORS_ONLN)" >/dev/null
    mkdir -p "$JNILIBS/$abi"
    cp "$OUT/$abi/libfjs.so" "$JNILIBS/$abi/libfjs.so"
    "$STRIP" --strip-unneeded "$JNILIBS/$abi/libfjs.so"
done

echo "built:"
ls -lh "$JNILIBS"/*/libfjs.so | awk '{print "  " $NF " " $5}'
