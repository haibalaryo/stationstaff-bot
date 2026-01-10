import * as Misskey from 'misskey-js';
import Database from 'better-sqlite3';
import fs from 'fs';
import pkg from 'ws';

// WebSocketポリフィル
const WebSocket = pkg.WebSocket || pkg.default || pkg;
global.WebSocket = WebSocket;

// 環境変数チェック
const MISSKEY_URL = process.env.MISSKEY_URL;
const MISSKEY_TOKEN = process.env.MISSKEY_TOKEN;

if (!MISSKEY_URL || !MISSKEY_TOKEN) {
  console.error('Error: Set MISSKEY_URL and MISSKEY_TOKEN in .env');
  process.exit(1);
}

const BOT_HOST = new URL(MISSKEY_URL).hostname;
console.log(`Bot instance host: ${BOT_HOST}`);

// データディレクトリ作成
if (!fs.existsSync('./data')) {
  try {
    fs.mkdirSync('./data', { recursive: true });
  } catch (err) {
    console.error('Failed to create data directory:', err);
    process.exit(1);
  }
}

// Misskeyクライアント
const cli = new Misskey.api.APIClient({
  origin: MISSKEY_URL,
  credential: MISSKEY_TOKEN,
});

let botUserId;
cli.request('i').then((res) => {
  botUserId = res.id;
  console.log(`Bot user ID: ${botUserId} (@${res.username})`);
}).catch(err => {
  console.error('Login failed:', err);
  process.exit(1);
});

// DB初期化
const db = new Database('./data/database.db');
db.exec(`
  CREATE TABLE IF NOT EXISTS bot_state (
    key TEXT PRIMARY KEY,
    value TEXT
  )
`);

// ========================================
// 新規ユーザー歓迎ロジック
// ========================================

async function checkNewUsers() {
  try {
    // 1. ユーザーリストを取得（新しい順）
    // origin: 'local' で自鯖のユーザーのみに限定
    const users = await cli.request('users', {
      limit: 10,
      origin: 'local',
      state: 'all' 
    });
    
    if (users.length === 0) return;

    // 2. DBから「最後にチェックしたユーザーID」を取得
    const stateRecord = db.prepare("SELECT value FROM bot_state WHERE key = 'last_welcome_user_id'").get();
    let lastCheckedUserId = stateRecord ? stateRecord.value : null;

    // 3. 初回起動時（DBに記録がない場合）
    // 現在の最新ユーザーを記録して終了（過去のユーザーに爆撃しないため）
    if (!lastCheckedUserId) {
      db.prepare("INSERT OR REPLACE INTO bot_state (key, value) VALUES (?, ?)").run('last_welcome_user_id', users[0].id);
      console.log(`[Welcome] Initialized! Latest user ID set to: ${users[0].id} (@${users[0].username})`);
      return;
    }

    // 4. 未挨拶の新規ユーザーを抽出
    const newUsers = [];
    for (const user of users) {
      if (user.id === lastCheckedUserId) break;
      // Bot自身には挨拶しない
      if (user.id === botUserId) continue;
      newUsers.push(user);
    }

    if (newUsers.length === 0) return;

    console.log(`[Welcome] Found ${newUsers.length} new users!`);

    // ★今回のチェックで一番新しいIDを確保
    const newestUserId = newUsers[0].id;

    // 5. 古い順（入ってきた順）に投稿するために反転
    newUsers.reverse();

    for (const user of newUsers) {
      // メッセージ内容はここをいじってくれ
      // ※LogboBotが別に動いている前提で、案内文にはLogboの宣伝を入れてあるぜ
      const welcomeText = `@${user.username} さん、${BOT_HOST} へようこそ！🎉

【はじめての方へ】
🔰 プロフィールを設定してアイコンを変えてみよう
🎁 「@loginbonus ログボ」と呟くとログボが貰えます！
📊 サーバー状況は @stationstaff で確認できます

困ったことがあれば #質問 タグで聞いてください
ゆっくりしていってね！`;

      try {
        await cli.request('notes/create', {
          text: welcomeText,
          visibility: 'public'
        });
        console.log(`[Welcome] Welcomed @${user.username}`);
      } catch (e) {
        console.error(`[Welcome] Failed to welcome @${user.username}:`, e);
      }

      // 連投制限対策（3秒待機）
      await new Promise(resolve => setTimeout(resolve, 3000));
    }

    // 6. 全員への挨拶が終わったらDB更新
    db.prepare("INSERT OR REPLACE INTO bot_state (key, value) VALUES (?, ?)").run('last_welcome_user_id', newestUserId);
    console.log(`[Welcome] State updated. Next check starts from: ${newestUserId}`);

  } catch (err) {
    console.error('[Welcome] Error:', err);
  }
}

// ----------------------------------------
// タイマー設定
// ----------------------------------------

console.log('[Welcome] Welcome Bot started.');

// 起動10秒後に初回チェック
setTimeout(() => {
  checkNewUsers();
}, 10000);

// 5分ごとにチェック
setInterval(checkNewUsers, 5 * 60 * 1000);
