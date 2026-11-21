// WebXR セッション制御・plane-detection 差分更新・スナップショット生成
// 設計: docs/ARCHITECTURE.md §5
import * as THREE from 'three';
import {
  OPACITY,
  createMaterialSet,
  disposeMaterialSet,
  createPlaneObject,
  updatePlaneGeometry,
  disposeGeometries,
  orientationKey,
  polygonToXZ,
} from './plane-mesh.js';

/**
 * @typedef {{ group: THREE.Group, mesh: THREE.Mesh, outline: THREE.LineLoop,
 *             orientation: import('./plane-mesh.js').Orientation,
 *             lastChangedTime: number }} PlaneRecord
 * @typedef {{ total: number, horizontal: number, vertical: number, unknown: number }} PlaneStats
 */

export class XRPlaneSession {
  /**
   * @param {THREE.WebGLRenderer} renderer main.js が所有する唯一のレンダラ
   * @param {{
   *   overlayRoot: HTMLElement,                          // dom-overlay の root
   *   onStats: (s: PlaneStats) => void,                  // 平面数が変わったときだけ呼ぶ
   *   onTracking: (lost: boolean) => void,               // トラッキング状態が変わったときだけ呼ぶ
   *   onEnd: (mapRoot: THREE.Group | null) => void,      // セッション終了時（ボタン/外部終了とも）
   * }} callbacks
   */
  constructor(renderer, { overlayRoot, onStats, onTracking, onEnd }) {
    this.renderer = renderer;
    this.overlayRoot = overlayRoot;
    this.onStats = onStats;
    this.onTracking = onTracking;
    this.onEnd = onEnd;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(); // XR 中は renderer.xr が姿勢と投影を上書きする
    this.materials = createMaterialSet(OPACITY.ar);

    /** @type {Map<XRPlane, PlaneRecord>} */
    this.planeMap = new Map();
    /** @type {XRSession | null} */
    this.session = null;
    /** @type {XRReferenceSpace | null} */
    this.refSpace = null;
    this.refSpaceType = /** @type {'local-floor'|'local'} */ ('local');
  }

  get planeCount() {
    return this.planeMap.size;
  }

  /**
   * AR セッションを開始し、描画ループを登録する。失敗時は例外を投げる（呼び出し側で IDLE に戻す）。
   */
  async start() {
    // TODO(M1):
    // 1. navigator.xr.requestSession('immersive-ar', {
    //      requiredFeatures: ['plane-detection'],
    //      optionalFeatures: ['local-floor', 'dom-overlay'],
    //      domOverlay: { root: this.overlayRoot } })
    // 2. renderer.xr.setReferenceSpaceType('local-floor') を試し、
    //    session.requestReferenceSpace('local-floor') が失敗したら 'local' にフォールバック
    // 3. await renderer.xr.setSession(session)
    //    this.refSpace = renderer.xr.getReferenceSpace()
    // 4. session.addEventListener('end', () => this.#handleEnd())
    // 5. renderer.setAnimationLoop((t, frame) => this.#onXRFrame(t, frame))
    throw new Error('XRPlaneSession.start() は未実装です（M1）');
  }

  /** カメラ映像を隠す（カメラ追従の不透明裏面球を表示）。§5.5 */
  setFeedHidden(hidden) {
    // TODO(M4): 半径50m の SphereGeometry + MeshBasicMaterial({ color: 0x1a1a1a, side: BackSide,
    //   depthWrite: false }) を renderOrder = -1 で scene に追加し、毎フレーム camera 位置へ移動。
    //   ここでは visible を切り替えるだけ。
    void hidden;
  }

  /**
   * 「スキャン完了」ボタン用。平面0件なら何もせず false。
   * それ以外はセッションを終了し、スナップショットは 'end' イベント経由で onEnd に渡る。
   * @returns {boolean}
   */
  finish() {
    if (this.planeCount === 0 || !this.session) return false;
    this.session.end();
    return true;
  }

  /** @param {number} time @param {XRFrame} frame */
  #onXRFrame(time, frame) {
    // TODO(M1): §5.3 の表どおり
    // - viewerPose = frame.getViewerPose(this.refSpace) → null なら onTracking(true)（変化時のみ）
    // - detected = frame.detectedPlanes ?? new Set()
    // - 削除: planeMap にあって detected にない → scene.remove, disposeGeometries, delete
    // - 新規: createPlaneObject(polygonToXZ(plane.polygon), orientationKey(plane.orientation), this.materials)
    //         group.matrixAutoUpdate = false; scene.add(group)
    // - 更新: plane.lastChangedTime > rec.lastChangedTime → updatePlaneGeometry(rec, ...)
    // - 姿勢: pose = frame.getPose(plane.planeSpace, this.refSpace)
    //         pose があれば group.matrix.fromArray(pose.transform.matrix)
    // - 件数が変わったら onStats(this.#stats())
    // - renderer.render(this.scene, this.camera)
    void time; void frame;
  }

  /** @returns {PlaneStats} */
  #stats() {
    const s = { total: this.planeMap.size, horizontal: 0, vertical: 0, unknown: 0 };
    for (const rec of this.planeMap.values()) s[rec.orientation]++;
    return s;
  }

  /**
   * 現在の平面群を XR から独立した Three.js オブジェクトに複製する。§5.6
   * group は最後の姿勢を保持しているので、セッション終了後でも呼べる。
   * @returns {THREE.Group}
   */
  #snapshot() {
    // TODO(M2):
    // - mapRoot = new THREE.Group(); mapRoot.name = 'EnvironmentMap'
    // - 向きごとの連番カウンタで rec.group を clone:
    //     g = new THREE.Group(); rec.group.matrix.decompose(g.position, g.quaternion, g.scale)
    //     mesh/outline は geometry.clone() で複製、マテリアルはプレビュー側で差し替えるので一旦そのまま
    //     g.name = `Plane_${Horizontal|Vertical|Unknown}_${NN}`、mesh.name も同名
    //     g.userData = { ...rec.group.userData }
    // - return mapRoot
    return new THREE.Group();
  }

  #handleEnd() {
    const mapRoot = this.planeCount > 0 ? this.#snapshot() : null;
    this.renderer.setAnimationLoop(null);
    this.#disposeAll();
    this.onEnd(mapRoot);
  }

  #disposeAll() {
    for (const rec of this.planeMap.values()) disposeGeometries(rec.group);
    this.planeMap.clear();
    this.scene.clear();
    disposeMaterialSet(this.materials);
    this.session = null;
    this.refSpace = null;
  }
}
