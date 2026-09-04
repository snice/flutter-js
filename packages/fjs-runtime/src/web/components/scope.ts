// The web half of the control scope `radio-group` / `checkbox-group` /
// `label` / `form` all sit on. Same shape as the Dart side
// (flutter_fjs/lib/src/widgets/control_scope.dart), so the two platforms
// answer a form submit with the same object in the same key order.
//
// A control registers a handle with the nearest enclosing scope on mount; a
// scope forwards every registration to its own parent scope. Registration
// order is mount order, which for siblings is document order — the only
// reason the two payloads compare equal byte for byte.
import {
  getCurrentInstance,
  inject,
  onMounted,
  onUnmounted,
  provide,
  type InjectionKey,
} from 'vue';

export type FjsControlKind =
  | 'input'
  | 'checkbox'
  | 'radio'
  | 'toggle'
  | 'slider'
  | 'group';

export interface FjsControlHandle {
  kind: FjsControlKind;
  /** Read lazily: props change without the control remounting. */
  getName: () => string | undefined;
  /** The node's `id` — what `<label for>` matches on. */
  getId: () => string | undefined;
  /** String / boolean / number, so JSON.stringify matches Dart's jsonEncode. */
  getValue: () => unknown;
  /** Forced by a group (exclusion); emits no event of the control's own. */
  setChecked?: (value: boolean) => void;
  /** What a label forwards a tap to. */
  toggle?: () => void;
  focus?: () => void;
}

export interface FjsControlRegistry {
  parent: FjsControlRegistry | null;
  /** Handles of this kind stop here instead of bubbling: a group speaks for
   * its members, so a <form> above it sees one key (the group's) and not
   * one per checkbox. */
  owns?: FjsControlKind;
  handles: FjsControlHandle[];
  onRegister?: (handle: FjsControlHandle) => void;
  onChanged?: (handle: FjsControlHandle) => void;
  register: (handle: FjsControlHandle) => void;
  unregister: (handle: FjsControlHandle) => void;
  notifyChanged: (handle: FjsControlHandle) => void;
}

const SCOPE: InjectionKey<FjsControlRegistry> = Symbol('fjs-control-scope');

export function createControlRegistry(
  parent: FjsControlRegistry | null,
): FjsControlRegistry {
  const registry: FjsControlRegistry = {
    parent,
    handles: [],
    register(handle) {
      registry.handles.push(handle);
      registry.onRegister?.(handle);
      if (handle.kind === registry.owns) return;
      parent?.register(handle);
    },
    unregister(handle) {
      const at = registry.handles.indexOf(handle);
      if (at >= 0) registry.handles.splice(at, 1);
      if (handle.kind === registry.owns) return;
      parent?.unregister(handle);
    },
    // Bubbles, so a <form> above a <radio-group> hears about it too.
    notifyChanged(handle) {
      registry.onChanged?.(handle);
      if (handle.kind === registry.owns) return;
      parent?.notifyChanged(handle);
    },
  };
  return registry;
}

/** Opens a scope for a group / label / form and returns it. */
export function provideControlScope(): FjsControlRegistry {
  const registry = createControlRegistry(inject(SCOPE, null));
  provide(SCOPE, registry);
  return registry;
}

/** Registers a control with the enclosing scope for as long as it is
 * mounted. Returns a `changed()` to call after a USER-driven change — the
 * signal a group needs to enforce exclusion and emit its own payload. */
export function useControl(handle: FjsControlHandle): () => void {
  const registry = inject(SCOPE, null);
  if (registry) {
    onMounted(() => registry.register(handle));
    onUnmounted(() => registry.unregister(handle));
  }
  return () => registry?.notifyChanged(handle);
}

/** What a `<button form-type>` calls on the nearest enclosing form. */
export interface FjsFormActions {
  submit: () => void;
  reset: () => void;
}

export const FORM_ACTIONS: InjectionKey<FjsFormActions> =
  Symbol('fjs-form-actions');

const warned = new Set<string>();

/** Constitution V: a control that silently does nothing (no `name`, no
 * label target) is a bug, not a no-op. Mirrors fjsWarnOnce on the Dart
 * side. */
export function warnControlOnce(key: string, message: string): void {
  if (warned.has(key)) return;
  warned.add(key);
  console.warn(`[fjs] ${message}`);
}

/** A getter for the `id` attribute Vue passed through, for `<label for>`.
 *
 * The instance is captured HERE, during setup: a handle's getters run long
 * after setup returns, when getCurrentInstance() is null. */
export function nodeIdGetter(): () => string | undefined {
  const instance = getCurrentInstance();
  return () => {
    const id = instance?.attrs?.id;
    return id == null ? undefined : String(id);
  };
}
