// mapRoot（THREE.Group）→ .glb / .obj ファイルのダウンロード
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { OBJExporter } from 'three/addons/exporters/OBJExporter.js';

/**
 * 書き出し用に mapRoot を浅く複製し、必要なら枠線（Line系）を除外する。
 * geometry/material は共有参照なので、戻り値を dispose しないこと。
 */
function prepareExportRoot(mapRoot, { includeOutlines = false } = {}) {
  const root = mapRoot.clone(true);
  if (!includeOutlines) {
    const lines = [];
    root.traverse((obj) => { if (obj.isLine) lines.push(obj); });
    for (const l of lines) l.removeFromParent();
  }
  root.updateMatrixWorld(true);
  return root;
}

/** @returns {Promise<Blob>} */
export async function exportGLB(mapRoot, options) {
  const root = prepareExportRoot(mapRoot, options);
  const result = await new GLTFExporter().parseAsync(root, { binary: true });
  return new Blob([result], { type: 'model/gltf-binary' });
}

/** OBJ は色・マテリアルを含まない（three.js の OBJExporter は .mtl を出力しない） */
export function exportOBJ(mapRoot, options) {
  const root = prepareExportRoot(mapRoot, options);
  const text = new OBJExporter().parse(root);
  return new Blob([text], { type: 'text/plain' });
}

/** webxr_env_map_YYYYMMDD_HHMMSS.<ext> */
export function timestampedName(ext, date = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  const ymd = `${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}`;
  const hms = `${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}`;
  return `webxr_env_map_${ymd}_${hms}.${ext}`;
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // 同期で revoke すると Android Chrome でダウンロードが失敗することがあるので遅延させる
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
