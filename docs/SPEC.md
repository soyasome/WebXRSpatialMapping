# 元仕様書：WebXR 平面検出 × 3D 環境地図

> プロジェクト開始時にユーザーが提示した仕様書の原文（表の崩れのみ修正）。
> 実装上の変更点は [ARCHITECTURE.md](ARCHITECTURE.md) の「⚠ 仕様からの変更」を優先すること。

## 1. プロジェクト概要

### 1.1 目的

WebXR Device API（特に `plane-detection` モジュール）の挙動およびSLAMによる環境地図構築プロセスを学習・検証するためのサンプルWebアプリケーションを開発する。

### 1.2 コア機能

1. **リアルタイム平面オーバーレイ表示**：ARセッション中のカメラ映像に、認識された平面（床・壁・机等）を半透明ポリゴンとしてリアルタイム重畳描画する。
2. **環境地図の全体プレビュー**：ARセッション終了後（または一時停止時）に、それまでに蓄積された環境地図（全平面メッシュ）を通常の3Dビューア（OrbitControls）で俯瞰・回転・ズームして確認する。
3. **3Dモデルファイルのエクスポート**：構築された環境地図全体を、標準的な3Dモデル形式（`.glb` / `.obj`）としてクライアント側で生成し、端末へダウンロード保存する。

---

## 2. システム要件・技術スタック

### 2.1 動作環境（ターゲットデバイス）

* **推奨環境**：Android スマートフォン（ARCore対応機種） + Google Chrome 最新版
* **その他対応**：Meta Quest 2 / 3 / Pro（Quest Browser）
* **非対応（対象外）**：iOS Safari（標準WebXR `plane-detection` 未対応のため）
* **通信要件**：HTTPS環境必須（ローカル開発時は `localhost` または自己署名証明書/トンネルツールを使用）

### 2.2 採用技術・ライブラリ

ビルドツール不要（単一HTMLまたはES Modules構成）で学習コストを抑えつつ、実務標準のライブラリを採用する。

| カテゴリ | 技術 / ライブラリ | 用途 |
| --- | --- | --- |
| **言語** | HTML5 / CSS3 / JavaScript (ES2022+) | アプリケーション基盤 |
| **3D描画エンジン** | **Three.js** (`r160+`) | WebXRレンダリング、メッシュ生成、3Dビューア |
| **WebXR API** | `WebXR Device API` (`immersive-ar`, `plane-detection`) | カメラ映像合成、姿勢トラッキング、平面検出 |
| **カメラ操作** | `three/addons/controls/OrbitControls.js` | 全体確認モード時の視点回転・ズーム・パン操作 |
| **3D出力** | `three/addons/exporters/GLTFExporter.js`<br>`three/addons/exporters/OBJExporter.js` | 環境地図の `.glb`（バイナリglTF）および `.obj` 書き出し |

---

## 3. 画面構成・状態遷移（UI/UX仕様）

アプリケーションは大きく3つの状態（ステート）を持ち、単一画面上でUIオーバーレイを切り替える形で遷移する。

```
[ 1. 初期待機画面 (IDLE) ]
       │  「ARスキャン開始」ボタン押下
       ▼
[ 2. ARスキャンモード (AR_SCANNING) ]  ◄── 機能1：半透明ポリゴン表示
       │  「スキャン完了 / 全体確認」ボタン押下（ARセッション終了）
       ▼
[ 3. 全体確認・出力モード (PREVIEW_EXPORT) ] ◄── 機能2：全体確認 / 機能3：3D出力
       │  「再スキャン（リセット）」ボタン押下
       ▼
[ 2. ARスキャンモードへ戻る ]

```

### 3.1 各画面のUI要素

#### ① 初期待機画面 (`IDLE`)

* アプリタイトル・簡単な操作説明（「床や壁にカメラを向けてゆっくり動かしてください」）
* デバイス互換性ステータス表示（`navigator.xr.isSessionSupported('immersive-ar')` の判定結果）
* **`[ARスキャン開始]` ボタン**（非対応端末の場合は非活性にしエラーメッセージを表示）

#### ② ARスキャンモード (`AR_SCANNING`)

* **背景**：端末のカメラ映像（WebXRパススルー）＋ 認識済み平面の半透明ポリゴン
* **上部HUD（情報表示）**：
* 認識済み平面数（例：`検出平面: 4面 (水平: 2 / 垂直: 2)`）
* 凡例バッジ（水色：水平面、オレンジ：垂直面）


