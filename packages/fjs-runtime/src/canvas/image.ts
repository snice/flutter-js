// Canvas images and toDataURL: the two genuinely asynchronous things a
// canvas does.
//
// Both follow the fetch pattern (constitution II): JS allocates the id,
// invokeHost starts the work and returns immediately, and the host reports
// back through __fjsDispatchEvent. Nothing here blocks, and no new C ABI is
// needed.
//
// Decoded images live on the host, not here. A decoded bitmap is the one
// thing in this subsystem that must not cross the boundary: it is large, it
// is binary, and the only thing JS ever does with it is name it in a
// drawImage. So JS holds a handle and the host holds the pixels.
import { invokeHost } from '../host';
import { warnCanvasOnce } from './warn';

/** The canvas subsystem's event number (fjs.h FJS_EVENT_CANVAS). One number
 * carries three messages, told apart by the payload's `t`. */
export const CANVAS_EVENT = 30;

type SizeListener = (width: number, height: number) => void;

const sizeListeners = new Map<number, SizeListener>();
const imageRequests = new Map<number, FjsCanvasImage>();
const dataUrlRequests = new Map<number, (result: string, error?: string) => void>();

let nextHandle = 1;
let installed = false;

/** How this module reaches the event dispatcher. Injected by the element
 * layer rather than imported from it: the element layer owns canvases, so
 * importing it back from here would make the two modules cyclic for no
 * benefit. */
type Registrar = (
  type: number,
  handler: (id: number, payload?: string) => void,
) => void;
let registrar: Registrar | null = null;

export function setCanvasEventRegistrar(register: Registrar): void {
  registrar = register;
}

/** The host tells a canvas node its laid-out size here; the element layer
 * uses it for `canvas.width` / `canvas.height`. */
export function listenCanvasSize(nodeId: number, listener: SizeListener): void {
  install();
  sizeListeners.set(nodeId, listener);
}

export function forgetCanvasSize(nodeId: number): void {
  sizeListeners.delete(nodeId);
}

function install(): void {
  if (installed || !registrar) return;
  installed = true;
  registrar(CANVAS_EVENT, (id, payload) => {
    if (!payload) return;
    let message: {
      t?: string;
      w?: number;
      h?: number;
      err?: string;
      data?: string;
    };
    try {
      message = JSON.parse(payload) as typeof message;
    } catch {
      return;
    }
    switch (message.t) {
      case 'size':
        // `id` is the canvas node
        sizeListeners.get(id)?.(message.w ?? 0, message.h ?? 0);
        return;
      case 'image': {
        // `id` is the image handle this side allocated
        const image = imageRequests.get(id);
        if (!image) return;
        imageRequests.delete(id);
        image._settle(message.w ?? 0, message.h ?? 0, message.err);
        return;
      }
      case 'dataurl': {
        const resolve = dataUrlRequests.get(id);
        if (!resolve) return;
        dataUrlRequests.delete(id);
        resolve(message.data ?? '', message.err);
        return;
      }
      default:
        return;
    }
  });
}

/** An image being decoded by the host. Shaped like the parts of the DOM's
 * HTMLImageElement a canvas actually uses: `src`, `width`, `height`,
 * `onload` / `onerror`. Libraries feature-detect those (ECharts' loadImage
 * does), so the names are the DOM's rather than nicer ones. */
export class FjsCanvasImage {
  readonly handle = nextHandle++;
  width = 0;
  height = 0;
  complete = false;
  onload: (() => void) | null = null;
  onerror: ((message: string) => void) | null = null;

  private _src = '';

  get src(): string {
    return this._src;
  }

  set src(value: string) {
    this._src = value;
    if (value === '') return;
    install();
    imageRequests.set(this.handle, this);
    try {
      invokeHost('fjs.canvas.loadImage', this.handle, value);
    } catch {
      imageRequests.delete(this.handle);
      this._settle(0, 0, 'no native host');
    }
  }

  /** @internal — called by the dispatcher above. */
  _settle(width: number, height: number, error?: string): void {
    this.complete = true;
    if (error) {
      this.onerror?.(error);
      return;
    }
    this.width = width;
    this.height = height;
    this.onload?.();
  }
}

/** Loads an image, calling back when the host has decoded it. */
export function loadCanvasImage(
  src: string,
  onload?: (image: FjsCanvasImage) => void,
  onerror?: (message: string) => void,
): FjsCanvasImage {
  const image = new FjsCanvasImage();
  image.onload = () => onload?.(image);
  image.onerror = (message) => onerror?.(message);
  image.src = src;
  return image;
}

let nextDataUrlRequest = 1;

/** Asks the host to rasterize the canvas node and hand back a data URL.
 *
 * Async, unlike the DOM's toDataURL, because the pixels do not exist until
 * the host has drawn a frame and read it back — there is nothing to return
 * synchronously. The type signature says so rather than pretending
 * otherwise; docs/canvas-compat.md marks it as the one difference in shape. */
export function canvasToDataURL(
  nodeId: number,
  type = 'image/png',
  quality = 0.92,
): Promise<string> {
  install();
  const id = nextDataUrlRequest++;
  return new Promise((resolve, reject) => {
    dataUrlRequests.set(id, (data, error) => {
      if (error) reject(new Error(error));
      else resolve(data);
    });
    try {
      invokeHost('fjs.canvas.toDataURL', id, nodeId, type, quality);
    } catch {
      dataUrlRequests.delete(id);
      warnCanvasOnce(
        'todataurl-no-host',
        'canvas.toDataURL() needs the native host; nothing to export.',
      );
      reject(new Error('no native host'));
    }
  });
}

/** Test hook: deterministic handles. */
export function resetCanvasImageHandles(): void {
  nextHandle = 1;
  nextDataUrlRequest = 1;
}
