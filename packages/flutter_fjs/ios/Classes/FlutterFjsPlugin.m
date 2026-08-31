#import "FlutterFjsPlugin.h"

#include <stdint.h>

// The engine ships as a static slice inside fjs.xcframework, so nothing in the
// app references its symbols at link time: without the table below the linker
// would never pull those archive members in, and dart:ffi's
// DynamicLibrary.process() would find nothing. GeneratedPluginRegistrant
// references this class, which drags the table — and with it the engine — into
// the binary. Keep it in sync with native/include/fjs.h.
extern int32_t fjs_abi_version(void);
extern void *fjs_vm_create(void);
extern void fjs_vm_destroy(void *);
extern void fjs_set_callbacks(void *, void *, void *, void *);
extern void fjs_set_toast_callback(void *, void *);
extern int32_t fjs_vm_eval_source(void *, const uint8_t *, int32_t, const char *);
extern int32_t fjs_vm_eval_bundle(void *, const uint8_t *, int32_t);
extern int32_t fjs_vm_pump(void *, int64_t);
extern int64_t fjs_vm_now(void *);
extern int32_t fjs_vm_dispatch_event(void *, int32_t, int32_t, const uint8_t *, int32_t);
extern int32_t fjs_compile_bundle(void *, const uint8_t *, int32_t, uint8_t **, int32_t *);
extern int32_t fjs_bundle_check(const uint8_t *, int32_t, int32_t *, int32_t *);
extern const char *fjs_last_error(void *);
extern const uint8_t *fjs_engine_id(void);

__attribute__((used)) static const void *const kFjsKeepAlive[] = {
    (const void *)&fjs_abi_version,      (const void *)&fjs_vm_create,
    (const void *)&fjs_vm_destroy,       (const void *)&fjs_set_callbacks,
    (const void *)&fjs_set_toast_callback, (const void *)&fjs_vm_eval_source,
    (const void *)&fjs_vm_eval_bundle,   (const void *)&fjs_vm_pump,
    (const void *)&fjs_vm_now,           (const void *)&fjs_vm_dispatch_event,
    (const void *)&fjs_compile_bundle,   (const void *)&fjs_bundle_check,
    (const void *)&fjs_last_error,       (const void *)&fjs_engine_id,
};

@implementation FlutterFjsPlugin
+ (void)registerWithRegistrar:(NSObject<FlutterPluginRegistrar>*)registrar {}
@end
