import fs from 'node:fs';
import path from 'node:path';

const PROJECT_ROOT = process.cwd();

const TITLE_OVERRIDES = {
  scout: '星探！',
  tipperary: '蒂珀雷里',
  boop: '猫咪碰碰',
  similo: '线索灵犀',
  sagani: '萨迦尼',
  geekoutmasters: '极客大比拼：大师版',
  pixies: '小精灵',
  lineit: '排列成线',
  lostexplorers: '迷失探险家',
  iwari: '伊瓦里',
  quarto: '四重奏棋',
  euchre: '尤克牌',
  neom: '新经济之城',
  crusadersthywillbedone: '十字军：遵主旨意',
  spookytower: '幽灵高塔',
  k2: 'K2雪峰',
  mindup: '心念排序',
  solstis: '至日',
  qawale: '卡瓦勒',
  quibbles: '小吵牌',
  qwinto: '昆托',
  cubosaurs: '方块恐龙',
  lielow: '谎言高低',
  romirami: '罗米拉米',
  rollandbump: '掷骰撞撞',
  knister: '闪点骰阵',
  strands: '线索拼词',
  capereurope: '欧洲妙贼',
  mutantcrops: '变异作物',
  goldblivion: '金矿遗迹',
  greatsplit: '大分配',
  fliptoons: '翻翻卡通',
  wispwood: '幽光森林',
  dewan: '德万',
  draftandwriterecords: '选牌写唱片',
  miams: '美味小吃',
  tacta: '战术方阵',
  verso: '反转牌',
  dicycards: '骰子卡牌',
  pilipili: '辣椒派对',
  schnapsen: '施纳普森',
  thegang: '怪盗团',
  elawa: '埃拉瓦',
  karvi: '卡尔维',
  ninjan: '忍者阵',
  bandada: '鸟群',
  tagteam: '双打拍档',
  abrachadabra: '阿布拉咒语',
  oxono: '奥克索诺',
  yaxha: '雅克斯哈',
};

const TARGET_FILES = [
  'src/data/gameDatabase.ts',
  'src/data/gameDatabaseAutoExpansion.ts',
  'src/data/gameDatabaseCatalogExpansion.ts',
];

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function replaceTitleInText(text, gameId, titleCn) {
  const escapedId = escapeRegExp(gameId);
  const singleQuotePattern = new RegExp(`(id:\\s*'${escapedId}',\\s*\\n\\s*titleCn:\\s*)'[^']*'`, 'g');
  const doubleQuotePattern = new RegExp(`("id":\\s*"${escapedId}",\\s*\\n\\s*"titleCn":\\s*)"[^"]*"`, 'g');

  return text
    .replace(singleQuotePattern, `$1'${titleCn}'`)
    .replace(doubleQuotePattern, `$1"${titleCn}"`);
}

let totalChanges = 0;

for (const relativeFile of TARGET_FILES) {
  const filePath = path.join(PROJECT_ROOT, relativeFile);
  if (!fs.existsSync(filePath)) {
    continue;
  }

  const original = fs.readFileSync(filePath, 'utf8');
  let updated = original;

  for (const [gameId, titleCn] of Object.entries(TITLE_OVERRIDES)) {
    const before = updated;
    updated = replaceTitleInText(updated, gameId, titleCn);
    if (updated !== before) {
      totalChanges += 1;
    }
  }

  if (updated !== original) {
    fs.writeFileSync(filePath, updated);
    console.log(`localized ${relativeFile}`);
  }
}

console.log(`localized title entries: ${totalChanges}`);
