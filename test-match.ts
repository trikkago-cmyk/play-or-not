import { GAME_DATABASE } from './src/data/gameDatabase';

const text = "我推荐 **《车票之旅》**！\n它有简单治愈的火车旅行体验，就像在游戏里规划路线一样，有类似拼图和占地盘的感觉。\n为了连通东西海岸，大家会争抢车厢，能让玩家快速互动起来，很适合破冰社交。";

const matches = Array.from(text.matchAll(/[《【](.*?)[》】]/g)).map((m: any) => m[1].replace(/[*_]/g, '').trim());
console.log("Matches:", matches);

const detectedGame = matches
  .map(name => GAME_DATABASE.find(g => g.titleCn === name || g.titleEn === name))
  .find(g => g);

console.log("Detected Game:", detectedGame?.titleCn, detectedGame?.id);
