// LAN beacon: "a fjs dev server is here".
//
// The QR code solves typing the address; this solves knowing it at all.
// `fjs dev` broadcasts a small JSON datagram once a second and `fjs go`
// lists whatever it hears, so connecting is a tap instead of an address.
//
// Deliberately one-way and connectionless. The client learns the host from
// the datagram's source address — the interface the packet actually arrived
// on — which is the one address that is guaranteed to be reachable from the
// device, unlike anything the server could put in the payload.
//
// Broadcast is best-effort by nature: guest networks and "AP isolation" on
// consumer routers drop it, and some Android devices need a multicast lock
// to receive it at all. That is why the banner still prints the address and
// its QR code.
import dgram from 'node:dgram';
import os from 'node:os';

/** Fixed, because the client has to bind it before it knows anything. Not
 * derived from --port: the whole point is to find servers on odd ports. */
export const DISCOVERY_PORT = 38901;

/** How often a beacon goes out. The client expires a server after a few
 * missed ones, so this is also how fast a stopped server disappears. */
const INTERVAL_MS = 1000;

export interface BeaconInfo {
  /** Project name, as /manifest.json reports it. */
  name: string;
  /** The HTTP port to connect to — the datagram only carries its own. */
  port: number;
  /** 'bundle' | 'pages', so the client can show what it is connecting to. */
  mode: string;
  entry?: string;
}

/** Starts broadcasting `info` until the returned function is called. */
export function startBeacon(info: BeaconInfo): () => void {
  const payload = Buffer.from(JSON.stringify({ fjs: 'dev', v: 1, ...info }));
  const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
  let stopped = false;
  let timer: NodeJS.Timeout | null = null;

  const send = () => {
    for (const target of broadcastAddresses()) {
      socket.send(payload, DISCOVERY_PORT, target, () => {
        // a downed interface, a firewall, a network that forbids broadcast:
        // discovery is the optional path, so failures stay silent
      });
    }
  };

  socket.on('error', () => {
    // nothing to recover: stop beaconing and leave the banner to do the job
    stop();
  });
  // port 0: the client is the one that binds a fixed port, so several dev
  // servers on one machine never collide
  socket.bind(0, () => {
    if (stopped) return;
    try {
      socket.setBroadcast(true);
    } catch {
      stop();
      return;
    }
    send();
    timer = setInterval(send, INTERVAL_MS);
    // the HTTP server is what keeps `fjs dev` alive; a beacon must not
    timer.unref();
  });
  socket.unref();

  function stop() {
    if (stopped) return;
    stopped = true;
    if (timer) clearInterval(timer);
    try {
      socket.close();
    } catch {
      // never bound, or already closed
    }
  }
  return stop;
}

/** The directed broadcast address of every IPv4 LAN interface, plus the
 * limited broadcast address as a fallback.
 *
 * Directed broadcast (192.168.1.255) is what reaches a phone on a machine
 * with several interfaces — VPNs and container bridges are common, and
 * 255.255.255.255 only goes out the one interface the OS picks for it.
 */
function broadcastAddresses(): string[] {
  const out = new Set<string>(['255.255.255.255']);
  for (const infos of Object.values(os.networkInterfaces())) {
    for (const info of infos ?? []) {
      if (info.family !== 'IPv4' || info.internal) continue;
      const address = directedBroadcast(info.address, info.netmask);
      if (address) out.add(address);
    }
  }
  return [...out];
}

/** address | ~netmask, or null if either is not a dotted quad. */
function directedBroadcast(address: string, netmask: string): string | null {
  const a = address.split('.').map(Number);
  const m = netmask.split('.').map(Number);
  if (a.length !== 4 || m.length !== 4) return null;
  if ([...a, ...m].some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
  return a.map((byte, i) => byte | (~m[i] & 255)).join('.');
}
