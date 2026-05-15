import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import {
  documentationResponse,
  jsonResponse,
  methodNotAllowed,
  optionsResponse,
  type EndpointDoc,
} from './_lib/agentDocs.js';

export const config = {
  runtime: 'nodejs',
};

const DEFAULT_RAG_SERVICE_URL = 'http://127.0.0.1:8001';
const LOCAL_RAG_SECTIONS_PATH = resolve(process.cwd(), 'knowledge/boardgame_kb_sections.jsonl');

type NodeRequestLike = {
  body?: unknown;
  headers?: Record<string, string | string[] | undefined>;
  method?: string;
  url?: string;
  [Symbol.asyncIterator]?: () => AsyncIterableIterator<Uint8Array | string>;
};

type NodeResponseLike = {
  end: (chunk?: Uint8Array | Buffer | string) => void;
  setHeader: (name: string, value: string | string[]) => void;
  statusCode: number;
};

type LocalKnowledgeSection = {
  document_id: string;
  game_id?: string;
  title_cn?: string;
  title_en?: string;
  aliases?: string[];
  tags?: string[];
  heading?: string;
  section_id?: string;
  section_type?: string;
  content?: string;
  search_text?: string;
  recommendation_tags?: string[];
  min_players?: number;
  max_players?: number;
  playtime_min?: number;
  age_rating?: number;
  complexity?: number;
  [key: string]: unknown;
};

type RagQueryBody = {
  query?: string;
  top_k?: number;
  mode?: string;
  active_game_id?: string;
  where?: Record<string, unknown>;
  where_document?: Record<string, unknown>;
};

type RecommendationRewriteRule = {
  pattern: RegExp;
  aliases: string[];
  skipWhenLightStrategyIntent?: boolean;
};

type ScoredLocalSection = {
  section: LocalKnowledgeSection;
  score: number;
};

const RECOMMENDATION_REWRITE_RULES: RecommendationRewriteRule[] = [
  { pattern: /情侣|约会|两个人约会|双人约会/, aliases: ['双人核心', '情侣约会', '双人', '两人', '2人'] },
  { pattern: /双人|两人|2人/, aliases: ['双人核心', '双人', '两人', '2人'] },
  { pattern: /爸妈|父母|长辈|老人|家里人/, aliases: ['家庭同乐', '低冲突友好', '新手友好', '家庭', '亲子', '合家欢'] },
  { pattern: /经典|耐玩|常青|稳|入门砖|经典入门|老牌|口碑/, aliases: ['经典入门', '德式经典', '老牌德式', '入门砖'] },
  { pattern: /破冰|聊天|说话|表达/, aliases: ['团建破冰', '猜词联想', '破冰', '聊天', '表达'] },
  { pattern: /聚会|人多|热闹|团建|朋友局/, aliases: ['朋友聚会', '欢乐搞笑', '聚会', '人多', '热闹'] },
  { pattern: /合作|协作|不想.*互相伤害|友好/, aliases: ['合作共赢', '低冲突友好', '合作', '友好'] },
  { pattern: /亲子时光|亲子|家庭|合家欢|全家|带娃|孩子|小朋友|儿童|家里人/, aliases: ['家庭同乐', '低冲突友好', '新手友好', '亲子', '合家欢', '家庭'] },
  { pattern: /安静|对弈|低冲突|不互坑|别太伤感情|伤感情/, aliases: ['安静对弈', '低冲突友好', '低冲突', '安静', '对弈'] },
  { pattern: /轻策略|中策略|别太重|不要太重|不想太重|别太烧脑|不要太烧脑|有点策略/, aliases: ['轻策略', '中策略', '低冲突友好', '新手友好'] },
  { pattern: /拼图|布局/, aliases: ['拼图布局'] },
  { pattern: /同时进行|同时开玩|同步行动|边写边玩|写写画画/, aliases: ['纸笔规划', '同时进行', '多人同玩', '写写画画'] },
  { pattern: /阵营|身份|推理/, aliases: ['阵营推理', '身份', '推理'] },
  { pattern: /嘴炮|谈判/, aliases: ['嘴炮谈判', '嘴炮', '谈判'] },
  { pattern: /拍卖|押注|下注|赌注/, aliases: ['拍卖押注', '押注', '拍卖'] },
  { pattern: /对抗|博弈|单挑|斗智|pk/i, aliases: ['高互动对抗', '抽象对战', '对抗', '博弈'] },
  { pattern: /策略|烧脑|重策|硬核|深度/, aliases: ['烧脑策略', '重策略', '策略', '烧脑', '博弈'], skipWhenLightStrategyIntent: true },
  { pattern: /轻松|休闲|简单|上手快|新手/, aliases: ['轻松休闲', '新手友好', '轻松', '休闲', '上手快'] },
  { pattern: /搞笑|欢乐/, aliases: ['欢乐搞笑', '欢乐', '搞笑'] },
  { pattern: /半小时|30分钟/, aliases: ['30分钟内', '半小时内'] },
  { pattern: /一小时|60分钟/, aliases: ['60分钟内', '一小时内'] },
];

const NEGATED_RECOMMENDATION_RULES: Array<[RegExp, string[]]> = [
  [/(?:完全)?(?:不想|不要|别|不考虑)(?:玩)?[^，。；,.;!?？！]{0,10}(?:太重|过重|重策|重策略|硬核|烧脑)/, ['重策略', '烧脑策略', '中策略']],
  [/(?:完全)?(?:不想|不要|别|不考虑)(?:玩)?[^，。；,.;!?？！]{0,10}(?:阵营|身份|推理|狼人|阿瓦隆|钟楼)/, ['阵营推理', '身份', '推理', '嘴炮']],
  [/(?:完全)?(?:不想|不要|别|不考虑)(?:玩)?[^，。；,.;!?？！]{0,10}(?:嘴炮|谈判)/, ['嘴炮谈判', '嘴炮', '谈判']],
  [/(?:完全)?(?:不想|不要|别|不考虑)(?:玩)?[^，。；,.;!?？！]{0,10}(?:对抗|博弈|互坑|互相伤害|伤感情)/, ['高互动对抗', '对抗', '博弈', '互坑']],
  [/(?:完全)?(?:不想|不要|别|不考虑)(?:玩)?[^，。；,.;!?？！]{0,10}(?:烧脑|重策|硬核)/, ['烧脑策略', '重策略', '烧脑', '重策']],
  [/别[^，。；,.;!?？！]{0,8}(?:伤感情|太伤|互坑|互相伤害)/, ['高互动对抗', '对抗', '博弈', '互坑']],
];

