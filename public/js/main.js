// エントリポイント：レンダラ所有・状態遷移（IDLE / AR_SCANNING / PREVIEW_EXPORT）
// 設計: docs/ARCHITECTURE.md §3, §4
import * as THREE from 'three';
import * as ui from './ui.js';
import { XRPlaneSession } from './xr-manager.js';
import { PreviewViewer } from './preview.js';
import { exportGLB, exportOBJ, downloadBlob, timestampedName } from './exporter.js';

const State = Object.freeze({
  IDLE: 'IDLE',
  AR_SCANNING: 'AR_SCANNING',
  PREVIEW_EXPORT: 'PREVIEW_EXPORT',
});

const MSG = {
  unsupported:
    'このアプリはAndroid版Google Chrome（ARCore対応端末）またはMeta Questブラウザで動作します',
  insecure: 'HTTPS（または localhost）で開いてください。WebXR は安全なコンテキストでのみ動作します',
  noPlanes: '平面がまだ検出されていません。床や壁を映して動かしてください',
  tracking: 'トラッキング不安定：明るい場所で特徴のある面を映してください',
  sessionFailed: 'ARセッションを開始できませんでした。この端末/ブラウザは平面検出に未対応の可能性があります',
};

// ---- 共有リソース（レンダラは1つだけ） ----
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.xr.enabled = true;
ui.el.canvasRoot.appendChild(renderer.domElement);

const preview = new PreviewViewer(renderer);

let state = State.IDLE;
/** @type {XRPlaneSession | null} */
let xr = null;
/** @type {THREE.Group | null} */
let mapRoot = null;

function setState(next) {
  state = next;
  ui.showState(next);
}

// ---- IDLE ----
async function checkCompatibility() {
  if (!window.isSecureContext) return { ok: false, message: MSG.insecure };
  if (!navigator.xr) return { ok: false, message: MSG.unsupported };
  try {
    const ok = await navigator.xr.isSessionSupported('immersive-ar');
    return ok
      ? { ok: true, message: 'immersive-ar 対応端末です（平面検出の可否は開始時に判定）' }
      : { ok: false, message: MSG.unsupported };
  } catch {
    return { ok: false, message: MSG.unsupported };
  }
}

// ---- AR_SCANNING ----
async function startScan() {
  xr = new XRPlaneSession(renderer, {
    overlayRoot: ui.el.overlay,
    onStats: ui.setPlaneStats,
    onTracking: (lost) => ui.setWarning(lost ? MSG.tracking : null),
    onEnd: handleSessionEnd,
  });
  ui.setPlaneStats({ total: 0, horizontal: 0, vertical: 0, unknown: 0 });
  ui.setWarning(null);
  ui.setPressed(ui.el.btnToggleFeed, false, '映像 ON', '映像 OFF');
  setState(State.AR_SCANNING);
  try {
    await xr.start();
  } catch (err) {
    console.error(err);
    xr = null;
    setState(State.IDLE);
    ui.toast(`${MSG.sessionFailed}\n(${err.message})`, 6000);
  }
}

/** ボタン終了・システムUIからの終了（Quest等）の両方がここに来る */
function handleSessionEnd(snapshot) {
  xr = null;
  if (!snapshot) {
    setState(State.IDLE);
    return;
  }
  mapRoot = snapshot;
  preview.show(mapRoot);
  ui.setPreviewStats(preview.getStats());
  ui.setPressed(ui.el.btnWireframe, false);
  setState(State.PREVIEW_EXPORT);
}

// ---- PREVIEW_EXPORT ----
async function exportAs(kind) {
  if (!mapRoot) return;
  try {
    const blob = kind === 'glb' ? await exportGLB(mapRoot) : exportOBJ(mapRoot);
    downloadBlob(blob, timestampedName(kind));
  } catch (err) {
    console.error(err);
    ui.toast(`エクスポートに失敗しました: ${err.message}`);
  }
}

function resetAndRescan() {
  preview.dispose();
  mapRoot = null;
  startScan();
}

// ---- イベント配線 ----
ui.el.btnStart.addEventListener('click', startScan);

ui.el.btnFinish.addEventListener('click', () => {
  if (!xr?.finish()) ui.toast(MSG.noPlanes);
});

ui.el.btnToggleFeed.addEventListener('click', () => {
  const hidden = ui.el.btnToggleFeed.getAttribute('aria-pressed') !== 'true';
  xr?.setFeedHidden(hidden);
  ui.setPressed(ui.el.btnToggleFeed, hidden, '映像 ON', '映像 OFF');
});

ui.el.btnWireframe.addEventListener('click', () => {
  const on = ui.el.btnWireframe.getAttribute('aria-pressed') !== 'true';
  preview.setWireframe(on);
  ui.setPressed(ui.el.btnWireframe, on);
});

ui.el.btnExportGlb.addEventListener('click', () => exportAs('glb'));
ui.el.btnExportObj.addEventListener('click', () => exportAs('obj'));
ui.el.btnReset.addEventListener('click', resetAndRescan);

addEventListener('resize', () => {
  if (state !== State.PREVIEW_EXPORT && !renderer.xr.isPresenting) {
    renderer.setSize(innerWidth, innerHeight);
  }
});

// ---- 起動 ----
setState(State.IDLE);
ui.setCompat(await checkCompatibility());
