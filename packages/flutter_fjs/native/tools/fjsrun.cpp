/*
 * fjsrun — offline harness: runs a source file or .fjsbundle with the fjs
 * native core, prints console output and decodes UI op frames to stdout.
 * Lets you verify app bundles without launching Flutter:
 *
 *   fjsrun dist/bundle.js          # source mode
 *   fjsrun dist/app.fjsbundle      # bytecode mode
 *   fjsrun --pump 2000 dist/bundle.js   # keep pumping timers for 2s
 */
#include "fjs.h"

#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>
#include <vector>

static void dump_ops(const uint8_t *ops, int32_t len) {
    printf("--- ui frame (%d bytes) ---\n", len);
    int p = 0;
    auto need = [&](int n) {
        if (p + n > len) { printf("  truncated\n"); p = len + 1; return false; }
        return true;
    };
    auto u32 = [&]() -> uint32_t {
        uint32_t v = ops[p] | (ops[p+1] << 8) | (ops[p+2] << 16) | ((uint32_t)ops[p+3] << 24);
        p += 4; return v;
    };
    auto u16 = [&]() -> uint16_t {
        uint16_t v = ops[p] | (ops[p+1] << 8); p += 2; return v;
    };
    while (p < len) {
        uint8_t op = ops[p++];
        switch (op) {
            case 1: { if (!need(6)) return; uint32_t id = u32(); uint16_t tl = u16();
                      if (!need(tl)) return;
                      printf("create #%u tag=%.*s\n", id, tl, (const char *)ops + p); p += tl; break; }
            case 2: { if (!need(4)) return; printf("remove #%u\n", u32()); break; }
            case 3: { if (!need(12)) return; uint32_t a = u32(), b = u32(), c = u32();
                      printf("insert parent=#%u child=#%u index=%u\n", a, b, c); break; }
            case 4: { if (!need(8)) return; uint32_t a = u32(), b = u32();
                      printf("removeChild parent=#%u child=#%u\n", a, b); break; }
            case 5: { if (!need(8)) return; uint32_t id = u32(), l = u32();
                      if (!need((int)l)) return;
                      printf("setText #%u = %.*s\n", id, (int)l, (const char *)ops + p); p += l; break; }
            case 6: { if (!need(8)) return; uint32_t id = u32(), l = u32();
                      if (!need((int)l)) return;
                      printf("setProps #%u = %.*s\n", id, (int)l, (const char *)ops + p); p += l; break; }
            default: printf("unknown op %u at %d\n", op, p - 1); return;
        }
    }
}

static void on_log(int32_t level, const char *msg, int32_t len) {
    printf("[log %d] %.*s\n", level, len, msg);
}
static int g_hex = 0;
static void on_ui_ops(const uint8_t *ops, int32_t len) {
    if (g_hex) {
        printf("--- ui frame raw (%d bytes) ---\n", len);
        for (int32_t i = 0; i < len && i < 48; i++) {
            printf("%02x ", ops[i]);
            if ((i + 1) % 16 == 0) printf("\n");
        }
        printf("\n");
    }
    dump_ops(ops, len);
}
static int32_t on_invoke_host(const char *name, int32_t argc,
                              const FJSValue *args, FJSValue *out) {
    /* delegate to the built-in demo natives is unnecessary here; report */
    std::string msg = std::string("invokeHost('") + name + "') has no handler in fjsrun";
    out->tag = FJS_T_STRING;
    out->s = strdup(msg.c_str());
    out->len = (int32_t)msg.size();
    return 0;
}

int main(int argc, char **argv) {
    int pump_ms = 0;
    int tap_id = -1;
    const char *tap_text = nullptr;
    std::vector<const char *> paths;
    /* action sequence: repeatable --tap/--pump steps executed in order */
    struct Action { enum { Tap, Pump } kind; int id; int ms; const char *text; };
    std::vector<Action> actions;
    for (int i = 1; i < argc; i++) {
        if (!strcmp(argv[i], "--pump") && i + 1 < argc)
            actions.push_back({Action::Pump, 0, atoi(argv[++i]), nullptr});
        else if (!strcmp(argv[i], "--tap") && i + 1 < argc)
            actions.push_back({Action::Tap, atoi(argv[++i]), 0, nullptr});
        else if (!strcmp(argv[i], "--tap-text") && i + 1 < argc && !actions.empty())
            actions.back().text = argv[++i];
        else if (!strcmp(argv[i], "--hex")) g_hex = 1;
        else paths.push_back(argv[i]);
    }
    if (paths.size() != 1) {
        fprintf(stderr, "usage: fjsrun [--pump ms] [--tap node-id] <bundle.js | app.fjsbundle>\n");
        return 2;
    }

    FILE *f = fopen(paths[0], "rb");
    if (!f) { fprintf(stderr, "fjsrun: cannot open %s\n", paths[0]); return 1; }
    fseek(f, 0, SEEK_END); long size = ftell(f); fseek(f, 0, SEEK_SET);
    std::vector<uint8_t> data((size_t)size + 1, 0); /* +1: NUL for eval */
    if (fread(data.data(), 1, (size_t)size, f) != (size_t)size) {
        fprintf(stderr, "fjsrun: read failed\n");
        fclose(f);
        return 1;
    }
    fclose(f);

    FJSVM *vm = fjs_vm_create();
    fjs_set_callbacks(vm, on_log, on_ui_ops, on_invoke_host);

    const bool is_bundle = size >= 4 && data[0] == 'F' && data[1] == 'J' && data[2] == 'S' && data[3] == 'B';
    int32_t rc;
    const char *filename = is_bundle ? paths[0] : "app.js";
    if (is_bundle) {
        rc = fjs_vm_eval_bundle(vm, data.data(), (int32_t)size);
    } else {
        rc = fjs_vm_eval_source(vm, data.data(), (int32_t)size, filename);
    }
    if (rc != 0) {
        fprintf(stderr, "fjsrun: %s\n", fjs_last_error(vm));
        fjs_vm_destroy(vm);
        return 1;
    }

    for (const auto &act : actions) {
        if (act.kind == Action::Tap) {
            printf("--- tap #%d%s ---\n", act.id, act.text ? " (text)" : "");
            if (act.text) {
                fjs_vm_dispatch_event(vm, act.id, 3, (const uint8_t *)act.text,
                                      (int32_t)strlen(act.text));
            } else {
                fjs_vm_dispatch_event(vm, act.id, 1, nullptr, 0);
            }
        } else {
            int64_t start = fjs_vm_now(vm);
            while (fjs_vm_now(vm) - start < act.ms) {
                fjs_vm_pump(vm, fjs_vm_now(vm));
                struct timespec ts = {0, 2 * 1000 * 1000}; /* 2ms */
                nanosleep(&ts, nullptr);
            }
        }
    }
    fjs_vm_destroy(vm);
    return 0;
}
