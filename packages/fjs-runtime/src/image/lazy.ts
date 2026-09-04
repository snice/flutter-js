/**
 * How far outside the visible area a lazy image starts loading, in logical
 * pixels. uni-app documents lazy-load as "about to enter the screen" rather
 * than "on screen", so both ends preload by a margin instead of waiting for
 * a true intersection — and the margin has to be the same number on both,
 * or the same page loads at different scroll offsets per platform.
 *
 * Mirrored by `_preloadSlack` in
 * `flutter_fjs/lib/src/render/image_visibility.dart`.
 */
export const IMAGE_LAZY_PRELOAD_PX = 240;
