// The wevu-style component shell: runs an SFC's setup(), keeps the returned
// bindings in a @vue/reactivity-tracked snapshot, and diffs that snapshot
// into setData on every change (microtask-batched). Templates are WXML and
// never render through Vue — this file is the entire "runtime" a compiled
// SFC needs.
//
// Shape of the compiler output this expects (`script.ts` in @ufjs/cli):
//
//   const __sfc__ = {
//     __name: 'switch-page',
//     props: { title: null },          // from defineProps, or absent
//     setup(__props) {
//       ...user code...
//       const __ev0 = ($event) => ...; // extracted inline handlers
//       const __d0 = computed(() => ...); // extracted expressions
//       const __returned__ = { wifi, push, __ev0, __d0 };
//       Object.defineProperty(__returned__, '__isScriptSetup', {...});
//       return __returned__;
//     },
//   };
//   __createWevuComponent(__sfc__);
import {
  effectScope,
  reactive,
  watch,
  type Ref,
} from '@vue/reactivity';
import {
  __withInstanceHooks,
  runHooks,
  type HookType,
  type Hooks,
} from './vue';
import { adaptEvent, type NormalizedEvent } from './events';

/** Minimal structural type of the mini-program Component instance (`this`)
 * we attach our state to. Declared loosely on purpose: the real host is
 * WeChat's, which we don't ship types for. */
interface MpInstance {
  data: Record<string, unknown>;
  setData(patch: Record<string, unknown>): void;
  triggerEvent(name: string, detail?: unknown): void;
  [key: string]: unknown;
}

/** The compileScript product (a defineComponent options object), typed
 * loosely — the mp shell only needs setup/props/__name. */
export interface WevuSfc {
  __name?: string;
  props?: Record<string, unknown> | string[];
  setup?: (props: Record<string, unknown>, ctx: WevuSetupCtx) => unknown;
  /** Compiler-injected: exactly the setup bindings the template reads in
   * expressions. When present, setData is narrowed to these keys — event
   * handler bindings (a router object) never become data. */
  __fjsData?: string[];
}

export interface WevuSetupCtx {
  attrs: Record<string, unknown>;
  emit: (event: string, ...args: unknown[]) => void;
  expose: (exposed?: Record<string, unknown>) => void;
}

interface InstanceState {
  fns: Record<string, (...args: unknown[]) => unknown>;
  returned: Record<string, unknown>;
  hooks: Hooks;
  scope: ReturnType<typeof effectScope>;
  stopWatch: () => void;
  props: Record<string, unknown>;
}

const MOUNTED: HookType = 'mounted';

function propNames(sfc: WevuSfc): string[] {
  const raw = sfc.props;
  if (!raw) return [];
  return Array.isArray(raw) ? raw : Object.keys(raw);
}

/** Deep-walks a binding value into a plain (non-reactive) snapshot, reading
 * everything on the way so the watcher tracks nested mutations too —
 * unlike a vdom render, nothing else walks the data for us. */
function snapshot(value: unknown, seen: Set<object>): unknown {
  if (value === null || typeof value !== 'object') return value ?? null;
  const obj = value as object;
  if (seen.has(obj)) return '[circular]';
  seen.add(obj);
  try {
    if ((value as { __v_isRef?: boolean }).__v_isRef === true) {
      return snapshot((value as Ref<unknown>).value, seen);
    }
    if (Array.isArray(value)) {
      return (value as unknown[]).map((v) => snapshot(v, seen));
    }
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = snapshot(v, seen);
    }
    return out;
  } finally {
    seen.delete(obj);
  }
}

function shallowDiff(
  prev: Record<string, unknown>,
  next: Record<string, unknown>,
): Record<string, unknown> | null {
  const patch: Record<string, unknown> = {};
  let changed = false;
  for (const key of Object.keys(next)) {
    if (!deepEqual(prev[key], next[key])) {
      patch[key] = next[key];
      changed = true;
    }
  }
  return changed ? patch : null;
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return false;
  if (typeof a !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a as object);
  const kb = Object.keys(b as object);
  if (ka.length !== kb.length) return false;
  for (const k of ka) {
    if (
      !deepEqual(
        (a as Record<string, unknown>)[k],
        (b as Record<string, unknown>)[k],
      )
    )
      return false;
  }
  return true;
}

