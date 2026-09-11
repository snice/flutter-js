/* Internal shared declarations for the fjs C++ core (not part of fjs.h ABI). */
#ifndef FJS_INTERNAL_H
#define FJS_INTERNAL_H

#include "fjs.h"

#include <string>
#include <unordered_map>
#include <vector>

#include "quickjs.h"

struct Timer {
    int32_t id;
    bool interval;
    double next_ms;    /* absolute deadline on the host clock */
    double interval_ms;
    JSValue callback;  /* owns a reference */
};

struct FJSVM {
    JSRuntime *rt = nullptr;
    JSContext *ctx = nullptr;
    fjs_on_log_fn on_log = nullptr;
    fjs_on_ui_ops_fn on_ui_ops = nullptr;
    fjs_invoke_host_fn on_invoke_host = nullptr;
    fjs_on_toast_fn on_toast = nullptr;
    std::vector<Timer> timers;
    int32_t next_timer_id = 1;
    /* Binary handles (spec 038): Dart writes a body once, JS consumes it
     * through the fns natives. Not a JS-opaque map — the host modules run
     * in Dart and can never hold a C++ pointer, so the table is the point:
     * data crosses Dart->C++ once, then only int ids travel. next_handle_id
     * is monotonic across the VM's whole life (no reset), which is what
     * makes a stale id miss instead of alias. */
    std::unordered_map<int64_t, std::vector<uint8_t>> handle_bytes;
    int64_t next_handle_id = 1;
    char last_error[1024] = {0};
};

namespace fjs {

/* Monotonic clock in ms (used for nowMs() and internal pumps). */
double now_ms(FJSVM *vm);

/* Helpers shared across translation units. */
void set_error(FJSVM *vm, const char *fmt, ...);
void log_line(FJSVM *vm, int32_t level, const char *msg, int32_t len);
std::string format_exception(FJSVM *vm, JSValue exc);
/* Clears the pending exception, records + logs it. Returns false. */
bool fail_with_pending_exception(FJSVM *vm, const char *where);

/* natives.cpp: installs `console` and `__fjs` on the global object. */
bool install_natives(FJSVM *vm);

/* value.cpp: FJSValue (C ABI tagged value) <-> JSValue conversion.
 * to_fjs_value: string pointers are QuickJS-owned, valid until the
 *   matching fjs_free_abi_value() (ref-holding for strings).
 * from_fjs_value: consumes malloc'ed strings (free()d here). */
bool to_fjs_value(FJSVM *vm, JSValueConst v, FJSValue *out);
void fjs_free_abi_value(FJSVM *vm, FJSValue *v);
JSValue from_fjs_value(FJSVM *vm, const FJSValue *v);

} // namespace fjs

#endif /* FJS_INTERNAL_H */
