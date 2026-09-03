// Byte-level contract for the interned style ops (7/8/9). The opcode table
// lives in four hand-written places — this writer, flutter_fjs's
// mirror_tree.dart, the dump in native/tools/fjsrun.cpp and the protocol
// comment in ui_ops.dart — with no generator keeping them honest, so these
// assertions are the closest thing to a cross-language contract test.
import { describe, expect, it } from 'vitest';
import { OpWriter, UiOp } from '../src/ui/ops';

// The runtime falls back to the pre-interning style encoding unless a host
// declares it can decode ops 7-9 (FjsEngine does this when it creates the
// VM; so does fjsrun). Without it these assertions would silently measure
// the legacy path.
(globalThis as { __fjsHost?: { uiOpsVersion: number } }).__fjsHost = {
  uiOpsVersion: 2,
};

interface Op {
  op: number;
  id?: number;
  styleId?: number;
  activeStyleId?: number;
  style?: Record<string, unknown>;
}

/** Decodes the ops this suite cares about; anything else is skipped by size. */
function decode(bytes: Uint8Array): Op[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const dec = new TextDecoder();
  const out: Op[] = [];
  let i = 0;
  const u32 = () => {
    const v = view.getUint32(i, true);
    i += 4;
    return v;
  };
  while (i < bytes.length) {
    const op = bytes[i++];
    switch (op) {
      case UiOp.DefineStyle: {
        const styleId = u32();
        const len = u32();
        const style = JSON.parse(dec.decode(bytes.subarray(i, i + len)));
        i += len;
        out.push({ op, styleId, style });
        break;
      }
      case UiOp.SetStyle: {
        out.push({ op, id: u32(), styleId: u32(), activeStyleId: u32() });
        break;
      }
      case UiOp.ResetStyles:
        out.push({ op });
        break;
      default:
        throw new Error(`unexpected op ${op} at ${i - 1}`);
    }
  }
  return out;
}

function drain(w: OpWriter): Op[] {
  const ops = decode(w.toUint8Array());
  w.reset();
  return ops;
}

describe('style interning', () => {
  it('sends a style definition once, then references it by id', () => {
    const w = new OpWriter();
    const shared = { color: '#333333', fontSize: 14 };
    w.setStyle(1, shared);
    w.setStyle(2, shared);
    w.setStyle(3, shared);

    const ops = drain(w);
    const defines = ops.filter((o) => o.op === UiOp.DefineStyle);
    const sets = ops.filter((o) => o.op === UiOp.SetStyle);
    expect(defines).toHaveLength(1);
    expect(defines[0].style).toEqual(shared);
    expect(sets.map((o) => o.id)).toEqual([1, 2, 3]);
    // all three point at the one definition
    expect(new Set(sets.map((o) => o.styleId))).toEqual(
      new Set([defines[0].styleId]),
    );
  });

  it('keys on object identity, so an equal-but-distinct style defines again', () => {
    const w = new OpWriter();
    w.setStyle(1, { color: 'red' });
    w.setStyle(2, { color: 'red' });
    expect(drain(w).filter((o) => o.op === UiOp.DefineStyle)).toHaveLength(2);
  });

  it('interns the pressed variant too', () => {
    const w = new OpWriter();
    const base = { backgroundColor: '#fff' };
    const active = { backgroundColor: '#eee' };
    w.setStyle(1, base, active);
    w.setStyle(2, base, active);

    const ops = drain(w);
    expect(ops.filter((o) => o.op === UiOp.DefineStyle)).toHaveLength(2);
    const sets = ops.filter((o) => o.op === UiOp.SetStyle);
    expect(sets[0].styleId).toBe(sets[1].styleId);
    expect(sets[0].activeStyleId).toBe(sets[1].activeStyleId);
    expect(sets[0].activeStyleId).not.toBe(0);
  });

  it('reports no pressed style as id 0, which clears the slot', () => {
    const w = new OpWriter();
    w.setStyle(1, { color: 'red' });
    w.setStyle(2, { color: 'red' }, null);
    for (const set of drain(w).filter((o) => o.op === UiOp.SetStyle)) {
      expect(set.activeStyleId).toBe(0);
    }
  });

  it('carries definitions across frames until the directory is dropped', () => {
    const w = new OpWriter();
    const shared = { color: '#333333' };
    w.setStyle(1, shared);
    expect(drain(w).filter((o) => o.op === UiOp.DefineStyle)).toHaveLength(1);

    // second frame: the peer still knows the id
    w.setStyle(2, shared);
    expect(drain(w).filter((o) => o.op === UiOp.DefineStyle)).toHaveLength(0);

    // forgetStyles is what the host calls before recording a replayable log
    w.forgetStyles();
    w.setStyle(3, shared);
    const ops = drain(w);
    expect(ops[0].op).toBe(UiOp.ResetStyles);
    expect(ops.filter((o) => o.op === UiOp.DefineStyle)).toHaveLength(1);
  });

  it('ends the epoch rather than evicting when the table fills', () => {
    const w = new OpWriter();
    // one distinct style object per element, so every one takes a table slot
    for (let i = 0; i < 2100; i++) w.setStyle(i + 1, { width: i });
    const ops = drain(w);
    const resets = ops.filter((o) => o.op === UiOp.ResetStyles);
    expect(resets).toHaveLength(1);

    // every SetStyle is still preceded by its own definition, which is the
    // invariant that makes dropping the directory safe
    const defined = new Set<number>();
    for (const op of ops) {
      if (op.op === UiOp.ResetStyles) defined.clear();
      else if (op.op === UiOp.DefineStyle) defined.add(op.styleId!);
      else if (op.op === UiOp.SetStyle) expect(defined.has(op.styleId!)).toBe(true);
    }
  });

  it('never reuses an id after an epoch ends', () => {
    const w = new OpWriter();
    const seen = new Set<number>();
    for (let i = 0; i < 2100; i++) w.setStyle(i + 1, { width: i });
    for (const op of drain(w)) {
      if (op.op !== UiOp.DefineStyle) continue;
      expect(seen.has(op.styleId!)).toBe(false);
      seen.add(op.styleId!);
    }
  });
});
