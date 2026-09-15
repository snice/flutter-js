/******************************************************************************
 * Spine Runtimes License Agreement
 * Last updated April 5, 2025. Replaces all prior versions.
 *
 * Copyright (c) 2013-2025, Esoteric Software LLC
 *
 * Integration of the Spine Runtimes into software or otherwise creating
 * derivative works of the Spine Runtimes is permitted under the terms and
 * conditions of Section 2 of the Spine Editor License Agreement:
 * http://esotericsoftware.com/spine-editor-license
 *
 * Otherwise, it is permitted to integrate the Spine Runtimes into software
 * or otherwise create derivative works of the Spine Runtimes (collectively,
 * "Products"), provided that each user of the Products must obtain their own
 * Spine Editor license and redistribution of the Products in any form must
 * include this license and copyright notice.
 *
 * THE SPINE RUNTIMES ARE PROVIDED BY ESOTERIC SOFTWARE LLC "AS IS" AND ANY
 * EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
 * WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
 * DISCLAIMED. IN NO EVENT SHALL ESOTERIC SOFTWARE LLC BE LIABLE FOR ANY
 * DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
 * (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES,
 * BUSINESS INTERRUPTION, OR LOSS OF USE, DATA, OR PROFITS) HOWEVER CAUSED AND
 * ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF
 * THE SPINE RUNTIMES, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 *****************************************************************************/

// SpinePlayer for the fjs <canvas> — spine-player 4.3's behaviour on top of
// this package's canvas SkeletonRenderer, given a 2d context instead of a DOM
// parent.
//
// Kept from upstream (same names, same semantics): the config's asset / skin /
// animation / viewport options, the load -> success flow, play / pause /
// speed, setAnimation / addAnimation / setViewport with the animated viewport
// transition, per-animation viewports and padding, control bones, the
// frame / update / draw / loading callbacks, startRendering / stopRendering.
//
// Not carried, because they are DOM: the HTML control bar and its popups, the
// fullscreen button, the WebGL loading screen, window / document listeners.
// A page builds its own controls with fjs components and forwards touches
// (handleTouch) — that is the one-source way on app, web and mini program.
//
// Also different: the canvas size is pushed in with resize(). ctx.canvas
// cannot be trusted for it (bitmap pixels on web, logical on the app), and
// fjs pages already get the logical size from <canvas @resize>.
import {
  type Animation,
  AnimationState,
  AnimationStateData,
  AtlasAttachmentLoader,
  type Bone,
  Color,
  type Disposable,
  type Downloader,
  MixFrom,
  Physics,
  Skeleton,
  SkeletonBinary,
  SkeletonClipping,
  type SkeletonData,
  SkeletonJson,
  Skin,
  type StringMap,
  type TextureAtlas,
  TimeKeeper,
  type TrackEntry,
  Vector2,
} from '@esotericsoftware/spine-core';
import type { FjsCanvasContext2D } from '@ufjs/runtime';

import { AssetManager } from './AssetManager';
import type { CanvasTexture } from './CanvasTexture';
import { SkeletonRenderer } from './SkeletonRenderer';

export interface SpinePlayerConfig {
  /* The URL of the skeleton JSON (.json) or binary (.skel) file */
  skeleton: string;

  /* Optional: The name of a field in the JSON that holds the skeleton data. Default: none */
  jsonField?: string;

  /* The scale when loading the skeleton data. Default: 1 */
  scale?: number;

  /* The URL of the skeleton atlas file (.atlas). Atlas page images are automatically resolved. */
  atlas: string;

  /* Raw data URIs, mapping a path to base64 encoded raw data. Default: none */
  rawDataURIs?: StringMap<string>;

  /* Optional: The name of the animation to be played. Default: empty animation, paused */
  animation?: string;

  /* Optional: List of animation names that play() may pick from. Default: all animations */
  animations?: string[];

  /* Optional: The default mix time used to switch between two animations. Default: 0.25 */
  defaultMix?: number;

  /* Optional: The name of the skin or list of skins to be set. Default: the default skin */
  skin?: string | string[];

  /* Optional: List of skin names from which the user can choose. Default: all skins */
  skins?: string[];

  /* Optional: Debug drawing. true/false toggles all. Default: none */
  debug?: boolean | { bones?: boolean; regions?: boolean; meshes?: boolean; bounds?: boolean };