* **下部コントロール**：
* **`[映像表示 ON/OFF]` トグルボタン**：ポリゴンのみを確認したい場合の一時非表示用
* **`[スキャン完了・全体確認へ]` ボタン**：現在の環境地図データを保持したままARセッションを終了し、プレビューモードへ移行



#### ③ 全体確認・出力モード (`PREVIEW_EXPORT`)

* **背景**：ダークグレー（`#1a1a1a`）の3D空間＋グリッド床ヘルパー（1mマス）＋スキャンされた全平面メッシュ
* **上部HUD**：
* 合計平面数・総面積（概算㎡）・頂点数
* **`[ワイヤーフレーム切替]` トグルボタン**


* **下部コントロール**：
* **`[GLB形式で保存]` ボタン**（テクスチャ・マテリアル色情報付き標準3D形式）
* **`[OBJ形式で保存]` ボタン**（CADやBlender等で扱いやすい汎用形式）
* **`[新規スキャン（リセット）]` ボタン**（データを破棄して初期状態または再スキャンへ戻る）



---

## 4. 機能詳細仕様

### 4.1 機能1：カメラ映像への半透明ポリゴン表示（リアルタイム平面検出）

#### 1) WebXRセッション初期化

`navigator.xr.requestSession` を以下のオプションで呼び出す。

```javascript
const session = await navigator.xr.requestSession('immersive-ar', {
  requiredFeatures: ['local-floor', 'plane-detection'],
  optionalFeatures: ['dom-overlay'],
  domOverlay: { root: document.getElementById('ui-overlay') }
});

```

※ `local-floor` を指定することで、床の高さを $Y = 0$ 基準とした実寸（メートル単位）のワールド座標系を構築する。

#### 2) 平面データの差分管理（`Map<XRPlane, MeshData>`）

`requestAnimationFrame` のコールバック内で `frame.detectedPlanes`（`Set<XRPlane>`）を取得し、前フレームとの差分を処理する。

| 判定条件 | 処理内容 |
| --- | --- |
| **新規 (`!planeMap.has(plane)`)** | 新規に `THREE.Group`（塗りつぶしメッシュ＋外周枠線 `THREE.LineLoop`）を生成し、`scene` と `planeMap` に登録。 |
| **更新 (`plane.lastChangedTime > record.lastUpdated`)** | `plane.polygon` からジオメトリを再生成して差し替え、旧ジオメトリを `.dispose()` でメモリ解放。 |
| **削除 (`!detectedPlanes.has(plane)`)** | 平面の統合（Merge）等で消滅した平面を `scene` から削除し、ジオメトリ・マテリアルを破棄して `planeMap` から削除。 |
| **毎フレーム共通（姿勢同期）** | `frame.getPose(plane.planeSpace, referenceSpace)` を取得し、メッシュの `position` と `quaternion` を更新。 |

#### 3) ポリゴンジオメトリの生成アルゴリズム

`XRPlane.polygon` は平面ローカル座標系（X-Z平面上、Y=0）の凸多角形頂点配列として渡される。

1. 各頂点の `(x, z)` を抽出し、`THREE.Shape` を作成（またはファン三角形分割でインデックス生成）。
2. `THREE.ShapeGeometry` で2Dメッシュを生成し、`geometry.rotateX(Math.PI / 2)` でX-Z平面に寝かせる（法線が+Y方向になるよう頂点順序を調整）。
3. 視認性を高めるため、外周エッジに `THREE.LineLoop`（不透明度 `0.9` の枠線）を子要素として追加する。

#### 4) マテリアル配色仕様（`orientation` 別）

* **水平面（`plane.orientation === 'horizontal'`）**：シアン系（`#00d2ff`）、`opacity: 0.35`、`transparent: true`、`side: THREE.DoubleSide`
* **垂直面（`plane.orientation === 'vertical'`）**：オレンジ系（`#ff7b00`）、`opacity: 0.35`、`transparent: true`、`side: THREE.DoubleSide`
* **未分類（`undefined`）**：グリーン系（`#2ecc71`）、`opacity: 0.35`

---

### 4.2 機能2：現時点の環境地図の全体確認（プレビューモード）

#### 1) セッション終了時のデータ退避（スナップショット化）

`session.end()` を実行すると `XRPlane` オブジェクトへの参照や `getPose()` が無効になるため、終了直前のフレーム（または終了ボタン押下時のループ内）で以下を実行する。

