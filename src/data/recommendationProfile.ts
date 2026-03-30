import type { Game, RecommendationProfile } from '@/types';

type RecommendationFacet =
  | 'occasionTags'
  | 'interactionTags'
  | 'mechanicTags'
  | 'moodTags'
  | 'themeTags';

interface FacetRule {
  facet: RecommendationFacet;
  tag: string;
  aliases: string[];
  searchTerms?: string[];
}

export const RECOMMENDATION_TAG_VOCABULARY = {
  playerTags: ['双人核心', '3到4人佳', '5人以上佳', '大团体适配'],
  durationTags: ['15分钟内', '30分钟内', '60分钟内', '60分钟以上'],
  complexityTags: ['新手友好', '轻策略', '中策略', '重策略'],
  occasionTags: ['情侣约会', '朋友聚会', '团建破冰', '家庭同乐'],
  interactionTags: ['合作共赢', '阵营推理', '嘴炮谈判', '高互动对抗', '安静对弈', '团队对抗'],
  mechanicTags: [
    '手速反应',
    '猜词联想',
    '手牌管理',
    '引擎构筑',
    '工人放置',
    '拼图布局',
    '抽象对战',
    '路线规划',
    '纸笔规划',
    '拍卖押注',
    '骰子驱动',
    '角色技能',
    '编程行动',
    '竞速赛跑',
    '吃墩叫牌',
    '收集组合',
    '卡组构筑',
  ],
  moodTags: ['轻松休闲', '欢乐搞笑', '烧脑策略', '低冲突友好'],
  themeTags: ['自然动物', '科幻太空', '文明历史', '商业经营'],
} as const;

