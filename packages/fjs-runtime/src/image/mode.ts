/** The image mode vocabulary shared by the web adapter and Flutter's
 * equivalent mapping (`flutter_fjs/lib/src/render/image_mode.dart`).
 * `mode` is an image contract, not a CSS property.
 *
 * `mode` wins over the older `fit` prop and `fit` is read only when no `mode`
 * is set: one concept ends up with two spellings, which is the price of not
 * breaking pages written before `mode` existed. */
export const IMAGE_MODES = [
  'scaleToFill',
  'aspectFit',
  'aspectFill',
  'widthFix',
  'heightFix',
  'top',
  'bottom',
  'center',
  'left',
  'right',
  'top left',
  'top right',
  'bottom left',
  'bottom right',
] as const;

export type ImageMode = (typeof IMAGE_MODES)[number];

export interface ResolvedImageMode {
  mode: ImageMode;
  objectFit: 'fill' | 'contain' | 'cover';
  objectPosition: string;
  fix: 'width' | 'height' | null;
}

const MODE_SET = new Set<string>(IMAGE_MODES);

const positions: Record<ImageMode, string> = {
  scaleToFill: 'center',
  aspectFit: 'center',
  aspectFill: 'center',
  widthFix: 'center',
  heightFix: 'center',
  top: 'center top',
  bottom: 'center bottom',
  center: 'center',
  left: 'left center',
  right: 'right center',
  'top left': 'left top',
  'top right': 'right top',
  'bottom left': 'left bottom',
  'bottom right': 'right bottom',
};

export function resolveImageMode(
  mode: unknown,
  fit: unknown,
  warn: (message: string) => void = () => {},
): ResolvedImageMode {
  let selected: ImageMode;
  if (mode !== undefined && mode !== null && String(mode) !== '') {
    const value = String(mode);
    if (!MODE_SET.has(value)) {
      warn(
        `image received unsupported mode="${value}"; using "scaleToFill".`,
      );
      selected = 'scaleToFill';
    } else {
      selected = value as ImageMode;
    }
  } else if (fit !== undefined && fit !== null && String(fit) !== '') {
    const legacy = String(fit);
    const objectFit =
      legacy === 'contain' || legacy === 'fill' || legacy === 'cover'
        ? legacy
        : 'cover';
    return {
      mode: objectFit === 'fill' ? 'scaleToFill' : 'aspectFill',
      objectFit,
      objectPosition: 'center',
      fix: null,
    };
  } else {
    selected = 'scaleToFill';
  }

  if (selected === 'scaleToFill') {
    return {
      mode: selected,
      objectFit: 'fill',
      objectPosition: positions[selected],
      fix: null,
    };
  }
  if (selected === 'aspectFit') {
    return {
      mode: selected,
      objectFit: 'contain',
      objectPosition: positions[selected],
      fix: null,
    };
  }
  if (selected === 'widthFix') {
    return {
      mode: selected,
      objectFit: 'fill',
      objectPosition: positions[selected],
      fix: 'width',
    };
  }
  if (selected === 'heightFix') {
    return {
      mode: selected,
      objectFit: 'fill',
      objectPosition: positions[selected],
      fix: 'height',
    };
  }
  return {
    mode: selected,
    objectFit: 'cover',
    objectPosition: positions[selected],
    fix: null,
  };
}
