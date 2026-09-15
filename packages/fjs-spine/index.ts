// @ufjs/spine — Spine runtime for the fjs <canvas> (port of spine-canvas 4.3).
//
// spine-core is used as published; only spine-canvas' three files are
// ported (src/), because they are the ones that touch the DOM:
//
//   AssetManager      XMLHttpRequest / new Image()  ->  fetch / loadCanvasImage
//   CanvasTexture     HTMLImageElement              ->  FjsCanvasImageSource
//   SkeletonRenderer  CanvasRenderingContext2D      ->  FjsCanvasContext2D
//
// Same page source on the app and on web. Pages import everything from here,
// exactly like `import * as spine from '@esotericsoftware/spine-canvas'`.
export * from '@esotericsoftware/spine-core';
export { AssetManager, FjsDownloader } from './src/AssetManager';
export { CanvasTexture } from './src/CanvasTexture';
export { SkeletonRenderer } from './src/SkeletonRenderer';
export { SpinePlayer, type SpinePlayerConfig, type Viewport } from './src/SpinePlayer';