/** Wires one mini-program instance to one SFC. Called from the `attached`
 * lifetime, or page `onLoad` for pages — a page root is both, so this is
 * idempotent (first caller wins). */
function mountInstance(self: MpInstance, sfc: WevuSfc): void {
  if (self.__fjs_state) return;
  const names = propNames(sfc);
  // props live in a reactive object so computeds that read props re-run
  // when a parent updates them (observers keep it in sync with this.data)
  const props = reactive(
    Object.fromEntries(names.map((n) => [n, self.data[n] ?? null])),
  ) as Record<string, unknown>;
  self.__fjs_props = props;

  const hooks: Hooks = {};
  const scope = effectScope(true);
  const ctx: WevuSetupCtx = {
    attrs: {},
    emit: (event, ...args) => self.triggerEvent(event, args.length === 1 ? args[0] : args),
    expose: () => {},
  };

  let returned: Record<string, unknown> = {};
  __withInstanceHooks(hooks, () => {
    scope.run(() => {
      try {
        const r = sfc.setup?.(props, ctx);
        if (r && typeof r === 'object') returned = r as Record<string, unknown>;
      } catch (err) {
        console.error(`[fjs/wx] setup failed in ${sfc.__name ?? '<anonymous>'}:`, err);
      }
    });
  });

  // script setup's __returned__ carries a non-enumerable marker; hide any
  // other non-function state that must not reach setData (functions become
  // event targets, everything else becomes template data)
  const fns: Record<string, (...args: unknown[]) => unknown> = {};
  const dataKeys: string[] = [];
  const dataFilter = sfc.__fjsData;
  for (const [k, v] of Object.entries(returned)) {
    if (typeof v === 'function') fns[k] = v as (...args: unknown[]) => unknown;
    else if (!dataFilter || dataFilter.includes(k)) dataKeys.push(k);
  }
  self.__fjs_fns = fns;
  self.__fjs_returned = returned;
  self.__fjs_hooks = hooks;

  let prev: Record<string, unknown> = {};
  const render = (): Record<string, unknown> => {
    const next: Record<string, unknown> = {};
    for (const k of dataKeys) {
      next[k] = snapshot(returned[k], new Set());
    }
    return next;
  };
  // watch() (not effect()) so the callback only fires when a tracked dep
  // changed — the getter builds the full snapshot each run, which doubles
  // as the deep dependency scan. Data stays untouched until the first diff.
  const stopWatch = scope.run(() =>
    watch(render, (next) => {
      const patch = shallowDiff(prev, next as Record<string, unknown>);
      if (patch) {
        prev = next as Record<string, unknown>;
        self.setData(patch);
      }
    }),
  );

  self.__fjs_state = {
    fns,
    returned,
    hooks,
    scope,
    stopWatch: stopWatch ?? (() => {}),
    props,
  } satisfies InstanceState;

  // first snapshot lands synchronously in attached — WeChat folds setData
  // issued here into the initial render, so there's no empty flash
  const first = render();
  prev = first;
  self.setData(first);
}

function unmountInstance(self: MpInstance): void {
  const state = self.__fjs_state as InstanceState | undefined;
  if (!state) return;
  runHooks(state.hooks, 'before-unmounted');
  runHooks(state.hooks, 'unmounted');
  state.stopWatch();
  state.scope.stop();
  self.__fjs_state = undefined;
}

function stateOf(self: MpInstance): InstanceState {
  const state = self.__fjs_state as InstanceState | undefined;
  if (!state) throw new Error('[fjs/wx] instance accessed outside its lifetime');
  return state;
}

/** Event funnel: every event binding the compiler emits lands here. The
 * dataset carries which function to call and which template-scope values
 * (v-for item etc.) to pass — generated closures can't see those. */
