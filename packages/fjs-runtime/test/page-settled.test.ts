// onPageSettled's contract, on the web substrate (specs/027 §8).
//
// The Flutter half is the same state machine driven by FJS_EVENT_NAV_SETTLED
// instead of <Transition>'s afterEnter; what is asserted here is the shape
// both sides promise a page: one-shot, always async, dropped on unmount.
import { describe, expect, it } from 'vitest';
import {
  beginPageTransition,
  cancelPageTransition,
  markPageSettled,
  whenNoTransition,
  whenSettled,
} from '../src/router/settled';

const tick = () => new Promise<void>((r) => queueMicrotask(() => queueMicrotask(r)));

describe('page settled', () => {
  it('runs asynchronously even when the page has already settled', async () => {
    const calls: string[] = [];
    whenSettled('/never-navigated', () => calls.push('cb'));
    expect(calls).toEqual([]); // NOT synchronous — setup() must finish first
    await tick();
    expect(calls).toEqual(['cb']);
  });

  it('waits for the transition, then fires once', async () => {
    beginPageTransition('/a');
    const calls: string[] = [];
    whenSettled('/a', () => calls.push('one'));
    whenSettled('/a', () => calls.push('two'));
    await tick();
    expect(calls).toEqual([]);

    markPageSettled('/a');
    await tick();
    expect(calls).toEqual(['one', 'two']);

    // settling again must not re-run anything
    markPageSettled('/a');
    await tick();
    expect(calls).toEqual(['one', 'two']);
  });

  it('drops callbacks when the page leaves before settling', async () => {
    beginPageTransition('/b');
    const calls: string[] = [];
    whenSettled('/b', () => calls.push('cb'));
    cancelPageTransition('/b');
    markPageSettled('/b');
    await tick();
    expect(calls).toEqual([]);
  });

  it('a page that settled while nobody waited answers immediately after', async () => {
    beginPageTransition('/c');
    markPageSettled('/c');
    const calls: string[] = [];
    whenSettled('/c', () => calls.push('cb'));
    await tick();
    expect(calls).toEqual(['cb']);
  });

  it('whenNoTransition waits for the arriving page, not a stale one', async () => {
    beginPageTransition('/old');
    beginPageTransition('/new');
    const calls: string[] = [];
    // <canvas> does not know its own path: it must latch onto the newest
    whenNoTransition(() => calls.push('canvas'));
    markPageSettled('/old');
    await tick();
    expect(calls).toEqual([]);

    markPageSettled('/new');
    await tick();
    expect(calls).toEqual(['canvas']);
  });

  it('whenNoTransition is immediate when nothing is animating', async () => {
    const calls: string[] = [];
    whenNoTransition(() => calls.push('canvas'));
    await tick();
    expect(calls).toEqual(['canvas']);
  });
});
