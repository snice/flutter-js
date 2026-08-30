// Base stylesheet for the web adapter: makes the fjs tag set lay out the
// way flutter_jsc's widget layer does.
//
// The two big alignments with Flutter:
//   * every container is a column flexbox with border-box sizing, because
//     Flutter puts padding inside the sized/decorated box and margin outside
//   * `stack` overlaps its children (CSS grid, all children in cell 1/1),
//     which is what Flutter's Stack does
//
// Known difference: a `flex-direction: row` container centers its children
// on the cross axis in Flutter and stretches them in CSS. Set `align-items`
// explicitly when it matters — see docs/web.md.
export const BASE_CSS = `
*, *::before, *::after { box-sizing: border-box; }
html, body { margin: 0; padding: 0; height: 100%; }
body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC',
    'Hiragino Sans GB', 'Microsoft YaHei', sans-serif;
  font-size: 14px;
  color: #333333;
  background: #f4f5f7;
  -webkit-font-smoothing: antialiased;
}
#app { height: 100%; display: flex; flex-direction: column; }

view, scroll-view, list-view, safe-area, refresh, swiper-item,
fjs-modal-sheet, switch, checkbox, progress-bar {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  min-width: 0;
  min-height: 0;
}

text {
  display: block;
  /* template whitespace is already condensed by the Vue compiler, so
     pre-line only preserves the newlines the app itself put in a string */
  white-space: pre-line;
  min-width: 0;
}

.fjs-image { display: block; object-fit: cover; max-width: 100%; }

scroll-view, list-view { overflow: auto; -webkit-overflow-scrolling: touch; }
scroll-view[direction="horizontal"], list-view[direction="horizontal"] {
  flex-direction: row;
  overflow-x: auto;
  overflow-y: hidden;
}

stack { display: grid; position: relative; }
stack > * { grid-area: 1 / 1; }

safe-area {
  padding-top: env(safe-area-inset-top, 0px);
  padding-bottom: env(safe-area-inset-bottom, 0px);
  padding-left: env(safe-area-inset-left, 0px);
  padding-right: env(safe-area-inset-right, 0px);
}

divider {
  display: block;
  height: 16px;
  border: 0;
  background:
    linear-gradient(currentColor, currentColor) center / 100% 1px no-repeat;
  color: #e0e0e0;
}

.fjs-button {
  font: inherit;
  color: #007aff;
  background: transparent;
  border: 1px solid rgba(0, 0, 0, 0.16);
  border-radius: 8px;
  padding: 10px 16px;
  cursor: pointer;
  text-align: center;
  min-width: 0;
}
.fjs-button:disabled { opacity: 0.5; cursor: default; }

.fjs-input {
  font: inherit;
  color: inherit;
  background: transparent;
  border: 0;
  outline: 0;
  padding: 8px 0;
  min-width: 0;
}
textarea.fjs-input { resize: vertical; min-height: 72px; }

.fjs-switch {
  display: inline-flex;
  flex: 0 0 auto;
  align-self: center;
  width: 51px;
  height: 31px;
  padding: 2px;
  border-radius: 16px;
  background: #e5e5ea;
  transition: background 0.15s ease;
  cursor: pointer;
}
.fjs-switch.on { background: #34c759; }
.fjs-switch.disabled { opacity: 0.5; cursor: default; }
.fjs-switch-knob {
  width: 27px;
  height: 27px;
  border-radius: 50%;
  background: #ffffff;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3);
  transition: transform 0.15s ease;
}
.fjs-switch.on .fjs-switch-knob { transform: translateX(20px); }

.fjs-checkbox {
  display: inline-flex;
  flex: 0 0 auto;
  align-self: center;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border: 2px solid #b0b0b0;
  border-radius: 4px;
  cursor: pointer;
}
.fjs-checkbox.on { background: #007aff; border-color: #007aff; }
.fjs-checkbox.disabled { opacity: 0.5; cursor: default; }
.fjs-check {
  width: 10px;
  height: 5px;
  border-left: 2px solid #ffffff;
  border-bottom: 2px solid #ffffff;
  transform: translateY(-1px) rotate(-45deg);
}

.fjs-slider { width: 100%; accent-color: #007aff; }

.fjs-progress {
  display: block;
  height: 4px;
  border-radius: 2px;
  background: rgba(0, 122, 255, 0.2);
  overflow: hidden;
}
.fjs-progress-fill { display: block; height: 100%; background: #007aff; }
.fjs-progress.indeterminate .fjs-progress-fill {
  width: 40%;
  animation: fjs-indeterminate 1.2s ease-in-out infinite;
}
@keyframes fjs-indeterminate {
  0% { transform: translateX(-100%); }
  100% { transform: translateX(250%); }
}
.fjs-progress-ring {
  display: block;
  width: 32px;
  height: 32px;
  border: 3px solid rgba(0, 122, 255, 0.25);
  border-top-color: #007aff;
  border-radius: 50%;
  animation: fjs-spin 0.9s linear infinite;
}
@keyframes fjs-spin { to { transform: rotate(360deg); } }

.fjs-swiper {
  display: flex;
  flex-direction: row;
  height: 200px;
  overflow-x: auto;
  overflow-y: hidden;
  scroll-snap-type: x mandatory;
  scrollbar-width: none;
}
.fjs-swiper::-webkit-scrollbar { display: none; }
.fjs-swiper-item { flex: 0 0 100%; scroll-snap-align: start; }

.fjs-refresh { position: relative; overflow: auto; }
.fjs-refresh-hint {
  display: block;
  text-align: center;
  font-size: 12px;
  color: #999999;
  height: 0;
  overflow: hidden;
  transition: height 0.2s ease;
}
.fjs-refresh-hint.active { height: 28px; line-height: 28px; }

.fjs-modal {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
}
.fjs-modal-mask { position: absolute; inset: 0; background: rgba(0, 0, 0, 0.4); }
.fjs-modal-sheet {
  position: relative;
  background: #ffffff;
  border-radius: 12px 12px 0 0;
  padding: 16px;
  max-height: 80%;
  overflow: auto;
  animation: fjs-sheet-in 0.22s ease;
}
@keyframes fjs-sheet-in { from { transform: translateY(100%); } }

/* page transition (web mirror of the native push animation). The host
   gives the leaving page something to be absolutely positioned against, so
   the two pages overlap for the length of the crossfade instead of
   stacking. */
fjs-page-host {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  flex-grow: 1;
  min-height: 0;
  position: relative;
}
.fjs-page-leave-active { position: absolute; inset: 0; }
.fjs-page-enter-active, .fjs-page-leave-active {
  transition: transform 0.2s ease, opacity 0.2s ease;
}
.fjs-page-enter-from { transform: translateX(16px); opacity: 0; }
.fjs-page-leave-to { transform: translateX(-8px); opacity: 0; }

.fjs-toast {
  position: fixed;
  left: 50%;
  bottom: 80px;
  transform: translateX(-50%);
  max-width: 80vw;
  padding: 12px 16px;
  border-radius: 10px;
  background: rgba(34, 34, 34, 0.8);
  color: #ffffff;
  font-size: 14px;
  z-index: 2000;
  pointer-events: none;
}
`;

/** Injects [BASE_CSS] once per document. */
export function installBaseCss(doc: Document = document): void {
  const id = 'fjs-base-css';
  if (doc.getElementById(id)) return;
  const style = doc.createElement('style');
  style.id = id;
  style.textContent = BASE_CSS;
  doc.head.appendChild(style);
}
