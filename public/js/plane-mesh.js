// XRPlane.polygon → Three.js オブジェクト変換（純粋関数。XR API には依存しない）
import * as THREE from 'three';

export const PLANE_COLORS = {
  horizontal: 0x00d2ff,
  vertical: 0xff7b00,
  unknown: 0x2ecc71,
};

export const OPACITY = { ar: 0.35, preview: 0.75 };
const OUTLINE_OPACITY = 0.9;
const OUTLINE_OFFSET_Y = 0.001; // 塗りとのZファイティング回避（1mm）

/** @typedef {'horizontal'|'vertical'|'unknown'} Orientation */
/** @typedef {[number, number][]} XZPoints 平面ローカル座標 (x, z) の配列 */

/** @returns {Orientation} */
export function orientationKey(orientation) {
  return orientation === 'horizontal' || orientation === 'vertical' ? orientation : 'unknown';
}

/**
 * XRPlane.polygon（DOMPointReadOnly[]、平面ローカルの X-Z 平面上）を (x, z) 配列に正規化。
 * 実装によって末尾に先頭と同じ点が入ることがあるので除去する。
 * @param {ArrayLike<{x:number, z:number}>} polygon
 * @returns {XZPoints}
 */
export function polygonToXZ(polygon) {
  const pts = Array.from(polygon, (p) => [p.x, p.z]);
  if (pts.length > 1) {
    const a = pts[0];
    const b = pts[pts.length - 1];
    if (a[0] === b[0] && a[1] === b[1]) pts.pop();
  }
  return pts;
}

/** シューレース公式の符号付き和（x_i * z_{i+1} - x_{i+1} * z_i） */
function signedShoelace(pts) {
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, z1] = pts[i];
    const [x2, z2] = pts[(i + 1) % pts.length];
    s += x1 * z2 - x2 * z1;
  }
  return s;
}

/** 多角形の面積 [㎡] */
export function polygonArea(pts) {
  return Math.abs(signedShoelace(pts)) / 2;
}

/**
 * 凸多角形を扇形三角形分割した塗りジオメトリ。法線は必ず +Y。
 * （ShapeGeometry + rotateX(π/2) だと法線が −Y になるため使わない）
 * @param {XZPoints} pts
 */
export function createFillGeometry(pts) {
  const n = pts.length;
  const positions = new Float32Array(n * 3);
  pts.forEach(([x, z], i) => {
    positions[i * 3] = x;
    positions[i * 3 + 2] = z;
  });

  // 扇 (0, i, i+1) の法線Y成分 = −(符号付きシューレース)。正なら順序を反転して +Y に揃える
  const flip = signedShoelace(pts) > 0;
  const index = [];
  for (let i = 1; i < n - 1; i++) {
    if (flip) index.push(0, i + 1, i);
    else index.push(0, i, i + 1);
  }

  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geom.setIndex(index);
  geom.computeVertexNormals();
  geom.computeBoundingSphere();
  return geom;
}

/** 外周枠線用ジオメトリ（LineLoop 用） */
export function createOutlineGeometry(pts) {
  const positions = new Float32Array(pts.length * 3);
  pts.forEach(([x, z], i) => {
    positions[i * 3] = x;
    positions[i * 3 + 1] = OUTLINE_OFFSET_Y;
    positions[i * 3 + 2] = z;
  });
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  return geom;
}

/**
 * 向き別に共有するマテリアル一式。平面ごとに new しない。
 * AR 用とプレビュー用で別セットを作り、不要になったら disposeMaterialSet() で破棄。
 * @param {number} opacity
 */
export function createMaterialSet(opacity) {
  const fill = {};
  const line = {};
  for (const [key, color] of Object.entries(PLANE_COLORS)) {
    fill[key] = new THREE.MeshStandardMaterial({
      color,
      transparent: true,
      opacity,
      side: THREE.DoubleSide,
      depthWrite: false,
      roughness: 0.8,
      metalness: 0,
    });
    line[key] = new THREE.LineBasicMaterial({ color, transparent: true, opacity: OUTLINE_OPACITY });
  }
  return { fill, line };
}

export function disposeMaterialSet(set) {
  for (const m of [...Object.values(set.fill), ...Object.values(set.line)]) m.dispose();
}

/**
 * 1平面分のオブジェクト（Group > Mesh + LineLoop）を生成。
 * @param {XZPoints} pts
 * @param {Orientation} orientation
 * @param {ReturnType<typeof createMaterialSet>} materials
 */
export function createPlaneObject(pts, orientation, materials) {
  const mesh = new THREE.Mesh(createFillGeometry(pts), materials.fill[orientation]);
  const outline = new THREE.LineLoop(createOutlineGeometry(pts), materials.line[orientation]);
  const group = new THREE.Group();
  group.add(mesh, outline);
  group.userData.orientation = orientation;
  group.userData.area = polygonArea(pts);
  return { group, mesh, outline };
}

/** polygon 更新時：ジオメトリだけ差し替え、旧ジオメトリを dispose */
export function updatePlaneGeometry({ group, mesh, outline }, pts) {
  const oldFill = mesh.geometry;
  const oldLine = outline.geometry;
  mesh.geometry = createFillGeometry(pts);
  outline.geometry = createOutlineGeometry(pts);
  oldFill.dispose();
  oldLine.dispose();
  group.userData.area = polygonArea(pts);
}

/** 配下のジオメトリをすべて dispose（共有マテリアルは触らない） */
export function disposeGeometries(root) {
  root.traverse((obj) => obj.geometry?.dispose());
}
