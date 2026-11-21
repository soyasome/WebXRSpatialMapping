# アーキテクチャ設計（確定版）

元仕様（WebXR 平面検出 × 3D 環境地図プレビュー／エクスポート）を実装できる形に落とし込んだ設計。
元仕様からの**変更点・補足**は「⚠ 仕様からの変更」で明示している。

---

## 1. ディレクトリ構成

```text
WebXRSpatialMapping/
├── public/                  # ← 配信対象（このフォルダだけを静的ホスティングに載せる）
│   ├── index.html           # Import Map（three.js をCDNからバージョン固定で読込）+ UIオーバーレイ
│   ├── style.css            # HUD・ボタン・トースト。AR中は透明背景
│   └── js/
│       ├── main.js          # エントリ。renderer 所有・状態遷移（IDLE / AR_SCANNING / PREVIEW_EXPORT）
│       ├── ui.js            # DOM参照・パネル切替・HUD文言・トースト（DOM操作はここに集約）
│       ├── plane-mesh.js    # 純粋関数：polygon → BufferGeometry / 枠線 / 面積 / マテリアル
│       ├── xr-manager.js    # XRセッション制御・detectedPlanes 差分更新・スナップショット生成
│       ├── preview.js       # 非XR描画：カメラ・OrbitControls・自動フレーミング・ワイヤーフレーム
│       └── exporter.js      # GLB / OBJ 生成とダウンロード
├── docs/ARCHITECTURE.md     # 本書
├── .github/workflows/pages.yml  # GitHub Pages 自動デプロイ
└── README.md                # 起動・実機テスト・デプロイ手順
```

⚠ 仕様からの変更
- **`plane-mesh.js` を追加**：ジオメトリ生成・配色は AR 中（xr-manager）とプレビュー（preview / スナップショット）の両方で使うため、独立した純粋関数モジュールにした。Three.js 以外に依存しないので、単体で動作確認しやすい。
- **`ui.js` を追加**：`main.js` が状態遷移と DOM 操作の両方を持つと肥大化するため分離。
- **`public/` に分離**：`docs/` や `.github/` を配信しないため。

---

## 2. モジュール依存関係

```text
            main.js  ──────────────┐
          ／   │    ＼              │
   xr-manager  preview  exporter   ui.js
          ＼   │
          plane-mesh.js
               │
            three (Import Map)
```

- 依存は一方向。`xr-manager` / `preview` / `exporter` は互いを import しない。
- モジュール間の受け渡しは **`THREE.Group`（mapRoot）1つだけ**。
  `xr-manager.finish()` が返した mapRoot を `main.js` が `preview.show()` と `exporter.*()` に渡す。

---

## 3. レンダラ／描画ループの所有権

- `THREE.WebGLRenderer` は **`main.js` が1つだけ生成**し、`renderer.xr.enabled = true` のまま使い回す。
- 描画ループは常に `renderer.setAnimationLoop(fn)` 1本。状態に応じて差し替える。
  - AR_SCANNING：`xr-manager` の `onXRFrame(time, frame)`（XRFrame が渡る）
  - PREVIEW_EXPORT：`preview` の `render()`
  - IDLE：`null`（停止）
- シーンは **ARシーン** と **プレビューシーン** を別に持つ（グリッドやライトが AR に混ざらないように）。

---

## 4. 状態遷移

```text
IDLE ──[ARスキャン開始]──▶ AR_SCANNING ──[完了ボタン / セッション外部終了]──▶ PREVIEW_EXPORT
  ▲                          │ 平面0件なら遷移せずトースト                     │
  │                          └──[セッション開始失敗]──▶ IDLE（エラー表示）      │
  └──────────────────────────────────[新規スキャン]──────────────────────────────┘
                                         （mapRoot を dispose → AR_SCANNING を直接開始）
```

⚠ 仕様からの変更：**ユーザーがシステムUIでARを抜けた場合も PREVIEW へ遷移**する。
Meta Quest は `dom-overlay` 非対応で画面上のボタンを出せず、終了はMetaボタン操作になるため。
（平面0件で外部終了した場合は IDLE に戻す。）

---

## 5. 機能1：AR 平面オーバーレイ（xr-manager.js）

### 5.1 セッション要求

```js
navigator.xr.requestSession('immersive-ar', {
  requiredFeatures: ['plane-detection'],
  optionalFeatures: ['local-floor', 'dom-overlay'],
  domOverlay: { root: overlayRoot },
});
// referenceSpace: 'local-floor' を試し、失敗したら 'local' にフォールバック
```

⚠ 仕様からの変更：`local-floor` を **required → optional** に。端末によっては床推定前で
`local-floor` が取れずセッション自体が失敗するため。`local` の場合は Y=0 が床にならない点を HUD に表示する。

### 5.2 データ構造

```js
/** @typedef {{ group: THREE.Group, mesh: THREE.Mesh, outline: THREE.LineLoop,
 *              orientation: 'horizontal'|'vertical'|'unknown',
 *              lastChangedTime: number, area: number }} PlaneRecord */
planeMap: Map<XRPlane, PlaneRecord>
```

### 5.3 毎フレーム処理（仕様どおり）

| 判定 | 処理 |
| --- | --- |
| 新規 | `createPlaneObject()` → scene と planeMap に登録 |
| 更新 `plane.lastChangedTime > rec.lastChangedTime` | `updatePlaneGeometry()`（旧 geometry を dispose） |
| 削除 `!detectedPlanes.has(plane)` | scene から外し geometry を dispose、planeMap から削除 |
| 共通 | `frame.getPose(plane.planeSpace, refSpace)` → `group.matrix` に反映 |
| トラッキング | `frame.getViewerPose(refSpace) === null` → HUD に警告 |

