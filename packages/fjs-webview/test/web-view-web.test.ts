// @vitest-environment happy-dom
// The web stand-in: what reaches the iframe, and which window messages count
// as this web-view's. The Flutter twin is flutter/test/web_view_test.dart.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp, h, nextTick, ref, type Component } from 'vue';
import WebViewWeb from '../components/WebViewWeb.vue';
import { WEB_ASSET_BASE } from '../index';

function mount(props: Record<string, unknown>) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  createApp({ render: () => h(WebViewWeb, props) } as Component).mount(host);
  return host;
}

/** happy-dom gives an iframe a contentWindow; a message only counts when it
 * claims to come from that one. */
function post(frame: HTMLIFrameElement, data: unknown, source?: unknown) {
  const event = new MessageEvent('message', { data });
  Object.defineProperty(event, 'source', {
    value: source === undefined ? frame.contentWindow : source,
  });
  window.dispatchEvent(event);
}

afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('src', () => {
  it('passes an http src straight through', async () => {
    const host = mount({ src: 'https://example.com/a' });
    await nextTick();
    const frame = host.querySelector('iframe') as HTMLIFrameElement;
    expect(frame.getAttribute('src')).toBe('https://example.com/a');
  });

  it('serves an asset src from the app static root', async () => {
    const host = mount({ src: 'asset://demo.html' });
    await nextTick();
    const frame = host.querySelector('iframe') as HTMLIFrameElement;
    expect(frame.getAttribute('src')).toBe(`${WEB_ASSET_BASE}/demo.html`);
  });

  it('loads nothing for an unsupported scheme, and says why once', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const host = mount({ src: 'file:///etc/passwd' });
    await nextTick();
    const frame = host.querySelector('iframe') as HTMLIFrameElement;
    expect(frame.getAttribute('src')).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain('file:///etc/passwd');
  });

  it('loads nothing when there is no src', async () => {
    const host = mount({});
    await nextTick();
    expect(host.querySelector('iframe')!.getAttribute('src')).toBeNull();
  });
});

describe('events', () => {
  it('reports one @load, with the URL it actually loaded', async () => {
    const loads: string[] = [];
    const host = mount({
      src: 'https://example.com/a',
      onLoad: (payload: string) => loads.push(payload),
    });
    await nextTick();
    const frame = host.querySelector('iframe') as HTMLIFrameElement;
    frame.dispatchEvent(new Event('load'));
    frame.dispatchEvent(new Event('load'));
    expect(loads).toEqual(['{"src":"https://example.com/a"}']);
  });

  it('says nothing when there is no src (about:blank also fires load)', async () => {
    const loads: string[] = [];
    const host = mount({ onLoad: (payload: string) => loads.push(payload) });
    await nextTick();
    host.querySelector('iframe')!.dispatchEvent(new Event('load'));
    expect(loads).toEqual([]);
  });

  it('reports @error with the stable message', async () => {
    const errors: string[] = [];
    const host = mount({
      src: 'https://example.com/a',
      onError: (payload: string) => errors.push(payload),
    });
    await nextTick();
    host.querySelector('iframe')!.dispatchEvent(new Event('error'));
    expect(errors).toEqual([
      '{"src":"https://example.com/a","errMsg":"web-view load failed"}',
    ]);
  });

  it('does not report the old page after the src changes', async () => {
    const src = ref('https://example.com/a');
    const loads: string[] = [];
    const host = document.createElement('div');
    document.body.appendChild(host);
    createApp({
      render: () =>
        h(WebViewWeb, {
          src: src.value,
          onLoad: (payload: string) => loads.push(payload),
        }),
    } as Component).mount(host);
    await nextTick();
    const old = host.querySelector('iframe') as HTMLIFrameElement;

    src.value = 'https://example.com/b';
    await nextTick();
    // the old frame finally finishes; it belongs to a load nobody is
    // waiting for any more
    old.dispatchEvent(new Event('load'));
    expect(loads).toEqual([]);

    host.querySelector('iframe')!.dispatchEvent(new Event('load'));
    expect(loads).toEqual(['{"src":"https://example.com/b"}']);
  });
});

describe('message: the window is a party line', () => {
  it('takes a message from this frame in the shim\'s shape', async () => {
    const messages: string[] = [];
    const host = mount({
      src: 'https://example.com/a',
      onMessage: (payload: string) => messages.push(payload),
    });
    await nextTick();
    const frame = host.querySelector('iframe') as HTMLIFrameElement;
    post(frame, { __fjs: 'hello' });
    expect(messages).toEqual(['{"data":"hello"}']);
  });

  it('ignores messages from anything else on the page', async () => {
    const messages: string[] = [];
    const host = mount({
      src: 'https://example.com/a',
      onMessage: (payload: string) => messages.push(payload),
    });
    await nextTick();
    const frame = host.querySelector('iframe') as HTMLIFrameElement;
    post(frame, { __fjs: 'from elsewhere' }, window); // another source
    post(frame, 'a bare string'); // right source, wrong shape
    post(frame, { type: 'webpack-hmr' }); // somebody else's protocol
    post(frame, { __fjs: 42 }); // not a string
    expect(messages).toEqual([]);
  });

  it('stops listening once it is gone', async () => {
    const messages: string[] = [];
    const host = document.createElement('div');
    document.body.appendChild(host);
    const app = createApp({
      render: () =>
        h(WebViewWeb, {
          src: 'https://example.com/a',
          onMessage: (payload: string) => messages.push(payload),
        }),
    } as Component);
    app.mount(host);
    await nextTick();
    const frame = host.querySelector('iframe') as HTMLIFrameElement;
    app.unmount();
    post(frame, { __fjs: 'too late' });
    expect(messages).toEqual([]);
  });
});
