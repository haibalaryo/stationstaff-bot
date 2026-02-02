import * as Misskey from 'misskey-js';
import { setupDailyPostRanking } from './ranking.js';
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import cron from 'node-cron'; // ★追加
import pkg from 'ws';

import { setupAds } from './senden.js'; // 宣伝
// WebSocketのポリフィル（Node環境でMisskey Streamingを使うため）
const WebSocket = pkg.WebSocket || pkg.default || pkg;
global.WebSocket = WebSocket;

// 環境変数のチェック
const MISSKEY_URL = process.env.MISSKEY_URL;
const MISSKEY_TOKEN = process.env.MISSKEY_TOKEN;
const USER_TOKEN = process.env.USER_TOKEN;  // おにゃのこはすはす用API
const NIGHT_IMAGE_ID = process.env.NIGHT_IMAGE_ID;  // おはよう！朝4時になにしてるんだい？


if (!MISSKEY_URL || !MISSKEY_TOKEN) {
  console.error('Error: Set MISSKEY_URL and MISSKEY_TOKEN in .env');
  process.exit(1);
}

const BOT_HOST = new URL(MISSKEY_URL).hostname;
console.log(`Bot instance host: ${BOT_HOST}`);

// データディレクトリの作成
if (!fs.existsSync('./data')) {
  try {
    fs.mkdirSync('./data', { recursive: true });
  } catch (err) {
    console.error('Failed to create data directory:', err);
    process.exit(1);
  }
}

// Misskey Botクライアント設定
const cli = new Misskey.api.APIClient({
  origin: MISSKEY_URL,
  credential: MISSKEY_TOKEN,
});

// Misskey User クライアント設定
let userCli = null;
if (USER_TOKEN) {
  userCli = new Misskey.api.APIClient({
    origin: MISSKEY_URL,
    credential: USER_TOKEN,
  });
  console.log('[Setup] User client initialized for @n1suru posts.');
}

let botUserId;
cli.request('i').then((res) => {
  botUserId = res.id;
  console.log(`Bot user ID: ${botUserId} (@${res.username})`);
}).catch(err => {
  console.error('Login failed:', err);
  process.exit(1);
});

// SQLiteデータベース設定
const db = new Database('./data/database.db');
db.exec(`
  CREATE TABLE IF NOT EXISTS bot_state (
    key TEXT PRIMARY KEY,
    value TEXT
  )
`);

