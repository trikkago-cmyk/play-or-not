#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
from dataclasses import dataclass
from html import unescape
from pathlib import Path
from typing import Any, Iterable
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlencode
from urllib.request import Request, urlopen


USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36"
)
DEFAULT_TIMEOUT_SECONDS = 25
DEFAULT_DELAY_SECONDS = 1.2
BV_PATTERN = re.compile(r"BV[1-9A-HJ-NP-Za-km-z]{10}")
PROJECT_ROOT = Path(__file__).resolve().parents[1]
CURATED_DB_FILES = [
    PROJECT_ROOT / "src/data/gameDatabase.ts",
    PROJECT_ROOT / "src/data/gameDatabaseExpansion.ts",
]

SOURCE_POLICY = {
    "boardgamearena": "public_gamepanel_only",
    "boardgamegeek": "disabled_for_rag_ingest",
    "xiaohongshu": "manual_only_robots_disallow_all",
    "bilibili": "search_engine_discovery_only",
}

BGA_TAG_TO_DISPLAY_TAG = {
    "Casual games": "简单易懂",
    "For regular players": "轻策略",
    "For core gamers": "硬核策略",
    "Party game": "热场",
    "Family": "家庭欢乐",
    "Fantasy": "奇幻主题",
    "Science fiction": "科幻",
    "Historical": "历史主题",
    "Adventure": "冒险主题",
    "Exploration": "探索冒险",
    "Espionage": "谍战",
    "Trains": "路线规划",
    "Sport": "竞速",
    "Economy": "经商",
    "Animals": "动物主题",
    "Abstract games": "抽象棋类",
    "Cards": "卡牌驱动",
    "Dice": "骰子",
    "Worker placement": "工人放置",
    "Hand management": "手牌管理",
    "Bluffing": "虚张声势",
    "Tile placement": "板块拼接",
    "Combos": "卡牌组合",
    "Race": "竞速",
    "Collection": "收集控",
    "Cooperative": "合作",
    "Speed": "拼手速",
    "Asymmetrical": "角色技能",
    "Communication": "猜词",
    "Team": "团队对抗",
    "Auction": "拍卖",
    "Objectives": "任务目标",
    "Trick-taking": "吃墩",
    "Resource management": "资源管理",
}

CHINESE_TITLE_BLACKLIST = {
    "桌游教学",
    "规则教学",
    "玩法介绍",
    "桌游规则详解",
    "桌游推荐",
    "桌游",
    "规则详解",
    "超清",
    "试玩",
    "上集",
    "下集",
    "简单易懂",
    "最好玩的",
    "玩法",
    "教学",
}

CHINESE_TITLE_FRAGMENT_BLACKLIST = {
    "桌游",
    "桌遊",
    "规则",
    "規則",
    "教学",
    "教學",
    "教程",
    "介绍",
    "介紹",
    "影片",
    "视频",
    "視頻",
    "小教室",
    "一周",
    "翻唱",
    "候选",
    "系列",
    "红蓝",
    "紅藍",
    "规则讲解",
    "桌遊教學影片",
}

KNOWN_CHINESE_TITLE_OVERRIDES = {
    "luckynumbers": "幸运数字",
    "cantstop": "别停",
    "toybattle": "玩具大作战",
    "flipseven": "翻转7",
    "faraway": "遥远之地",
    "raceforthegalaxy": "银河竞逐",
    "itsawonderfulworld": "美丽新世界",
    "arnak": "失落的阿纳克遗迹",
    "chakra": "脉轮",
    "lostcities": "失落的城市",
    "cartographers": "王国制图师",
    "supermegaluckybox": "超级幸运盒",
    "sevenwondersarchitects": "七大奇迹建筑师",
    "cubirds": "方鸟",
    "gizmos": "小小发明",
    "stoneage": "石器时代",
    "railroadink": "铁道墨水",
    "seasons": "四季物语",
    "regicide": "弑君者",
    "gaiaproject": "盖亚计划",
    "resarcana": "奥法对决",
    "greatwesterntrail": "大西部之路",
    "viticulture": "葡萄酒庄园",
    "photosynthesis": "光合作用",
    "isleofcats": "猫岛奇缘",
    "clansofcaledonia": "卡利多尼亚氏族",
    "caverna": "洞穴农夫",
    "throughtheages": "历史巨轮",
    "thecrew": "星际探险队",
}

KNOWN_ENGLISH_TITLE_OVERRIDES = {
    "isleofcats": "The Isle of Cats",
}

CATALOG_TAG_OVERRIDES = {
    "arnak": ["卡组构筑", "工人放置", "烧脑策略"],
    "cantstop": ["骰子驱动", "轻松休闲", "家庭同乐"],
    "captainflip": ["收集组合", "轻松休闲", "朋友聚会"],
    "cartographers": ["纸笔规划", "拼图布局", "低冲突友好"],
    "castlecombo": ["收集组合", "拼图布局", "轻松休闲"],
    "flipseven": ["朋友聚会", "欢乐搞笑", "轻松休闲"],
    "gizmos": ["引擎构筑", "收集组合", "低冲突友好"],
    "itsawonderfulworld": ["引擎构筑", "收集组合", "烧脑策略"],
    "lostcities": ["情侣约会", "手牌管理", "高互动对抗"],
    "raceforthegalaxy": ["引擎构筑", "手牌管理", "科幻太空", "烧脑策略"],
    "railroadink": ["纸笔规划", "路线规划", "低冲突友好", "朋友聚会"],
    "seasons": ["引擎构筑", "骰子驱动", "烧脑策略"],
    "stoneage": ["工人放置", "骰子驱动", "文明历史", "烧脑策略"],
    "supermegaluckybox": ["纸笔规划", "家庭同乐", "轻松休闲"],
    "gaiaproject": ["引擎构筑", "科幻太空", "烧脑策略", "低冲突友好"],
    "resarcana": ["引擎构筑", "手牌管理", "烧脑策略", "高互动对抗"],
    "greatwesterntrail": ["手牌管理", "路线规划", "文明历史", "烧脑策略"],
    "viticulture": ["工人放置", "商业经营", "烧脑策略", "低冲突友好"],
    "photosynthesis": ["抽象对战", "低冲突友好", "烧脑策略", "家庭同乐"],
    "isleofcats": ["拼图布局", "收集组合", "低冲突友好", "家庭同乐"],
    "clansofcaledonia": ["引擎构筑", "商业经营", "文明历史", "烧脑策略"],
    "caverna": ["工人放置", "文明历史", "烧脑策略", "低冲突友好"],
    "throughtheages": ["引擎构筑", "手牌管理", "文明历史", "烧脑策略"],
    "thecrew": ["合作共赢", "吃墩叫牌", "科幻太空", "低冲突友好"],
}