  /* Optional: Viewport in the skeleton's world coordinates. Default: the bounding box that fits
     the current animation, 10% padding, 0.25 transition time */
  viewport?: {
    x?: number;
    y?: number;
    width?: number;
    height?: number;
    /* Optional: When true, drawing won't go outside the viewport. Default: false */
    clip?: boolean;
    /* Optional: Padding, a number (world units) or percentage (eg "25%"). Default: 10% */
    padLeft?: string | number;
    padRight?: string | number;
    padTop?: string | number;
    padBottom?: string | number;
    /* Optional: Whether to draw lines showing the viewport bounds. Default: false */
    debugRender?: boolean;
    /* Optional: When the current viewport changes, the time to animate to the new viewport. Default: 0.25 */
    transitionTime?: number;
    /* Optional: Viewports for specific animations. Default: none */
    animations?: StringMap<Partial<Viewport>>;
  };

  /* Optional: Background color, #rrggbb or #rrggbbaa. Default: none (the canvas stays transparent,
     so the page's CSS background shows — upstream defaults to black because its canvas is a WebGL surface) */
  backgroundColor?: string;

  /* Optional: An image to draw behind the skeleton. Default: none */
  backgroundImage?: {
    url: string;
    /* Optional: Position and size in the skeleton's world coordinates. Default: fills the viewport */
    x?: number;
    y?: number;
    width?: number;
    height?: number;
  };

  /* Optional: Render mesh attachments (SkeletonRenderer.triangleRendering). Default: true —
     most skeletons have meshes; false draws region attachments only and is cheaper on the app */
  triangleRendering?: boolean;

  /* Optional: Whether handleTouch drags control bones. Default: true */
  interactive?: boolean;

  /* Optional: List of bone names that the user can drag to position. Default: none */
  controlBones?: string[];

  /* Optional: Callback when the skeleton and its assets have been successfully loaded. If an animation is set on track 0,
     the player won't set its own animation. Default: none */
  success?: (player: SpinePlayer) => void;

  /* Optional: Callback when the skeleton could not be loaded or rendered. Default: none */
  error?: (player: SpinePlayer, msg: string) => void;

  /* Optional: Callback at the start of each frame, before the skeleton is posed or drawn. Default: none */
  frame?: (player: SpinePlayer, delta: number) => void;

  /* Optional: Callback to update the skeleton's world transform. Default: skeleton.updateWorldTransform(Physics.update) */
  updateWorldTransform?: (player: SpinePlayer, delta: number) => void;

  /* Optional: Callback after the skeleton is posed each frame, before it is drawn. Default: none */
  update?: (player: SpinePlayer, delta: number) => void;

  /* Optional: Callback after the skeleton is drawn each frame. Default: none */
  draw?: (player: SpinePlayer, delta: number) => void;

  /* Optional: Callback each frame before the skeleton is loaded. Default: none */
  loading?: (player: SpinePlayer, delta: number) => void;

  /* Optional: The downloader used by the player's asset manager. Default: new instance */
  downloader?: Downloader;
}

export interface Viewport {
  x: number;
  y: number;
  width: number;
  height: number;
  padLeft: string | number;
  padRight: string | number;
  padTop: string | number;
  padBottom: string | number;
  clip?: boolean;
}

/** Control-bone handle radius and touch slop, in logical canvas pixels. */
const HANDLE_RADIUS = 10;
const HANDLE_SLOP = 24;

export class SpinePlayer implements Disposable {
  public readonly context: FjsCanvasContext2D;
  public readonly renderer: SkeletonRenderer;
  public readonly assetManager: AssetManager;

  /* True if the player is unable to load or render the skeleton. */
  public error = false;
  /* The player's skeleton. Null until loading is complete (access after config.success). */
  public skeleton: Skeleton | null = null;
  /* The animation state controlling the skeleton. Null until loading is complete (access after config.success). */
  public animationState: AnimationState | null = null;

  public paused = true;
  public speed = 1;
  public time = new TimeKeeper();

  /** Logical canvas size, from resize(). Nothing is drawn while it is 0. */
  private width = 0;
  private height = 0;

  /** Held by reference, as upstream: changing a field (debug, viewport.debugRender,
   * triangleRendering, controlBones …) takes effect on the next frame. */
  public readonly config: SpinePlayerConfig;
  private background: string | null = null;
  private pinnedSkins = new Set<string>();
  private selectedBones: (Bone | null)[] = [];
  private dragTarget: Bone | null = null;
  private dragOffset = new Vector2();
  private clipper = new SkeletonClipping();

