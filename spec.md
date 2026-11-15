# YouTube 一覧ページ spec（grill-me 確定版）

## 目的
- `restoration` / `bushcraft` / `knife making` の検索結果一覧を Vercel Hobby で表示する個人用ページ。

## リポジトリ・キー
- リポジトリ: https://github.com/masasikatano/youtube
- APIキー: `/home/masasikatano/project/youtube/.env` の `YOUTUBE_API_KEY` を Vercel Environment Variables に登録する。

## 仕様（確定）
1. **検索範囲**: 3キーワードの結果を混ぜて1一覧に表示する。
2. **並び順**: アップロード日順（新しい順）。重複動画は排除する。
3. **期間フィルタ**: デフォルト「今週」。「今日／今週／今月／今年」を選択可。`search.list` の `publishedAfter` で絞る（切替ごとに再取得＋別キャッシュ）。
4. **キャッシュ**: 1日キャッシュ。Vercel の fetch cache `revalidate: 86400`（期間×キーワード単位）。cron事前キャッシュなし。追加料金なし。
5. **再生**: 埋め込み再生。タップで同一画面に YouTube 埋め込み＋全画面＋2xボタン付き。iPad第6世代 Safari の制限（JS強制2倍速・自動全画面不可）に配慮し、ワンタップで全画面＆速度切替できるUIにする。
6. **除外・絞込**: Shorts除外。
7. **認証**: 使用者は本人のみ。ID・PASS管理画面・閲覧制限なし。

## API見積もり
- search 100unit × 3KW ＋ videos.list 詳細取得。期間切替ごとに再取得。1日1回程度の利用想定。

## 共通理解の確認
- 未確認：「共通理解に達した」とのユーザー確認がまだ。確認後に実装へ進む。
