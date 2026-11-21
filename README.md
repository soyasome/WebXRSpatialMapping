# WebXR Plane Mapper

WebXR `plane-detection` で検出した平面をARで半透明表示し、セッション終了後に環境地図として
3Dプレビュー・`.glb` / `.obj` 書き出しする学習用サンプル。ビルド不要（ES Modules + Import Map）。

設計の詳細は [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) を参照。

## 進捗

| マイルストーン | 状態 |
| --- | --- |
| M0 骨組み（状態遷移・UI・互換性チェック・デプロイ） | ✅ |
| M1 AR 平面表示（`xr-manager.js`） | TODO |
| M2 スナップショット＋プレビュー（`xr-manager.js#snapshot`, `preview.js`） | TODO |
| M3 エクスポート（`exporter.js` は実装済み、M2 完了後に結合確認） | 一部済 |
| M4 映像ON/OFF・警告・Quest 外部終了 | TODO |

## ローカル開発

`public/` を静的配信するだけで動く。

```bash
npx serve public -l 8080        # または: python3 -m http.server 8080 -d public
```

### Android 実機（推奨：USB + adb reverse）

WebXR は HTTPS か `localhost` でしか動かない。`adb reverse` で端末の `localhost` を PC に転送すれば
証明書なしで実機テストでき、PC の Chrome から `chrome://inspect` でコンソールも見られる。

```bash
adb reverse tcp:8080 tcp:8080
# 端末の Chrome で http://localhost:8080 を開く
# PC の Chrome で chrome://inspect/#devices → inspect でリモートデバッグ
```

- Chrome が古く平面が出ない場合は `chrome://flags/#webxr-incubations` を有効化
- Meta Quest も開発者モード + USB で同じ手順が使える

### USB が使えない場合

`cloudflared tunnel --url http://localhost:8080` などのトンネルで一時 HTTPS URL を発行する。

## 配信（GitHub Pages）

`main` に push すると `.github/workflows/pages.yml` が `public/` を GitHub Pages にデプロイする。

初回のみ：リポジトリの **Settings → Pages → Build and deployment → Source** を **GitHub Actions** に設定。

公開 URL：`https://<owner>.github.io/<repo>/`（HTTPS が自動で付くので実機・Quest からそのまま開ける）