1. 環境地図専用の親グループ `mapRootGroup = new THREE.Group()` を用意する。
2. 各平面メッシュの現在のワールド変換行列（`position`, `quaternion`, `scale`）および `BufferGeometry` を `.clone()` し、純粋な Three.js オブジェクトとして `mapRootGroup` に格納する。
3. ARセッションを終了し、通常の非XRレンダリングループへ切り替える。

#### 2) 3Dビューア構成

* **カメラ**：`THREE.PerspectiveCamera(60, aspect, 0.05, 100)`
* **自動フレーミング**：`THREE.Box3().setFromObject(mapRootGroup)` で環境地図全体のバウンディングボックスと中心座標を計算し、カメラの初期位置と `OrbitControls.target` を地図の中心に自動調整する。
* **補助オブジェクト**：
* `THREE.GridHelper(10, 10)`（10m × 10m、1グリッド = 1m のスケール基準線）
* `THREE.AxesHelper(0.5)`（原点・XYZ軸表示）
* 環境光 `AmbientLight` ＋ 平行光源 `DirectionalLight`（立体感強調用）


* **表示調整**：プレビューモードでは背景カメラ映像が無いため、メッシュの不透明度を `0.35` から `0.75` へ引き上げて形状を視認しやすくする。

---

### 4.3 機能3：環境地図全体の3Dモデルファイルエクスポート

#### 1) エクスポート対象のデータ構造

* `mapRootGroup` 配下の平面メッシュ群のみを対象とする（`GridHelper` や `AxesHelper` などのUI補助オブジェクトは除外する）。
* エクスポート時の単位系は **1単位 = 1メートル（m）**（glTF / Three.js 標準仕様）を維持する。
* 各メッシュには識別用の `mesh.name`（例：`Plane_Horizontal_01`, `Plane_Vertical_02`）を付与しておく。

#### 2) ファイル生成・ダウンロードフロー

1. **GLB出力（`GLTFExporter`）**：
* `exporter.parse(mapRootGroup, onCompleted, onError, { binary: true })` を実行。
* 返却された `ArrayBuffer` から `new Blob([result], { type: 'model/gltf-binary' })` を生成。


2. **OBJ出力（`OBJExporter`）**：
* `const objText = exporter.parse(mapRootGroup)` を実行。
* 返却された文字列から `new Blob([objText], { type: 'text/plain' })` を生成。


3. **ダウンロード発火**：
* `URL.createObjectURL(blob)` で一時URLを生成し、動的に作成した `<a download="webxr_env_map_YYYYMMDD_HHMMSS.glb">` 要素をプログラムから `.click()` して端末に保存させる。
* ダウンロード後、`URL.revokeObjectURL()` でメモリを解放する。



---

## 5. ディレクトリ・モジュール設計（学習用最小構成）

学習のしやすさと見通しの良さを優先し、ビルド環境不要でそのまま静的Webサーバーに配置できる構成とする。

```text
webxr-plane-mapper/
├── index.html          # メインHTML（Import MapによるThree.js読み込み + UIオーバーレイ）
├── style.css           # HUD・ボタン・モーダル等のレスポンシブスタイル
└── js/
    ├── main.js         # エントリーポイント・状態管理（IDLE / AR / PREVIEW）
    ├── xr-manager.js   # WebXRセッション制御・plane-detection差分更新・メッシュ生成
    ├── preview.js      # プレビューモード用カメラ・OrbitControls・バウンディング計算
    └── exporter.js     # GLTFExporter / OBJExporter ラッパーとファイルダウンロード処理

```

---

## 6. エラーハンドリング・エッジケース対策

* **平面が0件のまま「全体確認」を押した場合**
* アラートまたはトースト通知で「平面がまだ検出されていません。床や壁を映して動かしてください」と表示し、ARスキャンモードを継続する。


* **トラッキングロスト（暗い場所・白壁など）**
* `frame.getViewerPose(referenceSpace)` が `null` を返した場合は、HUD上に「トラッキング不安定：明るい場所で特徴のある面を映してください」と警告表示を出す。


* **メモリリーク防止**
* `plane-detection` は毎秒高頻度でポリゴン頂点を更新するため、ジオメトリ再生成時およびリセット時には必ず古い `geometry.dispose()` と `material.dispose()` を呼び出す。


* **iOS Safari 等でのアクセス時**
* 起動時に `navigator.xr` の有無および `isSessionSupported('immersive-ar')` をチェックし、非対応ブラウザの場合は「このアプリはAndroid版Google Chrome（ARCore対応端末）またはMeta Questブラウザで動作します」と明示する。