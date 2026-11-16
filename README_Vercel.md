# Vercel デプロイ手順

個人利用の Hobby プラン向け手順。

## 本番

- https://youtube-rho-lemon.vercel.app/

## 前提

- このリポジトリが GitHub に push されていること
- YouTube Data API v3 の API キーを持っていること

## 手順

1. [Vercel](https://vercel.com) に GitHub アカウントでログインする
2. 「Add New」→「Project」→ このリポジトリ（`youtube`）を Import する
3. Framework は `Next.js` が自動選択されるのでそのままにする
4. 「Environment Variables」に以下を追加する
   - Key: `YOUTUBE_API_KEY` / Value: YouTube Data API v3 のキー
5. 「Deploy」を押す

## 注意

- API キーは `.env` ではなく Vercel の Environment Variables に登録すること（`.env` は git 管理外）
- 一覧取得は1日キャッシュ（`revalidate: 86400`）のため、quota 消費は1期間あたり約600unit/日程度
- YouTube API の quota は日本時間17時頃にリセットされる
- 開発モード（`npm run dev`）ではキャッシュが効かず、開くたびに quota を消費する