const FACET_RULES: FacetRule[] = [
  {
    facet: 'occasionTags',
    tag: '情侣约会',
    aliases: ['情侣首选', '情侣', '约会', '二人拼图'],
    searchTerms: ['情侣', '约会'],
  },
  {
    facet: 'occasionTags',
    tag: '朋友聚会',
    aliases: ['聚会', '聚会必备', '派对', '热场', '酒吧游戏', '友尽神器'],
    searchTerms: ['聚会', '人多', '热闹', '欢乐'],
  },
  {
    facet: 'occasionTags',
    tag: '团建破冰',
    aliases: ['破冰', '团队配合', '默契', '默契测试', '眼神交流', '猜词', '看图说话', '文字联想'],
    searchTerms: ['破冰', '聊天', '说话', '开场'],
  },
  {
    facet: 'occasionTags',
    tag: '家庭同乐',
    aliases: ['家庭策略', '家庭欢乐', '家庭桌游', '经典入门', '简单易懂', '推新神器'],
    searchTerms: ['家庭', '亲子', '合家欢'],
  },
  {
    facet: 'interactionTags',
    tag: '合作共赢',
    aliases: ['合作', '合作抗疫', '盲打合作', '团队配合', '拯救世界', '硬核合作', '默契测试', '禁止说话'],
    searchTerms: ['合作', '协作', '不想互相伤害', '友好'],
  },
  {
    facet: 'interactionTags',
    tag: '阵营推理',
    aliases: [
      '身份推理',
      '阵营推理',
      '阵营',
      '阵营对抗',
      '终极推理',
      '极速推理',
      '逻辑推理',
      '演技大赏',
      '说谎法则',
      '没有法官',
      '天亮就投',
      '谍战',
      '传情报',
    ],
    searchTerms: ['阵营', '身份', '推理', '嘴炮', '说谎'],
  },
  {
    facet: 'interactionTags',
    tag: '嘴炮谈判',
    aliases: ['交易谈判', '谈判', '商战', '嘴炮', '经济博弈'],
    searchTerms: ['嘴炮', '谈判', '聊天博弈'],
  },
  {
    facet: 'interactionTags',
    tag: '高互动对抗',
    aliases: ['互相伤害', '友尽神器', '友尽前奏', '互殴', '乱斗', '暗算', '卡路', '互相卡手', '二人对战'],
    searchTerms: ['对抗', '博弈', '互坑'],
  },
  {
    facet: 'interactionTags',
    tag: '安静对弈',
    aliases: ['抽象棋类', '拼图游戏', '二人拼图', '板块拼接', '版图拼接', '贴瓷砖', '空间拼图', '颜值正义'],
    searchTerms: ['安静', '低冲突', '对弈'],
  },
  {
    facet: 'interactionTags',
    tag: '团队对抗',
    aliases: ['团队对抗'],
    searchTerms: ['团队对抗', '分队'],
  },
  {
    facet: 'mechanicTags',
    tag: '手速反应',
    aliases: ['拼手速', '眼疾手快', '找茬高手', '指甲杀手'],
    searchTerms: ['手速', '反应', '快节奏'],
  },
  {
    facet: 'mechanicTags',
    tag: '猜词联想',
    aliases: ['猜词', '联想猜测', '词语接龙', '文字联想', '看图说话', '想象力', '机密代号'],
    searchTerms: ['猜词', '联想', '表达', '说话'],
  },
  {
    facet: 'mechanicTags',
    tag: '手牌管理',
    aliases: ['手牌管理', '集换手牌', '不能重排'],
  },
  {
    facet: 'mechanicTags',
    tag: '引擎构筑',
    aliases: ['引擎构筑', '引擎构建', '卡牌组合', '资源转换'],
  },
  {
    facet: 'mechanicTags',
    tag: '工人放置',
    aliases: ['工人放置'],
  },
  {
    facet: 'mechanicTags',
    tag: '拼图布局',
    aliases: ['拼图游戏', '二人拼图', '板块拼接', '版图拼接', '贴瓷砖', '空间拼图', '草坪规划'],
  },
  {
    facet: 'mechanicTags',
    tag: '抽象对战',
    aliases: ['抽象棋类', '二人对战', '盖房子'],
  },
  {
    facet: 'mechanicTags',
    tag: '路线规划',
    aliases: ['路线规划', '卡路'],
  },
  {
    facet: 'mechanicTags',
    tag: '纸笔规划',
    aliases: ['纸笔', '规划', '多人同玩', '同时进行', '同时开玩', '同步行动', '写写画画'],
    searchTerms: ['纸笔', '同时进行', '同步行动', '多人同玩', '写写画画'],
  },
  {
    facet: 'mechanicTags',
    tag: '拍卖押注',
    aliases: ['拍卖', '押注', '豪赌', '赌狗必玩', '运气比拼'],
  },
  {
    facet: 'mechanicTags',
    tag: '骰子驱动',
    aliases: ['骰子', '骰子策略'],
  },
  {
    facet: 'mechanicTags',
    tag: '角色技能',
    aliases: ['角色选择'],
  },
  {
    facet: 'mechanicTags',
    tag: '编程行动',
    aliases: ['编程移动'],
  },
  {
    facet: 'mechanicTags',
    tag: '竞速赛跑',
    aliases: ['竞速', '骆驼赛跑', '赛车'],
  },
  {
    facet: 'mechanicTags',
    tag: '吃墩叫牌',
    aliases: ['吃墩', '叫牌'],
  },
  {
    facet: 'mechanicTags',
    tag: '收集组合',
    aliases: ['收集', '收集控', '成套收集'],
  },
  {
    facet: 'mechanicTags',
    tag: '卡组构筑',
    aliases: ['卡组构筑', '卡牌驱动'],
  },
  {
    facet: 'moodTags',
    tag: '轻松休闲',
    aliases: ['简单易懂', '轻策', '中轻策', '极简', '爽局', '热场', '家庭欢乐', '推新神器'],
    searchTerms: ['轻松', '休闲', '上手快'],
  },
  {
    facet: 'moodTags',
    tag: '欢乐搞笑',
    aliases: ['欢乐', '热场', '脑洞大开', '怪兽乱斗', '酒吧游戏', '懂的都懂'],
    searchTerms: ['搞笑', '欢乐', '热闹'],
  },
  {
    facet: 'moodTags',
    tag: '烧脑策略',
    aliases: ['硬核策略', '德式重策', '德式策略', '策略大作', '极度压榨', '德式经典', '老牌德式'],
    searchTerms: ['烧脑', '偏烧脑', '策略', '重策'],
  },
  {
    facet: 'moodTags',
    tag: '低冲突友好',
    aliases: ['家庭策略', '家庭桌游', '安静对弈', '单人可玩', '画风精美'],
    searchTerms: ['低冲突', '友好', '不互坑'],
  },
  {
    facet: 'themeTags',
    tag: '自然动物',
    aliases: ['动物主题', '鸟类百科', '自然主题', '生态主题'],
  },
  {
    facet: 'themeTags',
    tag: '科幻太空',
    aliases: ['科幻', '科幻经营', '太空'],
  },
  {
    facet: 'themeTags',
    tag: '文明历史',
    aliases: ['文明竞争', '文明发展', '地理知识', '西部'],
  },
  {
    facet: 'themeTags',
    tag: '商业经营',
    aliases: ['经商', '经营建设', '商战', '海运', '交易谈判'],
  },
];

