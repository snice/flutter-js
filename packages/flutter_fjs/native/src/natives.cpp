/*
 * Native (host) functions installed on the JS global object:
 *
 *   console.log/info/warn/error/debug(...)
 *   __fjs.setTimeout(cb, ms) / clearTimeout(id)
 *   __fjs.setInterval(cb, ms) / clearInterval(id)
 *   __fjs.uiOps(u8ArrayOrArrayBuffer)   — batched UI op buffer -> host
 *   __fjs.invokeHost(name, ...args)     — synchronous host-module call (JSI)
 *   __fjs.nowMs()
 *   __fjs.gc()                          — collect now; returns heap before/after
 *   __fjs.engine                        — { engineId, abiVersion }
 *   __fjs.natives.fibonacci(n)          — demo C++ JSI module
 *
 * Everything here receives raw JSValues from QuickJS — this is the
 * direct JS<->C++ channel, equivalent in spirit to RN's JSI HostFunctions.
 */
#include "fjs_internal.h"

#include <cmath>
#include <cstring>
#include <string>

namespace {

JSValue fjs_fail(FJSVM *vm, const char *msg) {
    return JS_ThrowTypeError(vm->ctx, "%s", msg);
}

/* ---- console --------------------------------------------------------- */

JSValue console_print(FJSVM *vm, int32_t level, int argc, JSValueConst *argv) {
    std::string line;
    for (int i = 0; i < argc; i++) {
        size_t len = 0;
        const char *s = JS_ToCStringLen(vm->ctx, &len, argv[i]);
        if (!s) return JS_EXCEPTION;
        if (i > 0) line += ' ';
        line.append(s, len);
        JS_FreeCString(vm->ctx, s);
    }
    fjs::log_line(vm, level, line.c_str());
    return JS_UNDEFINED;
}

#define CONSOLE_FN(name, LEVEL)                                                \
    static JSValue js_console_##name(JSContext *ctx, JSValueConst this_val,    \
                                     int argc, JSValueConst *argv) {           \
        (void)this_val;                                                        \
        FJSVM *vm = (FJSVM *)JS_GetContextOpaque(ctx);                         \
        return console_print(vm, LEVEL, argc, argv);                           \
    }

CONSOLE_FN(log, FJS_LOG_INFO)
CONSOLE_FN(debug, FJS_LOG_DEBUG)
CONSOLE_FN(info, FJS_LOG_INFO)
CONSOLE_FN(warn, FJS_LOG_WARN)
CONSOLE_FN(error, FJS_LOG_ERROR)

/* ---- timers ----------------------------------------------------------- */

static JSValue js_set_timeout(JSContext *ctx, JSValueConst this_val, int argc,
                              JSValueConst *argv) {
    (void)this_val;
    FJSVM *vm = (FJSVM *)JS_GetContextOpaque(ctx);
    if (argc < 1 || !JS_IsFunction(ctx, argv[0]))
        return fjs_fail(vm, "setTimeout(callback, ms): callback required");
    double ms = 0;
    if (argc >= 2) JS_ToFloat64(ctx, &ms, argv[1]);
    if (ms < 0) ms = 0;

    Timer t{};
    t.id = vm->next_timer_id++;
    t.interval = false;
    t.next_ms = fjs::now_ms(vm) + ms;
    t.interval_ms = 0;
    t.callback = JS_DupValue(ctx, argv[0]);
    vm->timers.push_back(t);
    return JS_NewInt32(ctx, t.id);
}

static JSValue js_set_interval(JSContext *ctx, JSValueConst this_val, int argc,
                               JSValueConst *argv) {
    (void)this_val;
    FJSVM *vm = (FJSVM *)JS_GetContextOpaque(ctx);
    if (argc < 1 || !JS_IsFunction(ctx, argv[0]))
        return fjs_fail(vm, "setInterval(callback, ms): callback required");
    double ms = 0;
    if (argc >= 2) JS_ToFloat64(ctx, &ms, argv[1]);
    if (ms < 1) ms = 1; /* no busy loops */

    Timer t{};
    t.id = vm->next_timer_id++;
    t.interval = true;
    t.next_ms = fjs::now_ms(vm) + ms;
    t.interval_ms = ms;
    t.callback = JS_DupValue(ctx, argv[0]);
    vm->timers.push_back(t);
    return JS_NewInt32(ctx, t.id);
}

