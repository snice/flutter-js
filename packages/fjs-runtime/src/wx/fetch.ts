// fetch() on wx, over wx.request. Pages written against the web/fjs fetch
// surface (the fetch.vue example, any dependency doing `await fetch(...)`)
// keep working without source changes. Only the JSON-text surface is
// implemented: wx.request has no streaming, so response bodies are buffered
// whole — same as the QuickJS host binding, just platform-side.
//
// Installed once on module load (see index.ts); wx.request's timeout and
// header restrictions apply as documented by WeChat.

interface WxRequestResult {
  statusCode: number;
  data: unknown;
  header?: Record<string, string>;
  errMsg?: string;
}

// wx itself comes from the ambient declarations in env.d.ts; the request
// option fields used here are the documented subset.

export function installFetchPolyfill(): void {
  const g = globalThis as Record<string, unknown>;
  if (typeof g.fetch === 'function') return;

  g.fetch = ((input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> => {
    const url = typeof input === 'string' ? input : String((input as URL).toString());
    const method = (init.method ?? 'GET').toUpperCase();
    const headers = normalizeHeaders(init.headers);
    const body = init.body;
    return new Promise((resolve, reject) => {
      wx.request({
        url,
        method,
        header: headers,
        data: body === undefined || body === null ? undefined : String(body),
        responseType: 'text',
        dataType: 'text', // any non-'json' value disables wx's implicit JSON.parse
        success: (res: WxRequestResult) => resolve(makeResponse(url, res)),
        fail: (res: { errMsg: string }) => reject(new TypeError(`fetch failed: ${res.errMsg}`)),
      });
    });
  }) as typeof fetch;
}

function normalizeHeaders(init: HeadersInit | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!init) return out;
  if (Array.isArray(init)) {
    for (const [k, v] of init) out[k] = v;
  } else {
    Object.assign(out, init);
  }
  return out;
}

function makeResponse(url: string, res: WxRequestResult): Response {
  const text = typeof res.data === 'string' ? res.data : JSON.stringify(res.data ?? null);
  const headers = new Map(
    Object.entries(res.header ?? {}).map(([k, v]) => [k.toLowerCase(), String(v)]),
  );
  return {
    ok: res.statusCode >= 200 && res.statusCode < 300,
    status: res.statusCode,
    statusText: '',
    url,
    redirected: false,
    type: 'basic' as const,
    headers: {
      get: (name: string) => headers.get(name.toLowerCase()) ?? null,
      has: (name: string) => headers.has(name.toLowerCase()),
    },
    text: () => Promise.resolve(text),
    json: () => Promise.resolve(JSON.parse(text) as unknown),
    arrayBuffer: () => Promise.resolve(new TextEncoder().encode(text).buffer as ArrayBuffer),
    blob: () => Promise.reject(new Error('response.blob() is not supported on wx')),
    formData: () => Promise.reject(new Error('response.formData() is not supported on wx')),
    clone: () => {
      throw new Error('response.clone() is not supported on wx');
    },
    bodyUsed: false,
    body: null,
  } as unknown as Response;
}
