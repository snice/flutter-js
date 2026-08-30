import { describe, expect, it } from 'vitest';
import { historyEntryKey } from '../src/router/web';

describe('historyEntryKey', () => {
  it('keys one KeepAlive slot per stack entry, not per path', () => {
    expect(historyEntryKey({ fullPath: '/' }, { position: 0 })).toBe('0:/');
    expect(historyEntryKey({ fullPath: '/' }, { position: 1 })).toBe('1:/');
    expect(historyEntryKey({ fullPath: '/comp/button' }, { position: 1 })).toBe(
      '1:/comp/button',
    );
  });

  it('treats a missing position as 0', () => {
    expect(historyEntryKey({ fullPath: '/' }, {})).toBe('0:/');
    expect(historyEntryKey({ fullPath: '/' }, null)).toBe('0:/');
  });
});