  private viewport: Viewport = {} as Viewport;
  private currentViewport: Viewport = {} as Viewport;
  private previousViewport: Viewport | null = null;
  private viewportTransitionStart = 0;
  /** The camera of the last drawn frame, so touches map to what is on screen. */
  private camera = { x: 0, y: 0, zoom: 1 };

  private raf = 0;
  private stopRequestAnimationFrame = false;
  private disposed = false;

  constructor(context: FjsCanvasContext2D, config: SpinePlayerConfig) {
    this.context = context;
    this.config = config;
    this.renderer = new SkeletonRenderer(context);
    this.assetManager = new AssetManager('', config.downloader);

    try {
      this.validateConfig(config);
    } catch (e) {
      this.showError((e as Error).message);
    }

    if (config.rawDataURIs) {
      for (const path in config.rawDataURIs) this.assetManager.setRawDataURI(path, config.rawDataURIs[path]);
    }
    if (config.skeleton.endsWith('.json')) this.assetManager.loadJson(config.skeleton);
    else this.assetManager.loadBinary(config.skeleton);
    this.assetManager.loadTextureAtlas(config.atlas);
    if (config.backgroundImage) this.assetManager.loadTexture(config.backgroundImage.url);
    if (config.backgroundColor) this.background = cssColor(new Color().setFromString(config.backgroundColor));

    this.startRendering();
  }

  /** Sets the logical canvas size. Call it from `<canvas @resize>`. */
  resize(width: number, height: number): void {
    this.width = width;
    this.height = height;
    if (this.paused) this.drawFrame(false);
  }

  dispose(): void {
    this.stopRendering();
    this.assetManager.dispose();
    this.disposed = true;
  }

  private validateConfig(config: SpinePlayerConfig): void {
    if (!config) throw new Error('A configuration object must be passed to to new SpinePlayer().');
    if (!config.skeleton) throw new Error('A URL must be specified for the skeleton JSON or binary file.');
    if (!config.scale) config.scale = 1;
    if (!config.atlas) throw new Error('A URL must be specified for the atlas file.');
    if (config.backgroundImage && !config.backgroundImage.url) config.backgroundImage = undefined;
    if (config.interactive === void 0) config.interactive = true;
    if (config.triangleRendering === void 0) config.triangleRendering = true;
    if (typeof config.debug !== 'object') {
      const d = !!config.debug;
      config.debug = { bones: d, regions: d, meshes: d, bounds: d };
    }
    if (config.animations && config.animation && config.animations.indexOf(config.animation) < 0)
      throw new Error(`Animation '${config.animation}' is not in the config animation list: ${JSON.stringify(config.animations)}`);
    if (config.skin) {
      if (!Array.isArray(config.skin)) config.skin = [config.skin];
      if (config.skins) {
        for (const s of config.skin) {
          if (config.skins.indexOf(s) < 0)
            throw new Error(`Default skin '${s}' is not in the config skins list: ${JSON.stringify(config.skins)}`);
        }
      }
    }
    if (!config.viewport) config.viewport = {};
    if (!config.viewport.animations) config.viewport.animations = {};
    if (config.viewport.debugRender === void 0) config.viewport.debugRender = false;
    if (config.viewport.transitionTime === void 0) config.viewport.transitionTime = 0.25;
    if (!config.controlBones) config.controlBones = [];
    if (config.defaultMix === void 0) config.defaultMix = 0.25;
  }

