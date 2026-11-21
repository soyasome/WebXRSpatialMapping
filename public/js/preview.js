// 非XRの3Dビューア（環境地図の俯瞰・回転・ズーム）
// 設計: docs/ARCHITECTURE.md §6
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { OPACITY, createMaterialSet, disposeMaterialSet, disposeGeometries } from './plane-mesh.js';

export class PreviewViewer {
  /** @param {THREE.WebGLRenderer} renderer */
  constructor(renderer) {
    this.renderer = renderer;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x1a1a1a);
    this.scene.add(new THREE.GridHelper(10, 10, 0x666666, 0x333333)); // 1マス = 1m
    this.scene.add(new THREE.AxesHelper(0.5));
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.6));
    const sun = new THREE.DirectionalLight(0xffffff, 1.2);
    sun.position.set(3, 5, 2);
    this.scene.add(sun);

    this.camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.05, 100);
    /** @type {OrbitControls | null} */
    this.controls = null;
    /** @type {THREE.Group | null} */
    this.mapRoot = null;
    this.materials = null;

    this.onResize = this.onResize.bind(this);
  }

  /**
   * mapRoot を表示して描画ループを開始する。
   * @param {THREE.Group} mapRoot XRPlaneSession のスナップショット
   */
  show(mapRoot) {
    this.mapRoot = mapRoot;
    this.materials = createMaterialSet(OPACITY.preview);
    // TODO(M2):
    // - mapRoot.traverse: Mesh/LineLoop に this.materials.fill|line[userData.orientation] を割り当て
    //   （orientation は親 Group の userData にある）
    // - this.scene.add(mapRoot)
    // - this.controls = new OrbitControls(this.camera, this.renderer.domElement)
    // - this.#frame(): Box3.setFromObject(mapRoot) → center / radius
    //     dist = radius / Math.sin(fov/2) * 1.2、camera を center + (1, 0.8, 1).normalize()*dist に置き
    //     controls.target.copy(center); controls.update()
    addEventListener('resize', this.onResize);
    this.onResize();
    this.renderer.setAnimationLoop(() => this.render());
  }

  render() {
    this.controls?.update();
    this.renderer.render(this.scene, this.camera);
  }

  /** @returns {{ planes: number, area: number, vertices: number }} */
  getStats() {
    const s = { planes: 0, area: 0, vertices: 0 };
    // TODO(M2): mapRoot.children を走査し planes++, area += userData.area,
    //           vertices += Mesh の geometry.attributes.position.count
    return s;
  }

  setWireframe(on) {
    if (!this.materials) return;
    for (const m of Object.values(this.materials.fill)) m.wireframe = on;
  }

  onResize() {
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(innerWidth, innerHeight);
  }

  /** 表示を終了し、mapRoot を含めて破棄する（新規スキャン時） */
  dispose() {
    this.renderer.setAnimationLoop(null);
    removeEventListener('resize', this.onResize);
    this.controls?.dispose();
    this.controls = null;
    if (this.mapRoot) {
      this.scene.remove(this.mapRoot);
      disposeGeometries(this.mapRoot);
      this.mapRoot = null;
    }
    if (this.materials) {
      disposeMaterialSet(this.materials);
      this.materials = null;
    }
  }
}
