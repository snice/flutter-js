// The DOM-shaped `el.style` object on fjs elements (spec 042).
//
// DOM animation libraries (@vueuse/motion and friends) assign
// `el.style[key] = v` instead of calling setStyle. The shim must merge those
// writes into the style engine's INLINE layer — the same record a `:style`
// binding writes — so the two writers can never clobber each other, and
// reads must round-trip what was written. Both halves asserted here.
import { beforeEach, describe, expect, it } from 'vitest';
import { create, setElementStyleBridge, forgetElementStyle } from '../src/ui/element';
import { StyleEngine } from '../src/css/style';
import { setOpSink } from '../src/host';

(globalThis as { __fjsHost?: { uiOpsVersion: number } }).__fjsHost = {
  uiOpsVersion: 2,
};

beforeEach(() => {
  setOpSink(() => {});
});

/** A real StyleEngine wired the way vue/renderer.ts wires it, so the test
 * exercises the same bridge the app runs. */
function wiredEngine() {
  const engine = new StyleEngine(
    new Map(),
    new Map(),
    () => {}, // resolved styles going to the peer — nothing asserts them here
  );
  setElementStyleBridge({
    read: (id) => engine.inlineRecord(id),
    write: (id, key, value) => engine.mutateInline(id, key, value),
  });
  return engine;
}

describe('element style shim', () => {
  it('writes land in the engine inline layer and read back', () => {
    const engine = wiredEngine();
    const el = create('view');
    engine.ensure(el.id, 'view');

    el.style.opacity = 0.5;
    el.style.setProperty('transform', 'translateX(2px)');

    expect(engine.inlineRecord(el.id)).toEqual({
      opacity: 0.5,
      transform: 'translateX(2px)',
    });
    // DOM reads come back as strings
    expect(el.style.opacity).toBe('0.5');
    expect(el.style.getPropertyValue('transform')).toBe('translateX(2px)');
    expect(el.style.getPropertyValue('opacity')).toBe('0.5');
    expect(el.style.getPropertyValue('color')).toBe('');
  });

  it('coexists with a :style binding — neither side clobbers the other', () => {
    const engine = wiredEngine();
    const el = create('view');
    engine.ensure(el.id, 'view');

    // what patchProp does for `:style="{ color: 'red' }"`
    engine.patchInlineStyle(el.id, undefined, { color: 'red' });
    // what @vueuse/motion does on every frame
    el.style.opacity = 1;
    // the binding re-patches on a re-render — an object binding DIFFS keys
    // (DOM patchStyle semantics), so the shim's write survives
    engine.patchInlineStyle(el.id, { color: 'red' }, { color: 'blue' });

    expect(engine.inlineRecord(el.id)).toEqual({ color: 'blue', opacity: 1 });
    // and the other direction: a shim write must not eat the binding
    el.style.transform = 'scale(2)';
    expect(engine.inlineRecord(el.id)).toEqual({
      color: 'blue',
      opacity: 1,
      transform: 'scale(2)',
    });
    // the binding dropping a key removes exactly that key
    engine.patchInlineStyle(el.id, { color: 'blue' }, {});
    expect(engine.inlineRecord(el.id)).toEqual({ opacity: 1, transform: 'scale(2)' });
  });

  it('removeProperty and null writes remove', () => {
    const engine = wiredEngine();
    const el = create('view');
    engine.ensure(el.id, 'view');

    el.style.opacity = 0.5;
    expect(el.style.removeProperty('opacity')).toBe('0.5');
    expect(el.style.getPropertyValue('opacity')).toBe('');

    el.style.opacity = 0.5;
    el.style.opacity = null as unknown as string;
    expect(el.style.getPropertyValue('opacity')).toBe('');
    expect(engine.inlineRecord(el.id)).toEqual({});
  });

  it('without a bridge it keeps a local record so reads still round-trip', () => {
    setElementStyleBridge(null);
    const el = create('view');
    el.style.marginTop = '4px';
    expect(el.style.marginTop).toBe('4px');
    forgetElementStyle(el.id);
    expect(el.style.marginTop).toBe('');
  });
});