  private loadSkeleton(): void {
    if (this.error) return;

    if (this.assetManager.hasErrors())
      this.showError(`Error: Assets could not be loaded.\n${JSON.stringify(this.assetManager.getErrors())}`);

    const config = this.config;
    const atlas = this.assetManager.require(config.atlas) as TextureAtlas;

    let skeletonData: SkeletonData;
    try {
      const attachmentLoader = new AtlasAttachmentLoader(atlas);
      let data = this.assetManager.remove(config.skeleton) as unknown;
      let loader: SkeletonJson | SkeletonBinary;
      if (config.skeleton.endsWith('.json')) {
        if (!data) throw new Error('Empty JSON data.');
        if (config.jsonField) {
          data = (data as Record<string, unknown>)[config.jsonField];
          if (!data) throw new Error(`JSON field does not exist: ${config.jsonField}`);
        }
        loader = new SkeletonJson(attachmentLoader);
      } else {
        loader = new SkeletonBinary(attachmentLoader);
      }
      loader.scale = config.scale!;
      skeletonData = loader.readSkeletonData(data as never);
    } catch (e) {
      this.showError(`Error: Could not load skeleton data.\n${(e as Error).message}`);
      return;
    }
    this.skeleton = new Skeleton(skeletonData);
    const stateData = new AnimationStateData(skeletonData);
    stateData.defaultMix = config.defaultMix!;
    this.animationState = new AnimationState(stateData);

    for (const bone of config.controlBones!) {
      if (!skeletonData.findBone(bone)) this.showError(`Error: Control bone does not exist in skeleton: ${bone}`);
    }
    this.selectedBones = new Array<Bone | null>(config.controlBones!.length).fill(null);

    // Setup skin.
    if ((!config.skin || !config.skin.length) && skeletonData.skins.length) config.skin = [skeletonData.skins[0].name];
    if (config.skins && config.skin!.length) {
      for (const skin of config.skins) {
        if (!skeletonData.findSkin(skin)) this.showError(`Error: Skin in config list does not exist in skeleton: ${skin}`);
      }
    }
    const skinList = config.skin as string[];
    if (skinList?.length) {
      for (const s of skinList) {
        if (!skeletonData.findSkin(s)) this.showError(`Error: Skin does not exist in skeleton: ${s}`);
        if (skeletonData.findSkin(s) !== skeletonData.defaultSkin) this.pinnedSkins.add(s);
      }
      this.applyCombinedSkin();
    }

    // Check if all animations given a viewport exist.
    for (const animation of Object.getOwnPropertyNames(config.viewport!.animations)) {
      if (!skeletonData.findAnimation(animation))
        this.showError(`Error: Animation for which a viewport was specified does not exist in skeleton: ${animation}`);
    }

    if (config.animations && config.animations.length) {
      for (const animation of config.animations) {
        if (!skeletonData.findAnimation(animation))
          this.showError(`Error: Animation in config list does not exist in skeleton: ${animation}`);
      }
      if (!config.animation) config.animation = config.animations[0];
    }

    if (config.animation && !skeletonData.findAnimation(config.animation))
      this.showError(`Error: Animation does not exist in skeleton: ${config.animation}`);

    if (config.success) config.success(this);

    let entry = this.animationState.getTrack(0);
    if (!entry) {
      if (config.animation) {
        this.setAnimation(config.animation);
        this.play();
      } else {
        entry = this.animationState.setEmptyAnimation(0);
        entry.trackEnd = 100000000;
        this.skeleton.updateWorldTransform(Physics.update);
        this.setViewport(entry.animation!);
        this.pause();
      }
    } else {
      if (this.currentViewport.x === undefined) this.setViewport(entry.animation!);
      if (!config.animation) config.animation = entry.animation?.name;
      this.play();
    }
  }

  play(): void {
    this.paused = false;
    // Upstream picks an animation when play is pressed on an empty track.
    const config = this.config;
    if (!config.animation && this.skeleton) {
      if (config.animations && config.animations.length) config.animation = config.animations[0];
      else if (this.skeleton.data.animations.length) config.animation = this.skeleton.data.animations[0].name;
      if (config.animation) this.setAnimation(config.animation);
    }
  }

  pause(): void {
    this.paused = true;
  }

  /* Sets a new animation and viewport on track 0. */
  setAnimation(animation: string | Animation, loop = true): TrackEntry {
    animation = this.setViewport(animation);
    this.config.animation = animation.name;
    return this.animationState!.setAnimation(0, animation, loop);
  }

  /* Adds a new animation and viewport on track 0. */
  addAnimation(animation: string | Animation, loop = true, delay = 0): TrackEntry {
    animation = this.setViewport(animation);
    return this.animationState!.addAnimation(0, animation, loop, delay);
  }

  /** Animations the player offers: the config whitelist, else all. */
  getAnimationNames(): string[] {
    if (!this.skeleton) return [];
    const all = this.skeleton.data.animations.map((animation) => animation.name);
    return this.config.animations ? all.filter((name) => this.config.animations!.indexOf(name) >= 0) : all;
  }

  /** Skins the player offers (default skin excluded): the config whitelist, else all. */
  getSkinNames(): string[] {
    if (!this.skeleton) return [];
    const data = this.skeleton.data;
    return data.skins
      .filter((skin) => skin !== data.defaultSkin && (!this.config.skins || this.config.skins.indexOf(skin.name) >= 0))
      .map((skin) => skin.name);
  }

  /** Pinned skins, combined — what upstream's skins popup toggles. */
  setSkins(names: string[]): void {
    this.pinnedSkins = new Set(names);
    this.applyCombinedSkin();
  }

