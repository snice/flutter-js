// The @linechange contract. widgets/input.dart mirrors these rules on the
// Flutter side; the web adapter calls this code directly.
import { describe, expect, it } from 'vitest';
import { LineChangeState, lineChangePayload } from '../src/textarea/lines';

describe('lineChangePayload', () => {
  it('writes the two fields in a fixed order', () => {
    expect(lineChangePayload({ height: 68, lineCount: 3 })).toBe(
      '{"height":68,"lineCount":3}',
    );
  });

  it('rounds height to one decimal and leaves lineCount exact', () => {
    expect(lineChangePayload({ height: 67.9412, lineCount: 3 })).toBe(
      '{"height":67.9,"lineCount":3}',
    );
  });

  it('has no heightRpx: fjs has no rpx coordinate system', () => {
    expect(lineChangePayload({ height: 1, lineCount: 1 })).not.toContain('rpx');
  });
});

describe('LineChangeState', () => {
  it('primes on the first measurement without reporting it', () => {
    const state = new LineChangeState();
    expect(state.report({ height: 20, lineCount: 1 })).toBeNull();
  });

  it('reports only when the count actually changes', () => {
    const state = new LineChangeState();
    state.report({ height: 20, lineCount: 1 });
    // more text, still one line
    expect(state.report({ height: 20, lineCount: 1 })).toBeNull();
    expect(state.report({ height: 40, lineCount: 2 })).toBe(
      '{"height":40,"lineCount":2}',
    );
    // staying on two lines is not a change
    expect(state.report({ height: 40, lineCount: 2 })).toBeNull();
  });

  it('reports each way when the count goes back down', () => {
    const state = new LineChangeState();
    state.report({ height: 20, lineCount: 1 });
    expect(state.report({ height: 60, lineCount: 3 })).toBe(
      '{"height":60,"lineCount":3}',
    );
    expect(state.report({ height: 20, lineCount: 1 })).toBe(
      '{"height":20,"lineCount":1}',
    );
  });

  it('reset makes the next measurement prime again', () => {
    const state = new LineChangeState();
    state.report({ height: 20, lineCount: 1 });
    state.reset();
    expect(state.report({ height: 40, lineCount: 2 })).toBeNull();
  });
});
