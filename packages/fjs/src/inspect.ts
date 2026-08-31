// fjs log / fjs eval — talk to the JS engine running on the device.
//
// Both go through the dev server rather than the device: `fjs dev` already
// holds a socket to every connected app, so a tool only has to say who it
// is (`{"fjs":"tool"}`) and the server relays. Nothing new is opened on the
// phone, and it works the same for an emulator, a physical device over the
// LAN, and the browser build.
//
//   fjs log            console output from the app, as it happens
//   fjs eval '1 + 1'   evaluate an expression in the running VM
import { WebSocket } from 'ws';
import { colorSupported } from './qrcode.js';

/** Marks an eval answer inside the ordinary log stream, so getting a value
 * back needs no second message type — and no new native call. The NUL
 * prefix keeps it out of `fjs log`'s output and out of anything a real
 * console.log would produce. */
const EVAL_MARK = '\u0000fjs-eval:';

interface Options {
  port: number;
  host: string;
}

export async function logCommand(argv: string[]): Promise<void> {
  const { opts, rest } = parseCommon(argv);
  for (const arg of rest) throw new Error(`unknown log option: ${arg}`);

  const color = colorSupported();
  const socket = await connect(opts);
  const hello = await handshake(socket);
  console.log(
    `fjs log — ${url(opts)}, ${hello.apps} app${hello.apps === 1 ? '' : 's'} connected`,
  );
  if (hello.apps === 0) {
    console.log(dim('(nothing connected yet; lines appear as soon as an app is)', color));
  }

  socket.on('message', (raw) => {
    const msg = parse(raw.toString());
    if (msg?.fjs !== 'log') return;
    const text = String(msg.text ?? '');
    if (text.startsWith(EVAL_MARK)) return; // another tool's answer
    console.log(`${level(Number(msg.level ?? 1), color)} ${text}`);
  });
  socket.on('close', () => {
    console.log('dev server closed the connection');
    process.exit(1);
  });
  // resolves only on Ctrl-C
  await new Promise<void>(() => {});
}

export async function evalCommand(argv: string[]): Promise<void> {
  const { opts, rest } = parseCommon(argv);
  let expression: string | undefined;
  let timeout = 5000;
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (arg === '--timeout') {
      const value = Number(rest[++i]);
      if (!Number.isFinite(value) || value <= 0) throw new Error('--timeout needs milliseconds');
      timeout = value;
    } else if (expression === undefined) expression = arg;
    else throw new Error(`unknown eval option: ${arg}`);
  }
  if (!expression) {
    throw new Error("fjs eval needs an expression: fjs eval 'Object.keys(globalThis)'");
  }

  const socket = await connect(opts);
  const hello = await handshake(socket);
  if (hello.apps === 0) {
    socket.close();
    throw new Error(
      `no app connected to ${url(opts)} — start one with fjs run android|ios, ` +
        'or open the web build',
    );
  }

  const id = Math.random().toString(36).slice(2, 8);
  const answer = new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`no answer in ${timeout}ms — the app may be busy or not listening`));
    }, timeout);
    socket.on('message', (raw) => {
      const msg = parse(raw.toString());
      if (msg?.fjs !== 'log') return;
      const text = String(msg.text ?? '');
      if (!text.startsWith(`${EVAL_MARK}${id}:`)) return;
      clearTimeout(timer);
      const body = text.slice(EVAL_MARK.length + id.length + 1);
      if (body.startsWith('err:')) reject(new Error(body.slice(4)));
      else resolve(body.slice(3));
    });
  });

  socket.send(JSON.stringify({ fjs: 'eval', id, source: wrap(id, expression) }));
  try {
    console.log(await answer);
  } finally {
    socket.close();
  }
}

/** The expression runs in the VM as written; only the answer is wrapped.
 * Values come back as JSON, the one encoding both sides already agree on. */
export function wrap(id: string, expression: string): string {
  return (
    `try{var __fjsv=(${expression});` +
    `console.log(${JSON.stringify(EVAL_MARK + id + ':ok:')}+` +
    `(function(v){` +
    `if(typeof v==='string')return v;` +
    `if(typeof v==='undefined')return 'undefined';` +
    `if(typeof v==='function')return String(v);` +
    `try{var s=JSON.stringify(v);return s===undefined?String(v):s;}catch(e){return String(v);}` +
    `})(__fjsv))}` +
    `catch(e){console.log(${JSON.stringify(EVAL_MARK + id + ':err:')}+` +
    `(e&&e.message?e.message:String(e)))}`
  );
}

// ------------------------------------------------------------- plumbing

function url(opts: Options): string {
  return `ws://${opts.host}:${opts.port}/ws`;
}

function connect(opts: Options): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url(opts));
    socket.once('open', () => resolve(socket));
    socket.once('error', () => {
      reject(
        new Error(
          `cannot reach a dev server at ${url(opts)}\n` +
            '  start one with `fjs dev` (or `fjs run android|ios`), or pass --port',
        ),
      );
    });
  });
}

/** Announces this connection as a tool, so the server never pushes app
 * traffic — a stray "reload" — at it, and answers with how many apps are
 * listening. */
function handshake(socket: WebSocket): Promise<{ apps: number }> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('the dev server did not answer — is it an older fjs?'));
    }, 3000);
    socket.on('message', function hello(raw) {
      const msg = parse(raw.toString());
      if (msg?.fjs !== 'hello') return;
      clearTimeout(timer);
      socket.off('message', hello);
      resolve({ apps: Number(msg.apps ?? 0) });
    });
    socket.send(JSON.stringify({ fjs: 'tool' }));
  });
}

function parse(text: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(text);
    return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function parseCommon(argv: string[]): { opts: Options; rest: string[] } {
  const opts: Options = { port: 38900, host: '127.0.0.1' };
  const rest: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--port') {
      const value = Number(argv[++i]);
      if (!Number.isInteger(value)) throw new Error('--port needs a number');
      opts.port = value;
    } else if (arg === '--host') {
      const value = argv[++i];
      if (!value) throw new Error('--host needs a value');
      opts.host = value;
    } else rest.push(arg);
  }
  return { opts, rest };
}

function level(value: number, color: boolean): string {
  if (value >= 3) return color ? '\x1B[31merror\x1B[0m' : 'error';
  if (value === 2) return color ? '\x1B[33m warn\x1B[0m' : ' warn';
  return color ? '\x1B[2m  log\x1B[0m' : '  log';
}

function dim(value: string, color: boolean): string {
  return color ? `\x1B[2m${value}\x1B[0m` : value;
}