static bool clear_timer(FJSVM *vm, int argc, JSValueConst *argv) {
    if (argc < 1) return false;
    int32_t id = 0;
    if (JS_ToInt32(vm->ctx, &id, argv[0]) != 0) return false;
    for (auto it = vm->timers.begin(); it != vm->timers.end(); ++it) {
        if (it->id == id) {
            JS_FreeValue(vm->ctx, it->callback);
            vm->timers.erase(it);
            return true;
        }
    }
    return false;
}

static JSValue js_clear_timer(JSContext *ctx, JSValueConst this_val, int argc,
                              JSValueConst *argv) {
    (void)this_val;
    FJSVM *vm = (FJSVM *)JS_GetContextOpaque(ctx);
    clear_timer(vm, argc, argv);
    return JS_UNDEFINED;
}

/* ---- UI op buffer ------------------------------------------------------ */

static JSValue js_ui_ops(JSContext *ctx, JSValueConst this_val, int argc,
                         JSValueConst *argv) {
    (void)this_val;
    FJSVM *vm = (FJSVM *)JS_GetContextOpaque(ctx);
    if (argc < 1) return fjs_fail(vm, "uiOps(buffer) requires an argument");
    if (!vm->on_ui_ops) return JS_UNDEFINED; /* no host attached yet */

    JSValueConst buf = argv[0];
    size_t size = 0;
    uint8_t *bytes = nullptr;
    if (JS_IsObject(buf)) {
        /* ArrayBuffer directly */
        size_t asize = 0;
        uint8_t *abuf = JS_GetArrayBuffer(ctx, &asize, buf);
        if (abuf) {
            bytes = abuf;
            size = asize;
        } else {
            /* typed array (e.g. Uint8Array): read view over its buffer */
            JSValue bo2 = JS_GetPropertyStr(ctx, buf, "byteOffset");
            JSValue bl = JS_GetPropertyStr(ctx, buf, "byteLength");
            JSValue ab = JS_GetPropertyStr(ctx, buf, "buffer");
            uint32_t byteOffset = 0;
            int64_t byteLength = 0;
            if (!JS_IsException(bo2) && !JS_IsException(bl) &&
                JS_ToUint32(ctx, &byteOffset, bo2) == 0 &&
                JS_ToInt64(ctx, &byteLength, bl) == 0) {
                size_t basize = 0;
                uint8_t *base = JS_GetArrayBuffer(ctx, &basize, ab);
                if (base && byteOffset + byteLength <= (int64_t)basize) {
                    bytes = base + byteOffset;
                    size = (size_t)byteLength;
                }
            }
            JS_FreeValue(ctx, bo2);
            JS_FreeValue(ctx, bl);
            JS_FreeValue(ctx, ab);
        }
    }
    if (!bytes) return fjs_fail(vm, "uiOps expects a Uint8Array/ArrayBuffer");
    /* The host copies synchronously inside the callback. */
    vm->on_ui_ops(bytes, (int32_t)size);
    return JS_UNDEFINED;
}

/* ---- synchronous host-module invocation (JSI) --------------------------- */