BGA_TAG_TO_PROFILE_TAGS = {
    "Party game": ["朋友聚会", "欢乐搞笑"],
    "Family": ["家庭同乐", "轻松休闲"],
    "Cooperative": ["合作共赢", "低冲突友好"],
    "Team": ["团队对抗"],
    "Communication": ["猜词联想", "团建破冰"],
    "Bluffing": ["阵营推理"],
    "Hand management": ["手牌管理"],
    "Worker placement": ["工人放置"],
    "Tile placement": ["拼图布局"],
    "Abstract games": ["抽象对战", "安静对弈"],
    "Trains": ["路线规划"],
    "Race": ["竞速赛跑"],
    "Speed": ["手速反应"],
    "Dice": ["骰子驱动"],
    "Trick-taking": ["吃墩叫牌"],
    "Auction": ["拍卖押注"],
    "Collection": ["收集组合"],
    "Combos": ["收集组合"],
    "Resource management": ["引擎构筑"],
    "Cards": ["手牌管理"],
    "Asymmetrical": ["角色技能"],
    "Science fiction": ["科幻太空"],
    "Historical": ["文明历史"],
    "Economy": ["商业经营"],
    "Animals": ["自然动物"],
}

OCCASION_TAGS = {"情侣约会", "朋友聚会", "团建破冰", "家庭同乐"}
INTERACTION_TAGS = {"合作共赢", "阵营推理", "嘴炮谈判", "高互动对抗", "安静对弈", "团队对抗"}
MECHANIC_TAGS = {
    "手速反应",
    "猜词联想",
    "手牌管理",
    "引擎构筑",
    "工人放置",
    "拼图布局",
    "抽象对战",
    "路线规划",
    "纸笔规划",
    "拍卖押注",
    "骰子驱动",
    "角色技能",
    "编程行动",
    "竞速赛跑",
    "吃墩叫牌",
    "收集组合",
    "卡组构筑",
}
MOOD_TAGS = {"轻松休闲", "欢乐搞笑", "烧脑策略", "低冲突友好"}
THEME_TAGS = {"自然动物", "科幻太空", "文明历史", "商业经营"}


@dataclass
class LLMConfig:
    base_url: str
    api_key: str
    model: str


def unique_preserve_order(values: Iterable[str]) -> list[str]:
    seen: set[str] = set()
    ordered: list[str] = []
    for value in values:
        normalized = value.strip()
        if not normalized or normalized in seen:
            continue
        seen.add(normalized)
        ordered.append(normalized)
    return ordered


def compact_text(value: str) -> str:
    value = value.replace("\r\n", "\n").replace("\xa0", " ")
    value = re.sub(r"[ \t]+", " ", value)
    value = re.sub(r"\n{3,}", "\n\n", value)
    return value.strip()


def clean_html_fragment(html: str) -> str:
    text = html
    replacements = {
        "<br />": "\n",
        "<br/>": "\n",
        "<br>": "\n",
        "</p>": "\n\n",
        "</li>": "\n",
        "</ul>": "\n",
        "</ol>": "\n",
        "</h1>": "\n\n",
        "</h2>": "\n\n",
        "</h3>": "\n\n",
    }
    for needle, replacement in replacements.items():
        text = text.replace(needle, replacement)
    text = re.sub(r"<li[^>]*>", "- ", text)
    text = re.sub(r"<[^>]+>", " ", text)
    text = unescape(text)
    return compact_text(text)


def decode_html_entities(value: str) -> str:
    return unescape(unescape(value))


def fetch_text(url: str, *, timeout: int = DEFAULT_TIMEOUT_SECONDS, data: bytes | None = None, headers: dict[str, str] | None = None) -> str:
    request_headers = {
        "User-Agent": USER_AGENT,
    }
    if headers:
        request_headers.update(headers)
    request = Request(url, data=data, headers=request_headers)
    with urlopen(request, timeout=timeout) as response:
        charset = response.headers.get_content_charset() or "utf-8"
        return response.read().decode(charset, "ignore")


