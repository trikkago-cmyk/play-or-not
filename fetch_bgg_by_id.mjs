import fs from 'fs';

const games = [
    ["卡卡颂", 822, "BV1PZ4y187Hf", "拼接地面的经典板块放置游戏玩家共同构建中世纪景观"],
    ["璀璨宝石", 148228, "BV1pD4y1o7ta", "收集宝石换取发展卡的入门级引擎构筑游戏非常适合推新"],
    ["车票之旅", 9209, "BV1PC4y1h7Nj", "收集按颜色匹配的火车票在地图上铺设铁路完成隐藏路线"],
    ["七大奇迹", 68448, "BV144411a7vk", "文明发展主题的多人同时轮抽游戏建立你的世界奇迹"],
    ["农场主", 31260, "BV1Zo4y1w72z", "极具深度的工人放置与资源管理游戏发展你的中世纪农场"],
    ["展翅翱翔", 266192, "BV1BB4y1N7ui", "以鸟类为主题的绝美引擎构筑卡牌游戏画风极度精美"],
    ["沙丘：帝国", 316554, "BV1NL411M72Y", "结合了工人放置与卡组构筑机制的科幻策略大作"],
    ["波多黎各", 3076, "BV1SL4y1c753", "经典的角色选择机制建设殖民地赚取分数与金钱"],
    ["阿瓦隆", 128882, "BV1Ym4y1Q7Gq", "没有玩家淘汰的身份推理阵营游戏极其考验演技与逻辑"],
];

async function main() {
    console.log("Fetching images by ID...");
    for (const [cn, id, bv, desc] of games) {
        try {
            const thingUrl = `https://boardgamegeek.com/xmlapi2/thing?id=${id}`;
            const thingRes = await fetch(thingUrl);
            const thingText = await thingRes.text();
            const coverMatch = thingText.match(/<image>(.*?)<\/image>/);
            if (coverMatch) {
                console.log(`{
  id: '${cn === "沙丘：帝国" ? "dune-imperium" : en_id(cn)}',
  titleCn: '${cn}',
  titleEn: 'TODO',
  bilibiliId: '${bv}',
  coverUrl: '${coverMatch[1]}',
  minPlayers: 2,
  maxPlayers: 5,
  playtimeMin: 45,
  ageRating: 10,
  complexity: 2.0,
  tags: ['策略', '经典'],
  oneLiner: '${desc}',
  rules: { target: '最高分获胜', flow: '略', tips: '略' },
  FAQ: '',
  commonQuestions: ['怎么赢？']
},`);
            }
        } catch (e) { console.log('Error for', cn); }
        await new Promise(r => setTimeout(r, 500));
    }
}

function en_id(cn) {
    const map = { "卡卡颂": "carcassonne", "璀璨宝石": "splendor", "车票之旅": "ticket-to-ride", "七大奇迹": "7-wonders", "农场主": "agricola", "展翅翱翔": "wingspan", "波多黎各": "puerto-rico", "阿瓦隆": "avalon" };
    return map[cn] || "game";
}

main();
