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
    /** 直前フレームでトラッキングを失っていたか（変化したときだけ onTracking を呼ぶため） */
    this.trackingLost = false;
  }

  get planeCount() {
    return this.planeMap.size;
  }

  /**
   * AR セッションを開始し、描画ループを登録する。失敗時は例外を投げる（呼び出し側で IDLE に戻す）。
   */
  async start() {
    // ---- 1. セッション要求 ----
    // requiredFeatures：1つでも使えなければ requestSession 自体が失敗する（NotSupportedError）。
    //   このアプリは平面検出がないと意味がないので 'plane-detection' は必須。
    // optionalFeatures：使えなくてもセッションは始まる。実際に有効になったかは
    //   session.enabledFeatures で後から確認できる。
    // この呼び出しはユーザー操作（ボタンのクリック）の中でしか許可されない点にも注意。
    const session = await navigator.xr.requestSession('immersive-ar', {
      requiredFeatures: ['plane-detection'],
      optionalFeatures: ['local-floor', 'dom-overlay'],
      domOverlay: { root: this.overlayRoot },
    });

    try {
      // ---- 2. 参照空間の種類を決める ----
      // 'local-floor'：原点が床の高さ（Y=0 が床）。プレビューや書き出しで扱いやすい。
      // 'local'      ：原点はセッション開始時の端末の位置。Y=0 は床にならない。
      // three.js の setSession() は内部で requestReferenceSpace(type) を1回呼ぶだけで、
      // 失敗してもフォールバックしない。だから先にここで自分で試して、取れる方を選んでおく。
      this.refSpaceType = await this.#pickReferenceSpaceType(session);
      // setReferenceSpaceType() は setSession() より前に呼ぶ必要がある（XR 中は変更できない）
      this.renderer.xr.setReferenceSpaceType(this.refSpaceType);

      // ---- 3. three.js にセッションを渡す ----
      // ここで three.js が XRWebGLLayer を作って描画先を XR に切り替え、参照空間を取得する。
      // 以後、renderer.render() はカメラ姿勢・投影行列を XR から受け取って描画する。
      await this.renderer.xr.setSession(session);
      this.refSpace = this.renderer.xr.getReferenceSpace();
    } catch (err) {
      // セッションは作れたのに準備に失敗した場合、開きっぱなしにしないよう閉じてから例外を伝える。
      // （'end' リスナーはまだ付けていないので #handleEnd は走らない。後始末は main.js の catch に任せる）
      await session.end().catch(() => {});
      throw err;
    }
    this.session = session;

    // 学習用ログ：実際に何が有効になったか（chrome://inspect で確認）
    console.info('[XR] session started', {
      referenceSpace: this.refSpaceType,
      enabledFeatures: session.enabledFeatures ? [...session.enabledFeatures] : '(未対応ブラウザ)',
      domOverlay: session.domOverlayState?.type ?? '(なし)',
    });
    if (this.refSpaceType === 'local') {
      // TODO(M4): HUD に「床の高さが不明（Y=0 は開始時の端末の高さ）」と表示する
      console.warn('[XR] local-floor が使えないため local で開始。Y=0 は床ではありません');
    }

    // ---- 4. 終了イベント ----
    // 完了ボタン（finish → session.end()）でも、Quest のシステムUIから抜けても、
    // 必ずこの 'end' が発火する。終了処理はこの1経路に集約する。
    session.addEventListener('end', () => this.#handleEnd(), { once: true });

    // ---- 5. 描画ループ ----
    // XR 中は window.requestAnimationFrame ではなく session.requestAnimationFrame で回す必要がある。
    // renderer.setAnimationLoop() は XR 中なら自動でそちらに切り替え、第2引数に XRFrame を渡してくれる。
    this.renderer.setAnimationLoop((t, frame) => this.#onXRFrame(t, frame));
  }

  /**
   * 'local-floor' が取れるか試し、だめなら 'local' を返す。
   * 取得した参照空間はここでは使わず捨てる（three.js が setSession 内で改めて取得する）。
   * @param {XRSession} session
   * @returns {Promise<'local-floor'|'local'>}
   */
  async #pickReferenceSpaceType(session) {
    try {
      await session.requestReferenceSpace('local-floor');
      return 'local-floor';
    } catch {
      return 'local'; // 'local' は immersive セッションなら必ず使える
    }
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
    void time; // 経過時間は今は使わない
    // setAnimationLoop は XR 以外のときも呼ばれうる。その場合 frame は undefined なので何もしない
    if (!frame || !this.refSpace) return;

    // ---- A. トラッキング状態 ----
    // getViewerPose(refSpace)：「refSpace の座標系で見て、いま端末（目）はどこにあるか」。
    // 端末が自分の位置を見失う（暗い・白い壁だけ・速く振りすぎ）と null になる。
    const viewerPose = frame.getViewerPose(this.refSpace);
    const lost = viewerPose === null;
    if (lost !== this.trackingLost) {
      this.trackingLost = lost;
      this.onTracking(lost); // DOM 更新は状態が変わったときだけ
    }

    // ---- B. 平面の差分更新 ----
    // detectedPlanes は「このフレームで存在する平面すべて」の集合（差分ではない）。
    // 同じ平面はフレームをまたいでも同じ XRPlane オブジェクトなので、Map のキーにできる。
    // plane-detection が有効でなければ undefined なので空集合として扱う。
    /** @type {Set<XRPlane>} */
    const detected = frame.detectedPlanes ?? new Set();
    let countChanged = false;

    // B-1. 削除：前フレームまであったのに、今回の集合にないもの
    //      （ARCore が近くの平面を1枚に統合したときなどに起きる）
    for (const [plane, rec] of this.planeMap) {
      if (!detected.has(plane)) {
        this.scene.remove(rec.group);
        disposeGeometries(rec.group); // GPU 上の頂点バッファを解放。マテリアルは共有なので残す
        this.planeMap.delete(plane);  // Map は反復中の delete が安全
        countChanged = true;
      }
    }

    for (const plane of detected) {
      let rec = this.planeMap.get(plane);

      if (!rec) {
        // B-2. 新規：初めて見る平面 → メッシュを作って登録
        const pts = polygonToXZ(plane.polygon);
        if (pts.length < 3) continue; // まだ多角形になっていない。次フレームで再挑戦
        const orientation = orientationKey(plane.orientation);
        const obj = createPlaneObject(pts, orientation, this.materials);
        // 位置・向きは XR から 4x4 行列で直接もらうので、three.js に
        // position/quaternion/scale から matrix を作り直させない（上書きされて原点に戻るのを防ぐ）
        obj.group.matrixAutoUpdate = false;
        this.scene.add(obj.group);
        rec = { ...obj, orientation, lastChangedTime: plane.lastChangedTime };
        this.planeMap.set(plane, rec);
        countChanged = true;
      } else if (plane.lastChangedTime > rec.lastChangedTime) {
        // B-3. 更新：形（polygon）が変わった平面だけジオメトリを作り直す。
        //      lastChangedTime は polygon（や姿勢）が変わったときだけ進むので、
        //      毎フレーム作り直すより圧倒的に軽い
        const pts = polygonToXZ(plane.polygon);
        if (pts.length >= 3) updatePlaneGeometry(rec, pts);
        rec.lastChangedTime = plane.lastChangedTime;
      }

      // B-4. 姿勢：毎フレーム反映する。
      //      polygon は「平面自身の座標系（planeSpace）」での形。それが refSpace のどこに
      //      どの向きで置かれているかを getPose で聞き、その行列を group にそのまま入れる。
      //      → 形（geometry）と配置（matrix）が分かれているので、位置補正だけなら
      //        ジオメトリを作り直さなくて済む
      const pose = frame.getPose(plane.planeSpace, this.refSpace);
      if (pose) {
        rec.group.matrix.fromArray(pose.transform.matrix); // 列優先 16 要素 = three.js と同じ並び
        // matrixAutoUpdate=false のときは、matrixWorld の再計算をこちらから頼む必要がある
        rec.group.matrixWorldNeedsUpdate = true;
      }
      // pose が null（一時的に見失った）なら最後の姿勢のまま表示しておく
    }

    // ---- C. HUD 統計：件数が変わったフレームだけ通知 ----
    if (countChanged) this.onStats(this.#stats());

    // ---- D. 描画 ----
    // camera の姿勢・投影は renderer.xr が XR の値で上書きしてくれる
    this.renderer.render(this.scene, this.camera);
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
