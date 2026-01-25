// senden.js
// 宣伝を垂れ流すためのファイル
const cron = require('node-cron');

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

/**
     * ランダムな広告配信をセットアップ
     * @param {object} cli - Misskey API Client
     * @param {object} timezoneConfig - { timezone: 'Asia/Tokyo' }
     */
    function setupAds(cli, timezoneConfig) {
    console.log('[Senden] Random ads module loaded.');

    // 毎日朝6:00 に今日の予定決定
    cron.schedule('0 6 * * *', () => {
    scheduleTodaysAd(cli);
    }, timezoneConfig);

    // (オプション) 起動直後にもチャンスを与えるならここでも呼ぶ
    // scheduleTodaysAd(cli); 
}

/**
 * 今日の広告スケジュール
 */
function scheduleTodaysAd(cli) {
    console.log('[Senden] Deciding schedule for today...');
    // 今日呟くか
    if (Math.random() < 0.3) {
    console.log('[Senden] Today is a skip day. No ads.');
    return;
    }

    // 何時ごろ呟くか
    const startHour = 1;
    const endHour = 23;

    const now = new Date();
    const targetTime = new Date(now.getTime());

    // オフセット計算
    const rangeHours = endHour - startHour;
    const randomMinutes = Math.floor(Math.random() * (rangeHours * 60)); // 分単位のランダム

    targetTime.setHours(startHour, 0, 0, 0); // 今日の8:00
    targetTime.setMinutes(targetTime.getMinutes() + randomMinutes); // ランダムな分を足す

    // 過去時刻→スキップ
    if (targetTime < new Date()) {
    console.log(`[Senden] Target time ${targetTime.toLocaleTimeString()} has already passed. Skipping.`);
    return;
    }

    // 3. どのネタを呟くか決める
    const adContent = ADS[Math.floor(Math.random() * ADS.length)];

    // 4. タイマーをセット
    const delayMs = targetTime.getTime() - new Date().getTime();

    console.log(`[Senden] Ad scheduled at: ${targetTime.toLocaleString()} (Content: ${adContent.text.substring(0, 10)}...)`);

    setTimeout(async () => {
    try {
        await cli.request('notes/create', {
        text: adContent.text,
        cw: adContent.cw,
        visibility: 'public'
        });
        console.log('[Senden] Ad posted successfully.');
    } catch (err) {
        console.error('[Senden] Failed to post ad:', err);
    }
    }, delayMs);
}

module.exports = { setupAds };