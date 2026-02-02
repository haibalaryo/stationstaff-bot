// senden.js
// 宣伝と啓発を垂れ流すためのファイル
import cron from 'node-cron';

// 広告のネタ帳
const ADS = [
    {
    text: `【PR】新幹線で安く移動したい？
「ぷらっとこだま」なら、前日までの予約でドリンク1本ついてくる！
グリーン車もたったの+1250円から
（2026年1月時点）
https://travel.jr-central.co.jp/top/onewaysitetop/
#bot #おすすめ #非公式`,
    cw: '東京↔️新大阪 :tokaido_shinkansen: 🈯️が最安11,110円～！'
    },
    {
    text: `【PR】U25の特権、使わないと :oozon:
:jal: スカイメイトなら、当日予約でお得に！
・東京ー大阪: **7,480円**
・東京ー名古屋: **6,930円**
・東京ー山形: **6,490円**
（2026年1月時点）
長いおやすみは学生の特権だね
https://www.jal.co.jp/jp/ja/dom/fare/skymate-fare/
#bot #おすすめ #非公式`,
    cw: '25歳以下のみんなへ✈'
    },
];

// グルーミング啓発
const GROOMING_POSTS = [
    {
        cw: 'DMで「写真送って」と言われたら？',
        text: `その相手、本当に信用できますか？
ネット上で優しく接して信頼させ、性的な画像や動画を送らせようとする行為を**「グルーミング（手なずけ）」**といいます。

「好きだよ」「君だけ特別」という言葉は、あなたを支配するための罠かもしれません。
裸の写真を送ると、ネット上から完全に消すことは不可能です。絶対に断ってください。
#bot #注意喚起 #グルーミング対策`
    },
    {
        cw: '「自画撮り」は犯罪になる可能性がある？',
        text: `「イイね！」が欲しくて、あるいは相手に求められて、自分の裸を撮影していませんか？

自分が撮影したものであっても、18歳未満の裸の画像は**「児童ポルノ」**として扱われます。
過去には、投稿した児童自身が特定され、児童ポルノ禁止法違反で検挙された事例もあります。
「加害者」にも「被害者」にもならないために、画像を送るのはやめましょう。
#bot #注意喚起 #ネットリテラシー`
    },
    {
        cw: 'Misskeyの知り合いと会う前に',
        text: `ネットには危険な情報や、犯罪をしようと考えている人もいます。
「悩みを聞くよ」「会って遊ぼう」と誘われても、ついていかないでください。

もし、既に写真を送ってしまい脅されている、性被害に遭っているという場合は、ひとりで抱え込まずに大人や相談窓口（# 8103 など）に助けを求めてください。
#bot #注意喚起 #防犯`
    }
];

/**
 * ランダムな広告・啓発配信をセットアップする
 */
export function setupAds(cli, timezoneConfig) {
    console.log('[Senden] Random ads module loaded.');

    // 1. 宣伝: 毎日 朝1:00 に判定
    cron.schedule('0 1 * * *', () => {
        scheduleTodaysAd(cli);
    }, timezoneConfig);

    // 2. 啓発: 毎日 朝1:30 に判定
    cron.schedule('30 1 * * *', () => {
        scheduleGroomingPost(cli);
    }, timezoneConfig);
}

/**
 * 今日の広告スケジュール
 */
function scheduleTodaysAd(cli) {
    console.log('[Senden] Deciding AD schedule for today...');
    // 今日呟くか (30%の確率でスキップ = 70%投稿)
    if (Math.random() < 0.3) {
        console.log('[Senden] Today is a skip day for Ads.');
        return;
    }
    // 投稿予約
    postAtRandomTime(cli, ADS, 'Ad');
}

/**
 * 今日の啓発投稿スケジュール
 * 3日に1回程度
 */
function scheduleGroomingPost(cli) {
    console.log('[Senden] Deciding GROOMING schedule for today...');
    
    // Math.random() が0.67以上なら投稿
    if (Math.random() < 0.67) {
        console.log('[Senden] Today is a skip day for Grooming info.');
        return;
    }
    
    // 投稿予約処理へ
    postAtRandomTime(cli, GROOMING_POSTS, 'Grooming');
}

/**
 * 共通処理: 指定されたリストからランダムに選び、ランダムな時間に投稿予約する
 */
function postAtRandomTime(cli, contentList, logTag) {
    // 何時ごろ呟くか
    const startHour = 0; // 0時から
    const endHour = 23;  // 23時まで

    const now = new Date();
    const targetTime = new Date(now.getTime());

    // オフセット計算
    const rangeHours = endHour - startHour;
    const randomMinutes = Math.floor(Math.random() * (rangeHours * 60));

    targetTime.setHours(startHour, 0, 0, 0);
    targetTime.setMinutes(targetTime.getMinutes() + randomMinutes);

    // 過去時刻→スキップ
    if (targetTime < new Date()) {
        console.log(`[Senden][${logTag}] Target time ${targetTime.toLocaleTimeString()} has already passed. Skipping.`);
        return;
    }

    // ランダムに記事を選択
    const postContent = contentList[Math.floor(Math.random() * contentList.length)];

    const delayMs = targetTime.getTime() - new Date().getTime();
    console.log(`[Senden][${logTag}] Scheduled at: ${targetTime.toLocaleString()} (Content: ${postContent.cw})`);

    setTimeout(async () => {
        try {
            await cli.request('notes/create', {
                text: postContent.text,
                cw: postContent.cw,
                visibility: 'public'
            });
            console.log(`[Senden][${logTag}] Posted successfully.`);
        } catch (err) {
            console.error(`[Senden][${logTag}] Failed to post:`, err);
        }
    }, delayMs);
}