const PLAYER_TAG_SEARCH_TERMS: Record<string, string[]> = {
  双人核心: ['双人', '两人', '2人'],
  '3到4人佳': ['3到4人', '3-4人', '三四个人'],
  '5人以上佳': ['5人以上', '6人以上', '多人', '人多'],
  大团体适配: ['大团体', '多人', '团建'],
};

const DURATION_TAG_SEARCH_TERMS: Record<string, string[]> = {
  '15分钟内': ['15分钟内', '十几分钟', '快节奏'],
  '30分钟内': ['30分钟内', '半小时内', '半小时'],
  '60分钟内': ['60分钟内', '一小时内'],
  '60分钟以上': ['60分钟以上', '一小时以上', '长局'],
};

const COMPLEXITY_TAG_SEARCH_TERMS: Record<string, string[]> = {
  新手友好: ['新手', '入门', '上手快'],
  轻策略: ['轻策略', '轻松烧脑'],
  中策略: ['中策略', '有点策略'],
  重策略: ['重策略', '烧脑', '硬核'],
};

function uniqueStrings(values: Array<string | undefined | null>): string[] {
  return Array.from(new Set(values.map((value) => value?.trim()).filter(Boolean) as string[]));
}

function createEmptyProfile(): RecommendationProfile {
  return {
    playerTags: [],
    durationTags: [],
    complexityTags: [],
    occasionTags: [],
    interactionTags: [],
    mechanicTags: [],
    moodTags: [],
    themeTags: [],
    allTags: [],
    searchTerms: [],
  };
}

function addUnique(target: string[], values: string[]): void {
  values.forEach((value) => {
    if (value && !target.includes(value)) {
      target.push(value);
    }
  });
}

function addFacetTag(
  profile: RecommendationProfile,
  facet: RecommendationFacet,
  tag: string,
  searchTerms: string[] = [],
): void {
  if (!profile[facet].includes(tag)) {
    profile[facet].push(tag);
  }
  addUnique(profile.searchTerms, [tag, ...searchTerms]);
}

function containsAlias(haystack: string, aliases: string[]): boolean {
  return aliases.some((alias) => haystack.includes(alias.toLowerCase()));
}

function addPlayerAndDurationTags(game: Game, profile: RecommendationProfile): void {
  const bestPlayerCount = game.bestPlayerCount ?? [];
  const supportsLargeGroup = game.maxPlayers >= 8 || bestPlayerCount.some((count) => count >= 6);

  if (game.minPlayers <= 2 && game.maxPlayers === 2) {
    addUnique(profile.playerTags, ['双人核心']);
  } else if (bestPlayerCount.includes(2)) {
    addUnique(profile.playerTags, ['双人核心']);
  }

  if (bestPlayerCount.some((count) => count >= 3 && count <= 4) || (game.minPlayers <= 3 && game.maxPlayers >= 4)) {
    addUnique(profile.playerTags, ['3到4人佳']);
  }

  if (bestPlayerCount.some((count) => count >= 5) || game.maxPlayers >= 6) {
    addUnique(profile.playerTags, ['5人以上佳']);
  }

  if (supportsLargeGroup) {
    addUnique(profile.playerTags, ['大团体适配']);
  }

  if (game.playtimeMin <= 15) {
    addUnique(profile.durationTags, ['15分钟内', '30分钟内', '60分钟内']);
  } else if (game.playtimeMin <= 30) {
    addUnique(profile.durationTags, ['30分钟内', '60分钟内']);
  } else if (game.playtimeMin <= 60) {
    addUnique(profile.durationTags, ['60分钟内']);
  } else {
    addUnique(profile.durationTags, ['60分钟以上']);
  }

  if (game.complexity <= 1.35) {
    addUnique(profile.complexityTags, ['新手友好', '轻策略']);
  } else if (game.complexity <= 2.2) {
    addUnique(profile.complexityTags, ['轻策略']);
  } else if (game.complexity <= 2.8) {
    addUnique(profile.complexityTags, ['中策略']);
  } else {
    addUnique(profile.complexityTags, ['重策略']);
  }

  profile.playerTags.forEach((tag) => addUnique(profile.searchTerms, PLAYER_TAG_SEARCH_TERMS[tag] ?? []));
  profile.durationTags.forEach((tag) => addUnique(profile.searchTerms, DURATION_TAG_SEARCH_TERMS[tag] ?? []));
  profile.complexityTags.forEach((tag) => addUnique(profile.searchTerms, COMPLEXITY_TAG_SEARCH_TERMS[tag] ?? []));
}