def read_jsonl(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        return []
    records: list[dict[str, Any]] = []
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line:
            continue
        records.append(json.loads(line))
    return records


def write_jsonl(path: Path, records: Iterable[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    lines = [json.dumps(record, ensure_ascii=False) for record in records]
    path.write_text("\n".join(lines) + ("\n" if lines else ""), encoding="utf-8")


def load_slug_inputs(slug_args: list[str], slug_file: str | None, discover_featured: bool) -> list[str]:
    slugs: list[str] = []
    if slug_file:
        slugs.extend(
            line.strip()
            for line in Path(slug_file).read_text(encoding="utf-8").splitlines()
            if line.strip() and not line.strip().startswith("#")
        )
    slugs.extend(slug_args)
    if discover_featured:
        slugs.extend(discover_featured_bga_slugs())
    return unique_preserve_order(slugs)


def discover_featured_bga_slugs() -> list[str]:
    html = fetch_text("https://en.boardgamearena.com/gamelist")
    return unique_preserve_order(re.findall(r"/gamepanel\?game=([a-z0-9_-]+)", html))


def extract_title_from_gamepanel(html: str, slug: str) -> str:
    name_match = re.search(r'id="game_name"[^>]*>\s*(.*?)\s*</a>', html, re.S | re.I)
    if name_match:
        return clean_html_fragment(name_match.group(1))

    og_title_match = re.search(r'<meta property="og:title" content="Play (.*?) online from your browser', html, re.I)
    if og_title_match:
        return compact_text(unescape(og_title_match.group(1)))

    return slug.replace("-", " ").replace("_", " ").title()


def extract_presentation_text(html: str) -> str:
    match = re.search(
        r'<img[^>]+class="game_image"[^>]*>\s*(.*?)</p>\s*<p>Number of players:',
        html,
        re.S | re.I,
    )
    if not match:
        return ""
    return clean_html_fragment(match.group(1))


def extract_range(html: str, label: str) -> tuple[int | None, int | None]:
    match = re.search(rf"{re.escape(label)}:\s*(\d+)\s*-\s*(\d+)", html, re.I)
    if not match:
        return None, None
    return int(match.group(1)), int(match.group(2))


def extract_int(html: str, label: str, suffix: str = "") -> int | None:
    match = re.search(rf"{re.escape(label)}:\s*(\d+)\s*{re.escape(suffix)}", html, re.I)
    if not match:
        return None
    return int(match.group(1))


def extract_complexity(html: str) -> float | None:
    match = re.search(r"Complexity:\s*([0-9.]+)\s*/\s*5", html, re.I)
    if not match:
        return None
    try:
        return float(match.group(1))
    except ValueError:
        return None


def extract_cover_url(html: str) -> str:
    og_match = re.search(r'<meta property="og:image" content="(.*?)"', html, re.I)
    if og_match:
        return unescape(og_match.group(1))
    image_match = re.search(r'<img[^>]+class="game_image"[^>]+src="(.*?)"', html, re.I)
    if image_match:
        return unescape(image_match.group(1))
    return ""


def extract_rules_excerpt(html: str) -> str:
    start = html.find("Rules summary")
    if start == -1:
        return ""

    end = html.find('<div id="thankyou"', start)
    if end == -1:
        end = html.find("globalUserInfos=", start)
    if end == -1:
        end = len(html)

    raw_excerpt = html[start:end]
    cleaned = clean_html_fragment(raw_excerpt)
    cleaned = re.sub(r"^Rules summary\s*", "", cleaned)
    cleaned = re.sub(r"^Contents\s*", "", cleaned)
    return compact_text(cleaned[:8000])


def extract_json_array_by_key(text: str, key: str) -> list[Any]:
    marker = f'"{key}":'
    start_key = text.find(marker)
    if start_key == -1:
        return []
    start = text.find("[", start_key)
    if start == -1:
        return []

    depth = 0
    in_string = False
    escaped = False
    for index in range(start, len(text)):
        char = text[index]
        if in_string:
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == '"':
                in_string = False
            continue

        if char == '"':
            in_string = True
        elif char == "[":
            depth += 1
        elif char == "]":
            depth -= 1
            if depth == 0:
                return json.loads(text[start:index + 1])

    return []


def extract_json_string_field(text: str, field: str) -> str:
    match = re.search(rf'"{re.escape(field)}":"(.*?)"', text)
    return decode_html_entities(match.group(1)) if match else ""


def extract_json_int_field(text: str, field: str) -> int | None:
    match = re.search(rf'"{re.escape(field)}":(-?\d+)', text)
    return int(match.group(1)) if match else None


def load_bga_tag_catalog() -> dict[int, str]:
    html = fetch_text("https://en.boardgamearena.com/gamelist")
    tag_records = extract_json_array_by_key(html, "game_tags")
    catalog: dict[int, str] = {}
    for record in tag_records:
        if isinstance(record, dict) and isinstance(record.get("id"), int):
            catalog[record["id"]] = str(record.get("name", "")).strip()
    return catalog


def extract_panel_structured_fields(html: str, slug: str, tag_catalog: dict[int, str]) -> dict[str, Any]:
    game_records = extract_json_array_by_key(html, "game_list")
    matched: dict[str, Any] = {}
    for record in game_records:
        if isinstance(record, dict) and compact_text(str(record.get("name", ""))) == slug:
            matched = record
            break

    if not matched:
        return {
            "name": slug,
            "display_name_en": "",
            "bgg_id": 0,
            "player_numbers": [],
            "average_duration": None,
            "tag_ids": [],
            "tag_names": [],
            "box_url": "",
        }

    tag_pairs = matched.get("tags") if isinstance(matched.get("tags"), list) else []
    tag_ids = [pair[0] for pair in tag_pairs if isinstance(pair, list) and pair and isinstance(pair[0], int)]
    tag_names = [tag_catalog[tag_id] for tag_id in tag_ids if tag_id in tag_catalog]
    player_numbers = [int(value) for value in matched.get("player_numbers", []) if isinstance(value, int)]

    media = matched.get("media") if isinstance(matched.get("media"), dict) else {}
    box = media.get("box") if isinstance(media.get("box"), dict) else {}
    box_stamp = str(box.get("en") or "").strip()
    name = compact_text(str(matched.get("name", "")))
    display_name_en = compact_text(str(matched.get("display_name_en", "")))
    bgg_id = int(matched.get("bgg_id") or 0)
    average_duration = matched.get("average_duration")

    box_url = ""
    if name and box_stamp:
        box_url = f"https://x.boardgamearena.net/data/gamemedia/{name}/box/en_280.png?h={box_stamp}"

    return {
        "name": name,
        "display_name_en": display_name_en,
        "bgg_id": bgg_id,
        "player_numbers": player_numbers,
        "average_duration": int(average_duration) if isinstance(average_duration, int) else None,
        "tag_ids": tag_ids,
        "tag_names": tag_names,
        "box_url": box_url,
    }


def normalize_lookup_key(value: str) -> str:
    return re.sub(r"[^0-9a-z\u4e00-\u9fff]+", "", compact_text(value).lower())


def load_existing_runtime_keys() -> set[str]:
    keys: set[str] = set()
    patterns = [
        re.compile(r"id:\s*'([^']+)'"),
        re.compile(r"titleCn:\s*'([^']+)'"),
        re.compile(r"titleEn:\s*'([^']+)'"),
    ]
    for path in CURATED_DB_FILES:
        if not path.exists():
            continue
        text = path.read_text(encoding="utf-8")
        for pattern in patterns:
            for match in pattern.findall(text):
                normalized = normalize_lookup_key(match)
                if normalized:
                    keys.add(normalized)
    return keys


def choose_best_player_count(min_players: int, max_players: int, player_numbers: list[int]) -> list[int]:
    numbers = sorted({int(value) for value in player_numbers if min_players <= int(value) <= max_players})
    if min_players == max_players:
        return [min_players]
    if max_players >= 7 and min_players <= 5:
        return [value for value in [5, 6] if min_players <= value <= max_players]
    if min_players <= 4 <= max_players and min_players <= 5 <= max_players:
        return [4, 5]
    if min_players <= 3 <= max_players and min_players <= 4 <= max_players:
        return [3, 4]
    if min_players <= 2 <= max_players and max_players <= 3:
        return [value for value in [2, 3] if min_players <= value <= max_players]
    if numbers:
        mid = numbers[len(numbers) // 2]
        return [mid]
    midpoint = max(min_players, min(max_players, 4))
    return [midpoint]


def normalize_playtime_min(playtime_min: int | None, bga_tag_names: list[str], complexity: float | None) -> int | None:
    if playtime_min is None:
        return None
    if playtime_min >= 10:
        return int(playtime_min)

    bga_tags = set(bga_tag_names or [])
    difficulty = float(complexity or 0)
    if "Long games (> 30 min)" in bga_tags or difficulty >= 2.8:
        return 60
    if difficulty >= 2.2:
        return 30
    if "Short games" in bga_tags or "Party game" in bga_tags or "Family" in bga_tags:
        return 20
    return 30


def normalize_complexity(value: float | None, bga_tag_names: list[str]) -> float:
    if value and value > 0:
        return float(value)

    bga_tags = set(bga_tag_names or [])
    if "For core gamers" in bga_tags:
        return 3.2
    if "For regular players" in bga_tags:
        return 2.3
    if "Family" in bga_tags or "Casual games" in bga_tags:
        return 1.5
    return 2.0


def guess_age_rating(raw: dict[str, Any]) -> int:
    bga_tags = set(raw.get("bga_tag_names") or [])
    complexity = float(raw.get("complexity") or 0)
    playtime = int(raw.get("playtime_min") or 0)

    if "Speed" in bga_tags and complexity <= 1.4:
        return 6
    if "Family" in bga_tags and complexity <= 1.8 and playtime <= 45:
        return 8
    if complexity >= 3.2 or "For core gamers" in bga_tags:
        return 14
    if complexity >= 2.4 or playtime >= 60:
        return 12
    if complexity >= 1.6 or playtime >= 30:
        return 10
    return 8


def get_catalog_tag_bucket(tag: str) -> str:
    if tag in OCCASION_TAGS:
        return "occasion"
    if tag in INTERACTION_TAGS:
        return "interaction"
    if tag in MECHANIC_TAGS:
        return "mechanic"
    if tag in MOOD_TAGS:
        return "mood"
    if tag in THEME_TAGS:
        return "theme"
    return "other"


def derive_catalog_tags(raw: dict[str, Any]) -> list[str]:
    candidates: list[str] = []
    bga_tags = [str(value).strip() for value in raw.get("bga_tag_names", []) if str(value).strip()]
    slug = compact_text(str(raw.get("slug") or "")).lower()
    min_players = int(raw.get("min_players") or 2)
    max_players = int(raw.get("max_players") or max(min_players, 4))
    playtime = int(raw.get("playtime_min") or 30)
    complexity = float(raw.get("complexity") or 2.0)

    candidates.extend(CATALOG_TAG_OVERRIDES.get(slug, []))
    for bga_tag in bga_tags:
        candidates.extend(BGA_TAG_TO_PROFILE_TAGS.get(bga_tag, []))

    if min_players <= 2 and max_players == 2:
        candidates.extend(["情侣约会", "安静对弈"] if complexity <= 2.0 else ["高互动对抗"])
    if max_players >= 6 and playtime <= 45:
        candidates.append("朋友聚会")
    if max_players >= 7:
        candidates.append("团建破冰")
    if complexity >= 2.8:
        candidates.append("烧脑策略")
    elif complexity <= 1.4:
        candidates.append("轻松休闲")
    if "Party game" in bga_tags:
        candidates.append("欢乐搞笑")
    if "Family" in bga_tags or "Cooperative" in bga_tags:
        candidates.append("低冲突友好")

    ordered = unique_preserve_order(candidates)
    buckets = {
        "occasion": [],
        "interaction": [],
        "mechanic": [],
        "mood": [],
        "theme": [],
        "other": [],
    }
    for tag in ordered:
        buckets[get_catalog_tag_bucket(tag)].append(tag)

    selected: list[str] = []
    for bucket_name in ["occasion", "interaction", "mechanic", "mood", "theme"]:
        if buckets[bucket_name]:
            selected.append(buckets[bucket_name][0])

    for tag in ordered:
        if tag not in selected and len(selected) < 4:
            selected.append(tag)

    if not selected:
        selected = ["烧脑策略"] if complexity >= 2.8 else ["轻松休闲"]
    return selected[:4]


def get_preferred_title_cn(raw: dict[str, Any], fallback: str) -> str:
    slug = compact_text(str(raw.get("slug") or "")).lower()
    override = KNOWN_CHINESE_TITLE_OVERRIDES.get(slug)
    if override:
        return override
    title_cn_hint = compact_text(str(raw.get("title_cn_hint") or ""))
    return title_cn_hint or fallback


def get_preferred_title_en(raw: dict[str, Any], fallback: str) -> str:
    slug = compact_text(str(raw.get("slug") or "")).lower()
    override = KNOWN_ENGLISH_TITLE_OVERRIDES.get(slug)
    if override:
        return override
    return fallback


def build_catalog_one_liner(raw: dict[str, Any]) -> str:
    min_players = int(raw.get("min_players") or 2)
    max_players = int(raw.get("max_players") or max(min_players, 4))
    playtime = int(raw.get("playtime_min") or 30)
    tags = derive_catalog_tags(raw)

    player_phrase = f"{min_players}人" if min_players == max_players else f"{min_players}-{max_players}人"
    theme_tag = next((tag for tag in tags if tag in THEME_TAGS), "")
    mechanic_tag = next((tag for tag in tags if tag in MECHANIC_TAGS), "")
    mood_tag = next((tag for tag in tags if tag in MOOD_TAGS), "")
    occasion_tag = next((tag for tag in tags if tag in OCCASION_TAGS), "")

    if theme_tag and mechanic_tag:
        focus_phrase = f"{theme_tag}主题的{mechanic_tag}"
    elif mechanic_tag:
        focus_phrase = mechanic_tag
    elif theme_tag:
        focus_phrase = f"{theme_tag}主题"
    elif mood_tag:
        focus_phrase = mood_tag
    else:
        focus_phrase = "现代"

    if occasion_tag == "朋友聚会":
        closing = "拿来朋友聚会通常很稳"
    elif occasion_tag == "团建破冰":
        closing = "很适合拿来破冰暖场"
    elif occasion_tag == "家庭同乐":
        closing = "带新手或家人上桌都比较友好"
    elif occasion_tag == "情侣约会":
        closing = "双人对玩也不会太有压力"
    elif mood_tag == "烧脑策略":
        closing = "更适合想认真动脑的玩家"
    else:
        closing = "上手后通常很容易形成自己的偏好"

    return f"一款适合{player_phrase}、约{playtime}分钟的{focus_phrase}桌游，{closing}。"


def build_catalog_game_from_raw(raw: dict[str, Any]) -> dict[str, Any]:
    title_en = get_preferred_title_en(raw, compact_text(str(raw.get("title_en") or raw.get("slug") or "")))
    title_cn = get_preferred_title_cn(raw, title_en)
    min_players = int(raw.get("min_players") or 2)
    max_players = int(raw.get("max_players") or max(min_players, 4))
    playtime_min = int(raw.get("playtime_min") or 30)
    complexity = float(raw.get("complexity") or 2.0)

    return {
        "id": compact_text(str(raw.get("slug") or title_en)).replace("_", "-"),
        "titleCn": title_cn or title_en,
        "titleEn": title_en,
        "coverUrl": compact_text(str(raw.get("cover_url") or "")),
        "minPlayers": min_players,
        "maxPlayers": max_players,
        "playtimeMin": playtime_min,
        "ageRating": guess_age_rating(raw),
        "complexity": round(complexity, 1),
        "tags": derive_catalog_tags(raw),
        "oneLiner": build_catalog_one_liner(raw),
        "rules": {"target": "", "flow": "", "tips": ""},
        "FAQ": "",
        "commonQuestions": [],
        "knowledgeBase": "",
        "tutorialVideoUrl": compact_text(
            str(
                raw.get("tutorial_video_url")
                or build_bilibili_search_url(raw.get("bilibili_search_query") or title_en)
            )
        ),
        "bilibiliId": compact_text(str(raw.get("bilibili_id") or "")),
        "bestPlayerCount": choose_best_player_count(min_players, max_players, raw.get("player_numbers") or []),
        "bggId": str(raw.get("bgg_id") or ""),
        "bggUrl": compact_text(str(raw.get("bgg_url") or "")),
        "knowledgeTier": "catalog",
    }


def build_bilibili_search_query(title_en: str) -> str:
    return f"{title_en} 桌游教学"


def build_bilibili_search_url(query: str) -> str:
    return f"https://search.bilibili.com/all?keyword={quote(query)}"


def normalize_search_query(query: str) -> str:
    normalized = re.sub(r"[^0-9A-Za-z\u4e00-\u9fff]+", " ", query)
    return compact_text(normalized)


def extract_bilibili_candidate_results(html: str) -> list[dict[str, str]]:
    raw_matches = re.findall(
        r'href="//www\.bilibili\.com/video/(BV[1-9A-HJ-NP-Za-km-z]{10})/".{0,2500}?bili-video-card__info--tit" title="([^"]+)"',
        html,
        re.S,
    )
    candidates: list[dict[str, str]] = []
    seen_ids: set[str] = set()
    for bilibili_id, raw_title in raw_matches:
        if bilibili_id in seen_ids:
            continue
        seen_ids.add(bilibili_id)
        candidates.append(
            {
                "bilibili_id": bilibili_id,
                "search_title": compact_text(decode_html_entities(raw_title)),
            }
        )
    return candidates


def score_bilibili_candidate(title: str, search_query: str) -> int:
    query_core = normalize_search_query(
        search_query.replace("桌游教学", "").replace("桌游规则", "").replace("桌游", "")
    )
    title_norm = normalize_search_query(title).lower()
    query_norm = query_core.lower()
    if not query_norm:
        return 0

    query_tokens = [token for token in query_norm.split() if len(token) >= 2]
    compact_query = query_norm.replace(" ", "")
    compact_title = title_norm.replace(" ", "")
    score = 0

    if query_norm in title_norm:
        score += 8
    if compact_query and compact_query in compact_title:
        score += 6

    matched_tokens = sum(1 for token in query_tokens if token in title_norm)
    score += matched_tokens * 2

    chinese_parts = re.findall(r"[\u4e00-\u9fff]{2,}", query_core)
    for part in chinese_parts:
        if part in title:
            score += 6

    if "桌游" in title or "桌遊" in title:
        score += 1
    return score


def extract_bilibili_match_from_html(html: str, search_query: str) -> dict[str, str]:
    candidates = extract_bilibili_candidate_results(html)
    if candidates:
        scored = sorted(
            (
                {
                    **candidate,
                    "_score": score_bilibili_candidate(candidate["search_title"], search_query),
                }
                for candidate in candidates
            ),
            key=lambda item: item["_score"],
            reverse=True,
        )
        if scored[0]["_score"] >= 4:
            return {
                "bilibili_id": scored[0]["bilibili_id"],
                "search_title": scored[0]["search_title"],
            }

    matches = unique_preserve_order(BV_PATTERN.findall(html))
    return {
        "bilibili_id": matches[0] if matches else "",
        "search_title": "",
    }


def find_bilibili_match(search_query: str) -> dict[str, str]:
    query_variants = unique_preserve_order(
        [
            search_query,
            normalize_search_query(search_query),
            normalize_search_query(search_query.replace("桌游教学", "桌游规则")),
            normalize_search_query(search_query.replace("桌游教学", "桌游")),
        ]
    )

    for query in query_variants:
        if not query:
            continue
        html = fetch_text(build_bilibili_search_url(query))
        match = extract_bilibili_match_from_html(html, query)
        if match.get("bilibili_id") or match.get("search_title"):
            return match

    ddg_query = f'site:bilibili.com "{search_query}"'
    search_url = f"https://html.duckduckgo.com/html/?{urlencode({'q': ddg_query})}"
    html = fetch_text(search_url)
    match = extract_bilibili_match_from_html(html, search_query)
    if match.get("bilibili_id") or match.get("search_title"):
        return match

    return {
        "bilibili_id": "",
        "search_title": "",
    }


def extract_title_cn_from_search_title(search_title: str) -> str:
    if not search_title:
        return ""

    quoted_match = re.search(r"[《“'‘]([^》”'’]{2,32})[》”'’]", search_title)
    if quoted_match:
        candidate = compact_text(quoted_match.group(1))
        if candidate and candidate not in CHINESE_TITLE_BLACKLIST:
            return candidate

    candidates = re.findall(r"[\u4e00-\u9fff]{2,24}", search_title)
    filtered: list[str] = []
    for candidate in candidates:
        normalized = compact_text(candidate)
        if not normalized:
            continue
        if normalized in CHINESE_TITLE_BLACKLIST:
            continue
        if any(fragment in normalized for fragment in CHINESE_TITLE_FRAGMENT_BLACKLIST):
            continue
        filtered.append(normalized)

    filtered.sort(key=len, reverse=True)
    return filtered[0] if filtered else ""


def harvest_bga_game(slug: str, tag_catalog: dict[int, str]) -> dict[str, Any]:
    source_url = f"https://en.boardgamearena.com/gamepanel?game={slug}"
    html = fetch_text(source_url)
    panel_fields = extract_panel_structured_fields(html, slug, tag_catalog)
    title_en = panel_fields.get("display_name_en") or extract_title_from_gamepanel(html, slug)
    player_numbers = panel_fields.get("player_numbers") or []
    min_players = min(player_numbers) if player_numbers else None
    max_players = max(player_numbers) if player_numbers else None
    complexity = normalize_complexity(extract_complexity(html), panel_fields.get("tag_names") or [])
    playtime_min = normalize_playtime_min(
        panel_fields.get("average_duration") or extract_int(html, "Game duration", "mn"),
        panel_fields.get("tag_names") or [],
        complexity,
    )
    description = extract_presentation_text(html)
    rules_excerpt = extract_rules_excerpt(html)
    bilibili_search_query = build_bilibili_search_query(title_en)
    bilibili_match = find_bilibili_match(bilibili_search_query)

    return {
        "slug": slug,
        "source": "boardgamearena",
        "source_url": source_url,
        "source_policy": SOURCE_POLICY,
        "title_en": title_en,
        "title_cn_hint": extract_title_cn_from_search_title(bilibili_match.get("search_title", "")),
        "cover_url": panel_fields.get("box_url") or extract_cover_url(html),
        "min_players": min_players,
        "max_players": max_players,
        "player_numbers": player_numbers,
        "playtime_min": playtime_min,
        "complexity": complexity,
        "bga_tag_names": panel_fields.get("tag_names") or [],
        "bga_tag_ids": panel_fields.get("tag_ids") or [],
        "bgg_id": panel_fields.get("bgg_id") or 0,
        "bgg_url": f"https://boardgamegeek.com/boardgame/{panel_fields.get('bgg_id')}" if panel_fields.get("bgg_id") else "",
        "description": description,
        "rules_excerpt": rules_excerpt,
        "bilibili_search_query": bilibili_search_query,
        "bilibili_id": bilibili_match.get("bilibili_id", ""),
        "bilibili_search_title": bilibili_match.get("search_title", ""),
        "tutorial_video_url": build_bilibili_search_url(bilibili_search_query),
        "collected_at": int(time.time()),
    }


def resolve_llm_config() -> LLMConfig:
    base_url = os.getenv("KB_EXPANDER_LLM_BASE_URL") or os.getenv("LLM_BASE_URL")
    api_key = os.getenv("KB_EXPANDER_LLM_API_KEY") or os.getenv("LLM_API_KEY")
    model = (
        os.getenv("KB_EXPANDER_LLM_MODEL")
        or os.getenv("LLM_MODEL")
        or "gpt-4o-mini"
    )

    if not base_url or not api_key:
        raise SystemExit(
            "LLM config missing. Set KB_EXPANDER_LLM_BASE_URL / KB_EXPANDER_LLM_API_KEY "
            "or LLM_BASE_URL / LLM_API_KEY before running enrich."
        )

    return LLMConfig(
        base_url=base_url.rstrip("/"),
        api_key=api_key,
        model=model,
    )


def call_chat_completion(config: LLMConfig, messages: list[dict[str, str]]) -> str:
    url = f"{config.base_url}/chat/completions"
    body = json.dumps(
        {
            "model": config.model,
            "messages": messages,
            "temperature": 0.2,
            "max_tokens": 1800,
        }
    ).encode("utf-8")
    response_text = fetch_text(
        url,
        data=body,
        headers={
            "Authorization": f"Bearer {config.api_key}",
            "Content-Type": "application/json",
        },
    )
    payload = json.loads(response_text)
    return payload["choices"][0]["message"]["content"]


def parse_json_object(text: str) -> dict[str, Any]:
    cleaned = text.replace("```json", "").replace("```", "").strip()
    first_brace = cleaned.find("{")
    last_brace = cleaned.rfind("}")
    candidates = [cleaned]
    if first_brace != -1 and last_brace > first_brace:
        candidates.append(cleaned[first_brace:last_brace + 1])

    for candidate in candidates:
        if not candidate:
            continue
        try:
            return json.loads(candidate)
        except json.JSONDecodeError:
            continue

    raise ValueError("Model response did not contain valid JSON")


def build_enrichment_messages(raw: dict[str, Any]) -> list[dict[str, str]]:
    system = """
你在为一个中文桌游推荐/RAG项目补全游戏资料。
请根据给定的原始来源信息，输出严格 JSON，对齐当前前端 Game 结构。

规则：
1. 回复只能是 JSON 对象，不要包 Markdown。
2. 不要编造 BGG 数据，bggId 和 bggUrl 一律留空字符串。
3. 尽量使用常见中文桌游名；如果没有稳定中文名，再给出自然中文翻译。
4. tags 保持 2 到 4 个，偏人类可读、简短、能展示在卡片上。
5. rules / FAQ / knowledgeBase 要通俗、可直接给中文玩家使用。
6. 如果来源没有明确给出年龄，请给一个保守且合理的估计。
7. bestPlayerCount 必须落在 minPlayers 和 maxPlayers 范围内。
8. bilibiliId / tutorialVideoUrl 优先使用输入里的值。

输出字段：
id, titleCn, titleEn, coverUrl, minPlayers, maxPlayers, playtimeMin, ageRating,
complexity, tags, oneLiner, rules, FAQ, commonQuestions, knowledgeBase,
tutorialVideoUrl, bilibiliId, bestPlayerCount, bggId, bggUrl
""".strip()

    user = json.dumps(raw, ensure_ascii=False, indent=2)
    return [
        {"role": "system", "content": system},
        {"role": "user", "content": user},
    ]


def merge_raw_and_model(raw: dict[str, Any], model_output: dict[str, Any]) -> dict[str, Any]:
    catalog_defaults = build_catalog_game_from_raw(raw)

    def pick(key: str, fallback: Any) -> Any:
        value = model_output.get(key)
        if value in (None, "", [], {}):
            return fallback
        return value

    title_en = pick("titleEn", catalog_defaults["titleEn"])
    bilibili_id = raw.get("bilibili_id") or pick("bilibiliId", "")
    tutorial_video_url = raw.get("tutorial_video_url") or pick(
        "tutorialVideoUrl",
        build_bilibili_search_url(raw.get("bilibili_search_query", title_en)),
    )

    return {
        "id": pick("id", catalog_defaults["id"]).replace("_", "-"),
        "titleCn": pick("titleCn", get_preferred_title_cn(raw, catalog_defaults["titleCn"])),
        "titleEn": title_en,
        "coverUrl": raw.get("cover_url") or pick("coverUrl", catalog_defaults["coverUrl"]),
        "minPlayers": int(raw.get("min_players") or pick("minPlayers", catalog_defaults["minPlayers"])),
        "maxPlayers": int(raw.get("max_players") or pick("maxPlayers", catalog_defaults["maxPlayers"])),
        "playtimeMin": int(raw.get("playtime_min") or pick("playtimeMin", catalog_defaults["playtimeMin"])),
        "ageRating": int(pick("ageRating", catalog_defaults["ageRating"])),
        "complexity": float(raw.get("complexity") or pick("complexity", catalog_defaults["complexity"])),
        "tags": pick("tags", catalog_defaults["tags"]),
        "oneLiner": pick("oneLiner", catalog_defaults["oneLiner"]),
        "rules": pick("rules", catalog_defaults["rules"]),
        "FAQ": pick("FAQ", ""),
        "commonQuestions": pick("commonQuestions", []),
        "knowledgeBase": pick("knowledgeBase", ""),
        "tutorialVideoUrl": tutorial_video_url,
        "bilibiliId": bilibili_id,
        "bestPlayerCount": pick("bestPlayerCount", catalog_defaults["bestPlayerCount"]),
        "bggId": str(raw.get("bgg_id") or pick("bggId", catalog_defaults["bggId"])),
        "bggUrl": raw.get("bgg_url") or pick("bggUrl", catalog_defaults["bggUrl"]),
        "knowledgeTier": "catalog",
    }


def build_review_notes(raw: dict[str, Any], game: dict[str, Any]) -> list[str]:
    notes = [
        "Review Chinese title and display tags before rendering into runtime TS.",
        "Auto-expansion entries default to catalog tier and must not be treated as referee-grade rules.",
    ]
    if not raw.get("bilibili_id"):
        notes.append("No BV id resolved automatically; keep the search URL fallback or review manually.")
    if game.get("titleCn") == game.get("titleEn"):
        notes.append("Chinese title equals English title; likely needs localization review.")
    return notes


def render_ts_file(output_path: Path, games: list[dict[str, Any]]) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    body = json.dumps(games, ensure_ascii=False, indent=2)
    output_path.write_text(
        "import type { Game } from '@/types';\n\n"
        "// Auto-generated by scripts/boardgame_source_expander.py.\n"
        "export const GAME_DATABASE_AUTO_EXPANSION: Game[] = "
        f"{body};\n",
        encoding="utf-8",
    )


def command_harvest(args: argparse.Namespace) -> None:
    slugs = load_slug_inputs(args.slug or [], args.slug_file, args.discover_featured)
    if not slugs:
        raise SystemExit("No slugs provided. Use --slug, --slug-file, or --discover-featured.")

    tag_catalog = load_bga_tag_catalog()
    records: list[dict[str, Any]] = []
    for index, slug in enumerate(slugs, start=1):
        print(f"[harvest] ({index}/{len(slugs)}) {slug}", file=sys.stderr)
        try:
            records.append(harvest_bga_game(slug, tag_catalog))
        except (HTTPError, URLError, TimeoutError) as error:
            print(f"[harvest] skip {slug}: {error}", file=sys.stderr)
        time.sleep(args.delay_seconds)

    write_jsonl(Path(args.output), records)
    print(json.dumps({"output": args.output, "records": len(records)}, ensure_ascii=False))


def command_enrich(args: argparse.Namespace) -> None:
    config = resolve_llm_config()
    raw_records = read_jsonl(Path(args.input))
    if args.limit:
        raw_records = raw_records[: args.limit]

    enriched_records: list[dict[str, Any]] = []
    for index, raw in enumerate(raw_records, start=1):
        print(f"[enrich] ({index}/{len(raw_records)}) {raw.get('slug')}", file=sys.stderr)
        response_text = call_chat_completion(config, build_enrichment_messages(raw))
        model_output = parse_json_object(response_text)
        game = merge_raw_and_model(raw, model_output)
        enriched_records.append(
            {
                "game": game,
                "provenance": raw,
                "needs_review": True,
                "review_notes": build_review_notes(raw, game),
            }
        )
        time.sleep(args.delay_seconds)

    write_jsonl(Path(args.output), enriched_records)
    print(json.dumps({"output": args.output, "records": len(enriched_records)}, ensure_ascii=False))


def command_render_ts(args: argparse.Namespace) -> None:
    records = read_jsonl(Path(args.input))
    existing_keys = load_existing_runtime_keys()
    games: list[dict[str, Any]] = []
    rendered_keys: set[str] = set()
    skipped_existing = 0
    skipped_duplicates = 0

    for record in records:
        if "game" in record and isinstance(record["game"], dict):
            provenance = record.get("provenance") if isinstance(record.get("provenance"), dict) else {}
            game = merge_raw_and_model(provenance, record["game"]) if provenance else record["game"]
        elif isinstance(record, dict):
            if "slug" in record:
                game = build_catalog_game_from_raw(record)
            else:
                game = record
        else:
            continue

        lookup_keys = {
            normalize_lookup_key(str(game.get("id", ""))),
            normalize_lookup_key(str(game.get("titleCn", ""))),
            normalize_lookup_key(str(game.get("titleEn", ""))),
        }
        lookup_keys.discard("")

        if lookup_keys & existing_keys:
            skipped_existing += 1
            continue
        if lookup_keys & rendered_keys:
            skipped_duplicates += 1
            continue

        rendered_keys.update(lookup_keys)
        games.append(game)

    games.sort(key=lambda item: str(item.get("titleEn", item.get("id", ""))).lower())
    render_ts_file(Path(args.output), games)
    print(
        json.dumps(
            {
                "output": args.output,
                "records": len(games),
                "skipped_existing": skipped_existing,
                "skipped_duplicates": skipped_duplicates,
            },
            ensure_ascii=False,
        )
    )


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Expand the board-game library from approved public sources.")
    subparsers = parser.add_subparsers(dest="command", required=True)

    harvest_parser = subparsers.add_parser("harvest", help="Harvest raw source metadata from Board Game Arena.")
    harvest_parser.add_argument("--slug", action="append", default=[], help="Board Game Arena slug, can be repeated.")
    harvest_parser.add_argument("--slug-file", help="Path to a newline-delimited slug file.")
    harvest_parser.add_argument("--discover-featured", action="store_true", help="Append currently visible featured slugs from BGA gamelist.")
    harvest_parser.add_argument("--output", required=True, help="Output JSONL path.")
    harvest_parser.add_argument("--delay-seconds", type=float, default=DEFAULT_DELAY_SECONDS, help="Delay between requests.")
    harvest_parser.set_defaults(func=command_harvest)

    enrich_parser = subparsers.add_parser("enrich", help="Use an LLM to transform raw source metadata into Game-shaped review records.")
    enrich_parser.add_argument("--input", required=True, help="Input raw JSONL path.")
    enrich_parser.add_argument("--output", required=True, help="Output review JSONL path.")
    enrich_parser.add_argument("--limit", type=int, help="Optional record limit for small batches.")
    enrich_parser.add_argument("--delay-seconds", type=float, default=0.6, help="Delay between model calls.")
    enrich_parser.set_defaults(func=command_enrich)

    render_parser = subparsers.add_parser("render-ts", help="Render reviewed candidate records into runtime TypeScript.")
    render_parser.add_argument("--input", required=True, help="Input review JSONL path.")
    render_parser.add_argument("--output", required=True, help="Output TS path.")
    render_parser.set_defaults(func=command_render_ts)

    return parser


def main() -> None:
    parser = build_parser()
    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