const GENERIC_RECOMMENDATION_STOP_TERMS = new Set([
  '推荐',
  '来个',
  '求推荐',
  '桌游',
  '游戏',
  '一个',
  '一款',
  '适合',
  '有没有',
  '想玩',
  '可以',
  '比较',
  '最好',
]);

const CN_NUMBER_MAP: Record<string, number> = {
  两: 2,
  二: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
  十: 10,
};

const RAG_DOC: EndpointDoc = {
  endpoint: '/api/rag',
  title: 'RAG 代理接口',
  description: '优先代理 Python RAG 服务；若没有配置公网 RAG sidecar，则回退到仓库内知识库文件的本地检索。',
  allowedMethods: ['GET', 'POST', 'OPTIONS'],
  requestContentType: 'application/json',
  capabilities: [
    '检查远端或本地回退 RAG 的健康状态',
    '向 Python RAG 服务发送结构化查询请求',
    '在没有 RAG_SERVICE_URL 时，直接基于本地知识库文件做 serverless 检索',
  ],
  limitations: [
    '本地回退检索当前为轻量 lexical rerank，不等同于完整 Python hybrid RAG。',
    '如果配置了 RAG_SERVICE_URL，仍优先使用远端 Python RAG sidecar。',
  ],
  exampleRequest: {
    query: '推荐一个适合 6 人聚会、规则好讲的桌游',
    mode: 'recommendation',
  },
  exampleResponse: {
    query: '推荐一个适合 6 人聚会、规则好讲的桌游',
    top_k: 5,
    hits: [],
    strategy: 'local_sections_lexical',
  },
};

let localSectionsPromise: Promise<LocalKnowledgeSection[]> | null = null;

function normalizeBaseUrl(rawBaseUrl?: string) {
  return (rawBaseUrl || DEFAULT_RAG_SERVICE_URL).trim().replace(/\/+$/, '');
}

function shouldRequireRagService() {
  return /^(1|true|yes)$/i.test(process.env.RAG_REQUIRE_SERVICE?.trim() || '');
}

function ragServiceUnavailableResponse(error: unknown) {
  return jsonResponse({
    error: 'Configured RAG service is unavailable.',
    code: 'rag_service_unavailable',
    hint: 'Check RAG_SERVICE_URL, the Python RAG service health endpoint, and deployment networking before accepting this environment.',
    detail: error instanceof Error ? error.message : String(error),
  }, {
    status: 503,
    headers: {
      'x-rag-provider': 'unavailable',
      'x-rag-required': 'true',
    },
  });
}

function uint8ArrayToArrayBuffer(value: Uint8Array) {
  const copied = new Uint8Array(value.byteLength);
  copied.set(value);
  return copied.buffer;
}

function isFetchRequest(value: unknown): value is Request {
  return value instanceof Request
    || (
      typeof value === 'object'
      && value !== null
      && 'headers' in value
      && typeof (value as { headers?: { get?: unknown } }).headers?.get === 'function'
      && typeof (value as { method?: unknown }).method === 'string'
    );
}

async function nodeRequestToFetchRequest(req: NodeRequestLike): Promise<Request> {
  const headers = new Headers();

  Object.entries(req.headers || {}).forEach(([key, value]) => {
    if (Array.isArray(value)) {
      value.forEach((item) => headers.append(key, item));
      return;
    }

    if (typeof value === 'string') {
      headers.set(key, value);
    }
  });

  const method = (req.method || 'GET').toUpperCase();
  let body: BodyInit | undefined;

  if (method !== 'GET' && method !== 'HEAD') {
    if (typeof req.body === 'string') {
      body = req.body;
    } else if (req.body instanceof Uint8Array) {
      body = new Blob([uint8ArrayToArrayBuffer(req.body)]);
    } else if (req.body instanceof ArrayBuffer) {
      body = new Blob([req.body]);
    } else if (req.body !== undefined && req.body !== null) {
      body = JSON.stringify(req.body);
    } else if (typeof req[Symbol.asyncIterator] === 'function') {
      const chunks: Uint8Array[] = [];
      for await (const chunk of req as AsyncIterable<Uint8Array | string>) {
        chunks.push(typeof chunk === 'string' ? new TextEncoder().encode(chunk) : chunk);
      }
      if (chunks.length > 0) {
        const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
        const merged = new Uint8Array(totalLength);
        let offset = 0;
        chunks.forEach((chunk) => {
          merged.set(chunk, offset);
          offset += chunk.length;
        });
        body = new Blob([uint8ArrayToArrayBuffer(merged)]);
      }
    }
  }

  const host = headers.get('host') || 'localhost';
  const protocol = headers.get('x-forwarded-proto') || 'https';
  const url = new URL(req.url || '/api/rag', `${protocol}://${host}`);

  return new Request(url.toString(), {
    method,
    headers,
    body,
  });
}

async function sendFetchResponse(res: NodeResponseLike, response: Response): Promise<void> {
  res.statusCode = response.status;

  response.headers.forEach((value, key) => {
    res.setHeader(key, value);
  });

  const arrayBuffer = await response.arrayBuffer();
  res.end(Buffer.from(arrayBuffer));
}

