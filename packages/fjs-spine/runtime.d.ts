// invokeHost's scalar boundary and the __fjs* globals are ambient in the
// runtime (native-global.d.ts); a module that calls into the host needs the
// same declarations the app gets from its fjs-global.d.ts.
/// <reference types="@ufjs/runtime/ambient" />
