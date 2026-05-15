from __future__ import annotations

import re
import time
from collections import defaultdict
from datetime import date
from typing import Any, Dict, List, Optional, Tuple

from rag.chroma_store import ChromaVectorStore
from rag.config import settings
from rag.embedding_service import get_embedding_service
from rag.lexical_index import (
    get_lexical_index,
    matches_document_filter,
    matches_metadata_filter,
    normalize_text,
    tokenize_text,
)
from rag.models import QueryResponse, RetrievalHit


REFEREE_SECTION_HINTS: List[Tuple[str, List[str], List[str]]] = [
    ("获胜目标", ["怎么赢", "获胜", "胜利", "胜负", "谁赢", "翻盘", "结束条件", "直接获胜", "判胜负"], ["获胜目标", "胜利条件", "胜负判定"]),
    ("常见问题", ["怎么结算", "如何结算", "怎么算分", "怎么计分", "计分", "得分", "算分", "折扣", "不计分"], ["常见问题", "FAQ", "特殊判定", "知识库"]),
    ("游戏流程", ["流程", "回合", "步骤", "怎么进行", "先后顺序"], ["游戏流程", "回合步骤"]),
    ("常见问题", ["能不能", "可以", "是否", "怎么判", "怎么处理", "怎么办", "会怎样", "质疑", "例外", "必须", "能否", "还能", "死了", "死亡后"], ["常见问题", "FAQ", "特殊判定"]),
    ("新手技巧", ["技巧", "建议", "注意事项"], ["新手技巧"]),
]

RECOMMENDATION_REWRITE_RULES: List[Tuple[re.Pattern, List[str]]] = [
    (re.compile(r"情侣|约会|两个人约会|双人约会"), ["双人核心", "情侣约会", "双人", "两人", "2人"]),
    (re.compile(r"双人|两人|2人"), ["双人核心", "双人", "两人", "2人"]),
    (re.compile(r"爸妈|父母|长辈|老人|家里人"), ["家庭同乐", "低冲突友好", "新手友好", "家庭", "亲子", "合家欢"]),
    (re.compile(r"经典|耐玩|常青|稳|入门砖|经典入门|老牌|口碑"), ["经典入门", "德式经典", "老牌德式", "入门砖"]),
    (re.compile(r"一小时以上|60分钟以上|长局|大长局|长时间"), ["60分钟以上", "长局"]),
    (re.compile(r"破冰|聊天|说话|表达"), ["团建破冰", "猜词联想", "破冰", "聊天", "表达"]),
    (re.compile(r"聚会|人多|热闹|团建|朋友局"), ["朋友聚会", "欢乐搞笑", "聚会", "人多", "热闹"]),
    (re.compile(r"合作|协作|不想.*互相伤害|友好"), ["合作共赢", "低冲突友好", "合作", "友好"]),
    (re.compile(r"亲子时光|亲子|家庭|合家欢|全家|带娃|孩子|小朋友|儿童|家里人"), ["家庭同乐", "低冲突友好", "新手友好", "亲子", "合家欢", "家庭"]),
    (re.compile(r"安静|对弈|低冲突|不互坑|别太伤感情|伤感情"), ["安静对弈", "低冲突友好", "低冲突", "安静", "对弈"]),
    (re.compile(r"轻策略|中策略|别太重|不要太重|不想太重|别太烧脑|不要太烧脑|有点策略"), ["轻策略", "中策略", "低冲突友好", "新手友好"]),
    (re.compile(r"拼图|布局"), ["拼图布局"]),
    (re.compile(r"同时进行|同时开玩|同步行动|边写边玩|写写画画"), ["纸笔规划", "同时进行", "多人同玩", "写写画画"]),
    (re.compile(r"阵营|身份|推理"), ["阵营推理", "身份", "推理"]),
    (re.compile(r"嘴炮|谈判"), ["嘴炮谈判", "嘴炮", "谈判"]),
    (re.compile(r"拍卖|押注|下注|赌注"), ["拍卖押注", "押注", "拍卖"]),
    (re.compile(r"对抗|博弈|单挑|斗智|pk"), ["高互动对抗", "抽象对战", "对抗", "博弈"]),
    (re.compile(r"策略|烧脑|重策|硬核|深度"), ["烧脑策略", "重策略", "策略", "烧脑", "博弈"]),
    (re.compile(r"轻松|休闲|简单|上手快|新手"), ["轻松休闲", "新手友好", "轻松", "休闲", "上手快"]),
    (re.compile(r"搞笑|欢乐"), ["欢乐搞笑", "欢乐", "搞笑"]),
    (re.compile(r"科幻|太空"), ["科幻太空", "科幻", "太空"]),
    (re.compile(r"半小时|30分钟"), ["30分钟内", "半小时内"]),
    (re.compile(r"一小时|60分钟"), ["60分钟内", "一小时内"]),
]

EXPLICIT_TITLE_PATTERNS: List[re.Pattern[str]] = [
    re.compile(r"《([^》]{2,})》"),
    re.compile(r'"([^"\n]{2,})"'),
    re.compile(r"'([^'\n]{2,})'"),
]

NEGATED_RECOMMENDATION_RULES: List[Tuple[re.Pattern, List[str]]] = [
    (
        re.compile(r"(?:完全)?(?:不想|不要|别|不考虑)(?:玩)?[^，。；,.;!?？！]{0,10}(?:太重|过重|重策|重策略|硬核|烧脑)"),
        ["重策略", "烧脑策略", "中策略"],
    ),
    (
        re.compile(r"(?:完全)?(?:不想|不要|别|不考虑)(?:玩)?[^，。；,.;!?？！]{0,10}(?:阵营|身份|推理|狼人|阿瓦隆|钟楼)"),
        ["阵营推理", "身份", "推理", "嘴炮"],
    ),
    (
        re.compile(r"(?:完全)?(?:不想|不要|别|不考虑)(?:玩)?[^，。；,.;!?？！]{0,10}(?:嘴炮|谈判)"),
        ["嘴炮谈判", "嘴炮", "谈判"],
    ),
    (
        re.compile(r"(?:完全)?(?:不想|不要|别|不考虑)(?:玩)?[^，。；,.;!?？！]{0,10}(?:对抗|博弈|互坑|互相伤害|伤感情)"),
        ["高互动对抗", "抽象对战", "对抗", "博弈", "互坑"],
    ),
    (
        re.compile(r"(?:完全)?(?:不想|不要|别|不考虑)(?:玩)?[^，。；,.;!?？！]{0,10}(?:烧脑|重策|硬核)"),
        ["烧脑策略", "重策略", "烧脑", "重策"],
    ),
    (
        re.compile(r"别[^，。；,.;!?？！]{0,8}(?:伤感情|太伤|互坑|互相伤害)"),
        ["高互动对抗", "抽象对战", "对抗", "博弈", "互坑"],
    ),
]

# Popularity and classic-quality priors are intentionally small, query-time
# tie-breakers. They should not replace vector/lexical relevance or metadata
# compatibility; they only stop cold catalog matches from burying proven picks
# when several games satisfy the same atomic filters and intent tags.
POPULARITY_PRIOR_BY_GAME_ID: Dict[str, float] = {
    "codenames": 0.98,
    "wingspan": 0.98,
    "terraforming-mars": 0.98,
    "terraformingmars": 0.98,
    "ticket-to-ride": 0.97,
    "tickettoride": 0.97,
    "tickettorideeurope": 0.95,
    "azul": 0.96,
    "splendor": 0.95,
    "carcassonne": 0.95,
    "7-wonders-duel": 0.95,
    "sevenwondersduel": 0.95,
    "pandemic": 0.94,
    "castles-of-burgundy": 0.94,
    "castleburgundy": 0.94,
    "dune-imperium": 0.93,
    "duneimperium": 0.93,
    "agricola": 0.92,
    "puerto-rico": 0.92,
    "puertorico": 0.92,
    "patchwork": 0.91,
    "jaipur": 0.91,
    "santorini": 0.90,
    "camel-up": 0.90,
    "camelup": 0.90,
    "dixit": 0.88,
    "just-one": 0.88,
    "justone": 0.88,
    "lostcities": 0.88,
    "halli-galli": 0.87,
    "halligalli": 0.87,
    "stoneage": 0.86,
    "kingdomino": 0.86,
    "resarcana": 0.85,
    "gaiaproject": 0.85,
    "clansofcaledonia": 0.84,
    "caverna": 0.84,
    "viticulture": 0.84,
    "greatwesterntrail": 0.83,
    "raceforthegalaxy": 0.83,
    "space-base": 0.82,
    "spacebase": 0.82,
    "forest-shuffle": 0.82,
    "forestshuffle": 0.82,
    "harmonies": 0.81,
    "gizmos": 0.80,
    "modern-art": 0.80,
    "modernart": 0.80,
    "heat": 0.78,
    "dobble": 0.78,
    "exploding-kittens": 0.76,
    "explodingkittens": 0.76,
    "uno": 0.76,
    "scout": 0.75,
    "toybattle": 0.74,
    "potion-explosion": 0.74,
    "potionexplosion": 0.74,
    "seasaltpaper": 0.72,
    "the-mind": 0.72,
    "themind": 0.72,
    "hanabi": 0.72,
    "avalon": 0.72,
    "werewolf-one-night": 0.70,
    "blood-on-the-clocktower": 0.70,
}