function normalizeMatchText(text: string) {
  return (text || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[*_`>#\[\]\(\)"“”‘’|]/g, ' ')
    .replace(/\s+/g, '');
}

function toNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : typeof value === 'string' && value.trim() && Number.isFinite(Number(value))
      ? Number(value)
    : undefined;
}

function normalizeQueryText(query: string) {
  return (query || '').replace(/\s+/g, ' ').trim();
}

function getSectionMode(section: LocalKnowledgeSection) {
  return section.document_id.startsWith('recommendation:') ? 'recommendation' : 'referee';
}

function arrayText(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item) => typeof item === 'string' && item.trim()).join(' ')
    : typeof value === 'string'
      ? value
      : '';
}

function getRecommendationSurface(section: LocalKnowledgeSection) {
  return normalizeMatchText([
    arrayText(section.recommendation_tags),
    arrayText(section.tags),
    arrayText(section.aliases),
    section.title_cn,
    section.title_en,
    section.heading,
    section.content,
    section.search_text,
  ].filter(Boolean).join(' '));
}

function getDisplayTagSurface(section: LocalKnowledgeSection) {
  return normalizeMatchText([
    arrayText(section.tags),
    arrayText(section.recommendation_tags),
    section.search_text,
  ].filter(Boolean).join(' '));
}

function surfaceIncludes(surface: string, term: string) {
  return surface.includes(normalizeMatchText(term));
}

function countSurfaceMatches(surface: string, terms: string[]) {
  return terms.reduce((count, term) => count + (surfaceIncludes(surface, term) ? 1 : 0), 0);
}

function hasQueryIntent(query: string, pattern: RegExp) {
  return pattern.test(normalizeQueryText(query));
}

function extractNegativeRecommendationTerms(query: string) {
  const terms: string[] = [];
  NEGATED_RECOMMENDATION_RULES.forEach(([pattern, aliases]) => {
    if (pattern.test(query)) {
      terms.push(...aliases);
    }
  });

  return Array.from(new Set(terms.map((term) => term.trim()).filter(Boolean)));
}

function stripNegativeRecommendationClauses(query: string) {
  return NEGATED_RECOMMENDATION_RULES.reduce(
    (current, [pattern]) => current.replace(pattern, ' '),
    query,
  )
    .replace(/[，,。；;!?？！]\s*[，,。；;!?？！]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[，,。；;!?？！\s]+|[，,。；;!?？！\s]+$/g, '')
    .trim();
}

function rewriteRecommendationQuery(query: string, mode: string | undefined) {
  const normalizedQuery = normalizeQueryText(query);
  if (mode !== 'recommendation') {
    return {
      rewrittenQuery: normalizedQuery,
      rewriteExpansions: [] as string[],
      negativeTerms: [] as string[],
    };
  }

  const negativeTerms = extractNegativeRecommendationTerms(normalizedQuery);
  const strippedQuery = stripNegativeRecommendationClauses(normalizedQuery) || normalizedQuery;
  const lightStrategyIntent = hasQueryIntent(
    normalizedQuery,
    /轻策略|中策略|别太重|不要太重|不想太重|别太烧脑|不要太烧脑|有点策略/,
  );
  const rewriteExpansions: string[] = [];

  RECOMMENDATION_REWRITE_RULES.forEach((rule) => {
    if (rule.skipWhenLightStrategyIntent && lightStrategyIntent) {
      return;
    }
    if (rule.pattern.test(normalizedQuery)) {
      rule.aliases.forEach((alias) => {
        if (!negativeTerms.includes(alias)) {
          rewriteExpansions.push(alias);
        }
      });
    }
  });

  const uniqueExpansions = Array.from(new Set(rewriteExpansions))
    .filter((item) => item && !strippedQuery.includes(item));

  return {
    rewrittenQuery: uniqueExpansions.length
      ? `${strippedQuery}\n\n检索扩展：${uniqueExpansions.join(' / ')}`
      : strippedQuery,
    rewriteExpansions: uniqueExpansions,
    negativeTerms,
  };
}

function parseRequestedPlayerCount(query: string) {
  const trimmed = normalizeQueryText(query);
  const numericMatch = trimmed.match(/(\d+)\s*(?:人|个人)/);
  if (numericMatch) {
    return Number(numericMatch[1]);
  }

  const cnMatch = trimmed.match(/([两二三四五六七八九十])\s*(?:人|个人)/);
  return cnMatch ? CN_NUMBER_MAP[cnMatch[1]] : undefined;
}

function parseRequestedPlayerRange(query: string): [number, number] | undefined {
  const trimmed = normalizeQueryText(query);
  const numericMatch = trimmed.match(/(\d+)\s*[-~到至]\s*(\d+)\s*(?:人|个人)/);
  if (numericMatch) {
    const left = Number(numericMatch[1]);
    const right = Number(numericMatch[2]);
    return [Math.min(left, right), Math.max(left, right)];
  }

  const cnMatch = trimmed.match(/([两二三四五六七八九十])\s*[到至]\s*([两二三四五六七八九十])\s*(?:人|个人)/);
  if (!cnMatch) {
    return undefined;
  }

  const left = CN_NUMBER_MAP[cnMatch[1]];
  const right = CN_NUMBER_MAP[cnMatch[2]];
  return left && right ? [Math.min(left, right), Math.max(left, right)] : undefined;
}

function parseRequestedMaxPlaytime(query: string) {
  const trimmed = normalizeQueryText(query);
  if (/(半小时|30分钟|一小时|60分钟)\s*(以上|起步|及以上|往上)/.test(trimmed)) {
    return undefined;
  }
  if (trimmed.includes('半小时')) {
    return 30;
  }
  if (trimmed.includes('一小时')) {
    return 60;
  }

  const minuteMatch = trimmed.match(/(\d+)\s*分钟(?!\s*(以上|起步|及以上|往上))/);
  return minuteMatch ? Number(minuteMatch[1]) : undefined;
}

function parseRequestedAgeRating(query: string) {
  const trimmed = normalizeQueryText(query);
  const numericMatch = trimmed.match(/(\d+)\s*(?:岁|歲)(?:\s*(?:以上|左右|孩子|小孩|儿童|小朋友))?/);
  if (numericMatch) {
    return Number(numericMatch[1]);
  }

  const cnNumberMap: Record<string, number> = {
    六: 6,
    七: 7,
    八: 8,
    九: 9,
    十: 10,
    十一: 11,
    十二: 12,
    十三: 13,
    十四: 14,
  };
  const cnMatch = trimmed.match(/(十一|十二|十三|十四|六|七|八|九|十)\s*(?:岁|歲)/);
  return cnMatch ? cnNumberMap[cnMatch[1]] : undefined;
}

function parseRequestedComplexityRange(query: string): { min?: number; max?: number } {
  const trimmed = normalizeQueryText(query);
  const hasHighComplexityNegation = /(别|不要|不想|不用|无需|太)[^，。；,.、]{0,8}(重策|重策略|硬核|烧脑|深度|复杂|难)|(?:重策|重策略|硬核|烧脑|深度|复杂|难)[^，。；,.、]{0,8}(别|不要|不想|不用|无需|太)/.test(trimmed);

  const numericMaxMatch = trimmed.match(/(?:复杂度|难度)\s*(\d+(?:\.\d+)?)\s*(?:以内|以下|之内|以下的|以内的|以下吧|以内吧)/);
  if (numericMaxMatch) {
    return { max: Number(numericMaxMatch[1]) };
  }

  const numericMinMatch = trimmed.match(/(?:复杂度|难度)\s*(\d+(?:\.\d+)?)\s*(?:以上|往上|以上的)/);
  if (numericMinMatch) {
    return { min: Number(numericMinMatch[1]) };
  }

  const numericRangeMatch = trimmed.match(/(?:复杂度|难度)\s*(\d+(?:\.\d+)?)\s*[-~到至]\s*(\d+(?:\.\d+)?)/);
  if (numericRangeMatch) {
    const left = Number(numericRangeMatch[1]);
    const right = Number(numericRangeMatch[2]);
    return { min: Math.min(left, right), max: Math.max(left, right) };
  }

  if (
    /(重策|重策略|硬核|烧脑|深度|高复杂度|高难度|难度高|有难度|规则复杂|复杂(?:的|点|一点|一些)?|难一点|难一些)/.test(trimmed)
    && !hasHighComplexityNegation
  ) {
    return { min: 2.8 };
  }

  if (/(中策|中策略|有点策略|有策略但别太重|有策略，但别太重)/.test(trimmed)) {
    return { min: 1.4, max: 2.8 };
  }

  if (/(轻策|轻策略|别太重|不要太重|不想太重|别太烧脑|不要太烧脑|别太复杂|不要太复杂|规则简单|简单|新手|上手快)/.test(trimmed)) {
    return { max: 2.4 };
  }

  return {};
}

function extractFilterValue(where: unknown, field: string): string | undefined {
  if (!where || typeof where !== 'object') {
    return undefined;
  }

  if (field in (where as Record<string, unknown>)) {
    const value = (where as Record<string, unknown>)[field];
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
  }

  for (const key of ['$and', '$or']) {
    const clauses = (where as Record<string, unknown>)[key];
    if (!Array.isArray(clauses)) {
      continue;
    }
    for (const clause of clauses) {
      const nested = extractFilterValue(clause, field);
      if (nested) {
        return nested;
      }
    }
  }

  return undefined;
}

function hasWhereField(where: unknown, field: string): boolean {
  if (!where || typeof where !== 'object') {
    return false;
  }

  if (field in (where as Record<string, unknown>)) {
    return true;
  }

  for (const key of ['$and', '$or']) {
    const clauses = (where as Record<string, unknown>)[key];
    if (!Array.isArray(clauses)) {
      continue;
    }
    if (clauses.some((clause) => hasWhereField(clause, field))) {
      return true;
    }
  }

  return false;
}

function mergeWhereAndClauses(where: unknown, clauses: Record<string, unknown>[]) {
  const cleanClauses = clauses.filter((clause) => Object.keys(clause).length > 0);
  if (cleanClauses.length === 0) {
    return where;
  }

  if (!where || typeof where !== 'object' || Object.keys(where as Record<string, unknown>).length === 0) {
    return cleanClauses.length === 1 ? cleanClauses[0] : { $and: cleanClauses };
  }

  const whereRecord = where as Record<string, unknown>;
  if (Array.isArray(whereRecord.$and)) {
    return {
      ...whereRecord,
      $and: [...whereRecord.$and, ...cleanClauses],
    };
  }

  return {
    $and: [
      whereRecord,
      ...cleanClauses,
    ],
  };
}

function deriveRecommendationWhereFromQuery(query: string, mode: string | undefined, where: unknown) {
  if (mode !== 'recommendation') {
    return where;
  }

  const clauses: Record<string, unknown>[] = [];
  if (!hasWhereField(where, 'mode')) {
    clauses.push({ mode: 'recommendation' });
  }

  const playerRange = parseRequestedPlayerRange(query);
  if (playerRange) {
    if (!hasWhereField(where, 'min_players')) {
      clauses.push({ min_players: { $lte: playerRange[0] } });
    }
    if (!hasWhereField(where, 'max_players')) {
      clauses.push({ max_players: { $gte: playerRange[1] } });
    }
  } else {
    const requestedPlayerCount = parseRequestedPlayerCount(query);
    if (typeof requestedPlayerCount === 'number') {
      if (!hasWhereField(where, 'min_players')) {
        clauses.push({ min_players: { $lte: requestedPlayerCount } });
      }
      if (!hasWhereField(where, 'max_players')) {
        clauses.push({ max_players: { $gte: requestedPlayerCount } });
      }
    }
  }

  const maxPlaytime = parseRequestedMaxPlaytime(query);
  if (typeof maxPlaytime === 'number' && !hasWhereField(where, 'playtime_min')) {
    clauses.push({ playtime_min: { $lte: maxPlaytime } });
  }

  const complexityRange = parseRequestedComplexityRange(query);
  if (typeof complexityRange.min === 'number' && !hasWhereField(where, 'complexity')) {
    clauses.push({ complexity: { $gte: complexityRange.min } });
  }
  if (typeof complexityRange.max === 'number' && !hasWhereField(where, 'complexity')) {
    clauses.push({ complexity: { $lte: complexityRange.max } });
  }

  const maxAgeRating = parseRequestedAgeRating(query);
  if (typeof maxAgeRating === 'number' && !hasWhereField(where, 'age_rating')) {
    clauses.push({ age_rating: { $lte: maxAgeRating } });
  }

  return mergeWhereAndClauses(where, clauses);
}

function matchesWhereClause(section: LocalKnowledgeSection, where: unknown): boolean {
  if (!where || typeof where !== 'object') {
    return true;
  }

  const record = where as Record<string, unknown>;

  if (Array.isArray(record.$and)) {
    return record.$and.every((clause) => matchesWhereClause(section, clause));
  }

  if (Array.isArray(record.$or)) {
    return record.$or.some((clause) => matchesWhereClause(section, clause));
  }

  return Object.entries(record).every(([field, condition]) => {
    const value = field === 'mode'
      ? getSectionMode(section)
      : field === 'game_id'
        ? section.game_id
        : section[field];

    if (condition && typeof condition === 'object' && !Array.isArray(condition)) {
      const operator = condition as Record<string, unknown>;
      const numericValue = toNumber(value);
      if ('$lte' in operator) {
        const expected = toNumber(operator.$lte);
        return numericValue !== undefined && expected !== undefined && numericValue <= expected;
      }
      if ('$gte' in operator) {
        const expected = toNumber(operator.$gte);
        return numericValue !== undefined && expected !== undefined && numericValue >= expected;
      }
      if ('$eq' in operator) {
        return String(value ?? '') === String(operator.$eq ?? '');
      }
    }

    return String(value ?? '') === String(condition ?? '');
  });
}

function getSectionConfidenceScore(section: LocalKnowledgeSection): number | undefined {
  return toNumber(section.confidence_score);
}

function isIsoDateBeforeToday(value: unknown): boolean {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const today = new Date().toISOString().slice(0, 10);
  return value < today;
}

function getEffectiveVerificationStatus(section: LocalKnowledgeSection): string {
  const status = String(section.verification_status || '').trim();
  if (status === 'stale' || isIsoDateBeforeToday(section.stale_at)) {
    return 'stale';
  }
  return status || 'needs_review';
}

function parseSourceRefs(section: LocalKnowledgeSection) {
  if (Array.isArray(section.source_refs)) {
    return section.source_refs;
  }

  if (typeof section.source_refs_json !== 'string' || !section.source_refs_json.trim()) {
    return [];
  }

  try {
    const parsed = JSON.parse(section.source_refs_json);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function getProvenanceScoreAdjustment(section: LocalKnowledgeSection, mode: string | undefined): number {
  const status = getEffectiveVerificationStatus(section);
  const confidenceScore = getSectionConfidenceScore(section);
  const refereeMode = mode !== 'recommendation';
  let adjustment = 0;

  if (status === 'source_backed') {
    adjustment += refereeMode ? 4 : 2;
  } else if (status === 'reviewed') {
    adjustment += refereeMode ? 1 : 0.5;
  } else if (status === 'needs_review') {
    adjustment -= refereeMode ? 5 : 1.5;
  } else if (status === 'stale') {
    adjustment -= refereeMode ? 14 : 5;
  }

  if (typeof confidenceScore === 'number') {
    adjustment += (confidenceScore - 0.7) * (refereeMode ? 8 : 3);
  }

  return adjustment;
}

function extractNgrams(value: string, minLength = 2, maxLength = 4) {
  const grams: string[] = [];
  for (let size = minLength; size <= Math.min(maxLength, value.length); size += 1) {
    for (let index = 0; index <= value.length - size; index += 1) {
      grams.push(value.slice(index, index + size));
    }
  }
  return grams;
}

function extractQueryTerms(query: string) {
  const uniqueTerms = new Set<string>();
  const normalized = normalizeMatchText(query);

  const rawParts = query
    .split(/[\n/／|,，。！？!?;；:：]+/g)
    .map((part) => part.trim())
    .filter(Boolean);

  rawParts.forEach((part) => {
    const normalizedPart = normalizeMatchText(part);
    if (normalizedPart.length >= 2 && normalizedPart.length <= 10 && !GENERIC_RECOMMENDATION_STOP_TERMS.has(normalizedPart)) {
      uniqueTerms.add(normalizedPart);
    }
  });

  const hanRuns = normalized.match(/[\u4e00-\u9fff]{2,}/g) ?? [];
  hanRuns.forEach((run) => {
    if (run.length <= 10 && !GENERIC_RECOMMENDATION_STOP_TERMS.has(run)) {
      uniqueTerms.add(run);
    }
    extractNgrams(run).forEach((gram) => {
      if (!GENERIC_RECOMMENDATION_STOP_TERMS.has(gram)) {
        uniqueTerms.add(gram);
      }
    });
  });

  const latinRuns = normalized.match(/[a-z0-9-]{2,}/g) ?? [];
  latinRuns.forEach((run) => uniqueTerms.add(run));

  return Array.from(uniqueTerms)
    .filter((term) => term.length >= 2 && !GENERIC_RECOMMENDATION_STOP_TERMS.has(term))
    .sort((left, right) => right.length - left.length);
}

function queryHasAnyTerm(queryTerms: string[], terms: string[]) {
  return terms.some((term) => {
    const normalized = normalizeMatchText(term);
    return queryTerms.some((queryTerm) => queryTerm.includes(normalized) || normalized.includes(queryTerm));
  });
}

function scoreLocalSection(
  section: LocalKnowledgeSection,
  queryTerms: string[],
  mode: string | undefined,
  activeGameId: string | undefined,
  queryText: string,
  negativeTerms: string[],
) {
  const heading = section.heading || '';
  const content = section.content || '';
  const title = `${section.title_cn || ''} ${section.title_en || ''}`.trim();
  const modeValue = getSectionMode(section);
  const sectionType = section.section_type || '';
  const sectionId = section.section_id || '';

  const normalizedHeading = normalizeMatchText(heading);
  const normalizedContent = normalizeMatchText(content);
  const normalizedTitle = normalizeMatchText(title);
  const normalizedSearch = normalizeMatchText(section.search_text || `${title} ${heading} ${content}`);

  let score = 0;

  for (const term of queryTerms) {
    if (!term) {
      continue;
    }

    const weight = Math.min(8, term.length);
    if (normalizedSearch.includes(term)) {
      score += weight;
    }
    if (normalizedHeading.includes(term)) {
      score += weight + 2;
    }
    if (normalizedTitle.includes(term)) {
      score += weight + 1;
    }
    if (normalizedContent.includes(term)) {
      score += Math.max(1, weight - 1);
    }
  }

  if (mode && modeValue === mode) {
    score += 8;
  }

  if (activeGameId && section.game_id === activeGameId) {
    score += 16;
  }

  if (modeValue === 'recommendation') {
    if (sectionType === 'recommendation') {
      score += 5;
    }

    if (sectionId === 'rec_fit') {
      score += 8;
    } else if (sectionId === 'rec_summary') {
      score += 3;
    } else if (sectionId === 'rec_search') {
      score -= 7;
    } else if (sectionId === 'rec_tags') {
      score -= 3;
    }

    const recommendationSurface = getRecommendationSurface(section);
    const displayTagSurface = getDisplayTagSurface(section);
    const complexity = toNumber(section.complexity);
    const playtimeMin = toNumber(section.playtime_min);
    const ageRating = toNumber(section.age_rating);
    const minPlayers = toNumber(section.min_players);
    const maxPlayers = toNumber(section.max_players);
    const requestedPlayerRange = parseRequestedPlayerRange(queryText);
    const requestedPlayerCount = requestedPlayerRange ? undefined : parseRequestedPlayerCount(queryText);
    const matchedRecommendationTerms = countSurfaceMatches(recommendationSurface, queryTerms);
    score += Math.min(18, matchedRecommendationTerms * 2);

    const isFamilyQuery = queryHasAnyTerm(queryTerms, ['亲子', '家庭', '合家欢', '带娃', '孩子', '小朋友', '儿童', '家里人', '亲子时光']);
    if (isFamilyQuery) {
      score += countSurfaceMatches(recommendationSurface, ['家庭同乐', '低冲突友好', '新手友好', '亲子', '合家欢']) * 5;
      score += Math.min(10, countSurfaceMatches(recommendationSurface, ['工人放置', '拼图布局', '路线规划', '收集组合', '引擎构筑']) * 5);
      if (surfaceIncludes(recommendationSurface, '安静对弈')) {
        score += 6;
      }
      if (surfaceIncludes(recommendationSurface, '阵营推理') || surfaceIncludes(recommendationSurface, '嘴炮谈判')) {
        score -= 18;
      }
      if (surfaceIncludes(recommendationSurface, '高互动对抗')) {
        score -= 10;
      }
      if (surfaceIncludes(recommendationSurface, '抽象对战')) {
        score -= 8;
      }
      if (ageRating !== undefined) {
        if (ageRating <= 8) {
          score += 10;
        } else if (ageRating <= 10) {
          score += 4;
        } else if (ageRating >= 12) {
          score -= 12;
        }
      }
      if (complexity !== undefined) {
        if (complexity <= 1.6) {
          score += 7;
        } else if (complexity <= 2.0) {
          score += 3;
        } else if (complexity >= 2.8) {
          score -= 10;
        }
      }
      if (!requestedPlayerRange && requestedPlayerCount === undefined && maxPlayers !== undefined) {
        if (maxPlayers <= 2) {
          score -= 18;
        } else if (maxPlayers >= 4) {
          score += 4;
        }
      }
    }

    const isParentQuery = queryHasAnyTerm(queryTerms, ['爸妈', '父母', '长辈', '老人', '家里人']);
    if (isParentQuery) {
      score += countSurfaceMatches(recommendationSurface, ['家庭同乐', '低冲突友好', '新手友好', '轻松休闲']) * 4;
      score += Math.min(12, countSurfaceMatches(recommendationSurface, ['工人放置', '拼图布局', '路线规划', '收集组合', '引擎构筑']) * 6);
      if (surfaceIncludes(recommendationSurface, '安静对弈')) {
        score += 6;
      }
      if (surfaceIncludes(recommendationSurface, '高互动对抗') || surfaceIncludes(recommendationSurface, '阵营推理') || surfaceIncludes(recommendationSurface, '嘴炮谈判')) {
        score -= 16;
      }
      if (surfaceIncludes(recommendationSurface, '抽象对战')) {
        score -= 10;
      }
      if (complexity !== undefined) {
        if (complexity <= 1.8) {
          score += 6;
        } else if (complexity >= 2.8) {
          score -= 12;
        }
      }
      if (!requestedPlayerRange && requestedPlayerCount === undefined && maxPlayers !== undefined) {
        if (maxPlayers <= 2) {
          score -= 20;
        } else if (maxPlayers >= 4) {
          score += 6;
        }
      }
    }

    const isClassicQuery = queryHasAnyTerm(queryTerms, ['经典', '耐玩', '常青', '入门砖', '口碑']);
    if (isClassicQuery) {
      if (countSurfaceMatches(displayTagSurface, ['经典', '经典入门', '德式经典', '老牌德式', '入门砖', '口碑']) > 0) {
        score += 16;
      }
      score += countSurfaceMatches(recommendationSurface, ['家庭同乐', '低冲突友好', '轻策略', '轻松休闲']) * 2;
      if (countSurfaceMatches(recommendationSurface, ['朋友聚会', '欢乐搞笑', '阵营推理', '高互动对抗']) > 0) {
        score -= 8;
      }
      if (complexity !== undefined) {
        if (complexity <= 1.4) {
          score += 3;
        } else if (complexity <= 2.3) {
          score += 9;
        } else if (complexity >= 2.8) {
          score -= 10;
        }
      }
      if (playtimeMin !== undefined) {
        if (playtimeMin >= 20 && playtimeMin <= 60) {
          score += 5;
        } else if (playtimeMin < 15) {
          score -= 8;
        }
      }
    }

    const isLightStrategyQuery = hasQueryIntent(queryText, /轻策略|别太重|不要太重|不想太重|别太烧脑|不要太烧脑/);
    const isMidStrategyQuery = hasQueryIntent(queryText, /中策略|有点策略|有策略但别太重|有策略，但别太重/);
    const isGentleStrategyQuery = hasQueryIntent(queryText, /有策略但别太重|有策略，但别太重|别太重|不要太重|不想太重/);
    const strategyMechanics = ['引擎构筑', '工人放置', '拼图布局', '路线规划', '收集组合', '卡组构筑', '手牌管理', '骰子驱动'];
    const matchedStrategyMechanics = countSurfaceMatches(recommendationSurface, strategyMechanics);

    if (isLightStrategyQuery) {
      if (surfaceIncludes(recommendationSurface, '轻策略')) score += 10;
      if (surfaceIncludes(recommendationSurface, '中策略')) score += 6;
      if (surfaceIncludes(recommendationSurface, '轻松休闲')) score += 4;
      if (surfaceIncludes(recommendationSurface, '低冲突友好')) score += 4;
      score += Math.min(10, matchedStrategyMechanics * 3);
      if (matchedStrategyMechanics === 0) score -= 10;
      if (countSurfaceMatches(recommendationSurface, ['重策略', '烧脑策略', '高互动对抗', '阵营推理', '朋友聚会']) > 0) {
        score -= 16;
      }
      if (!queryText.includes('合作') && surfaceIncludes(recommendationSurface, '合作共赢')) {
        score -= 6;
      }
      if (complexity !== undefined) {
        if (complexity <= 1.4) {
          score += 3;
        } else if (complexity <= 2.3) {
          score += 12;
        } else if (complexity <= 2.7) {
          score += 3;
        } else {
          score -= 18;
        }
      }
    }

    if (isMidStrategyQuery) {
      if (surfaceIncludes(recommendationSurface, '中策略')) score += 12;
      score += Math.min(12, matchedStrategyMechanics * 4);
      if (matchedStrategyMechanics === 0) score -= 12;
      if (!queryText.includes('合作') && !queryText.includes('低冲突') && surfaceIncludes(recommendationSurface, '合作共赢')) {
        score -= 14;
      }
      if (countSurfaceMatches(recommendationSurface, ['团建破冰', '猜词联想', '阵营推理', '嘴炮谈判']) > 0) {
        score -= 10;
      }
      if (queryText.includes('低冲突') && surfaceIncludes(recommendationSurface, '合作共赢')) {
        score += 6;
      }
      if (complexity !== undefined) {
        if (complexity <= 1.4) {
          score -= 8;
        } else if (complexity <= 1.8) {
          score += 2;
        } else if (complexity <= 2.6) {
          score += 12;
        } else if (complexity <= 2.9) {
          score += 2;
        } else {
          score -= 16;
        }
      }
    }

    if (isGentleStrategyQuery) {
      score += Math.min(10, matchedStrategyMechanics * 3);
      if (countSurfaceMatches(recommendationSurface, ['双人核心', '情侣约会', '抽象对战', '合作共赢']) > 0) {
        score -= 12;
      }
      if (surfaceIncludes(recommendationSurface, '15分钟内')) {
        score -= 6;
      }
      if (complexity !== undefined) {
        if (complexity <= 1.2) {
          score -= 6;
        } else if (complexity <= 2.4) {
          score += 10;
        } else if (complexity >= 3.0) {
          score -= 12;
        }
      }
    }

    const isBettingQuery = queryHasAnyTerm(queryTerms, ['拍卖', '押注', '下注', '赌注']);
    if (isBettingQuery) {
      if (surfaceIncludes(recommendationSurface, '拍卖押注')) score += 18;
      if (surfaceIncludes(recommendationSurface, '朋友聚会')) score += 4;
      if (surfaceIncludes(recommendationSurface, '轻策略')) score += 3;
      if (surfaceIncludes(recommendationSurface, '双人核心')) score -= 6;
    }

    if (minPlayers !== undefined && maxPlayers !== undefined) {
      if (requestedPlayerRange) {
        const [requestedMin, requestedMax] = requestedPlayerRange;
        if (minPlayers <= requestedMin && maxPlayers >= requestedMax) {
          score += 22;
          const overflow = Math.max(0, requestedMin - minPlayers) + Math.max(0, maxPlayers - requestedMax);
          score -= Math.min(24, overflow * 6);
          if (minPlayers === requestedMin && maxPlayers === requestedMax) {
            score += 8;
          } else if (minPlayers === requestedMin || maxPlayers === requestedMax) {
            score += 4;
          }
        } else if (maxPlayers < requestedMin || minPlayers > requestedMax) {
          score -= 24;
        } else if (maxPlayers < requestedMax || minPlayers > requestedMin) {
          score -= 14;
        } else {
          score += 4;
        }
      } else if (requestedPlayerCount !== undefined) {
        if (minPlayers <= requestedPlayerCount && requestedPlayerCount <= maxPlayers) {
          score += 12;
        } else {
          score -= 20;
        }
      }
    }

    const requestedMaxPlaytime = parseRequestedMaxPlaytime(queryText);
    if (requestedMaxPlaytime !== undefined && playtimeMin !== undefined) {
      if (playtimeMin <= requestedMaxPlaytime) {
        score += 10;
      } else if (playtimeMin <= requestedMaxPlaytime + 15) {
        score -= 4;
      } else {
        score -= 14;
      }
    }

    if (complexity !== undefined && hasQueryIntent(queryText, /(推荐|来个|求推荐).*(桌游)|桌游.*(推荐|来个|求推荐)/)) {
      if (complexity <= 2.2) {
        score += 4;
      } else if (complexity >= 3.2) {
        score -= 8;
      }
    }

    negativeTerms.forEach((term) => {
      if (surfaceIncludes(recommendationSurface, term)) {
        score -= 12;
      }
    });
  } else {
    const faqLikeQuery = queryHasAnyTerm(queryTerms, ['能不能', '还能', '怎么办', '怎么判', '可以', '死了', '死亡后', '投票', '说话']);
    if (faqLikeQuery && sectionType === 'faq') {
      score += 12;
    }
    if (faqLikeQuery && sectionType === 'knowledge_base') {
      score += 6;
    }
    if (sectionType === 'rules') {
      score += 2;
    }
    if (sectionType === 'summary') {
      score -= 4;
    }
  }

  if (score > 0) {
    score += getProvenanceScoreAdjustment(section, mode);
  }

  return score;
}

function buildLocalHit(
  section: LocalKnowledgeSection,
  score: number,
  overrides: {
    text?: string;
    metadata?: Record<string, unknown>;
  } = {},
) {
  const title = section.title_cn || section.title_en || section.game_id || section.document_id;
  const mode = getSectionMode(section);

  return {
    chunk_id: `${section.document_id}:${section.section_id || 'section'}`,
    document_id: section.document_id,
    title,
    text: overrides.text ?? section.content ?? '',
    source: 'local_knowledge_fallback',
    distance: Number((1 / (1 + Math.max(score, 0.001))).toFixed(6)),
    score: Number(score.toFixed(6)),
    section_id: section.section_id || null,
    section_title: section.heading || null,
    metadata: {
      game_id: section.game_id || null,
      mode,
      section_title: section.heading || '',
      section_type: section.section_type || '',
      title_cn: section.title_cn || '',
      title_en: section.title_en || '',
      min_players: section.min_players,
      max_players: section.max_players,
      playtime_min: section.playtime_min,
      age_rating: section.age_rating,
      complexity: section.complexity,
      confidence_score: section.confidence_score,
      verification_status: getEffectiveVerificationStatus(section),
      verified_at: section.verified_at,
      source_retrieved_at: section.source_retrieved_at,
      stale_after_days: section.stale_after_days,
      stale_at: section.stale_at,
      canonicality: section.canonicality,
      primary_source_type: section.primary_source_type,
      source_ref_count: section.source_ref_count,
      source_types_text: section.source_types_text,
      source_policy_json: section.source_policy_json,
      source_refs_json: section.source_refs_json,
      source_refs: parseSourceRefs(section),
      search_text: section.search_text || '',
      wiki_provenance_version: section.wiki_provenance_version,
      confidence_method: section.confidence_method,
      confidence_basis_text: section.confidence_basis_text,
      review_queue_reason: section.review_queue_reason,
      ...overrides.metadata,
    },
  };
}

function mergeRecommendationGroupText(groupItems: ScoredLocalSection[]) {
  const preferredOrder = ['rec_fit', 'rec_summary', 'rec_tags', 'rec_search'];
  const ordered = [...groupItems].sort((left, right) => {
    const leftOrder = preferredOrder.indexOf(left.section.section_id || '');
    const rightOrder = preferredOrder.indexOf(right.section.section_id || '');
    const normalizedLeftOrder = leftOrder === -1 ? preferredOrder.length : leftOrder;
    const normalizedRightOrder = rightOrder === -1 ? preferredOrder.length : rightOrder;
    if (normalizedLeftOrder !== normalizedRightOrder) {
      return normalizedLeftOrder - normalizedRightOrder;
    }
    return right.score - left.score;
  });

  const blocks: string[] = [];
  const seen = new Set<string>();
  ordered.forEach((item) => {
    const text = (item.section.content || '').trim();
    const normalizedText = normalizeMatchText(text);
    if (!text || seen.has(normalizedText) || blocks.length >= 3) {
      return;
    }
    seen.add(normalizedText);
    blocks.push(item.section.heading ? `[${item.section.heading}]\n${text}` : text);
  });

  return blocks.join('\n\n') || groupItems[0]?.section.content || '';
}

function aggregateLocalHits(items: ScoredLocalSection[], mode: string | undefined, topK: number) {
  if (mode !== 'recommendation') {
    return items
      .sort((left, right) => {
        if (right.score !== left.score) {
          return right.score - left.score;
        }
        return (left.section.title_cn || left.section.document_id).localeCompare(right.section.title_cn || right.section.document_id);
      })
      .slice(0, topK)
      .map(({ section, score }) => buildLocalHit(section, score));
  }

  const groups = new Map<string, ScoredLocalSection[]>();
  items.forEach((item) => {
    const groupKey = item.section.game_id || item.section.document_id;
    const group = groups.get(groupKey) || [];
    group.push(item);
    groups.set(groupKey, group);
  });

  return Array.from(groups.entries())
    .map(([groupKey, groupItems]) => {
      const rankedGroup = [...groupItems].sort((left, right) => right.score - left.score);
      const leader = rankedGroup[0];
      const sectionCount = new Set(groupItems.map((item) => item.section.section_id || item.section.heading || item.section.document_id)).size;
      const coverageBonus = Math.min(8, Math.max(0, groupItems.length - 1) * 3) + Math.min(4, Math.max(0, sectionCount - 1) * 2);
      const mergedScore = leader.score + coverageBonus;

      return buildLocalHit(leader.section, mergedScore, {
        text: mergeRecommendationGroupText(groupItems),
        metadata: {
          aggregation_key: groupKey,
          aggregation_scope: 'game',
          aggregated_chunk_count: groupItems.length,
          aggregated_section_count: Math.max(1, sectionCount),
        },
      });
    })
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }
      return String(left.title || '').localeCompare(String(right.title || ''));
    })
    .slice(0, topK);
}

async function loadLocalKnowledgeSections() {
  if (!localSectionsPromise) {
    localSectionsPromise = readFile(LOCAL_RAG_SECTIONS_PATH, 'utf8').then((rawText) => rawText
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line) as LocalKnowledgeSection));
  }

  return localSectionsPromise;
}

async function localHealthResponse() {
  const sections = await loadLocalKnowledgeSections();
  return jsonResponse({
    status: 'ok',
    provider: 'local_sections_lexical',
    section_documents: sections.length,
    source_file: 'knowledge/boardgame_kb_sections.jsonl',
  }, {
    headers: {
      'x-rag-provider': 'local_sections_lexical',
      'x-rag-fallback': 'true',
    },
  });
}

async function runLocalRagFallback(body: RagQueryBody) {
  const query = typeof body.query === 'string' ? body.query.trim() : '';
  if (!query) {
    return jsonResponse({
      error: 'query is required',
      code: 'missing_query',
    }, {
      status: 400,
    });
  }

  const sections = await loadLocalKnowledgeSections();
  const topK = Math.max(1, Math.min(20, Number(body.top_k) || 5));
  const derivedMode = (typeof body.mode === 'string' && body.mode.trim())
    || extractFilterValue(body.where, 'mode')
    || undefined;
  const activeGameId = (typeof body.active_game_id === 'string' && body.active_game_id.trim())
    || extractFilterValue(body.where, 'game_id')
    || undefined;
  const effectiveWhere = deriveRecommendationWhereFromQuery(query, derivedMode, body.where);
  const {
    rewrittenQuery,
    rewriteExpansions,
    negativeTerms,
  } = rewriteRecommendationQuery(query, derivedMode);
  const queryTerms = extractQueryTerms(rewrittenQuery);

  const scoredItems = sections
    .filter((section) => matchesWhereClause(section, effectiveWhere))
    .map((section) => ({
      section,
      score: scoreLocalSection(section, queryTerms, derivedMode, activeGameId, rewrittenQuery, negativeTerms),
    }))
    .filter((item) => item.score > 0);

  const hits = aggregateLocalHits(scoredItems, derivedMode, topK);

  return jsonResponse({
    query,
    top_k: topK,
    hits,
    strategy: 'local_sections_lexical',
    diagnostics: {
      mode: derivedMode || null,
      active_game_id: activeGameId || null,
      rewritten_query: rewrittenQuery !== query ? rewrittenQuery : null,
      rewrite_expansions: rewriteExpansions,
      negative_terms: negativeTerms,
      derived_where: effectiveWhere ?? null,
      query_terms: queryTerms.slice(0, 24),
      fallback: true,
      aggregation_scope: derivedMode === 'recommendation' ? 'game' : null,
      source_file: 'knowledge/boardgame_kb_sections.jsonl',
    },
  }, {
    headers: {
      'x-rag-provider': 'local_sections_lexical',
      'x-rag-fallback': 'true',
    },
  });
}

async function proxyRagRequest(req: Request, baseUrl: string) {
  const url = new URL(req.url);

  if (req.method === 'GET' && url.searchParams.get('describe') === '1') {
    return documentationResponse(RAG_DOC);
  }

  const targetPath = req.method === 'GET' ? '/health' : '/query';
  const requestInit: RequestInit = {
    method: req.method,
    headers: {
      'Content-Type': 'application/json',
    },
  };

  if (req.method === 'POST') {
    const body = await req.json().catch(() => ({}));
    const query = typeof body.query === 'string' ? body.query.trim() : '';
    const derivedMode = (typeof body.mode === 'string' && body.mode.trim())
      || extractFilterValue(body.where, 'mode')
      || undefined;
    requestInit.body = JSON.stringify({
      ...body,
      where: deriveRecommendationWhereFromQuery(query, derivedMode, body.where),
    });
  }

  const response = await fetch(`${baseUrl}${targetPath}`, requestInit);
  const payload = await response.text();

  return new Response(payload, {
    status: response.status,
    headers: {
      'Content-Type': response.headers.get('content-type') || 'application/json',
      'Cache-Control': 'no-store',
      'Link': '</openapi.json>; rel="service-desc", </developers/>; rel="help", </llms.txt>; rel="describedby"',
      'x-rag-provider': 'python_rag',
      'x-rag-fallback': 'false',
    },
  });
}

async function handleFetchRequest(req: Request) {
  if (req.method === 'OPTIONS') {
    return optionsResponse(RAG_DOC);
  }

  if (req.method !== 'GET' && req.method !== 'POST') {
    return methodNotAllowed(req.method, RAG_DOC);
  }

  const url = new URL(req.url);
  if (req.method === 'GET' && url.searchParams.get('describe') === '1') {
    return documentationResponse(RAG_DOC);
  }

  const configuredBaseUrl = process.env.RAG_SERVICE_URL?.trim();
  if (!configuredBaseUrl) {
    if (req.method === 'GET') {
      return localHealthResponse();
    }

    const body = await req.json().catch(() => ({})) as RagQueryBody;
    return runLocalRagFallback(body);
  }

  const baseUrl = normalizeBaseUrl(configuredBaseUrl);
  const fallbackRequest = req.method === 'POST' ? req.clone() : undefined;
  try {
    return await proxyRagRequest(req, baseUrl);
  } catch (error) {
    if (shouldRequireRagService()) {
      return ragServiceUnavailableResponse(error);
    }

    if (req.method === 'GET') {
      return localHealthResponse();
    }

    const body = await (fallbackRequest ?? req).json().catch(() => ({})) as RagQueryBody;
    return runLocalRagFallback(body);
  }
}

export default async function handler(req: Request | NodeRequestLike, res?: NodeResponseLike) {
  if (isFetchRequest(req)) {
    return handleFetchRequest(req);
  }

  const response = await handleFetchRequest(await nodeRequestToFetchRequest(req));

  if (res) {
    await sendFetchResponse(res, response);
    return;
  }

  return response;
}