// ========================================
// 1. 新規ユーザー歓迎ロジック
// ========================================
async function checkNewUsers() {
  console.log('[Welcome] Starting checkNewUsers...'); // 生存確認用ログ
  try {
      const users = await cli.request('users', {
        limit: 100,
        origin: 'local',
        state: 'all',
        sort: '+createdAt'  // 「作成日の新しい順」にするオプションを追加
      });

      // ID順（時系列順：新しい順）にソート
      users.sort((a, b) => {
        if (a.id < b.id) return 1;
        if (a.id > b.id) return -1;
        return 0;
      });

      if (users.length === 0) return;

      // APIが見ている最新ユーザー
      console.log(`[Debug] API Top User: ${users[0].username} (ID: ${users[0].id})`);

      // 前回チェックした最後のユーザーIDを取得
      const stateRecord = db.prepare("SELECT value FROM bot_state WHERE key = 'last_welcome_user_id'").get();
      let lastCheckedUserId = stateRecord ? stateRecord.value : null;

      // 初回起動時は現在の最新ユーザーを記録して終了（過去の全員に挨拶しないため）
      if (!lastCheckedUserId) {
        console.log(`[Welcome] First run detected! Setting baseline to: ${users[0].id}`);
        db.prepare("INSERT OR REPLACE INTO bot_state (key, value) VALUES (?, ?)").run('last_welcome_user_id', users[0].id);
        return;
      }

      const newUsers = [];
      for (const user of users) {
        if (user.host !== null) continue; // リモートユーザーは除外
        if (user.id === botUserId) continue; // 自分自身は除外

        // 以下(<=)なので前回挨拶したユーザーが削除されていても、それより古いIDが来れば止まる
        if (user.id <= lastCheckedUserId) break; 
        
        newUsers.push(user);
      }

      if (newUsers.length === 0) {
        // console.log('[Debug] No NEW users found.'); // ログ過多ならコメントアウト
        return;
      }

      // フェイルセーフ追加
      // もし何らかの理由で大量のユーザーがヒットした場合（DB消失やロジックエラー）、
      // 暴走を防ぐために処理を強制中断し、基準点を最新に更新して終了
      const SAFETY_LIMIT = 10; // 一度に挨拶する上限人数
      
      if (newUsers.length > SAFETY_LIMIT) {
        console.warn(`[Welcome] ⚠️ Abnormal number of new users detected (${newUsers.length} users). Aborting to prevent spam.`);
        console.warn(`[Welcome] Updating last_welcome_user_id to current newest: ${users[0].id}`);
        
        // 最新のIDまで「処理済み」としてマークして今回は何もしない
        db.prepare("INSERT OR REPLACE INTO bot_state (key, value) VALUES (?, ?)").run('last_welcome_user_id', users[0].id);
        return;
      }

      // 古い順に挨拶するために反転
      const newestUserId = newUsers[0].id; // 取得した中で一番新しいIDを保存用にとっておく
      newUsers.reverse();

      for (const user of newUsers) {
        const welcomeText = `@${user.username} さん、${BOT_HOST} へようこそ！🎉

  【はじめての方へ】
  １．プロフィールを設定してアイコンを変えてみよう
  ２．「@loginbonus ログボ」と呟くとログボが貰えるよ！
  ３．サーバー状況は @stationstaff で確認できるよ

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
        // 連投制限回避のウェイト
        await new Promise(resolve => setTimeout(resolve, 3000));
      }

      // 状態更新
      db.prepare("INSERT OR REPLACE INTO bot_state (key, value) VALUES (?, ?)").run('last_welcome_user_id', newestUserId);

    } catch (err) {
      console.error('[Welcome] Error:', err);
    }
}

// ========================================
// 2. 再起動予告通知（毎日1:57）
// ========================================

async function postRebootNotice() {
  // 重複防止チェック: 今日すでに予告済みならスキップ
  const stateRecord = db.prepare("SELECT value FROM bot_state WHERE key = 'last_reboot_notice_date'").get();
  // 日本時間の「今日」の日付文字列 (YYYY-MM-DD)
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;

  if (stateRecord && stateRecord.value === today) {
    console.log('[Reboot] Already notified today. Skipping.');
    return;
  }

  console.log('[Reboot] Posting reboot notice...');

  try {
    await cli.request('notes/create', {
      text: `⚠️ **再起動予告** ⚠️

あと数分で再起動をします。
サーバーにアクセスできなくなりますので、終了までしばしお待ちください。

再起動時刻: n分後
予定所要時間: 数分`,
      visibility: 'public'
    });

    // 成功したら今日の日付を記録
    db.prepare("INSERT OR REPLACE INTO bot_state (key, value) VALUES (?, ?)").run('last_reboot_notice_date', today);
    console.log('[Reboot] Reboot notice posted successfully.');
  } catch (err) {
    console.error('[Reboot] Failed to post reboot notice:', err);
  }
}

// ========================================
// 3. バックアップ完了通知
// ========================================

// docker-composeでマウントしたパス
const BACKUP_DIR = '/mnt/backups';

async function checkBackupCompletion() {
  try {
    if (!fs.existsSync(BACKUP_DIR)) {
      console.log('[Backup] Backup directory not found.');
      return;
    }

    const files = fs.readdirSync(BACKUP_DIR);
    
    // 新しい順（降順）にソート
    const backupFiles = files.filter(f => 
      f.startsWith('misskey_full_backup_') && f.endsWith('.tar.gz')
    ).sort().reverse();

    if (backupFiles.length === 0) {
      return;
    }

    const latestBackup = backupFiles[0];
    const filePath = path.join(BACKUP_DIR, latestBackup);
    const stats = fs.statSync(filePath);
    const fileModifiedTime = stats.mtime;

    // 重複防止チェック: 最後に通知したファイルと同じならスキップ
    const stateRecord = db.prepare("SELECT value FROM bot_state WHERE key = 'last_notified_backup'").get();
    const lastNotifiedBackup = stateRecord ? stateRecord.value : null;

    if (lastNotifiedBackup === latestBackup) {
      return; // 既に通知済み
    }

    // ファイルが「ここ1h以内」に作成・更新されたかチェック
    const now = new Date();
    const timeDiffMinutes = (now - fileModifiedTime) / 1000 / 60;
    
    if (timeDiffMinutes < 60) {
      console.log(`[Backup] New backup detected: ${latestBackup}`);

      const fileSizeMB = (stats.size / 1024 / 1024).toFixed(2);

      try {
        await cli.request('notes/create', {
          text: `✅ **バックアップ完了**

バックアップに成功しました！

📦 ファイル名: ${latestBackup}
💾 サイズ: ${fileSizeMB} MB
🕐 作成日時: ${fileModifiedTime.toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}`,
          visibility: 'public'
        });

        // 通知済みとして記録
        db.prepare("INSERT OR REPLACE INTO bot_state (key, value) VALUES (?, ?)").run('last_notified_backup', latestBackup);
        console.log('[Backup] Backup completion notice posted successfully.');
      } catch (err) {
        console.error('[Backup] Failed to post backup notice:', err);
      }
    }

  } catch (err) {
    console.error('[Backup] Error checking backups:', err);
  }
}

// ========================================
// スケジューラー設定
// ========================================

function setupScheduledTasks() {
  console.log('[StationStaff] Setting up scheduled tasks...');
  const timeZone = { timezone: 'Asia/Tokyo'};

  // 宣伝モジュール起動
  setupAds(cli, timeZone);
  // 投稿数ランキング（毎日23:45）
  setupDailyPostRanking(cli, {
    timeZone: 'Asia/Tokyo',
    // calcOpts: { includeReplies: true, includeRenotes: true, excludeBots: true }
  });

  // 再起動予告：毎日 03:57 (Asia/Tokyo) // 投稿しない
  // cron.schedule('57 3 * * *', () => {
  //   console.log('[Cron] Reboot notice triggered.');
  //   postRebootNotice();
  // }, {
  //   timezone: 'Asia/Tokyo'
  // });

  // バックアップチェック：5分ごとに実行
  // 常に監視して、新しいファイルができたら通知するスタイル
  cron.schedule('*/5 * * * *', () => {
    checkBackupCompletion();
  }, {
    timezone: 'Asia/Tokyo'
  });

  // 追加:
  // 1. JST0200 おにゃのこhshs
  cron.schedule('0 2 * * *', async () => {
    if (!userCli) return;
    try {
      console.log('[Cron] Posting 2:00 hshs note...');
      await userCli.request('notes/create', {
        text: 'かぁいいおにゃのこはすはすしたい #kawaii_onnanoko_hshs_sitai',
        visibility: 'public'
      });
    } catch (err) {
      console.error('[Cron] Failed to post 4:00 note:', err);
    }
  }, timeZone);
  // 2. JST0230 2時には寝ようの歌
  cron.schedule('31 2 * * *', async () => {
    try {
      console.log('[Cron] Posting 2:30 song...');
      await cli.request('notes/create', {
        text: '2時には寝ようの歌 #bot\nhttps://fedimovie.com/videos/watch/c49d178c-ac40-418c-8ae7-07a8e4028847', // リンクは好きなのに変えて
        visibility: 'public'
      });
    } catch (err) {
      console.error('[Cron] Failed to post 2:30 note:', err);
    }
  }, timeZone);
  // 3. JST0300 大惨事
  cron.schedule('0 3 * * *', async () => {
    try {
      console.log('[Cron] Posting 3:00 disaster note...');
      await cli.request('notes/create', {
        text: ':mou3jidashi_daisanjittekanji: #bot',
        visibility: 'public'
      });
    } catch (err) {
      console.error('[Cron] Failed to post 3:00 note:', err);
    }
  }, timeZone);
  // 4. JST0400 おはよう！朝4時に何してるんだい？
  cron.schedule('0 4 * * *', async () => {
    if (!NIGHT_IMAGE_ID) {
      console.log('[Cron] Skip 4:00 image post (No Image ID).');
      return;
    }
    try {
      console.log('[Cron] Posting 4:00 image note...');
      await cli.request('notes/create', {
        text: '#bot',
        fileIds: [NIGHT_IMAGE_ID], // ここで画像のIDを指定する
        visibility: 'public'
      });
    } catch (err) {
      console.error('[Cron] Failed to post 4:00 note:', err);
    }
  }, timeZone);

  console.log('[StationStaff] Scheduled tasks registered.');
}

// ----------------------------------------
// 起動処理
// ----------------------------------------

console.log('[StationStaff] Bot started.');

// 新規ユーザーチェック (起動10秒後、以降5分ごと)
setTimeout(checkNewUsers, 10000);
setInterval(checkNewUsers, 5 * 60 * 1000);

// スケジューラー起動
setupScheduledTasks();

// 起動時にバックアップ状況を一回だけ確認（Botが落ちてた間に終わったやつを拾うため）
setTimeout(checkBackupCompletion, 8000);

// ★注意: postRebootNoticeは起動時に即実行しない（誤爆防止）