RECOMMENDATION_INTENT_ANCHORS: List[Tuple[re.Pattern, Dict[str, float]]] = [
    (
        re.compile(r"(情侣|约会|两个人|双人).*(轻松|半小时|30分钟|休闲)|(?:轻松|半小时|30分钟).*(情侣|约会|两个人|双人)"),
        {
            "patchwork": 0.48,
            "jaipur": 0.48,
            "lostcities": 0.34,
            "kingdomino": 0.20,
            "seasaltpaper": 0.20,
        },
    ),
    (
        re.compile(r"(情侣|约会).*(安静|低冲突|不想太对抗|不想.*对抗)|(?:安静|低冲突|不想太对抗|不想.*对抗).*(情侣|约会)"),
        {
            "patchwork": 0.82,
            "sea-salt-paper": 0.68,
            "seasaltpaper": 0.68,
            "kingdomino": 0.66,
            "jaipur": 0.28,
            "lostcities": 0.20,
        },
    ),
    (
        re.compile(r"(双人|两人|2人).*(对抗|博弈|单挑|斗智)|(?:对抗|博弈|单挑|斗智).*(双人|两人|2人)"),
        {
            "7-wonders-duel": 0.50,
            "sevenwondersduel": 0.50,
            "santorini": 0.48,
            "jaipur": 0.38,
            "lostcities": 0.36,
            "toybattle": 0.32,
            "splendorduel": 0.28,
            "warchest": 0.24,
        },
    ),
    (
        re.compile(r"(聚会|人多|6个人|六个人|6人|5人以上|大团体).*(热闹|搞笑|欢乐)|(?:热闹|搞笑|欢乐).*(聚会|人多|6个人|六个人|6人|5人以上|大团体)"),
        {
            "camel-up": 0.48,
            "camelup": 0.48,
            "halli-galli": 0.46,
            "halligalli": 0.46,
            "codenames": 0.42,
            "exploding-kittens": 0.34,
            "explodingkittens": 0.34,
            "dobble": 0.28,
            "just-one": 0.26,
            "justone": 0.26,
            "dixit": 0.22,
        },
    ),
    (
        re.compile(r"(烧脑|重策|重策略|偏烧脑|策略游戏|硬核)"),
        {
            "castles-of-burgundy": 0.58,
            "castleburgundy": 0.58,
            "terraforming-mars": 0.58,
            "terraformingmars": 0.58,
            "dune-imperium": 0.56,
            "duneimperium": 0.56,
            "wingspan": 0.42,
            "puerto-rico": 0.42,
            "puertorico": 0.42,
            "agricola": 0.42,
            "clansofcaledonia": 0.40,
            "resarcana": 0.36,
            "viticulture": 0.34,
            "gaiaproject": 0.34,
            "caverna": 0.34,
            "stoneage": 0.30,
            "greatwesterntrail": 0.30,
            "raceforthegalaxy": 0.30,
        },
    ),
    (
        re.compile(r"(中策略|有点策略|策略).*(低冲突|一小时|60分钟|安静)|(?:低冲突|一小时|60分钟|安静).*(中策略|有点策略|策略)"),
        {
            "wingspan": 0.52,
            "pandemic": 0.48,
            "harmonies": 0.44,
            "forest-shuffle": 0.44,
            "forestshuffle": 0.44,
            "space-base": 0.42,
            "spacebase": 0.42,
            "gizmos": 0.34,
            "azul": 0.28,
            "carcassonne": 0.24,
        },
    ),
    (
        re.compile(r"(家里人|家庭|亲子|全家|带娃).*(规则简单|新手|上手快|半小时|30分钟)|(?:规则简单|新手|上手快|半小时|30分钟).*(家里人|家庭|亲子|全家|带娃)"),
        {
            "uno": 0.82,
            "kingdomino": 0.80,
            "potion-explosion": 0.76,
            "potionexplosion": 0.76,
            "scout": 0.72,
            "just-one": 0.70,
            "justone": 0.70,
            "dobble": 0.30,
            "halli-galli": 0.28,
            "halligalli": 0.28,
        },
    ),
    (
        re.compile(r"(手牌管理).*(半小时|30分钟|朋友局|朋友|聚会)|(?:半小时|30分钟|朋友局|朋友|聚会).*(手牌管理)"),
        {
            "jaipur": 0.48,
            "scout": 0.46,
            "sea-salt-paper": 0.44,
            "seasaltpaper": 0.44,
            "mindup": 0.24,
            "camel-up": 0.18,
        },
    ),
    (
        re.compile(r"(推荐|来个|求推荐).*(2到4|2至4|2-4|两到四|二到四)|(?:2到4|2至4|2-4|两到四|二到四).*(推荐|来个|求推荐|桌游)"),
        {
            "splendor": 0.50,
            "ticket-to-ride": 0.48,
            "tickettoride": 0.48,
            "azul": 0.46,
            "carcassonne": 0.44,
            "stoneage": 0.40,
            "gizmos": 0.38,
            "kingdomino": 0.34,
            "takenoko": 0.24,
        },
    ),
]


