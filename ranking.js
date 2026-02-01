// ranking.js
import cron from 'node-cron';

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// JSTの YYYY-MM-DD を作る（タイムゾーン固定）
function getJstDateKey(d = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(d);
  const p = Object.fromEntries(parts.map(x => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}

function toEpochMsJst(dateKey, hh, mm, ss = 0) {
  // 例: 2026-02-01T23:30:00+09:00
  return new Date(`${dateKey}T${String(hh).padStart(2,'0')}:${String(mm).padStart(2,'0')}:${String(ss).padStart(2,'0')}+09:00`).getTime();
}

let cachedMe = null;
async function getMe(cli) {
  if (cachedMe) return cachedMe;
  cachedMe = await cli.request('i');
  return cachedMe;
}

/**
 * その日の投稿数ランキングを計算して投稿する
 */
async function buildDailyRanking(cli, opts) {
  const {
    dateKey = getJstDateKey(),
    cutoffHour = 23,
    cutoffMin = 30,
    includeReplies = true,
    includeRenotes = true,
    excludeBots = false,     // trueなら isBot ユーザーを除外
    excludeMyself = true,    // bot自身を除外
    pageLimit = 100,
    apiDelayMs = 200,
  } = opts ?? {};

  const sinceDate = toEpochMsJst(dateKey, 0, 0, 0);
  const untilDate = toEpochMsJst(dateKey, cutoffHour, cutoffMin, 0);

  const me = await getMe(cli);
  const myId = me?.id;

  const counts = new Map(); // userId -> { username, name, count }
  let untilId = undefined;

  for (;;) {
    const body = {
      limit: pageLimit,
      withReplies: includeReplies,
      withRenotes: includeRenotes,
      allowPartial: false,
      sinceDate,
      untilDate,
      ...(untilId ? { untilId } : {}),
    };

    let notes;
    try {
      notes = await cli.request('notes/local-timeline', body);
    } catch (e) {
      throw new Error(`[Ranking] API failed: notes/local-timeline: ${e?.message ?? e}`);
    }

    if (!Array.isArray(notes) || notes.length === 0) break;

    for (const n of notes) {
      const createdAt = new Date(n.createdAt).getTime();
      if (createdAt < sinceDate || createdAt >= untilDate) continue;

      // ローカルユーザーのみ
      if (n.user?.host != null) continue;

      if (excludeMyself && myId && n.userId === myId) continue;
      if (excludeBots && n.user?.isBot === true) continue;

      const userId = n.userId;
      const username = n.user?.username ?? '(unknown)';
      const name = n.user?.name ?? '';

      const cur = counts.get(userId) ?? { username, name, count: 0 };
      cur.username = username;
      cur.name = name;
      cur.count += 1;
      counts.set(userId, cur);
    }

    // 次ページへ
    const last = notes[notes.length - 1];
    untilId = last?.id;
    if (!untilId) break;

    // APIに優しく
    await sleep(apiDelayMs);
  }

  // ソートしてTop10
  const rows = [...counts.entries()]
    .map(([userId, v]) => ({ userId, ...v }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  return { dateKey, sinceDate, untilDate, rows, totalUsers: counts.size };
}

function formatRankingText(result, opts) {
  const { dateKey, rows, totalUsers } = result;
  const cutoffLabel = opts?.cutoffLabel ?? '00:00〜23:30(JST)';
  const title = `**本日の投稿数ランキング (Top 10)** \n${dateKey} ${cutoffLabel}\n`;

  if (rows.length === 0) {
    return `${title}\n集計対象の投稿がありませんでした。`;
  }

  const body = rows.map((r, i) => {
    const rank = i + 1;
    let icon = '';
    if (rank === 1) icon = '🥇';
    else if (rank === 2) icon = '🥈';
    else if (rank === 3) icon = '🥉';
    else icon = `${rank}.`;
    
    // 表示名の調整
    const dispName = r.name ? r.name : r.username;
    return `${icon} **${r.count}回**: ${dispName} (ID:${r.username})`;
  }).join('\n');

  return `${title}\n${body}\n\n(参加者数: ${totalUsers}人) #bot #すてーしょんランキング`;
}

/**
 * 毎日 23:45(JST) にランキング投稿をスケジュール
 */
export function setupDailyPostRanking(cli, options = {}) {
  const timeZone = options.timeZone ?? 'Asia/Tokyo';

  cron.schedule('45 23 * * *', async () => {
    const dateKey = getJstDateKey();
    const calcOpts = {
      dateKey,
      cutoffHour: 23,
      cutoffMin: 30,
      cutoffLabel: '00:00〜23:30(JST)',
      includeReplies: true,
      includeRenotes: true,
      excludeBots: true,
      excludeMyself: true,
      pageLimit: 100,
      apiDelayMs: 200,
      ...(options.calcOpts ?? {}),
    };

    console.log(`[Ranking] Building daily ranking for ${dateKey}...`);

    try {
      const result = await buildDailyRanking(cli, calcOpts);
      const text = formatRankingText(result, calcOpts);

      await cli.request('notes/create', {
        text,
        visibility: 'public',
      });

      console.log('[Ranking] Posted daily ranking.');
    } catch (e) {
      console.error('[Ranking] Failed:', e);
    }
  }, { timezone: timeZone });

  console.log('[Ranking] Scheduled (23:45 JST).');
}