  /** Track 0's position in its animation, 0..1 — upstream's timeline slider value. */
  getProgress(): number {
    const entry = this.animationState?.getTrack(0);
    const duration = entry?.animation?.duration ?? 0;
    return entry && duration ? entry.getAnimationTime() / duration : 0;
  }

  /** Pauses and jumps track 0 to a position (0..1) — upstream's timeline slider change. */
  seek(progress: number): void {
    const entry = this.animationState?.getTrack(0);
    if (!entry || !entry.animation || !this.skeleton) return;
    this.pause();
    const duration = entry.animation.duration;
    const time = duration * Math.max(0, Math.min(1, progress));
    const delta = time - entry.getAnimationTime();
    entry.trackTime = Math.max(0, time - entry.animationStart);
    this.animationState!.apply(this.skeleton);
    this.skeleton.update(delta);
    this.skeleton.updateWorldTransform(Physics.update);
    this.drawFrame(false);
  }

  /* Sets the viewport for the specified animation. */
  setViewport(animation: string | Animation): Animation {
    if (typeof animation === 'string') {
      const foundAnimation = this.skeleton!.data.findAnimation(animation);
      if (!foundAnimation) throw new Error(`Animation not found: ${animation}`);
      animation = foundAnimation;
    }

    this.previousViewport = this.currentViewport;

    // Determine the base viewport.
    const globalViewport = this.config.viewport!;
    const viewport = (this.currentViewport = {
      clip: globalViewport.clip,
      padLeft: globalViewport.padLeft !== void 0 ? globalViewport.padLeft : '10%',
      padRight: globalViewport.padRight !== void 0 ? globalViewport.padRight : '10%',
      padTop: globalViewport.padTop !== void 0 ? globalViewport.padTop : '10%',
      padBottom: globalViewport.padBottom !== void 0 ? globalViewport.padBottom : '10%',
    } as Viewport);
    if (globalViewport.x !== void 0 && globalViewport.y !== void 0 && globalViewport.width && globalViewport.height) {
      viewport.x = globalViewport.x;
      viewport.y = globalViewport.y;
      viewport.width = globalViewport.width;
      viewport.height = globalViewport.height;
    } else this.calculateAnimationViewport(animation, viewport);

    // Override with the animation specific viewport for the final result.
    const userAnimViewport = globalViewport.animations![animation.name];
    if (userAnimViewport) {
      if (userAnimViewport.x !== void 0 && userAnimViewport.y !== void 0 && userAnimViewport.width && userAnimViewport.height) {
        viewport.x = userAnimViewport.x;
        viewport.y = userAnimViewport.y;
        viewport.width = userAnimViewport.width;
        viewport.height = userAnimViewport.height;
      }
      if (userAnimViewport.clip !== void 0) viewport.clip = userAnimViewport.clip;
      if (userAnimViewport.padLeft !== void 0) viewport.padLeft = userAnimViewport.padLeft;
      if (userAnimViewport.padRight !== void 0) viewport.padRight = userAnimViewport.padRight;
      if (userAnimViewport.padTop !== void 0) viewport.padTop = userAnimViewport.padTop;
      if (userAnimViewport.padBottom !== void 0) viewport.padBottom = userAnimViewport.padBottom;
    }

    // Translate percentage padding to world units.
    viewport.padLeft = percentageToWorldUnit(viewport.width, viewport.padLeft);
    viewport.padRight = percentageToWorldUnit(viewport.width, viewport.padRight);
    viewport.padBottom = percentageToWorldUnit(viewport.height, viewport.padBottom);
    viewport.padTop = percentageToWorldUnit(viewport.height, viewport.padTop);

    this.viewportTransitionStart = Date.now();
    return animation;
  }

  private calculateAnimationViewport(animation: Animation, viewport: Viewport): void {
    const skeleton = this.skeleton!;
    skeleton.setupPose();

    const steps = 100;
    const stepTime = animation.duration ? animation.duration / steps : 0;
    let time = 0;
    let minX = 100000000,
      maxX = -100000000,
      minY = 100000000,
      maxY = -100000000;
    const offset = new Vector2(),
      size = new Vector2();

    const tempArray = [0, 0];
    for (let i = 0; i < steps; i++, time += stepTime) {
      animation.apply(skeleton, time, time, false, [], 1, MixFrom.setup, false, false, false);
      skeleton.updateWorldTransform(Physics.update);
      skeleton.getBounds(offset, size, tempArray, this.clipper);

      if (Number.isFinite(offset.x) && Number.isFinite(offset.y) && Number.isFinite(size.x) && Number.isFinite(size.y)) {
        minX = Math.min(offset.x, minX);
        maxX = Math.max(offset.x + size.x, maxX);
        minY = Math.min(offset.y, minY);
        maxY = Math.max(offset.y + size.y, maxY);
      }
    }

    viewport.x = minX;
    viewport.y = minY;
    viewport.width = maxX - minX;
    viewport.height = maxY - minY;

    if (!Number.isFinite(viewport.width) || !Number.isFinite(viewport.height))
      this.showError(`Animation bounds are invalid: ${animation.name}`);
  }

