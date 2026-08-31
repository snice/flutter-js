// The level a console line arrives with.
//
// The values mirror FJS_LOG_* in native/include/fjs.h, which in turn mirror
// the console methods the VM exposes: console.debug is [debug],
// console.log and console.info are both [info], and so on. Keeping the
// three in step is what lets a host print a name instead of a number.
enum FjsLogLevel {
  debug,
  info,
  warn,
  error;

  /// The level for a raw value from [FjsEngine.onLog].
  ///
  /// An unknown value — a newer engine, a host module inventing one —
  /// reads as [info] rather than throwing: printing a log line must never
  /// be able to bring the app down.
  static FjsLogLevel of(int value) =>
      value >= 0 && value < values.length ? values[value] : info;
}
