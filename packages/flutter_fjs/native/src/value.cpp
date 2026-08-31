/*
 * FJSValue (C ABI tagged value) <-> QuickJS JSValue conversion.
 *
 * JS -> host direction: strings are converted to utf8 via JS_ToCStringLen
 * and stay owned by a per-call stack; the host must consume them before
 * returning (the JSI contract: no copies, no cross-call ownership).
 *
 * Host -> JS direction: strings arriving in FJSValue are malloc'ed by the
 * host; we copy into a JS string and free() the buffer here.
 */
#include "fjs_internal.h"

#include <cstdlib>

namespace fjs {

bool to_fjs_value(FJSVM *vm, JSValueConst v, FJSValue *out) {
    JSContext *ctx = vm->ctx;
    if (out == nullptr) return false;
    out->tag = FJS_T_NULL;
    out->len = 0;
    out->d = 0;

    if (JS_IsNull(v) || JS_IsUndefined(v)) {
        return true;
    }
    if (JS_IsBool(v)) {
        out->tag = FJS_T_BOOL;
        out->i = JS_ToBool(ctx, v) ? 1 : 0;
        return true;
    }
    if (JS_IsNumber(v)) {
        double d;
        if (JS_ToFloat64(ctx, &d, v) != 0) return false;
        out->tag = FJS_T_FLOAT64;
        out->d = d;
        return true;
    }
    if (JS_IsString(v)) {
        size_t len = 0;
        const char *s = JS_ToCStringLen(ctx, &len, v);
        if (!s) return false;
        out->tag = FJS_T_STRING;
        out->s = s; /* freed by fjs_free_abi_value */
        out->len = (int32_t)len;
        return true;
    }
    /* objects/functions/etc. cross as their string form for v1 —
     * structured object handles are on the roadmap (docs/roadmap.md). */
    size_t len = 0;
    const char *s = JS_ToCStringLen(ctx, &len, v);
    if (!s) return false;
    out->tag = FJS_T_STRING;
    out->s = s;
    out->len = (int32_t)len;
    return true;
}

void fjs_free_abi_value(FJSVM *vm, FJSValue *v) {
    if (v && v->tag == FJS_T_STRING && v->s) {
        JS_FreeCString(vm->ctx, v->s);
        v->s = nullptr;
    }
    v->tag = FJS_T_NULL;
}

JSValue from_fjs_value(FJSVM *vm, const FJSValue *v) {
    JSContext *ctx = vm->ctx;
    if (!v) return JS_UNDEFINED;
    switch (v->tag) {
        case FJS_T_BOOL:  return JS_NewBool(ctx, v->i != 0);
        case FJS_T_INT32: return JS_NewInt32(ctx, v->i);
        case FJS_T_FLOAT64: return JS_NewFloat64(ctx, v->d);
        case FJS_T_STRING: {
            JSValue s = v->s
                            ? JS_NewStringLen(ctx, v->s, (size_t)v->len)
                            : JS_NewString(ctx, "");
            free((void *)v->s); /* host malloc'ed — contract in fjs.h */
            return s;
        }
        default: return JS_UNDEFINED;
    }
}

} // namespace fjs
