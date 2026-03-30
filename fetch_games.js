const games = [
    ["卡卡颂", "Carcassonne", "拼接地面的经典板块放置游戏"],
    ["璀璨宝石", "Splendor", "收集宝石换取发展卡的入门级引擎构筑游戏"],
    ["车票之旅", "Ticket to Ride", "收集按颜色匹配的火车票在地图上铺设铁路"],
    ["七大奇迹", "7 Wonders", "文明发展主题的轮抽游戏，建立你的世界奇迹"],
    ["农场主", "Agricola", "极具深度的工人放置与资源管理游戏，发展你的农场"],
    ["展翅翱翔", "Wingspan", "以鸟类为主题的绝美引擎构筑卡牌游戏"],
    ["沙丘：帝国", "Dune: Imperium", "结合了工人放置与卡组构筑机制的策略大作"],
    ["波多黎各", "Puerto Rico", "经典的角色选择机制，建设殖民地赚取分数"],
    ["阿瓦隆", "The Resistance: Avalon", "没有玩家淘汰的身份推理阵营游戏"],
];

async function main() {
    console.log("Starting fetch...");
    const results = [];

    // We fetch one by one to avoid rate limits
    for (const [cn, en, oneLiner] of games) {
        let bvId = "BVxxxxxx";
        let cover = "url";

        try {
            // Fetch Bilibili BV
            const bUrl = `https://search.bilibili.com/all?keyword=${encodeURIComponent(cn + '桌游教学')}`;
            const bRes = await fetch(bUrl, {
                headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" }
            });
            const text = await bRes.text();
            let match = text.match(/BV[1-9A-HJ-NP-Za-km-z]{10}/g);
            if (match && match.length > 0) {
                // Return the first unique BV
                bvId = match[0];
            }
        } catch (e) { console.log('Bilibili fetch error for', cn); }

        try {
            // Fetch BGG exact
            const bggSearchUrl = `https://boardgamegeek.com/xmlapi2/search?query=${encodeURIComponent(en)}&type=boardgame&exact=1`;
            const bggSearchRes = await fetch(bggSearchUrl);
            const bggSearchText = await bggSearchRes.text();

            const idMatch = bggSearchText.match(/id="(\d+)"/);
            if (idMatch) {
                let id = idMatch[1];
                const thingUrl = `https://boardgamegeek.com/xmlapi2/thing?id=${id}`;
                const thingRes = await fetch(thingUrl);
                const thingText = await thingRes.text();
                const coverMatch = thingText.match(/<image>(.*?)<\/image>/);
                if (coverMatch) {
                    cover = coverMatch[1];
                }
            } else {
                console.log("No exact match for BGG:", en);
            }
        } catch (e) { console.log('BGG fetch error for', en); }

        console.log(`Fetched: ${cn} -> BV: ${bvId}, Cover: ${cover}`);
        results.push({ cn_name: cn, en_name: en, bv_id: bvId, cover_url: cover, oneliner: oneLiner });

        // Delay explicitly 1 second
        await new Promise(r => setTimeout(r, 1000));
    }

    // Dump final JSON
    require('fs').writeFileSync('scraped_games.json', JSON.stringify(results, null, 2));
    console.log("Done. Saved to scraped_games.json");
}

main();
