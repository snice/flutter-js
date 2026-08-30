Pod::Spec.new do |s|
  s.name             = 'flutter_jsc'
  s.version          = '0.1.0'
  s.summary          = 'JS/TS runtime for Flutter (QuickJS-ng embedded, JSI-style bridge).'
  s.description      = 'Embeds QuickJS-ng in the Flutter app; JS runs against native C functions directly and renders HTML-like tags as Flutter widgets.'
  s.homepage         = 'https://example.com/flutter-js'
  s.license          = { :type => 'MIT' }
  s.author           = { 'flutter-js' => 'dev@flutter-js.dev' }
  s.source           = { :path => '.' }
  s.source_files     = 'Classes/**/*'
  # Classes/native is a copy of ../native kept in sync by tool/sync-native.sh
  # (CocoaPods requires all sources inside the platform pod root)
  s.public_header_files = 'Classes/native/include/fjs.h', 'Classes/FlutterJscPlugin.h'
  s.dependency 'Flutter'
  s.ios.deployment_target = '12.0'
  s.pod_target_xcconfig = {
    'GCC_C_LANGUAGE_STANDARD' => 'c11',
    'CLANG_CXX_LANGUAGE_STANDARD' => 'c++17',
    'OTHER_CFLAGS' => '-D_GNU_SOURCE $(inherited)',
    'HEADER_SEARCH_PATHS' => '"$(PODS_TARGET_SRCROOT)/Classes/native/quickjs" "$(PODS_TARGET_SRCROOT)/Classes/native/include" "$(PODS_TARGET_SRCROOT)/Classes/native/src" $(inherited)'
  }
end
