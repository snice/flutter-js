// Dev-only module registry behind `fjs dev`'s module-level hot reload
// (spec 037). Split dev builds give every shared app module its own unit:
// the CLI wraps it as `__fjsDefineUnit(id, factory)` and rewrites every
// import of a registry module to `__fjsRequireUnit(id)`. A hot swap then
// re-evaluates the changed units in the same VM and their importers pick
// up the new exports through this table.
//
// Everything here lives on globalThis because the generated stub code runs
// inside QuickJS-evaluated files that have no import path back to this
// module. Release and web builds never generate any of it, so this file is
// dead weight there and must not touch the native host.
//
// Factories run lazily — on the first require, not at registration. That
// is what keeps `modules.js` (all units in one file, registration only)
// safe with circular imports: the cycle resolves through partial exports
// exactly the way CommonJS does. The CLI's hot-swap files append an eager
// `__fjsRequireUnit(id)` to force a changed unit's factory to run again.

export type FjsUnitRequire = (id: string) => unknown;
export type FjsUnitFactory = (
  require: FjsUnitRequire,
  module: { exports: unknown },
  exports: unknown,
) => void;

interface FjsUnit {
  factory: FjsUnitFactory | null;
  /** Set while the factory is running: a require cycle landing back here
   * must see the in-progress `module.exports`, the way CommonJS does. */
  pending: { exports: unknown } | null;
  exports: unknown;
}

const units = (((globalThis as Record<string, unknown>).__FJS_MODULES ??=
  {}) as Record<string, FjsUnit>);

/** Same warn-once channel as the rest of the runtime, minus the import. */
const warned = new Set<string>();
function warnOnce(key: string, message: string): void {
  if (warned.has(key)) return;
  warned.add(key);
  console.warn(`[fjs] ${message}`);
}

/** Registers (or replaces, on a hot swap) a unit's factory. The factory
 * runs once per registration, on the first require. Replacing a unit does
 * NOT re-run its importers — the CLI owns that: a hot swap re-evaluates
 * the changed unit plus every transitive importer, in dependency order. */
export function defineUnit(id: string, factory: FjsUnitFactory): void {
  units[id] = { factory, pending: null, exports: undefined };
}

/** CommonJS-style require of one registry unit. A missing id is loud, not
 * an empty module: it means the host evaluated code whose dependencies it
 * did not load first (a bootstrap/deps.json bug), and returning {} would
 * corrupt the module graph far away from the cause (constitution V). */
export function requireUnit(id: string): unknown {
  const unit = units[id];
  if (!unit) {
    warnOnce(
      `unit:${id}`,
      `dev unit "${id}" is not loaded — the host will fall back to a full reload`,
    );
    throw new Error(`[fjs] dev unit "${id}" is not loaded`);
  }
  if (unit.pending) return unit.pending.exports;
  if (unit.factory) {
    const factory = unit.factory;
    // null out BEFORE running: a require cycle comes back here and must
    // see the partial-exports state, not recurse forever
    unit.factory = null;
    const module = { exports: {} as unknown };
    unit.pending = module;
    factory(requireUnit, module, module.exports);
    unit.pending = null;
    unit.exports = module.exports;
    return module.exports;
  }
  return unit.exports;
}

/** Test / introspection hook: whether the unit's factory has run. */
export function isUnitEvaluated(id: string): boolean {
  const unit = units[id];
  return !!unit && unit.factory === null;
}

const g = globalThis as Record<string, unknown>;
g.__fjsDefineUnit = defineUnit;
g.__fjsRequireUnit = requireUnit;
