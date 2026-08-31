/*
 * fjsc — fjs bytecode compiler (part of the toolchain).
 *
 *   fjsc <input.js> <output.fjsbundle>
 *
 * Produces a .fjsbundle whose QuickJS bytecode is guaranteed to match the
 * engine this project embeds (same vendored quickjs-ng). The `fjs` npm CLI
 * shells out to this binary for `--bytecode` builds; see docs/toolchain.md.
 */
#include "fjs.h"

#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>
#include <vector>

#ifdef _WIN32
#include <io.h>
#define FJS_READ_BINARY "rb"
#define FJS_WRITE_BINARY "wb"
#else
#include <unistd.h>
#define FJS_READ_BINARY "rb"
#define FJS_WRITE_BINARY "wb"
#endif

static bool read_file(const char *path, std::vector<uint8_t> *out) {
    FILE *f = fopen(path, FJS_READ_BINARY);
    if (!f) return false;
    fseek(f, 0, SEEK_END);
    long size = ftell(f);
    fseek(f, 0, SEEK_SET);
    if (size < 0) { fclose(f); return false; }
    out->resize((size_t)size);
    size_t got = fread(out->data(), 1, (size_t)size, f);
    fclose(f);
    return got == (size_t)size;
}

static bool write_file(const char *path, const uint8_t *data, int32_t len) {
    FILE *f = fopen(path, FJS_WRITE_BINARY);
    if (!f) return false;
    size_t wrote = fwrite(data, 1, (size_t)len, f);
    fclose(f);
    return wrote == (size_t)len;
}

int main(int argc, char **argv) {
    if (argc != 3) {
        fprintf(stderr, "usage: fjsc <input.js> <output.fjsbundle>\n");
        fprintf(stderr, "  engine: %s (abi %d)\n", fjs_engine_id(), fjs_abi_version());
        return 2;
    }
    std::vector<uint8_t> src;
    if (!read_file(argv[1], &src)) {
        fprintf(stderr, "fjsc: cannot read %s\n", argv[1]);
        return 1;
    }

    FJSVM *vm = fjs_vm_create();
    if (!vm) {
        fprintf(stderr, "fjsc: failed to create VM\n");
        return 1;
    }

    int32_t need = fjs_compile_bundle(vm, src.data(), (int32_t)src.size(),
                                      nullptr, 0);
    if (need <= 0) {
        fprintf(stderr, "fjsc: compile failed:\n%s\n", fjs_last_error(vm));
        fjs_vm_destroy(vm);
        return 1;
    }
    std::vector<uint8_t> bundle((size_t)need);
    int32_t wrote = fjs_compile_bundle(vm, src.data(), (int32_t)src.size(),
                                       bundle.data(), (int32_t)bundle.size());
    fjs_vm_destroy(vm);
    if (wrote != need) {
        fprintf(stderr, "fjsc: internal error writing bundle\n");
        return 1;
    }
    if (!write_file(argv[2], bundle.data(), wrote)) {
        fprintf(stderr, "fjsc: cannot write %s\n", argv[2]);
        return 1;
    }
    printf("fjsc: %s -> %s (%d bytes, engine %s)\n",
           argv[1], argv[2], wrote, fjs_engine_id());
    return 0;
}
