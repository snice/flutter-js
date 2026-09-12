// rewriteFjsCss：无单位长度补 px（spec 041 对拍修出）。
//
// JS 引擎把裸数字读成逻辑像素，`padding: 10 12` 是正常页面写法；浏览器
// 视其为非法声明整条丢弃——盒子在 App 有内边距、在 web 没有，差出来的
// 高度曾被当成「Dart 侧多了默认高度」。补 px 在构建期做，dev（vite
// transform）与 build（injectStyle）共用这一份。
import { describe, expect, it } from 'vitest';
import { rewriteFjsCss } from '../src/web/css-compat';

describe('unitless lengths get px (web == app layout)', () => {
  it('suffixes multi-value padding / margin / border-radius', () => {
    expect(rewriteFjsCss('.a { padding: 10 12 }'))
      .toBe('.a { padding: 10px 12px }');
    expect(rewriteFjsCss('.a { margin: 16 12 0 12 }'))
      .toBe('.a { margin: 16px 12px 0 12px }');
    expect(rewriteFjsCss('.a { border-radius: 8 10 }'))
      .toBe('.a { border-radius: 8px 10px }');
  });

  it('covers every length property the engine reads as px', () => {
    const out = rewriteFjsCss(
      '.a { width: 100; min-height: 40; gap: 8; top: 4; border-bottom-width: 2; font-size: 13; letter-spacing: 1 }',
    );
    expect(out).toContain('width: 100px');
    expect(out).toContain('min-height: 40px');
    expect(out).toContain('gap: 8px');
    expect(out).toContain('top: 4px');
    expect(out).toContain('border-bottom-width: 2px');
    expect(out).toContain('font-size: 13px');
    expect(out).toContain('letter-spacing: 1px');
  });

  it('leaves non-length tokens and non-length properties alone', () => {
    expect(rewriteFjsCss('.a { margin: 0 auto }')).toBe('.a { margin: 0 auto }');
    expect(rewriteFjsCss('.a { width: calc(100% - 32px) }'))
      .toBe('.a { width: calc(100% - 32px) }');
    expect(rewriteFjsCss('.a { width: 50% }')).toBe('.a { width: 50% }');
    expect(rewriteFjsCss('.a { line-height: 1.4 }'))
      .toBe('.a { line-height: 1.4 }'); // a bare number is a multiplier on both ends
    expect(rewriteFjsCss('.a { flex-grow: 2; z-index: 3; font-weight: 500 }'))
      .toBe('.a { flex: 2 1 0%; z-index: 3; font-weight: 500 }');
    expect(rewriteFjsCss('.a { color: #333 }')).toBe('.a { color: #333 }');
  });

  it('keeps already-unit values and !important intact, and is idempotent', () => {
    expect(rewriteFjsCss('.a { padding: 10px 12px !important }'))
      .toBe('.a { padding: 10px 12px !important }');
    const once = rewriteFjsCss('.a { padding: 10 12 }');
    expect(rewriteFjsCss(once)).toBe(once);
  });

  it('does not rewrite lengths inside longer property names', () => {
    // border-width is a length prop; border-bottom-color is not — the
    // boundary is "not part of a longer property name", same as the
    // flex-grow rewriter above it
    expect(rewriteFjsCss('.a { border-bottom-color: 333 }'))
      .toBe('.a { border-bottom-color: 333 }');
  });
});