  private applyCombinedSkin(): void {
    const skeleton = this.skeleton;
    if (!skeleton) return;
    if (this.pinnedSkins.size === 0) {
      skeleton.setSkin(skeleton.data.defaultSkin!);
    } else if (this.pinnedSkins.size === 1) {
      skeleton.setSkin(this.pinnedSkins.values().next().value!);
    } else {
      const combined = new Skin('fjs-player-combined');
      for (const name of this.pinnedSkins) {
        const skin = skeleton.data.findSkin(name);
        if (skin) combined.addSkin(skin);
      }
      skeleton.setSkin(combined);
    }
    skeleton.setupPoseSlots();
    skeleton.updateWorldTransform(Physics.pose);

    // Recalculate the viewport for the current animation since skin changes affect bounds.
    const entry = this.animationState?.getTrack(0);
    if (entry && entry.animation) this.setViewport(entry.animation);
  }

  // ---- input ---------------------------------------------------------------

  /** Forward a touch in logical canvas pixels (fjs `touch.offsetX / offsetY`).
   * Drags the nearest control bone, like upstream's Input listener. Returns
   * true while a bone is being dragged, so a page can skip its own tap logic. */
  handleTouch(type: 'start' | 'move' | 'end', x: number, y: number): boolean {
    if (!this.config.interactive || !this.skeleton || !this.config.controlBones!.length) return false;
    if (type === 'start') {
      this.dragTarget = this.closestControlBone(x, y);
      return !!this.dragTarget;
    }
    if (type === 'end') {
      const dragging = !!this.dragTarget;
      this.dragTarget = null;
      return dragging;
    }
    const target = this.dragTarget;
    if (!target) {
      this.closestControlBone(x, y);
      return false;
    }
    const skeleton = this.skeleton;
    const sx = Math.max(0, Math.min(this.width, x + this.dragOffset.x));
    const sy = Math.max(0, Math.min(this.height, y + this.dragOffset.y));
    const world = this.screenToWorld(sx, sy);
    const applied = target.appliedPose;
    if (target.parent) {
      const local = target.parent.appliedPose.worldToLocal(new Vector2(world.x - skeleton.x, world.y - skeleton.y));
      applied.x = local.x;
      applied.y = local.y;
    } else {
      applied.x = world.x - skeleton.x;
      applied.y = world.y - skeleton.y;
    }
    if (this.paused) {
      skeleton.updateWorldTransform(Physics.update);
      this.drawFrame(false);
    }
    return true;
  }

