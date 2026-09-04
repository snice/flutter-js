/** Image event payloads remain strings because all host events cross the
 * existing scalar dispatch boundary. Key order is part of the contract. */
export const IMAGE_ERROR_MESSAGE = 'image load failed';

export function encodeImageLoad(width: number, height: number): string {
  return `{"width":${Math.max(0, Math.round(width))},"height":${Math.max(
    0,
    Math.round(height),
  )}}`;
}

export function encodeImageError(
  message = IMAGE_ERROR_MESSAGE,
): string {
  return JSON.stringify({ errMsg: message || IMAGE_ERROR_MESSAGE });
}

/** One terminal event is allowed for each source generation. */
export class ImageLoadCycle {
  private generation = 0;
  private terminal: 'load' | 'error' | null = null;

  begin(): number {
    this.generation++;
    this.terminal = null;
    return this.generation;
  }

  finish(generation: number, event: 'load' | 'error'): boolean {
    if (generation !== this.generation || this.terminal !== null) return false;
    this.terminal = event;
    return true;
  }
}
