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
  console.log('--- [Debug] Check started ---');

  try {
    // 1. ユーザーリストを取得
    // limitを100にして取りこぼしを防ぐ
    const users = await cli.request('users', {
      limit: 100,
      origin: 'local',
      state: 'all'
    });

    // ソート
    // IDの降順（大きい順）＝ 新しい順 に並び替える
    users.sort((a, b) => {
        if (a.id < b.id) return 1;  // aの方が小さい(古い)なら後ろへ
        if (a.id > b.id) return -1; // aの方が大きい(新しい)なら前へ
        return 0;
    });

    console.log(`[Debug] API returned ${users.length} users.`);
    
    if (users.length === 0) {
      console.log('[Debug] No users found via API.');
      return;
    }
    
    // デバッグ：一番新しい人を表示
    console.log(`[Debug] Real Newest User (Sorted): ${users[0].id} (@${users[0].username})`);

    // 2. DBから「最後にチェックしたユーザーID」を取得
    const stateRecord = db.prepare("SELECT value FROM bot_state WHERE key = 'last_welcome_user_id'").get();
    let lastCheckedUserId = stateRecord ? stateRecord.value : null;

    console.log(`[Debug] Last checked ID in DB: ${lastCheckedUserId || 'none (first run)'}`);

    // 3. 初回起動時（DBに記録がない場合）
    if (!lastCheckedUserId) {
      console.log(`[Welcome] First run detected! Setting latest ID to: ${users[0].id} (@${users[0].username})`);
      db.prepare("INSERT OR REPLACE INTO bot_state (key, value) VALUES (?, ?)").run('last_welcome_user_id', users[0].id);
      return;
    }

    // 4. 未挨拶の新規ユーザーを抽出
    const newUsers = [];
    for (const user of users) {
      // origin: 'local' で弾いているはずだが、念のためリモートユーザーを除外
      if (user.host !== null) {
        console.log(`[Debug] Skip remote user: @${user.username}@${user.host}`);
        continue;
      }

      // 既知のIDにぶつかったら終了
      if (user.id === lastCheckedUserId) {
        console.log(`[Debug] Met known user ID: ${user.id}. Stopping search.`);
        break;
      }
      
      // Bot自身には挨拶しない
      if (user.id === botUserId) {
        console.log(`[Debug] Skipping myself (@${user.username}).`);
        continue;
      }
      
      newUsers.push(user);
    }

    if (newUsers.length === 0) {
      console.log('[Debug] No NEW users found since last check.');
      return;
    }

    console.log(`[Welcome] Found ${newUsers.length} new users! Processing...`);

    // 今回のチェックで一番新しいIDを確保
    const newestUserId = newUsers[0].id;

    // 5. 投稿順序を「古い順」にするために反転
    newUsers.reverse();

    for (const user of newUsers) {
      // メッセージ内の案内先を @vnstat に修正
      const welcomeText = `@${user.username} さん、${BOT_HOST} へようこそ！🎉

【はじめての方へ】
🔰 プロフィールを設定してアイコンを変えてみよう
📝 #自己紹介 タグで投稿してみよう
🎁 「@loginbonus ログボ」と呟くとログボが貰えます！
📊 サーバー状況は @vnstat で確認できます

困ったことがあれば #質問 タグで聞いてください
ゆっくりしていってね！`;

      try {
        const res = await cli.request('notes/create', {
          text: welcomeText,
          visibility: 'public'
        });
        console.log(`[Welcome] Welcomed @${user.username} (NoteID: ${res.createdNote.id})`);
      } catch (e) {
        console.error(`[Welcome] Failed to welcome @${user.username}:`, e);
      }

      // 連投制限対策
      await new Promise(resolve => setTimeout(resolve, 3000));
    }

    // 6. DB更新
    db.prepare("INSERT OR REPLACE INTO bot_state (key, value) VALUES (?, ?)").run('last_welcome_user_id', newestUserId);
    console.log(`[Welcome] State updated. Next check starts from: ${newestUserId}`);

  } catch (err) {
    console.error('[Welcome] Error:', err);
    if (err.stack) console.error(err.stack);
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