  private closestControlBone(x: number, y: number): Bone | null {
    const controlBones = this.config.controlBones!;
    const skeleton = this.skeleton!;
    let bestDistance = HANDLE_SLOP;
    let best: Bone | null = null;
    let index = 0;
    for (let i = 0; i < controlBones.length; i++) {
      this.selectedBones[i] = null;
      const bone = skeleton.findBone(controlBones[i]);
      if (!bone) continue;
      const screen = this.worldToScreen(skeleton.x + bone.appliedPose.worldX, skeleton.y + bone.appliedPose.worldY);
      const distance = Math.hypot(screen.x - x, screen.y - y);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = bone;
        index = i;
        this.dragOffset.x = screen.x - x;
        this.dragOffset.y = screen.y - y;
      }
    }
    if (best) this.selectedBones[index] = best;
    return best;
  }

  private worldToScreen(x: number, y: number): Vector2 {
    const { camera } = this;
    return new Vector2((x - camera.x) / camera.zoom + this.width / 2, this.height / 2 - (y - camera.y) / camera.zoom);
  }

  private screenToWorld(x: number, y: number): Vector2 {
    const { camera } = this;
    return new Vector2((x - this.width / 2) * camera.zoom + camera.x, (this.height / 2 - y) * camera.zoom + camera.y);
  }

  // ---- frame loop ----------------------------------------------------------

  private drawFrame(requestNextFrame = true): void {
    try {
      if (this.error || this.disposed) return;
      if (requestNextFrame && !this.stopRequestAnimationFrame) {
        this.raf = requestAnimationFrame(() => this.drawFrame());
      }

      this.time.update();
      const delta = requestNextFrame ? this.time.delta : 0;

      // Load the skeleton if the assets are ready.
      const loading = !this.assetManager.isLoadingComplete();
      if (!this.skeleton && !loading) this.loadSkeleton();
      const skeleton = this.skeleton;
      const config = this.config;
      const ctx = this.context;
      const { width, height } = this;

      if (skeleton && width > 0 && height > 0) {
        const playDelta = this.paused ? 0 : delta * this.speed;
        if (config.frame) config.frame(this, playDelta);

        // Update animation time and pose the skeleton.
        if (!this.paused) {
          skeleton.update(playDelta);
          this.animationState!.update(playDelta);
          this.animationState!.apply(skeleton);
          if (config.updateWorldTransform) config.updateWorldTransform(this, playDelta);
          else skeleton.updateWorldTransform(Physics.update);
        }

        // Determine the viewport.
        const viewport = this.viewport;
        const current = this.currentViewport;
        viewport.x = current.x - (current.padLeft as number);
        viewport.y = current.y - (current.padBottom as number);
        viewport.width = current.width + (current.padLeft as number) + (current.padRight as number);
        viewport.height = current.height + (current.padBottom as number) + (current.padTop as number);

        const previous = this.previousViewport;
        if (previous && previous.x !== undefined) {
          const transitionAlpha = (Date.now() - this.viewportTransitionStart) / 1000 / config.viewport!.transitionTime!;
          if (transitionAlpha < 1) {
            const x = previous.x - (previous.padLeft as number);
            const y = previous.y - (previous.padBottom as number);
            const w = previous.width + (previous.padLeft as number) + (previous.padRight as number);
            const h = previous.height + (previous.padBottom as number) + (previous.padTop as number);
            viewport.x = x + (viewport.x - x) * transitionAlpha;
            viewport.y = y + (viewport.y - y) * transitionAlpha;
            viewport.width = w + (viewport.width - w) * transitionAlpha;
            viewport.height = h + (viewport.height - h) * transitionAlpha;
          }
        }

        // Camera: upstream's OrthoCamera zoom (world units per pixel), fitting the viewport.
        const camera = this.camera;
        camera.zoom = height / width > viewport.height / viewport.width ? viewport.width / width : viewport.height / height;
        camera.x = viewport.x + viewport.width / 2;
        camera.y = viewport.y + viewport.height / 2;

        // A full-canvas clear is what lets the app host drop the previous
        // frame's commands; drawn before any transform so it covers the canvas.
        ctx.clearRect(0, 0, width, height);
        if (this.background) {
          ctx.fillStyle = this.background;
          ctx.fillRect(0, 0, width, height);
        }

        if (config.update) config.update(this, playDelta);

        // World space, y up: relative transforms only, the web surface has
        // already scaled for devicePixelRatio.
        ctx.save();
        ctx.translate(width / 2, height / 2);
        ctx.scale(1 / camera.zoom, -1 / camera.zoom);
        ctx.translate(-camera.x, -camera.y);

        if (current.clip) {
          ctx.beginPath();
          ctx.rect(viewport.x, viewport.y, viewport.width, viewport.height);
          ctx.clip();
        }

        const bgImage = config.backgroundImage;
        if (bgImage) {
          const image = (this.assetManager.require(bgImage.url) as CanvasTexture).getImage();
          const hasRect = bgImage.x !== void 0 && bgImage.y !== void 0 && bgImage.width && bgImage.height;
          const x = hasRect ? bgImage.x! : viewport.x;
          const y = hasRect ? bgImage.y! : viewport.y;
          const w = hasRect ? bgImage.width! : viewport.width;
          const h = hasRect ? bgImage.height! : viewport.height;
          ctx.save();
          ctx.translate(x, y + h);
          ctx.scale(1, -1); // images are y-down
          ctx.drawImage(image, 0, 0, w, h);
          ctx.restore();
        }

        // Draw the skeleton and debug output.
        const debug = config.debug as { bones?: boolean; regions?: boolean; meshes?: boolean; bounds?: boolean };
        this.renderer.triangleRendering = !!config.triangleRendering;
        this.renderer.debugRendering = !!(debug.regions || debug.meshes);
        this.renderer.draw(skeleton);
        if (debug.bones) this.drawBones(skeleton);
        if (debug.bounds) this.drawBounds(skeleton);

        // Draw the control bones.
        const controlBones = config.controlBones!;
        for (let i = 0; i < controlBones.length; i++) {
          const bone = skeleton.findBone(controlBones[i]);
          if (!bone) continue;
          const selected = !!this.selectedBones[i];
          const applied = bone.appliedPose;
          ctx.beginPath();
          ctx.arc(skeleton.x + applied.worldX, skeleton.y + applied.worldY, HANDLE_RADIUS * camera.zoom, 0, Math.PI * 2);
          ctx.fillStyle = selected ? BONE_INNER_OVER : BONE_INNER;
          ctx.fill();
          ctx.lineWidth = 2 * camera.zoom;
          ctx.strokeStyle = selected ? BONE_OUTER_OVER : BONE_OUTER;
          ctx.stroke();
        }

        // Draw the viewport bounds.
        if (config.viewport!.debugRender) {
          ctx.lineWidth = camera.zoom;
          ctx.strokeStyle = '#00ff00';
          ctx.strokeRect(current.x, current.y, current.width, current.height);
          ctx.strokeStyle = '#ff0000';
          ctx.strokeRect(viewport.x, viewport.y, viewport.width, viewport.height);
        }

        ctx.restore();

        if (config.draw) config.draw(this, playDelta);
      }

      if (loading && config.loading) config.loading(this, delta);
    } catch (e) {
      this.showError(`Error: Unable to render skeleton.\n${(e as Error).message}`);
    }
  }

  private drawBones(skeleton: Skeleton): void {
    const ctx = this.context;
    ctx.lineWidth = 2 * this.camera.zoom;
    ctx.strokeStyle = '#ff0000';
    ctx.beginPath();
    for (const bone of skeleton.bones) {
      if (!bone.active) continue;
      const pose = bone.appliedPose;
      const length = bone.data.length;
      const x = skeleton.x + pose.worldX;
      const y = skeleton.y + pose.worldY;
      ctx.moveTo(x, y);
      ctx.lineTo(x + length * pose.a, y + length * pose.c);
    }
    ctx.stroke();
  }

  private drawBounds(skeleton: Skeleton): void {
    const offset = new Vector2(),
      size = new Vector2();
    skeleton.getBounds(offset, size, [0, 0], this.clipper);
    if (!Number.isFinite(size.x) || !Number.isFinite(size.y)) return;
    const ctx = this.context;
    ctx.lineWidth = this.camera.zoom;
    ctx.strokeStyle = '#00ff00';
    ctx.strokeRect(offset.x, offset.y, size.x, size.y);
  }

  startRendering(): void {
    this.stopRequestAnimationFrame = false;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.time.update(); // don't count the time spent stopped as one long frame
    this.raf = requestAnimationFrame(() => this.drawFrame());
  }

  stopRendering(): void {
    this.stopRequestAnimationFrame = true;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  /** Upstream replaces the player with an HTML error box and throws. Here the
   * message is painted onto the canvas and handed to config.error; throwing
   * would only surface as an uncaught error inside a frame callback. */
  private showError(message: string): void {
    if (this.error) return;
    this.error = true;
    this.stopRendering();
    console.warn(`[fjs/spine] ${message}`);
    if (this.config.error) this.config.error(this, message);
    const ctx = this.context;
    if (this.width > 0 && this.height > 0) {
      ctx.clearRect(0, 0, this.width, this.height);
      ctx.save();
      ctx.fillStyle = '#e64340';
      ctx.font = '13px sans-serif';
      ctx.textBaseline = 'top';
      message.split('\n').forEach((line, i) => ctx.fillText(line, 8, 8 + i * 18));
      ctx.restore();
    }
  }
}

function percentageToWorldUnit(size: number, percentageOrAbsolute: string | number): number {
  if (typeof percentageOrAbsolute === 'string') return (size * parseFloat(percentageOrAbsolute.slice(0, -1))) / 100;
  return percentageOrAbsolute;
}

function cssColor(color: Color): string {
  return `rgba(${Math.round(color.r * 255)}, ${Math.round(color.g * 255)}, ${Math.round(color.b * 255)}, ${color.a})`;
}

// upstream's control-bone colours, as CSS
const BONE_INNER = 'rgba(122, 0, 0, 0.5)';
const BONE_OUTER = 'rgba(255, 0, 0, 0.8)';
const BONE_INNER_OVER = 'rgba(122, 0, 0, 0.25)';
const BONE_OUTER_OVER = 'rgba(255, 255, 255, 1)';