function addDerivedTags(game: Game, profile: RecommendationProfile): void {
  if (profile.playerTags.includes('双人核心') && !profile.occasionTags.includes('情侣约会') && game.complexity <= 1.8) {
    addFacetTag(profile, 'occasionTags', '情侣约会', ['情侣', '约会']);
  }

  if (
    (profile.interactionTags.includes('合作共赢') || profile.interactionTags.includes('安静对弈')) &&
    !profile.moodTags.includes('低冲突友好')
  ) {
    addFacetTag(profile, 'moodTags', '低冲突友好', ['低冲突', '友好', '不互坑']);
  }

  if (profile.mechanicTags.includes('猜词联想') && !profile.occasionTags.includes('团建破冰')) {
    addFacetTag(profile, 'occasionTags', '团建破冰', ['破冰', '聊天', '说话']);
  }

  if (
    (profile.interactionTags.includes('阵营推理') ||
      profile.interactionTags.includes('嘴炮谈判') ||
      profile.moodTags.includes('欢乐搞笑')) &&
    !profile.occasionTags.includes('朋友聚会')
  ) {
    addFacetTag(profile, 'occasionTags', '朋友聚会', ['聚会', '热闹', '多人']);
  }

  if (
    game.maxPlayers >= 5 &&
    game.playtimeMin <= 30 &&
    game.complexity <= 1.6 &&
    !profile.occasionTags.includes('朋友聚会')
  ) {
    addFacetTag(profile, 'occasionTags', '朋友聚会', ['聚会', '人多', '热闹', '欢乐']);
  }

  if (
    game.playtimeMin <= 30 &&
    game.complexity <= 1.5 &&
    !profile.moodTags.includes('轻松休闲')
  ) {
    addFacetTag(profile, 'moodTags', '轻松休闲', ['轻松', '休闲', '上手快']);
  }

  if (
    (game.complexity >= 2.5 ||
      (game.complexity >= 2.5 &&
        (profile.mechanicTags.includes('引擎构筑') ||
          profile.mechanicTags.includes('工人放置') ||
          profile.mechanicTags.includes('卡组构筑')))) &&
    !profile.moodTags.includes('烧脑策略')
  ) {
    addFacetTag(profile, 'moodTags', '烧脑策略', ['烧脑', '偏烧脑', '策略', '博弈']);
  }

  if (profile.occasionTags.includes('家庭同乐') && !profile.moodTags.includes('轻松休闲')) {
    addFacetTag(profile, 'moodTags', '轻松休闲', ['轻松', '休闲']);
  }
}

export function buildRecommendationProfile(game: Game): RecommendationProfile {
  const profile = createEmptyProfile();
  const searchCorpus = [
    game.titleCn,
    game.titleEn,
    game.oneLiner,
    ...(game.tags ?? []),
    game.knowledgeBase,
  ]
    .filter(Boolean)
    .join('\n')
    .toLowerCase();

  addPlayerAndDurationTags(game, profile);

  for (const rule of FACET_RULES) {
    if (containsAlias(searchCorpus, rule.aliases.map((alias) => alias.toLowerCase()))) {
      addFacetTag(profile, rule.facet, rule.tag, rule.searchTerms ?? []);
    }
  }

  addDerivedTags(game, profile);

  profile.allTags = uniqueStrings([
    ...profile.playerTags,
    ...profile.durationTags,
    ...profile.complexityTags,
    ...profile.occasionTags,
    ...profile.interactionTags,
    ...profile.mechanicTags,
    ...profile.moodTags,
    ...profile.themeTags,
  ]);
  profile.searchTerms = uniqueStrings(profile.searchTerms);

  return profile;
}
