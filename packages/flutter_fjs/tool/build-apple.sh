#!/usr/bin/env bash
# Builds fjs.xcframework from native/ into the ios/ and macos/ pod roots
# (CocoaPods resolves vendored paths inside the pod root, so each gets a copy).
#
# The slices are static libraries, not frameworks: pub.dev refuses to publish
# packages containing directory symlinks, and a versioned macOS framework bundle
# is built out of them. Static also means nothing to embed or code-sign — the
# engine links into the app binary and Dart reaches it via
# DynamicLibrary.process(). Classes/FlutterFjsPlugin.m keeps the entry points
# from being dead-stripped.
#
# Slices: ios-arm64, ios-arm64_x86_64-simulator, macos-arm64_x86_64.
# Run on macOS with Xcode + CMake installed, then commit the result.
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT=$(pwd)
OUT="$ROOT/build/apple"
IOS_MIN=12.0
MACOS_MIN=10.14

rm -rf "$OUT" "$ROOT/ios/fjs.xcframework" "$ROOT/macos/fjs.xcframework"
mkdir -p "$OUT"

# slice <name> <cmake system> <sysroot> <archs> <deployment target>
slice() {
    local name=$1 system=$2 sysroot=$3 archs=$4 target=$5
    echo "==> building $name ($archs)"
    cmake -S "$ROOT/native" -B "$OUT/$name" \
        -DCMAKE_BUILD_TYPE=Release \
        -DFJS_APPLE_STATIC=ON \
        -DFJS_BUILD_TESTS=OFF \
        -DCMAKE_SYSTEM_NAME="$system" \
        -DCMAKE_OSX_SYSROOT="$sysroot" \
        -DCMAKE_OSX_ARCHITECTURES="$archs" \
        -DCMAKE_OSX_DEPLOYMENT_TARGET="$target" \
        >/dev/null
    cmake --build "$OUT/$name" --target fjs_core quickjs --config Release \
        -j"$(sysctl -n hw.ncpu)" >/dev/null
    # one archive per slice: fjs core objects + vendored quickjs objects
    libtool -static -no_warning_for_no_symbols \
        -o "$OUT/$name/libfjs.a" \
        "$OUT/$name/libfjs_core.a" "$OUT/$name/libquickjs.a"
}

slice ios-device    iOS    iphoneos          "arm64"        "$IOS_MIN"
slice ios-simulator iOS    iphonesimulator   "arm64;x86_64" "$IOS_MIN"
slice macos         Darwin macosx            "arm64;x86_64" "$MACOS_MIN"

echo "==> creating xcframework"
xcodebuild -create-xcframework \
    -library "$OUT/ios-device/libfjs.a"    -headers "$ROOT/native/include" \
    -library "$OUT/ios-simulator/libfjs.a" -headers "$ROOT/native/include" \
    -library "$OUT/macos/libfjs.a"         -headers "$ROOT/native/include" \
    -output "$ROOT/ios/fjs.xcframework" >/dev/null

cp -R "$ROOT/ios/fjs.xcframework" "$ROOT/macos/fjs.xcframework"

if find "$ROOT/ios/fjs.xcframework" "$ROOT/macos/fjs.xcframework" -type l | grep -q .; then
    echo "error: xcframework contains symlinks (pub.dev rejects them)" >&2
    exit 1
fi

echo "built:"
find "$ROOT/ios/fjs.xcframework" -name 'libfjs.a' -exec ls -lh {} \; | awk '{print "  " $NF " " $5}'