HUD 統計（平面数・水平/垂直内訳）は**変化があったときだけ** `onStats` コールバックで通知（DOM更新を毎フレームしない）。

### 5.4 ジオメトリ生成（plane-mesh.js）

⚠ 仕様からの変更：`ShapeGeometry + rotateX(π/2)` は**法線が −Y を向く**（+90°回転で +Z → −Y）。
XRPlane.polygon は凸多角形と規定されているので、**BufferGeometry に直接 (x, 0, z) を入れて扇形三角形分割**し、
符号付き面積で巻き順を判定して法線を必ず +Y にする。回転処理が不要になり、面積計算（シューレース公式）も同じ頂点列で済む。

- polygon の末尾が先頭と同一点なら除去（実装差の吸収）
- 枠線 `LineLoop` は y = +1mm オフセットしてZファイティング回避
- **マテリアルは向き別に共有**（水平／垂直／未分類 × 面・線 = 6個）。平面ごとに new しないので、
  更新時の dispose は geometry だけで済み、マテリアルはリセット時にまとめて dispose。

### 5.5 「映像表示 ON/OFF」の実現方法

⚠ 仕様への補足：AR 中のカメラ映像はブラウザが合成するため WebXR から非表示にできず、
Three.js も AR 中は `scene.background` を無視する。
→ **カメラに追従する不透明な裏面球（半径 50m, `side: BackSide`, `renderOrder: -1`, `depthWrite: false`）** を
ON/OFF して映像を隠す。

### 5.6 スナップショット（機能2の前処理）

`group` は毎フレーム最終姿勢を保持しているので、XRPlane が無効になった**後でも**複製できる。
よって `finish()` は「ボタン押下時」でも「`session` の `end` イベント時」でも同じ処理で済む。

1. `mapRoot = new THREE.Group()`
2. 各 PlaneRecord の `mesh` / `outline` を clone（geometry も `.clone()`）し、`group.matrix` を
   `position/quaternion/scale` に分解して設定
3. マテリアルはプレビュー用セット（opacity 0.75）を割り当て
4. 名前付け：`Plane_Horizontal_01`, `Plane_Vertical_02` …（向きごとに連番）
5. AR 側の planeMap・geometry・マテリアルを全 dispose

---

## 6. 機能2：プレビュー（preview.js）

仕様どおり。補足のみ：
- `PerspectiveCamera(60, aspect, 0.05, 100)`、`GridHelper(10, 10)`、`AxesHelper(0.5)`、Ambient + Directional
- 自動フレーミング：`Box3.setFromObject(mapRoot)` → 中心を `controls.target`、
  `距離 = 半径 / sin(fov/2) × 1.2` で斜め上（+X, +Y, +Z 方向）から見る
- 統計：平面数・総面積（userData.area の合計）・頂点数（geometry.attributes.position.count の合計）
- ワイヤーフレーム切替：プレビュー用マテリアルセットの `wireframe` を一括切替
- `resize` に追従、`hide()` で OrbitControls を dispose

---

## 7. 機能3：エクスポート（exporter.js）

- 入力は mapRoot のみ（Grid/Axes はプレビューシーン側にあるので自然に除外される）
- ⚠ 仕様への補足：**枠線（LineLoop）はデフォルトで書き出さない**。
  GLTFExporter は線を LINE_LOOP プリミティブとして、OBJExporter は `l` 要素として出力し、
  Blender 等で扱いにくいため。`{ includeOutlines: true }` で含められる。
- ⚠ 仕様への補足：**OBJ は色・マテリアル情報を持たない**（three.js の OBJExporter は .mtl を出さない）。
  色付きが必要なら GLB を使う旨を UI に表示。
- GLB：`GLTFExporter.parseAsync(root, { binary: true })` → `Blob('model/gltf-binary')`
- OBJ：`OBJExporter.parse(root)` → `Blob('text/plain')`
- ファイル名：`webxr_env_map_YYYYMMDD_HHMMSS.{glb,obj}`
- `a[download].click()` → 次のタスクで `URL.revokeObjectURL()`（同期で revoke すると Android でDLが失敗することがある）

---

## 8. 対応環境の整理

| 環境 | plane-detection | dom-overlay | 備考 |
| --- | --- | --- | --- |
| Android Chrome（ARCore） | ○（Chrome 147 で正式出荷とされる。古い版は `chrome://flags/#webxr-incubations`） | ○ | 実時間で平面が増減・成長する＝SLAMの学習に最適 |
| Meta Quest 3 / Pro（Quest Browser） | ○ | ✕ | 平面は**事前のスペース設定（部屋スキャン）由来**で、セッション開始直後から全部出る。リアルタイム成長は見られない |
| Meta Quest 2 | ○ | ✕ | 同上・パススルーは白黒 |
| iOS Safari | ✕ | ✕ | IDLE画面で非対応メッセージ |

`isSessionSupported('immersive-ar')` は plane-detection 対応までは判定できない。
→ `requestSession` が `NotSupportedError` で失敗したら「この端末/ブラウザは平面検出に未対応」と表示して IDLE に戻す。

---

## 9. 実装順序（マイルストーン）

1. **M0 骨組み**（済）：状態遷移・UI・互換性チェック・デプロイが動く
2. **M1 AR表示**：xr-manager（新規/更新/削除/姿勢同期）+ HUD 統計 → 実機で平面が見える
3. **M2 スナップショット＋プレビュー**：finish() → preview.show()、自動フレーミング
4. **M3 エクスポート**：GLB/OBJ ダウンロード → Blender で開いて寸法確認
5. **M4 仕上げ**：映像ON/OFF、トラッキング警告、0件ガード、Quest 外部終了の動作確認