function fjsCall(this: MpInstance, e: { currentTarget?: { dataset?: Record<string, unknown> } } & Record<string, unknown>): void {
  const ds = e.currentTarget?.dataset ?? {};
  const name = String(ds.fn ?? '');
  const state = stateOf(this);
  const fn = state.fns[name];
  if (!fn) {
    console.warn(`[fjs/wx] event handler "${name}" not found on ${String(sfcName(this))}`);
    return;
  }
  // wx events carry their own type ("tap", "load", "modal-closed") — that,
  // not a template attribute, is what the payload adapter dispatches on
  const norm = adaptEvent(
    String(ds.tag ?? ''),
    String((e as { type?: string }).type ?? ''),
    e as never,
  ) as NormalizedEvent;
  const scopeArgs = Array.isArray(ds.args) ? (ds.args as unknown[]) : [];
  try {
    fn(norm.payload, ...scopeArgs);
  } catch (err) {
    console.error(`[fjs/wx] handler ${name} failed:`, err);
  }
}

function sfcName(self: MpInstance): string {
  return String((self.__fjs_sfc as WevuSfc | undefined)?.__name ?? '<anonymous>');
}

export interface WevuComponentOptions {
  /** virtualHost removes the component's host node so flex chains run
   * through the template root exactly like the vdom platforms. */
  virtualHost?: boolean;
  /** `Component()`-constructed pages get their lifecycle hooks here. */
  isPage?: boolean;
}

/** Registers the SFC with the mini-program runtime. Calling this is the
 * module's side effect — exactly what `Component()` means on wx. */
export function createWevuComponent(sfc: WevuSfc, options: WevuComponentOptions = {}): void {
  const names = propNames(sfc);
  const config: Record<string, unknown> = {
    options: {
      // virtualHost everywhere EXCEPT the page root: a Component()-page
      // without its own host node crashed skyline's attachView ("appendChild
      // expects a valid Node") — the official skyline pages never do this
      virtualHost: options.virtualHost !== false && !options.isPage,
      multipleSlots: true,
      addGlobalClass: true,
    },
    properties: Object.fromEntries(names.map((n) => [n, { type: null, value: null }])),
    data: {},
    // keep the props mirror in sync; assigning the reactive props re-runs
    // computeds that depend on them
    observers: names.length
      ? { [names.join(',')]: function (this: MpInstance) {
          const state = this.__fjs_state as InstanceState | undefined;
          if (!state) return;
          for (const n of names) state.props[n] = this.data[n] ?? null;
        } }
      : {},
    lifetimes: {
      attached(this: MpInstance) {
        this.__fjs_sfc = sfc;
        mountInstance(this, sfc);
      },
      // (pages hit the same guard through methods.onLoad below)
      ready(this: MpInstance) {
        runHooks((this.__fjs_state as InstanceState | undefined)?.hooks, MOUNTED);
      },
      detached(this: MpInstance) {
        unmountInstance(this);
      },
    },
    pageLifetimes: {
      show(this: MpInstance) {
        runHooks((this.__fjs_state as InstanceState | undefined)?.hooks, 'show');
      },
      hide(this: MpInstance) {
        runHooks((this.__fjs_state as InstanceState | undefined)?.hooks, 'hide');
      },
    },
    methods: {
      __fjsCall: fjsCall,
    },
  };

  if (options.isPage) {
    // Component()-constructed pages carry the page lifecycle in methods
    // (the skyline quickstart template registers pages exactly this way)
    config.methods = {
      ...(config.methods as Record<string, unknown>),
      onLoad(this: MpInstance, query: Record<string, string>) {
        this.__fjs_sfc = sfc;
        mountInstance(this, sfc);
        runHooks((this.__fjs_state as InstanceState | undefined)?.hooks, 'load', query ?? {});
      },
      onShow(this: MpInstance) {
        runHooks((this.__fjs_state as InstanceState | undefined)?.hooks, 'show');
      },
      onReady(this: MpInstance) {
        runHooks((this.__fjs_state as InstanceState | undefined)?.hooks, MOUNTED);
        runHooks((this.__fjs_state as InstanceState | undefined)?.hooks, 'ready');
      },
      onHide(this: MpInstance) {
        runHooks((this.__fjs_state as InstanceState | undefined)?.hooks, 'hide');
      },
      onUnload(this: MpInstance) {
        runHooks((this.__fjs_state as InstanceState | undefined)?.hooks, 'unload');
        unmountInstance(this);
      },
    };
  }

  Component(config);
}