static JSValue js_invoke_host(JSContext *ctx, JSValueConst this_val, int argc,
                              JSValueConst *argv) {
    (void)this_val;
    FJSVM *vm = (FJSVM *)JS_GetContextOpaque(ctx);
    if (argc < 1 || !JS_IsString(argv[0]))
        return fjs_fail(vm, "invokeHost(name, ...args): name required");
    if (!vm->on_invoke_host)
        return fjs_fail(vm, "no host module handler installed");

    size_t name_len = 0;
    const char *name = JS_ToCStringLen(ctx, &name_len, argv[0]);
    if (!name) return JS_EXCEPTION;

    int32_t nargs = argc - 1;
    FJSValue *cargs = nullptr;
    if (nargs > 0) {
        cargs = (FJSValue *)calloc((size_t)nargs, sizeof(FJSValue));
        if (!cargs) {
            JS_FreeCString(ctx, name);
            return JS_EXCEPTION;
        }
        for (int32_t i = 0; i < nargs; i++) {
            if (!fjs::to_fjs_value(vm, argv[1 + i], &cargs[i])) {
                for (int32_t k = 0; k < i; k++) fjs::fjs_free_abi_value(vm, &cargs[k]);
                free(cargs);
                JS_FreeCString(ctx, name);
                return JS_EXCEPTION;
            }
        }
    }

    FJSValue out{};
    int32_t rc = vm->on_invoke_host(name, nargs, cargs, &out);

    /* free converted args (string ptrs owned by QuickJS) */
    for (int32_t i = 0; i < nargs; i++) fjs::fjs_free_abi_value(vm, &cargs[i]);
    free(cargs);
    JS_FreeCString(ctx, name);

    if (rc != 0) {
        fjs::fjs_free_abi_value(vm, &out);
        return fjs_fail(vm, "host module call failed"); /* host sets details */
    }
    return fjs::from_fjs_value(vm, &out); /* consumes malloc'ed strings */
}

/* ---- misc --------------------------------------------------------------- */

static JSValue js_now_ms(JSContext *ctx, JSValueConst this_val, int argc,
                         JSValueConst *argv) {
    (void)this_val; (void)argc; (void)argv;
    FJSVM *vm = (FJSVM *)JS_GetContextOpaque(ctx);
    return JS_NewFloat64(ctx, fjs::now_ms(vm));
}

/* Collects now, and reports what the heap looked like on either side.
 *
 * QuickJS collects when an object allocation crosses a threshold, and the
 * threshold is recomputed as live*1.5 after every collection — so a
 * collection lands wherever the allocation happens to cross it, which on a
 * busy frame is in the middle of the work the user is watching. Handing the
 * decision to the host is the first step to moving it somewhere idle. */
static JSValue js_gc(JSContext *ctx, JSValueConst this_val, int argc,
                     JSValueConst *argv) {
    (void)this_val; (void)argc; (void)argv;
    JSRuntime *rt = JS_GetRuntime(ctx);
    JSMemoryUsage before, after;
    JS_ComputeMemoryUsage(rt, &before);
    JS_RunGC(rt);
    JS_ComputeMemoryUsage(rt, &after);
    JSValue out = JS_NewObject(ctx);
    JS_SetPropertyStr(ctx, out, "before", JS_NewInt64(ctx, before.malloc_size));
    JS_SetPropertyStr(ctx, out, "after", JS_NewInt64(ctx, after.malloc_size));
    JS_SetPropertyStr(ctx, out, "objects", JS_NewInt64(ctx, after.obj_count));
    return out;
}

static JSValue js_toast(JSContext *ctx, JSValueConst this_val, int argc,
                        JSValueConst *argv) {
    (void)this_val;
    FJSVM *vm = (FJSVM *)JS_GetContextOpaque(ctx);
    if (argc < 1 || !vm->on_toast) return JS_UNDEFINED;
    size_t len = 0;
    const char *msg = JS_ToCStringLen(ctx, &len, argv[0]);
    if (!msg) return JS_EXCEPTION;
    vm->on_toast(msg, (int32_t)len);
    JS_FreeCString(ctx, msg);
    return JS_UNDEFINED;
}

/* ---- demo native module: fibonacci (pure C++, called straight from JS) -- */

static int64_t fib(int64_t n) { return n < 2 ? n : fib(n - 1) + fib(n - 2); }

static JSValue js_fibonacci(JSContext *ctx, JSValueConst this_val, int argc,
                            JSValueConst *argv) {
    (void)this_val;
    if (argc < 1) return JS_ThrowTypeError(ctx, "fibonacci(n) requires n");
    int64_t n = 0;
    if (JS_ToInt64(ctx, &n, argv[0]) != 0)
        return JS_ThrowTypeError(ctx, "fibonacci(n): n must be an integer");
    if (n < 0 || n > 45)
        return JS_ThrowRangeError(ctx, "fibonacci(n): n out of range [0, 45]");
    return JS_NewInt64(ctx, fib(n));
}

