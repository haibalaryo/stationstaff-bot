# StationStaff Bot 🚉

Misskeyインスタンスに新規登録したユーザーを自動で歓迎するbotだわ。

## 機能

- **自動歓迎メッセージ**: 新規ユーザー登録を検知して自動で歓迎投稿するわ
- **定期監視**: 5分ごとに新規ユーザーをチェックするわ
- **スパム防止**: 同じユーザーに二度と歓迎メッセージを送らないわ

## 必要要件

- Docker & Docker Compose
- Misskeyインスタンス（v12.109.0以降を推奨）
- Bot用アカウントとAPIトークン

## クイックスタート

### 1. リポジトリをクローン

```bash
git clone https://github.com/haibalaryo/stationstaff-bot. git
cd stationstaff-bot
```

### 2. Bot用アカウントを作成

1. あなたのMisskeyインスタンスでBot用の新規アカウントを登録するわ
2. **設定 → API → アクセストークンの発行** を開くわ
3. 以下の権限を付与するわ: 
   - `account:read` （アカウント情報の読み取り）
   - `account:write` （アカウント情報の書き込み）
   - `notes:read` （ノートの読み取り）
   - `notes:write` （ノートの書き込み）

### 3. 環境変数を設定

```bash
cp .env.example .env
nano .env
```

`.env`を編集するわ: 

```env
MISSKEY_URL=https://あなたのインスタンス.com
MISSKEY_TOKEN=取得したAPIトークンをここに貼り付け
```

### 4. Botを起動

```bash
docker-compose up -d
```

### 5. ログを確認

```bash
docker-compose logs -f stationstaff-bot
```

正常に起動すると以下のようなログが出力されるわ:

```
Bot instance host: あなたのインスタンス.com
Bot user ID: xxxxxx (@stationstaff)
[Welcome] Welcome Bot started. 
[Welcome] Initialized!  Latest user ID set to:  xxxxxx (@someuser)
```

## カスタマイズ

### 歓迎メッセージを変更する

`bot.js`を開いて`welcomeText`変数を編集するわ:

```javascript
const welcomeText = `@${user.username} さん、${BOT_HOST}へようこそ！🎉

ここにあなた独自の歓迎メッセージを書くわ！`;
```

編集後は再ビルドが必要だわ: 

```bash
docker-compose down
docker-compose build --no-cache
docker-compose up -d
```

### チェック間隔を変更する

デフォルトは5分間隔だわ。変更するには`bot.js`のこの行を編集するわ:

```javascript
// 10分ごとにチェックする場合
setInterval(checkNewUsers, 10 * 60 * 1000);
```

### メッセージ送信間隔を変更する

デフォルトは3秒間隔だわ。API制限を避けるための待機時間だわ:

```javascript
// 5秒間隔にする場合
await new Promise(resolve => setTimeout(resolve, 5000));
```

### データベースを削除（状態がリセットされるわ）
rm -rf data/

# 仕組み

1. **初回セットアップ**: 起動時に現在の最新ユーザーIDを記録する
2. **定期チェック**: 5分ごとに最新10人のユーザーを取得する
3. **新規ユーザー検出**: 前回記録したIDと比較して新規ユーザーを抽出する
4. **歓迎メッセージ**: 各新規ユーザーにメンション付きで公開投稿する
5. **状態更新**: 最新ユーザーIDをSQLiteに保存する
