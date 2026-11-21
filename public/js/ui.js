// DOM 操作はすべてこのモジュールに集約する（他モジュールは document を触らない）

const $ = (id) => document.getElementById(id);

export const el = {
  overlay: $('ui-overlay'),
  canvasRoot: $('canvas-root'),
  compatStatus: $('compat-status'),
  btnStart: $('btn-start'),
  hudPlaneCount: $('hud-plane-count'),
  hudWarning: $('hud-warning'),
  btnToggleFeed: $('btn-toggle-feed'),
  btnFinish: $('btn-finish'),
  hudPreviewStats: $('hud-preview-stats'),
  btnWireframe: $('btn-wireframe'),
  btnExportGlb: $('btn-export-glb'),
  btnExportObj: $('btn-export-obj'),
  btnReset: $('btn-reset'),
  toast: $('toast'),
};

/** @param {'IDLE'|'AR_SCANNING'|'PREVIEW_EXPORT'} state */
export function showState(state) {
  el.overlay.dataset.state = state;
}

/** @param {{ ok: boolean, message: string }} result */
export function setCompat({ ok, message }) {
  el.compatStatus.textContent = message;
  el.compatStatus.classList.toggle('ok', ok);
  el.compatStatus.classList.toggle('ng', !ok);
  el.btnStart.disabled = !ok;
}

/** @param {{ total: number, horizontal: number, vertical: number, unknown: number }} s */
export function setPlaneStats(s) {
  const extra = s.unknown ? ` / 未分類: ${s.unknown}` : '';
  el.hudPlaneCount.textContent =
    `検出平面: ${s.total}面 (水平: ${s.horizontal} / 垂直: ${s.vertical}${extra})`;
}

/** @param {string|null} message null で非表示 */
export function setWarning(message) {
  el.hudWarning.hidden = !message;
  el.hudWarning.textContent = message ?? '';
}

/** @param {{ planes: number, area: number, vertices: number }} s */
export function setPreviewStats(s) {
  el.hudPreviewStats.textContent =
    `平面 ${s.planes}面 / ${s.area.toFixed(2)} ㎡ / ${s.vertices} 頂点`;
}

export function setPressed(button, pressed, labelOn, labelOff) {
  button.setAttribute('aria-pressed', String(pressed));
  if (labelOn && labelOff) button.textContent = pressed ? labelOn : labelOff;
}

let toastTimer = 0;
export function toast(message, ms = 3000) {
  el.toast.textContent = message;
  el.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.toast.hidden = true; }, ms);
}