static JSValue js_engine_info(JSContext *ctx, JSValueConst this_val, int argc,
                              JSValueConst *argv) {
    (void)this_val; (void)argc; (void)argv;
    FJSVM *vm = (FJSVM *)JS_GetContextOpaque(ctx);
    JSValue obj = JS_NewObject(ctx);
    JS_SetPropertyStr(ctx, obj, "engineId", JS_NewString(ctx, fjs_engine_id()));
    JS_SetPropertyStr(ctx, obj, "abiVersion", JS_NewInt32(ctx, fjs_abi_version()));
    (void)vm;
    return obj;
}

} // namespace

namespace fjs {

bool install_natives(FJSVM *vm) {
    JSContext *ctx = vm->ctx;
    JS_SetContextOpaque(ctx, vm);

    JSValue global = JS_GetGlobalObject(ctx);

    /* console */
    JSValue console = JS_NewObject(ctx);
    JS_SetPropertyStr(ctx, console, "log", JS_NewCFunction(ctx, js_console_log, "log", 1));
    JS_SetPropertyStr(ctx, console, "debug", JS_NewCFunction(ctx, js_console_debug, "debug", 1));
    JS_SetPropertyStr(ctx, console, "info", JS_NewCFunction(ctx, js_console_info, "info", 1));
    JS_SetPropertyStr(ctx, console, "warn", JS_NewCFunction(ctx, js_console_warn, "warn", 1));
    JS_SetPropertyStr(ctx, console, "error", JS_NewCFunction(ctx, js_console_error, "error", 1));
    JS_SetPropertyStr(ctx, global, "console", console);

    /* __fjs */
    JSValue fns = JS_NewObject(ctx);
    JS_SetPropertyStr(ctx, fns, "setTimeout", JS_NewCFunction(ctx, js_set_timeout, "setTimeout", 2));
    JS_SetPropertyStr(ctx, fns, "clearTimeout", JS_NewCFunction(ctx, js_clear_timer, "clearTimeout", 1));
    JS_SetPropertyStr(ctx, fns, "setInterval", JS_NewCFunction(ctx, js_set_interval, "setInterval", 2));
    JS_SetPropertyStr(ctx, fns, "clearInterval", JS_NewCFunction(ctx, js_clear_timer, "clearInterval", 1));
    JS_SetPropertyStr(ctx, fns, "uiOps", JS_NewCFunction(ctx, js_ui_ops, "uiOps", 1));
    JS_SetPropertyStr(ctx, fns, "invokeHost", JS_NewCFunction(ctx, js_invoke_host, "invokeHost", 1));
    JS_SetPropertyStr(ctx, fns, "nowMs", JS_NewCFunction(ctx, js_now_ms, "nowMs", 0));
    JS_SetPropertyStr(ctx, fns, "toast", JS_NewCFunction(ctx, js_toast, "toast", 1));
    JS_SetPropertyStr(ctx, fns, "gc", JS_NewCFunction(ctx, js_gc, "gc", 0));
    JS_SetPropertyStr(ctx, fns, "engine", js_engine_info(ctx, JS_UNDEFINED, 0, nullptr));

    JSValue root = JS_NewObject(ctx);
    JS_SetPropertyStr(ctx, root, "fns", fns);
    /* expose demo natives directly for discoverability */
    JSValue natives = JS_NewObject(ctx);
    JS_SetPropertyStr(ctx, natives, "fibonacci",
                      JS_NewCFunction(ctx, js_fibonacci, "fibonacci", 1));
    JS_SetPropertyStr(ctx, root, "natives", natives);
    JS_SetPropertyStr(ctx, root, "engine", js_engine_info(ctx, JS_UNDEFINED, 0, nullptr));
    JS_SetPropertyStr(ctx, global, "__fjs", root);

    JS_FreeValue(ctx, global);
    return true;
}

} // namespace fjs
