# CLAUDE.md — 引き継ぎ用プロジェクトメモ

このファイルは Claude Code が起動時に自動で読む。**別の環境・別のセッションで開いても開発を継続できるよう**、
これまでの経緯・決定事項・現在地・次の作業をここに集約している。作業が進んだら「現在の状態」と「作業ログ」を更新すること。

## ユーザーとのやり取り

- 回答は**日本語**で。
- 学習目的のプロジェクト（WebXR `plane-detection` と SLAM による環境地図構築を理解したい）。
  コードは「動けばよい」ではなく、読んで仕組みが分かるように書く（日本語コメント可）。

## プロジェクト概要

Android Chrome / Meta Quest の WebXR で検出した平面（床・壁・机）を AR で半透明表示し、
AR 終了後に環境地図として 3D プレビュー・`.glb` / `.obj` 書き出しする Web アプリ。

- 元仕様：[docs/SPEC.md](docs/SPEC.md)
- 確定設計（仕様からの変更点を含む）：[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) ← **実装前に必ず読む**
- 起動・実機テスト・デプロイ手順：[README.md](README.md)

## 技術方針（決定済み・変更する場合はユーザーに確認）

- ビルドツールなし。`public/` 以下を静的配信するだけで動く ES Modules 構成
- three.js は `public/index.html` の Import Map で **`three@0.170.0` を CDN（jsDelivr）から固定読込**
- 配信：**GitHub Pages**（`main` への push で `.github/workflows/pages.yml` が `public/` をデプロイ）
- 開発中の実機テスト：`npx serve public -l 8080` ＋ `adb reverse tcp:8080 tcp:8080` ＋ `chrome://inspect`

## コード構成とルール

```text
public/js/
├── main.js        レンダラ（WebGLRenderer）を唯一所有。状態遷移 IDLE / AR_SCANNING / PREVIEW_EXPORT
├── ui.js          DOM 操作はここだけ。他モジュールは document を触らない
├── plane-mesh.js  純粋関数（polygon → geometry / 面積 / 共有マテリアル）。XR API に依存しない
├── xr-manager.js  XRPlaneSession クラス：セッション・平面差分更新・スナップショット
├── preview.js     PreviewViewer クラス：非XR描画・OrbitControls・自動フレーミング
└── exporter.js    GLB / OBJ 生成とダウンロード
```

- import は一方向：`main` → `xr-manager` / `preview` / `exporter` / `ui`、`xr-manager` / `preview` → `plane-mesh`
- モジュール間の受け渡しは環境地図の `THREE.Group`（mapRoot）1つだけ
- 描画ループは常に `renderer.setAnimationLoop()` 1本を差し替える
- マテリアルは向き別に共有（`createMaterialSet`）。平面更新時は geometry だけ dispose、マテリアルはリセット時にまとめて dispose
- AR 終了は「完了ボタン」でも「システムUIからの終了（Quest）」でも、`session` の `end` イベント → `onEnd(mapRoot)` の1経路に集約

## 現在の状態

| マイルストーン | 状態 | 完了条件（実機で確認） |
| --- | --- | --- |
| M0 骨組み | ✅ 完了 | 状態遷移・UI・互換性チェック・`plane-mesh.js`・`exporter.js`・Pages ワークフロー |
| **M1 AR 平面表示** | ⏭ **次はここ** | スマホで床=水色・壁=オレンジの半透明ポリゴンが重なり、動かすと広がる。HUD の面数が増える |
| M2 スナップショット＋プレビュー | 未着手 | 完了ボタン → 暗い3D画面で回転・ズーム、グリッド上に平面、統計表示 |
| M3 エクスポート | `exporter.js` は実装済み | GLB/OBJ をダウンロードし Blender で開いて実寸（1マス=1m）を確認 |
| M4 仕上げ | 未着手 | 映像 OFF、暗所で警告、0面で完了→トースト、Quest でメタボタン終了→プレビュー |

未実装箇所は `TODO(M1)` / `TODO(M2)` / `TODO(M4)` コメントで手順付きで書いてある：
`grep -rn "TODO(M" public/js`

### 次にやること

1. **M1 を誰が書くかをユーザーに確認**（未回答）
   - Claude が実装 → ユーザーが実機テストして `chrome://inspect` のログを返す
   - ユーザーが自分で書く → `xr-manager.js` の TODO を手順として使い、詰まったところだけ手伝う
2. M1 実装後、最初に確認するのは「その端末で `plane-detection` 付きのセッションが開始できるか」
   （Chrome 147 で正式出荷とされるが未検証。古い版は `chrome://flags/#webxr-incubations`）

### ユーザー側で必要な GitHub 設定（完了したかは未確認）

- Settings → General → Default branch を `main` に
- Settings → Pages → Source を「GitHub Actions」に（公開URL：`https://soyasome.github.io/WebXRSpatialMapping/`）

## 開発フロー

1. 編集 → `npx serve public -l 8080` → スマホの Chrome で `http://localhost:8080`（`adb reverse` 済み）
2. ログは PC の `chrome://inspect/#devices` で確認。AR を抜けてからリロード
3. マイルストーン完了ごとに commit → push → PR → `main` にマージ → Pages で公開URLから最終確認（Quest もここで）

### このクラウド環境では実機テストできない点に注意

- サンドボックスからは `cdn.jsdelivr.net` に届かないことがある。ヘッドレス Chromium で確認する場合は
  Playwright の `page.route()` で CDN の URL をローカルの `npm i three@0.170.0` に差し替える
- ヘッドレスでは `immersive-ar` 非対応なので、確認できるのは IDLE 画面と純粋関数（`plane-mesh.js` 等）まで

## 作業ログ

- **2026-11-21** 元仕様を受領。構成を確定し `docs/ARCHITECTURE.md` を作成。M0 骨組みを実装。
  配信方法は「開発中は adb reverse、公開は GitHub Pages」に決定。`main` ブランチを作成。
  ヘッドレス確認：IDLE 表示・非対応メッセージ・法線 +Y（両巻き順）・閉じ点除去・ファイル名生成 OK。
- **2026-11-22** 環境を移っても継続できるよう本ファイルと `docs/SPEC.md`（元仕様）を追加。