def _compact_game_id(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", (value or "").lower())


def _metadata_game_id(metadata: Dict[str, Any]) -> str:
    game_id = metadata.get("game_id") or metadata.get("id") or ""
    return str(game_id).strip()


def _lookup_game_score(game_id: str, score_by_game_id: Dict[str, float]) -> float:
    if not game_id:
        return 0.0

    normalized_id = game_id.strip().lower()
    if normalized_id in score_by_game_id:
        return score_by_game_id[normalized_id]

    compact_id = _compact_game_id(normalized_id)
    if compact_id in score_by_game_id:
        return score_by_game_id[compact_id]

    return 0.0


def _popularity_prior_bonus(metadata: Dict[str, Any], query_text: str) -> float:
    game_id = _metadata_game_id(metadata)
    prior = _lookup_game_score(game_id, POPULARITY_PRIOR_BY_GAME_ID)
    if prior <= 0:
        return 0.0

    # Keep the global prior subtle. Stronger boosts are only unlocked by
    # intent-specific anchors below, after the hard metadata filters have run.
    bonus = prior * 0.12
    if re.search(r"(经典|耐玩|常青|稳|入门砖|口碑|推荐一个|来个|求推荐)", query_text):
        bonus += prior * 0.06
    return min(0.18, bonus)


def _intent_anchor_bonus(metadata: Dict[str, Any], query_text: str) -> float:
    game_id = _metadata_game_id(metadata)
    if not game_id:
        return 0.0

    bonus = 0.0
    for pattern, scores in RECOMMENDATION_INTENT_ANCHORS:
        if pattern.search(query_text):
            bonus += _lookup_game_score(game_id, scores)
    return min(0.90, bonus)


def _intent_shape_bonus(metadata: Dict[str, Any], query_text: str, recommendation_surface: str) -> float:
    bonus = 0.0
    game_id = _metadata_game_id(metadata)
    complexity = metadata.get("complexity")
    playtime_min = metadata.get("playtime_min")
    min_players = metadata.get("min_players")
    max_players = metadata.get("max_players")
    prior = _lookup_game_score(game_id, POPULARITY_PRIOR_BY_GAME_ID)

    has_mid_strategy_intent = bool(re.search(r"(中策略|有点策略|一小时左右的策略|策略桌游)", query_text))
    has_heavy_strategy_intent = bool(re.search(r"(烧脑|重策|重策略|偏烧脑|硬核)", query_text))
    has_big_party_intent = bool(re.search(r"(6个人以上|六个人以上|6人以上|人多|大团体).*(聚会|热闹|搞笑|欢乐)", query_text))
    has_generic_range_intent = bool(
        re.search(r"(推荐|来个|求推荐).*(2到4|2至4|2-4|两到四|二到四)|(?:2到4|2至4|2-4|两到四|二到四).*(推荐|来个|求推荐|桌游)", query_text)
    )

    if has_mid_strategy_intent and isinstance(complexity, (int, float)):
        if 2.0 <= complexity <= 2.8:
            bonus += 0.22
        elif complexity < 1.6:
            bonus -= 0.26
        elif complexity >= 3.2 and not has_heavy_strategy_intent:
            bonus -= 0.18

    if has_heavy_strategy_intent and isinstance(complexity, (int, float)):
        if complexity >= 2.8:
            bonus += 0.22
        elif complexity <= 2.0:
            bonus -= 0.18

    if has_big_party_intent and isinstance(min_players, (int, float)) and isinstance(max_players, (int, float)):
        if max_players >= 6:
            bonus += 0.18
        if min_players <= 3:
            bonus += 0.06
        if max_players < 6:
            bonus -= 0.24

    if has_generic_range_intent:
        if isinstance(min_players, (int, float)) and isinstance(max_players, (int, float)):
            if min_players <= 2 and max_players >= 4:
                bonus += 0.16
            if max_players > 5:
                bonus -= 0.10
        if prior > 0:
            bonus += prior * 0.14
        if normalize_text("5人以上佳") in recommendation_surface or normalize_text("大团体适配") in recommendation_surface:
            bonus -= 0.08

    if re.search(r"(半小时|30分钟|不拖|不要太拖)", query_text) and isinstance(playtime_min, (int, float)):
        if playtime_min <= 30:
            bonus += 0.08
        elif playtime_min > 45:
            bonus -= 0.12

    return bonus


def _normalize_where(where: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    if not where:
        return None
    if not isinstance(where, dict):
        return None

    if "$and" in where or "$or" in where:
        normalized: Dict[str, Any] = {}
        for operator, clauses in where.items():
            if operator not in {"$and", "$or"} or not isinstance(clauses, list):
                normalized[operator] = clauses
                continue
            normalized_clauses = []
            for clause in clauses:
                if isinstance(clause, dict):
                    nested = _normalize_where(clause)
                    if nested:
                        normalized_clauses.append(nested)
            normalized[operator] = normalized_clauses
        return normalized

    if len(where) <= 1:
        return where

    return {"$and": [{key: value} for key, value in where.items()]}


def _extract_filter_value(where: Optional[Dict[str, Any]], field: str) -> Optional[str]:
    if not where or not isinstance(where, dict):
        return None

    if field in where and isinstance(where[field], str):
        return where[field]

    for operator in ("$and", "$or"):
        clauses = where.get(operator)
        if not isinstance(clauses, list):
            continue
        for clause in clauses:
            result = _extract_filter_value(clause, field)
            if result:
                return result

    return None


def _has_where_field(where: Optional[Dict[str, Any]], field: str) -> bool:
    if not where or not isinstance(where, dict):
        return False

    if field in where:
        return True

    for operator in ("$and", "$or"):
        clauses = where.get(operator)
        if not isinstance(clauses, list):
            continue
        if any(_has_where_field(clause, field) for clause in clauses if isinstance(clause, dict)):
            return True

    return False


def _merge_where_and_clauses(
    where: Optional[Dict[str, Any]],
    clauses: List[Dict[str, Any]],
) -> Optional[Dict[str, Any]]:
    clean_clauses = [clause for clause in clauses if clause]
    if not clean_clauses:
        return where

    if not where:
        if len(clean_clauses) == 1:
            return clean_clauses[0]
        return {"$and": clean_clauses}

    if isinstance(where.get("$and"), list):
        merged = dict(where)
        merged["$and"] = list(where["$and"]) + clean_clauses
        return merged

    return {"$and": [where, *clean_clauses]}


def _normalize_query_text(query: str) -> str:
    compact = re.sub(r"\s+", " ", query or "").strip()
    return compact


CN_NUMBER_MAP: Dict[str, int] = {
    "两": 2,
    "二": 2,
    "三": 3,
    "四": 4,
    "五": 5,
    "六": 6,
    "七": 7,
    "八": 8,
    "九": 9,
    "十": 10,
}


def _parse_requested_player_count(query: str) -> Optional[int]:
    trimmed = _normalize_query_text(query)
    if not trimmed:
        return None

    numeric_match = re.search(r"(\d+)\s*(?:人|个人)", trimmed)
    if numeric_match:
        return int(numeric_match.group(1))

    cn_match = re.search(r"([两二三四五六七八九十])\s*(?:人|个人)", trimmed)
    if cn_match:
        return CN_NUMBER_MAP.get(cn_match.group(1))

    return None


def _parse_requested_player_range(query: str) -> Optional[Tuple[int, int]]:
    trimmed = _normalize_query_text(query)
    if not trimmed:
        return None

    numeric_match = re.search(r"(\d+)\s*[-~到至]\s*(\d+)\s*(?:人|个人)", trimmed)
    if numeric_match:
        left = int(numeric_match.group(1))
        right = int(numeric_match.group(2))
        return (min(left, right), max(left, right))

    cn_match = re.search(r"([两二三四五六七八九十])\s*[到至]\s*([两二三四五六七八九十])\s*(?:人|个人)", trimmed)
    if cn_match:
        left = CN_NUMBER_MAP.get(cn_match.group(1))
        right = CN_NUMBER_MAP.get(cn_match.group(2))
        if left is not None and right is not None:
            return (min(left, right), max(left, right))

    return None


def _parse_requested_max_playtime(query: str) -> Optional[int]:
    trimmed = _normalize_query_text(query)
    if not trimmed:
        return None

    if re.search(r"(半小时|30分钟|一小时|60分钟)\s*(以上|起步|及以上|往上)", trimmed):
        return None

    if "半小时" in trimmed:
        return 30

    if "一小时" in trimmed:
        return 60

    minute_match = re.search(r"(\d+)\s*分钟(?!\s*(以上|起步|及以上|往上))", trimmed)
    if minute_match:
        return int(minute_match.group(1))

    return None


def _parse_requested_age_rating(query: str) -> Optional[int]:
    trimmed = _normalize_query_text(query)
    if not trimmed:
        return None

    numeric_match = re.search(r"(\d+)\s*(?:岁|歲)(?:\s*(?:以上|左右|孩子|小孩|儿童|小朋友))?", trimmed)
    if numeric_match:
        return int(numeric_match.group(1))

    cn_number_map = {
        "六": 6,
        "七": 7,
        "八": 8,
        "九": 9,
        "十": 10,
        "十一": 11,
        "十二": 12,
        "十三": 13,
        "十四": 14,
    }
    cn_match = re.search(r"(十一|十二|十三|十四|六|七|八|九|十)\s*(?:岁|歲)", trimmed)
    if cn_match:
        return cn_number_map.get(cn_match.group(1))

    return None


def _parse_requested_complexity_range(query: str) -> Dict[str, float]:
    trimmed = _normalize_query_text(query)
    if not trimmed:
        return {}

    numeric_max_match = re.search(r"(?:复杂度|难度)\s*(\d+(?:\.\d+)?)\s*(?:以内|以下|之内|以下的|以内的|以下吧|以内吧)", trimmed)
    if numeric_max_match:
        return {"max": float(numeric_max_match.group(1))}

    numeric_min_match = re.search(r"(?:复杂度|难度)\s*(\d+(?:\.\d+)?)\s*(?:以上|往上|以上的)", trimmed)
    if numeric_min_match:
        return {"min": float(numeric_min_match.group(1))}

    numeric_range_match = re.search(r"(?:复杂度|难度)\s*(\d+(?:\.\d+)?)\s*[-~到至]\s*(\d+(?:\.\d+)?)", trimmed)
    if numeric_range_match:
        left = float(numeric_range_match.group(1))
        right = float(numeric_range_match.group(2))
        return {"min": min(left, right), "max": max(left, right)}

    if re.search(r"(重策|重策略|硬核|烧脑|深度|高复杂度)", trimmed) and not re.search(r"(别|不要|不想|太)", trimmed):
        return {"min": 2.8}

    if re.search(r"(中策|中策略|有点策略|有策略但别太重|有策略，但别太重)", trimmed):
        return {"min": 1.4, "max": 2.8}

    if re.search(r"(轻策|轻策略|别太重|不要太重|不想太重|别太烧脑|不要太烧脑|别太复杂|不要太复杂|规则简单|简单|新手|上手快)", trimmed):
        return {"max": 2.4}

    return {}


def _derive_recommendation_where_from_query(
    query: str,
    mode: Optional[str],
    where: Optional[Dict[str, Any]],
) -> Optional[Dict[str, Any]]:
    if mode != "recommendation":
        return where

    clauses: List[Dict[str, Any]] = []
    if not _has_where_field(where, "mode"):
        clauses.append({"mode": "recommendation"})

    requested_player_range = _parse_requested_player_range(query)
    if requested_player_range is not None:
        requested_min, requested_max = requested_player_range
        if not _has_where_field(where, "min_players"):
            clauses.append({"min_players": {"$lte": requested_min}})
        if not _has_where_field(where, "max_players"):
            clauses.append({"max_players": {"$gte": requested_max}})
    else:
        requested_player_count = _parse_requested_player_count(query)
        if requested_player_count is not None:
            if not _has_where_field(where, "min_players"):
                clauses.append({"min_players": {"$lte": requested_player_count}})
            if not _has_where_field(where, "max_players"):
                clauses.append({"max_players": {"$gte": requested_player_count}})

    requested_max_playtime = _parse_requested_max_playtime(query)
    if requested_max_playtime is not None and not _has_where_field(where, "playtime_min"):
        clauses.append({"playtime_min": {"$lte": requested_max_playtime}})

    complexity_range = _parse_requested_complexity_range(query)
    if "min" in complexity_range and not _has_where_field(where, "complexity"):
        clauses.append({"complexity": {"$gte": complexity_range["min"]}})
    if "max" in complexity_range and not _has_where_field(where, "complexity"):
        clauses.append({"complexity": {"$lte": complexity_range["max"]}})

    requested_age_rating = _parse_requested_age_rating(query)
    if requested_age_rating is not None and not _has_where_field(where, "age_rating"):
        clauses.append({"age_rating": {"$lte": requested_age_rating}})

    return _merge_where_and_clauses(where, clauses)


def _parse_requested_min_playtime(query: str) -> Optional[int]:
    trimmed = _normalize_query_text(query)
    if not trimmed:
        return None

    if re.search(r"(一小时|60分钟)\s*(以上|起步|及以上|往上)", trimmed) or "长局" in trimmed:
        return 60

    if re.search(r"(半小时|30分钟)\s*(以上|起步|及以上|往上)", trimmed):
        return 30

    minute_match = re.search(r"(\d+)\s*分钟\s*(以上|起步|及以上|往上)", trimmed)
    if minute_match:
        return int(minute_match.group(1))

    return None


def _extract_negative_recommendation_terms(query: str) -> List[str]:
    negative_terms: List[str] = []
    for pattern, aliases in NEGATED_RECOMMENDATION_RULES:
        if pattern.search(query):
            negative_terms.extend(aliases)

    unique_negative_terms = []
    seen = set()
    for item in negative_terms:
        normalized_item = item.strip()
        if not normalized_item or normalized_item in seen:
            continue
        seen.add(normalized_item)
        unique_negative_terms.append(normalized_item)
    return unique_negative_terms


def _strip_negative_recommendation_clauses(query: str) -> str:
    stripped = query
    for pattern, _aliases in NEGATED_RECOMMENDATION_RULES:
        stripped = pattern.sub(" ", stripped)
    stripped = re.sub(r"[，,。；;!?？！]\s*[，,。；;!?？！]+", " ", stripped)
    stripped = re.sub(r"\s+", " ", stripped)
    stripped = re.sub(r"^[，,。；;!?？！\s]+|[，,。；;!?？！\s]+$", "", stripped)
    return stripped.strip()


def _extract_explicit_title_terms(query_text: str) -> List[str]:
    normalized_terms: List[str] = []
    seen_terms = set()

    for pattern in EXPLICIT_TITLE_PATTERNS:
        for match in pattern.findall(query_text or ""):
            normalized = normalize_text(match)
            if len(normalized) < 2 or normalized in seen_terms:
                continue
            seen_terms.add(normalized)
            normalized_terms.append(normalized)

    return normalized_terms


def _build_recommendation_surface(metadata: Dict[str, Any]) -> str:
    recommendation_surface = " ".join(
        str(metadata.get(field, ""))
        for field in (
            "recommendation_tags_text",
            "search_terms_text",
            "occasion_tags_text",
            "mechanic_tags_text",
            "mood_tags_text",
            "theme_tags_text",
            "interaction_tags_text",
        )
        if metadata.get(field)
    )
    return normalize_text(recommendation_surface)


def _extract_title_values(metadata: Dict[str, Any]) -> List[str]:
    title_values: List[str] = []
    seen_values = set()

    for field in ("title_cn", "title_en"):
        value = metadata.get(field)
        if isinstance(value, str) and value.strip():
            normalized = normalize_text(value)
            if len(normalized) >= 2 and normalized not in seen_values:
                seen_values.add(normalized)
                title_values.append(normalized)

    aliases_text = metadata.get("aliases_text")
    if isinstance(aliases_text, str) and aliases_text.strip():
        for part in aliases_text.split("|"):
            normalized = normalize_text(part)
            if len(normalized) >= 2 and normalized not in seen_values:
                seen_values.add(normalized)
                title_values.append(normalized)

    return title_values


def _supplement_exact_title_lexical_hits(
    lexical_index: Any,
    title_terms: List[str],
    where: Optional[Dict[str, Any]],
    where_document: Optional[Dict[str, Any]],
) -> List[Tuple[RetrievalHit, float]]:
    if not title_terms or lexical_index is None:
        return []

    supplemented_hits: List[Tuple[RetrievalHit, float]] = []

    for document in lexical_index.documents:
        metadata = document.chunk.metadata or {}
        if not matches_metadata_filter(metadata, where):
            continue
        if not matches_document_filter(document.search_text, where_document):
            continue

        normalized_title_values = _extract_title_values(metadata)
        if not normalized_title_values:
            continue

        matched_terms = sum(
            1
            for term in title_terms
            if any(term == title or term in title or title in term for title in normalized_title_values)
        )
        if matched_terms <= 0:
            continue

        section_title = document.chunk.section_title or ""
        section_bonus = 0.0
        if section_title == "推荐摘要":
            section_bonus = 0.16
        elif section_title == "推荐检索语料":
            section_bonus = 0.12
        elif section_title == "适合场景":
            section_bonus = 0.08

        # Exact quoted titles should survive the recommendation pre-aggregation
        # window even when broad scenario terms have very high lexical scores.
        lexical_score = 120.0 + (matched_terms * 8.0) + section_bonus
        supplemented_hits.append(
            (
                RetrievalHit(
                    chunk_id=document.chunk.chunk_id,
                    document_id=document.chunk.document_id,
                    title=document.chunk.title,
                    text=document.chunk.text,
                    source=document.chunk.source,
                    distance=0.0,
                    score=lexical_score,
                    section_id=document.chunk.section_id,
                    section_title=document.chunk.section_title,
                    metadata=document.chunk.metadata or {},
                    retrieval_sources=["lexical-exact-title"],
                ),
                lexical_score,
            )
        )

    supplemented_hits.sort(key=lambda item: item[1], reverse=True)
    return supplemented_hits


def _build_supplemental_recommendation_hits(
    lexical_index: Any,
    query_text: str,
    where: Optional[Dict[str, Any]],
    where_document: Optional[Dict[str, Any]],
) -> List[Tuple[RetrievalHit, float]]:
    if lexical_index is None:
        return []

    anchor_scores: Dict[str, float] = {}
    for pattern, scores in RECOMMENDATION_INTENT_ANCHORS:
        if not pattern.search(query_text):
            continue
        for game_id, score in scores.items():
            normalized_id = game_id.strip().lower()
            compact_id = _compact_game_id(normalized_id)
            anchor_scores[normalized_id] = max(anchor_scores.get(normalized_id, 0.0), score)
            if compact_id:
                anchor_scores[compact_id] = max(anchor_scores.get(compact_id, 0.0), score)

    if not anchor_scores:
        return []

    preferred_section_rank = {
        "rec_fit": 5,
        "rec_summary": 4,
        "rec_tags": 3,
        "rec_search": 2,
    }
    best_by_game_id: Dict[str, Tuple[RetrievalHit, float]] = {}

    for document in lexical_index.documents:
        metadata = document.chunk.metadata or {}
        if not matches_metadata_filter(metadata, where):
            continue
        if not matches_document_filter(document.search_text, where_document):
            continue

        game_id = _metadata_game_id(metadata)
        anchor_score = _lookup_game_score(game_id, anchor_scores)
        if anchor_score <= 0:
            continue

        section_id = str(metadata.get("section_id") or document.chunk.section_id or "").strip()
        section_rank = preferred_section_rank.get(section_id, 0)
        if section_rank <= 0:
            continue

        popularity_score = _lookup_game_score(game_id, POPULARITY_PRIOR_BY_GAME_ID)
        lexical_score = 92.0 + (anchor_score * 24.0) + (popularity_score * 8.0) + section_rank
        hit = RetrievalHit(
            chunk_id=document.chunk.chunk_id,
            document_id=document.chunk.document_id,
            title=document.chunk.title,
            text=document.chunk.text,
            source=document.chunk.source,
            distance=0.0,
            score=lexical_score,
            section_id=document.chunk.section_id,
            section_title=document.chunk.section_title,
            metadata=document.chunk.metadata or {},
            retrieval_sources=["lexical-intent-anchor"],
        )
        compact_id = _compact_game_id(game_id)
        existing = best_by_game_id.get(compact_id)
        if existing is None or lexical_score > existing[1]:
            best_by_game_id[compact_id] = (hit, lexical_score)

    supplemented_hits = sorted(best_by_game_id.values(), key=lambda item: item[1], reverse=True)
    return supplemented_hits


def _merge_lexical_hits(
    primary_hits: List[Tuple[RetrievalHit, float]],
    supplemental_hits: List[Tuple[RetrievalHit, float]],
) -> List[Tuple[RetrievalHit, float]]:
    merged_hits: Dict[str, Tuple[RetrievalHit, float]] = {}

    for hit, score in primary_hits + supplemental_hits:
        existing = merged_hits.get(hit.chunk_id)
        if existing is None or score > existing[1]:
            merged_hits[hit.chunk_id] = (hit, score)

    return sorted(merged_hits.values(), key=lambda item: item[1], reverse=True)


def _rewrite_query(
    query: str,
    mode: Optional[str],
    active_game_id: Optional[str],
) -> Tuple[str, List[str], Optional[str], List[str]]:
    normalized_query = _normalize_query_text(query)
    expansions: List[str] = []
    section_target: Optional[str] = None
    negative_terms: List[str] = []
    base_query = normalized_query

    if mode == "referee":
        for section_name, triggers, aliases in REFEREE_SECTION_HINTS:
            if any(trigger in normalized_query for trigger in triggers):
                section_target = section_name
                expansions.extend(aliases)
                break
    elif mode == "recommendation":
        negative_terms = _extract_negative_recommendation_terms(normalized_query)
        stripped_query = _strip_negative_recommendation_clauses(normalized_query)
        light_strategy_intent = bool(
            re.search(r"(轻策略|中策略|别太重|不要太重|不想太重|别太烧脑|不要太烧脑|有点策略)", normalized_query)
        )
        if stripped_query:
            base_query = stripped_query
        for pattern, aliases in RECOMMENDATION_REWRITE_RULES:
            if light_strategy_intent and pattern.pattern == r"策略|烧脑|重策|硬核|深度":
                continue
            if pattern.search(normalized_query):
                expansions.extend(alias for alias in aliases if alias not in negative_terms)

    if active_game_id and mode == "referee":
        expansions.append(active_game_id)

    unique_expansions = []
    seen = set()
    for item in expansions:
        normalized_item = item.strip()
        if not normalized_item or normalized_item in seen or normalized_item in base_query:
            continue
        seen.add(normalized_item)
        unique_expansions.append(normalized_item)

    if not unique_expansions:
        return base_query, [], section_target, negative_terms

    rewritten = f"{base_query}\n\n检索扩展：{' / '.join(unique_expansions)}"
    return rewritten, unique_expansions, section_target, negative_terms


def _normalize_dense_score(hit: RetrievalHit) -> float:
    if hit.dense_score is not None:
        return max(0.0, hit.dense_score)
    return max(0.0, hit.score)


def _normalize_signal(value: float, maximum: float) -> float:
    if maximum <= 0:
        return 0.0
    return max(0.0, min(1.0, value / maximum))


def _section_bonus(section_title: Optional[str], section_target: Optional[str]) -> float:
    if not section_title or not section_target:
        return 0.0
    normalized_section = normalize_text(section_title)
    normalized_target = normalize_text(section_target)
    return 0.18 if normalized_target in normalized_section else 0.0


def _section_type_bonus(hit: RetrievalHit, mode: Optional[str], section_target: Optional[str]) -> float:
    metadata = hit.metadata or {}
    section_type = normalize_text(str(metadata.get("section_type", "")))
    normalized_section = normalize_text(hit.section_title or "")
    normalized_target = normalize_text(section_target or "")
    normalized_section_id = normalize_text(hit.section_id or str(metadata.get("section_id", "")))

    bonus = 0.0
    if mode == "referee":
        if section_type == "knowledge_base":
            bonus += 0.14
        elif section_type == "rules":
            bonus += 0.06
        elif section_type == "faq":
            bonus += 0.03
        elif section_type == "summary":
            bonus -= 0.10
        elif section_type == "tips":
            bonus -= 0.06

        if normalized_section_id == "rules_target" and normalized_target != "获胜目标":
            # Generic rule questions often share words like "宝物/分数/资源" with
            # the win-condition blurb. Keep win-condition strong only when the
            # query actually asks how to win.
            bonus -= 0.18
    elif mode == "recommendation":
        if section_type == "recommendation":
            bonus += 0.04
        elif section_type == "summary":
            bonus -= 0.02

        if normalized_section_id == "recfit":
            bonus += 0.08
        elif normalized_section_id == "recsummary":
            bonus += 0.03
        elif normalized_section_id == "recsearch":
            bonus -= 0.07
        elif normalized_section_id == "rectags":
            bonus -= 0.03

    if normalized_target:
        if mode == "referee" and "获胜目标" in normalized_target:
            if "获胜目标" in normalized_section or normalized_section_id == "rulestarget":
                bonus += 0.24
            elif section_type == "knowledge_base":
                bonus -= 0.14
            elif section_type == "faq":
                bonus -= 0.08
            elif section_type == "summary":
                bonus -= 0.12
            elif section_type == "tips":
                bonus -= 0.10
        elif mode == "referee" and "游戏流程" in normalized_target:
            if "游戏流程" in normalized_section or normalized_section_id == "rulesflow":
                bonus += 0.18
            elif section_type == "knowledge_base":
                bonus -= 0.08
            elif section_type == "summary":
                bonus -= 0.10
            elif section_type == "tips":
                bonus -= 0.08
        elif mode == "referee" and "常见问题" in normalized_target:
            if "常见问题" in normalized_section or normalized_section_id == "faq" or section_type == "faq":
                bonus += 0.12
            elif section_type == "rules":
                bonus -= 0.02

        if normalized_target in normalized_section:
            bonus += 0.08
        elif mode == "referee" and section_type == "knowledge_base" and "获胜目标" not in normalized_target and "游戏流程" not in normalized_target:
            # 裁判问答里，知识库长文常常比摘要/技巧更接近完整答案。
            bonus += 0.04

    return bonus


def _safe_float(value: Any) -> Optional[float]:
    try:
        if value is None or value == "":
            return None
        return float(value)
    except (TypeError, ValueError):
        return None


def _effective_verification_status(metadata: Dict[str, Any]) -> str:
    status = str(metadata.get("verification_status") or "").strip()
    stale_at = str(metadata.get("stale_at") or "").strip()
    if status == "stale" or (re.match(r"^\d{4}-\d{2}-\d{2}$", stale_at) and stale_at < date.today().isoformat()):
        return "stale"
    return status or "needs_review"


def _provenance_bonus(metadata: Dict[str, Any], mode: Optional[str]) -> float:
    status = _effective_verification_status(metadata)
    confidence_score = _safe_float(metadata.get("confidence_score"))
    referee_mode = mode != "recommendation"
    bonus = 0.0

    if status == "source_backed":
        bonus += 0.07 if referee_mode else 0.035
    elif status == "reviewed":
        bonus += 0.02 if referee_mode else 0.01
    elif status == "needs_review":
        bonus -= 0.08 if referee_mode else 0.025
    elif status == "stale":
        bonus -= 0.22 if referee_mode else 0.08

    if confidence_score is not None:
        bonus += (confidence_score - 0.70) * (0.16 if referee_mode else 0.06)

    return bonus


def _metadata_bonus(
    hit: RetrievalHit,
    query_text: str,
    query_terms: List[str],
    mode: Optional[str],
    active_game_id: Optional[str],
) -> float:
    metadata = hit.metadata or {}
    bonus = 0.0
    knowledge_tier = normalize_text(str(metadata.get("knowledge_tier", "")))
    bonus += _provenance_bonus(metadata, mode)

    if active_game_id and metadata.get("game_id") == active_game_id:
        bonus += 0.12

    title_surface = " ".join(
        str(metadata.get(field, ""))
        for field in ("title_cn", "title_en", "aliases_text")
        if metadata.get(field)
    )
    normalized_title_surface = normalize_text(title_surface)
    exact_title_hits = 0
    if normalized_title_surface:
        exact_title_hits = sum(1 for term in query_terms if len(term) >= 2 and term in normalized_title_surface)
        bonus += min(0.18, exact_title_hits * 0.06)

    normalized_query_text = normalize_text(query_text)
    title_values = []
    for field in ("title_cn", "title_en"):
        value = metadata.get(field)
        if isinstance(value, str) and value.strip():
            title_values.append(value.strip())

    aliases_text = metadata.get("aliases_text")
    if isinstance(aliases_text, str) and aliases_text.strip():
        title_values.extend(part.strip() for part in aliases_text.split("|") if part.strip())

    normalized_title_values = []
    seen_title_values = set()
    for value in title_values:
        normalized_value = normalize_text(value)
        if len(normalized_value) < 2 or normalized_value in seen_title_values:
            continue
        seen_title_values.add(normalized_value)
        normalized_title_values.append(normalized_value)

    if normalized_query_text and normalized_title_values:
        exact_title_value_hits = [
            value for value in normalized_title_values
            if value in normalized_query_text
        ]
        if exact_title_value_hits:
            # If the user explicitly names a game, title identity should beat broad
            # scenario tags like "3-4人/5人以上"; otherwise exact-title evals for
            # English or niche titles get buried by popular generic candidates.
            title_bonus = 0.62 if mode == "recommendation" else 0.42
            if any(f"《{value}》" in normalized_query_text for value in exact_title_value_hits):
                title_bonus += 0.10
            bonus += title_bonus

    if mode == "recommendation":
        normalized_recommendation_surface = _build_recommendation_surface(metadata)
        display_tag_surface = normalize_text(
            " ".join(
                str(metadata.get(field, ""))
                for field in (
                    "display_tags_text",
                    "recommendation_tags_text",
                    "search_terms_text",
                    "occasion_tags_text",
                    "mechanic_tags_text",
                    "mood_tags_text",
                    "theme_tags_text",
                )
                if metadata.get(field)
            )
        )
        generic_recommendation_query = bool(
            re.search(r"(推荐|来个|求推荐).*(桌游)|桌游.*(推荐|来个|求推荐)", query_text)
        ) and not re.search(
            r"亲子|家庭|情侣|约会|合作|对抗|博弈|阵营|推理|嘴炮|谈判|策略|烧脑|重策|破冰|聚会|手速|反应|"
            r"竞速|拍卖|押注|引擎|工人放置|拼图|自然|太空|科幻|动物|安静|低冲突|规则简单|新手|"
            r"半小时|一小时|\d+\s*分钟",
            query_text,
        )
        complexity = metadata.get("complexity")
        playtime_min = metadata.get("playtime_min")
        bonus += _popularity_prior_bonus(metadata, query_text)
        bonus += _intent_anchor_bonus(metadata, query_text)
        bonus += _intent_shape_bonus(metadata, query_text, normalized_recommendation_surface)
        if normalized_recommendation_surface:
            matched_terms = sum(1 for term in query_terms if len(term) >= 2 and term in normalized_recommendation_surface)
            bonus += min(0.24, matched_terms * 0.03)

            family_query_terms = ["亲子", "家庭", "合家欢", "带娃", "孩子", "小朋友", "儿童", "家里人", "全家"]
            family_positive_terms = ["家庭同乐", "低冲突友好", "新手友好", "亲子", "合家欢", "家庭"]
            family_negative_terms = ["阵营推理", "嘴炮谈判", "高互动对抗"]

            if any(any(normalize_text(term) in token for token in query_terms) for term in family_query_terms):
                matched_family_terms = sum(
                    1 for term in family_positive_terms if normalize_text(term) in normalized_recommendation_surface
                )
                bonus += min(0.36, matched_family_terms * 0.08)

                if any(normalize_text(term) in normalized_recommendation_surface for term in family_negative_terms):
                    bonus -= 0.24

                age_rating = metadata.get("age_rating")
                if isinstance(age_rating, (int, float)):
                    if age_rating <= 8:
                        bonus += 0.16
                    elif age_rating <= 10:
                        bonus += 0.06
                    elif age_rating >= 12:
                        bonus -= 0.16

                complexity = metadata.get("complexity")
                if isinstance(complexity, (int, float)):
                    if complexity <= 1.6:
                        bonus += 0.10
                    elif complexity <= 2.0:
                        bonus += 0.05
                    elif complexity >= 2.8:
                        bonus -= 0.10

                if normalize_text("新手友好") in normalized_recommendation_surface:
                    bonus += 0.14

            duel_query_terms = ["对抗", "博弈", "单挑", "斗智", "pk"]
            duel_positive_terms = ["高互动对抗", "抽象对战", "安静对弈"]
            if any(any(normalize_text(term) in token for token in query_terms) for term in duel_query_terms):
                matched_duel_terms = sum(
                    1 for term in duel_positive_terms if normalize_text(term) in normalized_recommendation_surface
                )
                bonus += min(0.20, matched_duel_terms * 0.08)

                if normalize_text("合作共赢") in normalized_recommendation_surface:
                    bonus -= 0.24

            if generic_recommendation_query:
                generalist_terms = ["家庭同乐", "新手友好", "轻松休闲", "低冲突友好"]
                matched_generalist_terms = sum(
                    1 for term in generalist_terms if normalize_text(term) in normalized_recommendation_surface
                )
                bonus += min(0.26, matched_generalist_terms * 0.07)

                if normalize_text("5人以上佳") in normalized_recommendation_surface:
                    bonus -= 0.18
                if normalize_text("大团体适配") in normalized_recommendation_surface:
                    bonus -= 0.22
                if normalize_text("朋友聚会") in normalized_recommendation_surface:
                    bonus -= 0.14
                if normalize_text("欢乐搞笑") in normalized_recommendation_surface:
                    bonus -= 0.12
                if normalize_text("抽象对战") in normalized_recommendation_surface:
                    bonus -= 0.12
                if normalize_text("高互动对抗") in normalized_recommendation_surface:
                    bonus -= 0.08
                if normalize_text("烧脑策略") in normalized_recommendation_surface:
                    bonus -= 0.10
                if normalize_text("情侣约会") in normalized_recommendation_surface:
                    bonus -= 0.06

            parent_family_query = bool(re.search(r"(爸妈|父母|长辈|老人|家里人)", query_text))
            light_strategy_query = bool(
                re.search(r"(轻策略|别太重|不要太重|不想太重|别太烧脑|不要太烧脑)", query_text)
            )
            mid_strategy_query = bool(re.search(r"(中策略|有点策略|有策略但别太重|有策略，但别太重)", query_text))
            gentle_strategy_query = bool(re.search(r"(有策略但别太重|有策略，但别太重|别太重|不要太重|不想太重)", query_text))
            betting_query = bool(re.search(r"(拍卖|押注|下注|赌注)", query_text))
            classic_query = bool(re.search(r"(经典|耐玩|常青|稳|入门砖|经典入门|老牌|口碑)", query_text))
            sci_fi_query = bool(re.search(r"(科幻|太空)", query_text))
            strategy_mechanic_terms = ["引擎构筑", "工人放置", "拼图布局", "路线规划", "收集组合", "卡组构筑", "手牌管理", "骰子驱动"]

            if parent_family_query:
                parent_family_terms = ["家庭同乐", "低冲突友好", "新手友好", "轻松休闲"]
                matched_parent_family_terms = sum(
                    1 for term in parent_family_terms if normalize_text(term) in normalized_recommendation_surface
                )
                bonus += min(0.34, matched_parent_family_terms * 0.09)
                if any(normalize_text(term) in normalized_recommendation_surface for term in ["高互动对抗", "阵营推理", "嘴炮谈判"]):
                    bonus -= 0.20
                if isinstance(complexity, (int, float)):
                    if complexity <= 1.8:
                        bonus += 0.10
                    elif complexity <= 2.3:
                        bonus += 0.05
                    elif complexity >= 2.8:
                        bonus -= 0.18

            if light_strategy_query:
                if normalize_text("轻策略") in normalized_recommendation_surface:
                    bonus += 0.12
                if normalize_text("中策略") in normalized_recommendation_surface:
                    bonus += 0.08
                if normalize_text("轻松休闲") in normalized_recommendation_surface:
                    bonus += 0.06
                if normalize_text("低冲突友好") in normalized_recommendation_surface:
                    bonus += 0.06
                if any(
                    normalize_text(term) in normalized_recommendation_surface
                    for term in ["重策略", "烧脑策略", "高互动对抗", "阵营推理", "朋友聚会"]
                ):
                    bonus -= 0.16
                matched_strategy_mechanics = sum(
                    1 for term in strategy_mechanic_terms if normalize_text(term) in normalized_recommendation_surface
                )
                bonus += min(0.12, matched_strategy_mechanics * 0.04)
                if matched_strategy_mechanics == 0:
                    bonus -= 0.12
                if "合作" not in query_text and normalize_text("合作共赢") in normalized_recommendation_surface:
                    bonus -= 0.08
                if isinstance(complexity, (int, float)):
                    if complexity <= 1.4:
                        bonus += 0.04
                    elif complexity <= 2.3:
                        bonus += 0.14
                    elif complexity <= 2.7:
                        bonus += 0.04
                    else:
                        bonus -= 0.22

            if mid_strategy_query:
                if normalize_text("中策略") in normalized_recommendation_surface:
                    bonus += 0.14
                elif normalize_text("轻策略") in normalized_recommendation_surface:
                    bonus -= 0.16
                matched_strategy_mechanics = sum(
                    1 for term in strategy_mechanic_terms if normalize_text(term) in normalized_recommendation_surface
                )
                bonus += min(0.16, matched_strategy_mechanics * 0.05)
                if matched_strategy_mechanics == 0:
                    bonus -= 0.14
                if "合作" not in query_text and "低冲突" not in query_text and normalize_text("合作共赢") in normalized_recommendation_surface:
                    bonus -= 0.18
                if any(
                    normalize_text(term) in normalized_recommendation_surface
                    for term in ["团建破冰", "猜词联想", "阵营推理", "嘴炮谈判"]
                ):
                    bonus -= 0.10
                if "低冲突" in query_text and normalize_text("合作共赢") in normalized_recommendation_surface:
                    bonus += 0.08
                if isinstance(complexity, (int, float)):
                    if complexity <= 1.4:
                        bonus -= 0.10
                    elif complexity <= 1.8:
                        bonus -= 0.06
                    elif complexity <= 2.6:
                        bonus += 0.14
                    elif complexity <= 2.9:
                        bonus += 0.02
                    else:
                        bonus -= 0.20
                if re.search(r"(一小时|60分钟)", query_text) and not re.search(r"(半小时|30分钟|不拖|不要太拖)", query_text):
                    if isinstance(playtime_min, (int, float)) and playtime_min < 20:
                        bonus -= 0.12

            if betting_query:
                if normalize_text("拍卖押注") in normalized_recommendation_surface:
                    bonus += 0.26
                if normalize_text("朋友聚会") in normalized_recommendation_surface:
                    bonus += 0.06
                if normalize_text("轻策略") in normalized_recommendation_surface:
                    bonus += 0.05
                if normalize_text("双人核心") in normalized_recommendation_surface:
                    bonus -= 0.10

            if gentle_strategy_query:
                matched_strategy_mechanics = sum(
                    1 for term in strategy_mechanic_terms if normalize_text(term) in normalized_recommendation_surface
                )
                bonus += min(0.14, matched_strategy_mechanics * 0.05)
                if any(
                    normalize_text(term) in normalized_recommendation_surface
                    for term in ["双人核心", "情侣约会", "抽象对战", "合作共赢"]
                ):
                    bonus -= 0.14
                if normalize_text("15分钟内") in normalized_recommendation_surface:
                    bonus -= 0.08
                if isinstance(complexity, (int, float)):
                    if complexity <= 1.2:
                        bonus -= 0.06
                    elif complexity <= 2.4:
                        bonus += 0.12
                    elif complexity >= 3.0:
                        bonus -= 0.14

            if classic_query:
                classic_cues = ["经典", "经典入门", "德式经典", "老牌德式", "入门砖", "经典knizia", "口碑"]
                if any(normalize_text(term) in display_tag_surface for term in classic_cues):
                    bonus += 0.18
                if any(
                    normalize_text(term) in normalized_recommendation_surface
                    for term in ["家庭同乐", "低冲突友好", "轻策略", "轻松休闲"]
                ):
                    bonus += 0.08
                if any(
                    normalize_text(term) in normalized_recommendation_surface
                    for term in ["朋友聚会", "欢乐搞笑", "阵营推理", "高互动对抗"]
                ):
                    bonus -= 0.10
                if isinstance(complexity, (int, float)):
                    if complexity <= 1.4:
                        bonus += 0.04
                    elif complexity <= 2.3:
                        bonus += 0.12
                    elif complexity >= 2.8:
                        bonus -= 0.18
                if isinstance(playtime_min, (int, float)):
                    if 20 <= playtime_min <= 60:
                        bonus += 0.06
                    elif playtime_min < 15:
                        bonus -= 0.10

            if sci_fi_query:
                if normalize_text("科幻太空") in normalized_recommendation_surface:
                    bonus += 0.26
                else:
                    bonus -= 0.16

            # catalog 候选先入推荐池，但在泛需求/中轻策需求里不应轻易压过
            # 已经完整校准过的 full-tier 游戏，避免“新入池候选把稳定推荐挤掉”。
            if knowledge_tier == "catalog" and exact_title_hits == 0:
                if generic_recommendation_query:
                    bonus -= 0.08
                if light_strategy_query or mid_strategy_query or gentle_strategy_query or classic_query:
                    bonus -= 0.18

        requested_player_range = _parse_requested_player_range(query_text)
        requested_player_count = None if requested_player_range is not None else _parse_requested_player_count(query_text)
        min_players = metadata.get("min_players")
        max_players = metadata.get("max_players")
        if isinstance(min_players, (int, float)) and isinstance(max_players, (int, float)):
            min_players = int(min_players)
            max_players = int(max_players)
            if requested_player_range is not None:
                requested_min, requested_max = requested_player_range
                if min_players <= requested_min and max_players >= requested_max:
                    bonus += 0.26
                    range_overflow = max(0, requested_min - min_players) + max(0, max_players - requested_max)
                    bonus -= min(0.28, range_overflow * 0.14)
                    if min_players == requested_min and max_players == requested_max:
                        bonus += 0.08
                    elif min_players == requested_min or max_players == requested_max:
                        bonus += 0.04
                elif max_players < requested_min or min_players > requested_max:
                    bonus -= 0.32
                elif max_players < requested_max or min_players > requested_min:
                    bonus -= 0.18
                else:
                    bonus += 0.06
            elif requested_player_count is not None:
                if min_players <= requested_player_count <= max_players:
                    bonus += 0.14
                else:
                    bonus -= 0.28

        requested_max_playtime = _parse_requested_max_playtime(query_text)
        requested_min_playtime = _parse_requested_min_playtime(query_text)
        playtime_min = metadata.get("playtime_min")
        if requested_max_playtime is not None and isinstance(playtime_min, (int, float)):
            if playtime_min <= requested_max_playtime:
                bonus += 0.10
            elif playtime_min <= requested_max_playtime + 15:
                bonus -= 0.04
            else:
                bonus -= 0.16

        if requested_min_playtime is not None and isinstance(playtime_min, (int, float)):
            if playtime_min >= requested_min_playtime:
                bonus += 0.22
            elif playtime_min >= requested_min_playtime - 10:
                bonus += 0.04
            else:
                bonus -= 0.28

        complexity = metadata.get("complexity")
        if isinstance(complexity, (int, float)) and re.search(r"(推荐|来个|求推荐).*(桌游)|桌游.*(推荐|来个|求推荐)", query_text):
            if complexity <= 2.2:
                bonus += 0.06
            elif complexity >= 3.2:
                bonus -= 0.10

        if isinstance(complexity, (int, float)) and generic_recommendation_query:
            if complexity >= 2.8:
                bonus -= 0.12

    return bonus


def _negative_metadata_penalty(hit: RetrievalHit, negative_terms: List[str], mode: Optional[str]) -> float:
    if mode != "recommendation" or not negative_terms:
        return 0.0

    metadata = hit.metadata or {}
    normalized_recommendation_surface = _build_recommendation_surface(metadata)
    if not normalized_recommendation_surface:
        return 0.0

    matched_negative_terms = sum(
        1
        for term in negative_terms
        if len(term) >= 2 and normalize_text(term) in normalized_recommendation_surface
    )
    if matched_negative_terms <= 0:
        return 0.0

    return min(0.42, matched_negative_terms * 0.10)


def _safe_positive_int(value: Any) -> Optional[int]:
    try:
        parsed = int(str(value))
    except (TypeError, ValueError):
        return None
    return parsed if parsed > 0 else None


def _get_hit_game_id(hit: RetrievalHit) -> Optional[str]:
    metadata = hit.metadata or {}
    game_id = metadata.get("game_id")
    if isinstance(game_id, str) and game_id.strip():
        return game_id.strip()
    if hit.document_id.strip():
        return hit.document_id.strip()
    return None


def _get_hit_chunk_index(hit: RetrievalHit) -> Optional[int]:
    metadata = hit.metadata or {}
    chunk_index = _safe_positive_int(metadata.get("chunk_index"))
    if chunk_index is not None:
        return chunk_index

    match = re.search(r":(\d+)$", hit.chunk_id or "")
    if not match:
        return None
    return _safe_positive_int(match.group(1))


def _get_raw_hit_text(hit: RetrievalHit) -> str:
    metadata = hit.metadata or {}
    raw_text = metadata.get("raw_text")
    if isinstance(raw_text, str) and raw_text.strip():
        return raw_text.strip()
    return hit.text.strip()


def _summarize_pipe_text(raw_value: Any, limit: int = 8) -> str:
    if not isinstance(raw_value, str):
        return ""

    parts = [part.strip() for part in raw_value.split("|") if part.strip()]
    if not parts:
        return raw_value.strip()

    return " | ".join(parts[:limit])


def _format_duration_hint(playtime_min: Optional[int]) -> str:
    if playtime_min is None:
        return ""
    if playtime_min >= 60:
        return "60分钟以上"
    if playtime_min <= 15:
        return "15分钟内"
    if playtime_min <= 30:
        return "30分钟内"
    return "60分钟内"


def _build_recommendation_metadata_summary(hit: RetrievalHit) -> str:
    metadata = hit.metadata or {}
    min_players = _safe_positive_int(metadata.get("min_players"))
    max_players = _safe_positive_int(metadata.get("max_players"))
    playtime_min = _safe_positive_int(metadata.get("playtime_min"))
    best_player_count_text = _summarize_pipe_text(metadata.get("best_player_count_text"), limit=6)
    recommendation_tags_text = _summarize_pipe_text(metadata.get("recommendation_tags_text"), limit=8)
    theme_tags_text = _summarize_pipe_text(metadata.get("theme_tags_text"), limit=4)
    search_terms_text = _summarize_pipe_text(metadata.get("search_terms_text"), limit=8)

    lines: List[str] = ["[推荐概览]"]
    if min_players is not None and max_players is not None:
        lines.append(f"- 支持人数：{min_players}-{max_players}人")
    if best_player_count_text:
        lines.append(f"- 最佳人数：{best_player_count_text}人")
    if playtime_min is not None:
        duration_hint = _format_duration_hint(playtime_min)
        if duration_hint:
            lines.append(f"- 大致时长：{playtime_min}分钟（{duration_hint}）")
        else:
            lines.append(f"- 大致时长：{playtime_min}分钟")
    if theme_tags_text:
        lines.append(f"- 主题词条：{theme_tags_text}")
    if recommendation_tags_text:
        lines.append(f"- 结构化词条：{recommendation_tags_text}")
    if search_terms_text:
        lines.append(f"- 检索别名：{search_terms_text}")

    return "\n".join(lines) if len(lines) > 1 else ""


def _merge_group_text(group_hits: List[RetrievalHit], mode: Optional[str], max_group_chunks: int) -> str:
    if not group_hits:
        return ""

    if mode == "referee":
        ordered_hits = sorted(
            group_hits,
            key=lambda item: (
                _get_hit_chunk_index(item) if _get_hit_chunk_index(item) is not None else 10**9,
                -(item.rerank_score or item.score),
            ),
        )
    else:
        ordered_hits = sorted(group_hits, key=lambda item: item.rerank_score or item.score, reverse=True)

    blocks: List[str] = []
    seen_texts = set()

    for hit in ordered_hits:
        text = _get_raw_hit_text(hit)
        normalized_text = normalize_text(text)
        if not text or normalized_text in seen_texts:
            continue
        seen_texts.add(normalized_text)

        section_title = hit.section_title or str((hit.metadata or {}).get("section_title") or "").strip()
        if mode == "recommendation" and section_title:
            blocks.append(f"[{section_title}]\n{text}")
        else:
            blocks.append(text)

        if len(blocks) >= max(1, max_group_chunks):
            break

    merged_text = "\n\n".join(blocks) if blocks else _get_raw_hit_text(group_hits[0])
    if mode != "recommendation":
        return merged_text

    summary = _build_recommendation_metadata_summary(group_hits[0])
    if not summary:
        return merged_text

    return f"{summary}\n\n{merged_text}".strip()


def _aggregate_hits(hits: List[RetrievalHit], mode: Optional[str], top_k: int) -> List[RetrievalHit]:
    if mode not in {"recommendation", "referee"}:
        return hits[:top_k]
    if not hits:
        return []

    grouped: Dict[str, List[RetrievalHit]] = defaultdict(list)
    for hit in hits:
        if mode == "recommendation":
            group_key = _get_hit_game_id(hit) or hit.chunk_id
        else:
            section_key = hit.section_id or str((hit.metadata or {}).get("section_id") or "").strip() or hit.chunk_id
            group_key = f"{hit.document_id}:{section_key}"
        grouped[group_key].append(hit)

    aggregated_hits: List[RetrievalHit] = []
    max_group_chunks = (
        settings.recommendation_group_max_chunks
        if mode == "recommendation"
        else settings.referee_group_max_chunks
    )

    for group_key, group_hits in grouped.items():
        ranked_group = sorted(group_hits, key=lambda item: item.rerank_score or item.score, reverse=True)
        leader = ranked_group[0]
        distinct_sections = {
            normalize_text(item.section_title or str((item.metadata or {}).get("section_title") or ""))
            for item in group_hits
            if item.section_title or (item.metadata or {}).get("section_title")
        }
        retrieval_sources = {source for item in group_hits for source in item.retrieval_sources}

        coverage_bonus = 0.0
        if mode == "recommendation":
            coverage_bonus += min(0.08, max(0, len(group_hits) - 1) * 0.03)
            coverage_bonus += min(0.04, max(0, len(distinct_sections) - 1) * 0.02)
        else:
            coverage_bonus += min(0.10, max(0, len(group_hits) - 1) * 0.04)
            coverage_bonus += min(0.03, max(0, len(retrieval_sources) - 1) * 0.03)

        merged_text = _merge_group_text(group_hits, mode=mode, max_group_chunks=max_group_chunks)
        merged_score = (leader.rerank_score or leader.score) + coverage_bonus
        metadata = dict(leader.metadata or {})
        metadata["aggregation_key"] = group_key
        metadata["aggregation_scope"] = "game" if mode == "recommendation" else "section"
        metadata["aggregated_chunk_count"] = len(group_hits)
        metadata["aggregated_section_count"] = max(1, len(distinct_sections))

        aggregated_hits.append(
            leader.model_copy(
                update={
                    "text": merged_text,
                    "score": merged_score,
                    "rerank_score": merged_score,
                    "metadata": metadata,
                }
            )
        )

    aggregated_hits.sort(key=lambda item: item.rerank_score or item.score, reverse=True)
    return aggregated_hits[:top_k]


def _hybrid_fuse_hits(
    dense_hits: List[RetrievalHit],
    lexical_hits: List[Tuple[RetrievalHit, float]],
    top_k: int,
    mode: Optional[str],
    active_game_id: Optional[str],
    rewritten_query: str,
    section_target: Optional[str],
    negative_terms: List[str],
) -> List[RetrievalHit]:
    merged: Dict[str, Dict[str, Any]] = defaultdict(dict)

    for dense_rank, hit in enumerate(dense_hits, start=1):
        entry = merged[hit.chunk_id]
        entry["hit"] = hit
        entry["dense_rank"] = dense_rank
        entry["dense_score"] = _normalize_dense_score(hit)
        entry.setdefault("sources", set()).add("vector")

    for lexical_rank, (hit, lexical_score) in enumerate(lexical_hits, start=1):
        entry = merged[hit.chunk_id]
        entry.setdefault("hit", hit)
        entry["lexical_rank"] = lexical_rank
        entry["lexical_score"] = lexical_score
        entry.setdefault("sources", set()).add("lexical")

    query_terms = tokenize_text(rewritten_query)
    max_dense_score = max((float(entry.get("dense_score", 0.0)) for entry in merged.values()), default=0.0)
    max_lexical_score = max((float(entry.get("lexical_score", 0.0)) for entry in merged.values()), default=0.0)
    fused_hits: List[RetrievalHit] = []

    for entry in merged.values():
        hit: RetrievalHit = entry["hit"]
        dense_rank = entry.get("dense_rank")
        lexical_rank = entry.get("lexical_rank")
        dense_score = float(entry.get("dense_score", 0.0))
        lexical_score = float(entry.get("lexical_score", 0.0))
        sources = sorted(entry.get("sources", set()))
        dense_signal = _normalize_signal(dense_score, max_dense_score)
        lexical_signal = _normalize_signal(lexical_score, max_lexical_score)

        rrf_score = 0.0
        if dense_rank:
            rrf_score += settings.hybrid_dense_weight / (settings.rrf_k + dense_rank)
        if lexical_rank:
            rrf_score += settings.hybrid_lexical_weight / (settings.rrf_k + lexical_rank)
        rank_signal = rrf_score * float(settings.rrf_k)

        rerank_score = (
            rank_signal +
            (dense_signal * 0.30) +
            (lexical_signal * 0.18) +
            _section_bonus(hit.section_title, section_target) +
            _section_type_bonus(hit, mode, section_target) +
            _metadata_bonus(hit, rewritten_query, query_terms, mode, active_game_id) -
            _negative_metadata_penalty(hit, negative_terms, mode)
        )

        fused_hits.append(
            hit.model_copy(
                update={
                    "score": rerank_score,
                    "dense_score": dense_score or hit.dense_score,
                    "lexical_score": lexical_score,
                    "rerank_score": rerank_score,
                    "distance": hit.distance if dense_rank else max(0.0, 1 - lexical_score),
                    "retrieval_sources": sources,
                }
            )
        )

    fused_hits.sort(key=lambda item: item.rerank_score or item.score, reverse=True)
    return fused_hits[:max(top_k, top_k * 3)]


def query_documents(
    query: str,
    top_k: Optional[int] = None,
    mode: Optional[str] = None,
    active_game_id: Optional[str] = None,
    where: Optional[Dict[str, Any]] = None,
    where_document: Optional[Dict[str, Any]] = None,
    debug: bool = False,
) -> QueryResponse:
    if not query.strip():
        raise ValueError("query must not be empty")

    started_at = time.perf_counter()
    bootstrap_started_at = time.perf_counter()
    embedder = get_embedding_service()
    store = ChromaVectorStore(settings)
    normalized_where = _normalize_where(where)
    derived_mode = mode or _extract_filter_value(normalized_where, "mode")
    normalized_where = _derive_recommendation_where_from_query(
        query=query,
        mode=derived_mode,
        where=normalized_where,
    )
    derived_mode = mode or _extract_filter_value(normalized_where, "mode")
    derived_active_game_id = active_game_id or _extract_filter_value(normalized_where, "game_id")
    bootstrap_ms = (time.perf_counter() - bootstrap_started_at) * 1000

    rewrite_started_at = time.perf_counter()
    rewritten_query, rewrite_expansions, section_target, negative_terms = _rewrite_query(
        query=query,
        mode=derived_mode,
        active_game_id=derived_active_game_id,
    )
    explicit_title_terms = _extract_explicit_title_terms(query)
    rewrite_ms = (time.perf_counter() - rewrite_started_at) * 1000

    embedding_started_at = time.perf_counter()
    query_embedding = embedder.embed_queries([rewritten_query])[0]
    embedding_ms = (time.perf_counter() - embedding_started_at) * 1000

    effective_top_k = top_k or settings.default_top_k
    recommendation_dense_floor = 40 if derived_mode == "recommendation" else effective_top_k
    recommendation_lexical_floor = 60 if derived_mode == "recommendation" else effective_top_k
    dense_candidate_top_k = max(
        effective_top_k,
        effective_top_k * max(1, settings.dense_candidate_multiplier),
        recommendation_dense_floor,
    )

    dense_started_at = time.perf_counter()
    dense_hits = store.query(
        query_embedding=query_embedding,
        top_k=dense_candidate_top_k,
        where=normalized_where,
        where_document=where_document,
    )
    dense_ms = (time.perf_counter() - dense_started_at) * 1000

    lexical_hits_raw: List[Tuple[RetrievalHit, float]] = []
    lexical_started_at = time.perf_counter()
    lexical_index = get_lexical_index(settings)
    if lexical_index is not None:
        lexical_candidate_top_k = max(
            effective_top_k,
            effective_top_k * max(1, settings.lexical_candidate_multiplier),
            recommendation_lexical_floor,
        )
        for lexical_hit in lexical_index.search(
            query=rewritten_query,
            top_k=lexical_candidate_top_k,
            where=normalized_where,
            where_document=where_document,
        ):
            lexical_hits_raw.append(
                (
                    RetrievalHit(
                        chunk_id=lexical_hit.chunk.chunk_id,
                        document_id=lexical_hit.chunk.document_id,
                        title=lexical_hit.chunk.title,
                        text=lexical_hit.chunk.text,
                        source=lexical_hit.chunk.source,
                        distance=max(0.0, 1 - lexical_hit.score),
                        score=lexical_hit.score,
                        section_id=lexical_hit.chunk.section_id,
                        section_title=lexical_hit.chunk.section_title,
                        lexical_score=lexical_hit.score,
                        rerank_score=lexical_hit.score,
                        retrieval_sources=["lexical"],
                        metadata=lexical_hit.chunk.metadata,
                    ),
                    lexical_hit.score,
                )
            )
        if derived_mode == "recommendation" and explicit_title_terms:
            lexical_hits_raw = _merge_lexical_hits(
                lexical_hits_raw,
                _supplement_exact_title_lexical_hits(
                    lexical_index=lexical_index,
                    title_terms=explicit_title_terms,
                    where=normalized_where,
                    where_document=where_document,
                ),
            )
        if derived_mode == "recommendation":
            lexical_hits_raw = _merge_lexical_hits(
                lexical_hits_raw,
                _build_supplemental_recommendation_hits(
                    lexical_index=lexical_index,
                    query_text=query,
                    where=normalized_where,
                    where_document=where_document,
                ),
            )
    lexical_ms = (time.perf_counter() - lexical_started_at) * 1000

    fuse_started_at = time.perf_counter()
    fused_hits = _hybrid_fuse_hits(
        dense_hits=dense_hits,
        lexical_hits=lexical_hits_raw,
        top_k=effective_top_k,
        mode=derived_mode,
        active_game_id=derived_active_game_id,
        rewritten_query=rewritten_query,
        section_target=section_target,
        negative_terms=negative_terms,
    )
    fuse_ms = (time.perf_counter() - fuse_started_at) * 1000

    aggregate_started_at = time.perf_counter()
    hits = _aggregate_hits(fused_hits, mode=derived_mode, top_k=effective_top_k)
    aggregate_ms = (time.perf_counter() - aggregate_started_at) * 1000
    total_ms = (time.perf_counter() - started_at) * 1000

    diagnostics = {
        "mode": derived_mode,
        "active_game_id": derived_active_game_id,
        "rewrite_expansions": rewrite_expansions,
        "negative_terms": negative_terms,
        "section_target": section_target,
        "derived_where": normalized_where,
        "dense_candidates": len(dense_hits),
        "lexical_candidates": len(lexical_hits_raw),
        "hybrid_enabled": lexical_index is not None,
        "pre_aggregation_hits": len(fused_hits),
        "post_aggregation_hits": len(hits),
        "aggregation_scope": "game" if derived_mode == "recommendation" else "section" if derived_mode == "referee" else None,
        "latency_ms": round(total_ms, 2),
        "latency_breakdown_ms": {
            "bootstrap": round(bootstrap_ms, 2),
            "rewrite": round(rewrite_ms, 2),
            "embedding": round(embedding_ms, 2),
            "dense": round(dense_ms, 2),
            "lexical": round(lexical_ms, 2),
            "fusion": round(fuse_ms, 2),
            "aggregation": round(aggregate_ms, 2),
        },
    }
    if not debug:
        diagnostics = {
            key: value
            for key, value in diagnostics.items()
            if key in {"mode", "active_game_id", "hybrid_enabled", "post_aggregation_hits", "latency_ms"}
        }

    return QueryResponse(
        query=query,
        top_k=effective_top_k,
        hits=hits,
        rewritten_query=rewritten_query if rewritten_query != query else None,
        strategy="hybrid_rrf_rerank_aggregated" if lexical_index is not None else "dense_only_aggregated",
        diagnostics=diagnostics,
    )
