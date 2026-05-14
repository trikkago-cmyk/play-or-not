import type { Game } from '../types';

export interface UserPreferenceEvidence {
    text: string;
    weight: number;
    timestamp: number;
}

export interface UserPreference {
    likedTags: Record<string, number>;
    dislikedTags: Record<string, number>;
    likedGames: string[];
    dislikedGames: string[];
    preferredPlayerCounts: Record<string, number>;
    preferredDurations: Record<string, number>;
    preferredComplexities: Record<string, number>;
    evidence: UserPreferenceEvidence[];
    updatedAt?: number;
}

const MEMORY_STORAGE_KEY = 'dm_agent_memory';
const MEMORY_STORAGE_PREFIX = 'dm_agent_memory_v2';

let activeMemoryOwner = 'anonymous';

function normalizeOwner(ownerKey?: string): string {
    const normalized = ownerKey?.trim().toLowerCase();
    return normalized || 'anonymous';
}

function getMemoryStorageKey(ownerKey?: string): string {
    return `${MEMORY_STORAGE_PREFIX}:${normalizeOwner(ownerKey ?? activeMemoryOwner)}`;
}

function normalizeMemory(memory: Partial<UserPreference> = {}): UserPreference {
    return {
        likedTags: memory.likedTags ?? {},
        dislikedTags: memory.dislikedTags ?? {},
        likedGames: memory.likedGames ?? [],
        dislikedGames: memory.dislikedGames ?? [],
        preferredPlayerCounts: memory.preferredPlayerCounts ?? {},
        preferredDurations: memory.preferredDurations ?? {},
        preferredComplexities: memory.preferredComplexities ?? {},
        evidence: Array.isArray(memory.evidence) ? memory.evidence.slice(-20) : [],
        updatedAt: typeof memory.updatedAt === 'number' ? memory.updatedAt : undefined,
    };
}

export function setActiveMemoryOwner(ownerKey?: string) {
    activeMemoryOwner = normalizeOwner(ownerKey);
}

export function getUserMemory(ownerKey?: string): UserPreference {
    try {
        const raw = localStorage.getItem(getMemoryStorageKey(ownerKey));
        if (raw) {
            return normalizeMemory(JSON.parse(raw) as Partial<UserPreference>);
        }

        // One-time compatibility read for older anonymous local data.
        const legacyRaw = localStorage.getItem(MEMORY_STORAGE_KEY);
        if (legacyRaw && normalizeOwner(ownerKey ?? activeMemoryOwner) === 'anonymous') {
            return normalizeMemory(JSON.parse(legacyRaw) as Partial<UserPreference>);
        }
    } catch (e) {
        console.warn('Failed to parse user memory', e);
    }

    return normalizeMemory();
}

export function saveUserMemory(memory: UserPreference, ownerKey?: string) {
    try {
        localStorage.setItem(getMemoryStorageKey(ownerKey), JSON.stringify({
            ...normalizeMemory(memory),
            updatedAt: Date.now(),
        }));
    } catch (e) {
        console.error('Failed to save user memory', e);
    }
}

export function replaceUserMemory(memory: Partial<UserPreference> | null | undefined, ownerKey?: string) {
    saveUserMemory(normalizeMemory(memory ?? {}), ownerKey);
}

function getPreferenceTags(game: Game): string[] {
    return game.recommendationProfile?.allTags ?? game.tags;
}

function bumpCounter(counter: Record<string, number>, key: string, delta = 1) {
    if (!key.trim()) {
        return;
    }

    counter[key] = Math.max(0, (counter[key] ?? 0) + delta);
    if (counter[key] === 0) {
        delete counter[key];
    }
}

function pushEvidence(memory: UserPreference, text: string, weight: number) {
    const compact = text.replace(/\s+/g, ' ').trim();
    if (!compact) {
        return;
    }

    memory.evidence = [
        ...memory.evidence,
        {
            text: compact.slice(0, 80),
            weight,
            timestamp: Date.now(),
        },
    ].slice(-20);
}

// 当玩家在详情页点赞游戏时调用，强化长期偏好
export function recordGameLike(game: Game, ownerKey?: string) {
    const memory = getUserMemory(ownerKey);

    if (!memory.likedGames.includes(game.id)) {
        memory.likedGames.push(game.id);
        memory.dislikedGames = memory.dislikedGames.filter(id => id !== game.id);

        getPreferenceTags(game).forEach(tag => {
            bumpCounter(memory.likedTags, tag, 1);
        });

        pushEvidence(memory, `收藏了《${game.titleCn}》`, 1);
        saveUserMemory(memory, ownerKey);
    }
}

// 当玩家取消点赞时调用，衰减特征权重
export function recordGameUnlike(game: Game, ownerKey?: string) {
    const memory = getUserMemory(ownerKey);

    const index = memory.likedGames.indexOf(game.id);
    if (index > -1) {
        memory.likedGames.splice(index, 1);

        getPreferenceTags(game).forEach(tag => {
            bumpCounter(memory.likedTags, tag, -1);
        });

        saveUserMemory(memory, ownerKey);
    }
}

function extractStablePreferenceSignals(input: string) {
    const positiveTags: string[] = [];
    const negativeTags: string[] = [];
    const playerCounts: string[] = [];
    const durations: string[] = [];
    const complexities: string[] = [];
    const text = input.trim();

    const stablePositive = /(我喜欢|我偏好|我更喜欢|以后.*推荐|下次.*推荐|适合我|常玩|爱玩)/.test(text);
    const stableNegative = /(我不喜欢|不爱玩|以后别|下次别|别再推荐|不适合我)/.test(text);

    const addTagSignals = (target: string[]) => {
        if (/阵营|身份|狼人|阿瓦隆|血染钟楼/.test(text)) target.push('阵营推理');
        if (/聚会|热闹|气氛|破冰/.test(text)) target.push('朋友聚会');
        if (/合作|协作|一起/.test(text)) target.push('合作共赢');
        if (/互坑|捉弄|搞人|嘴炮|谈判/.test(text)) target.push('高互动对抗');
        if (/策略|烧脑|逻辑|推理/.test(text)) target.push('烧脑策略');
        if (/轻松|休闲|简单|上手快/.test(text)) target.push('轻松休闲');
        if (/纸笔|画画|写写|图图/.test(text)) target.push('纸笔规划');
    };

    if (stablePositive) {
        addTagSignals(positiveTags);
    }
    if (stableNegative || /(不要|别|不想)[^，。；,.]{0,12}(阵营|身份|重策|烧脑|纸笔|画画|写写|互坑)/.test(text)) {
        addTagSignals(negativeTags);
    }

    const playerMatch = text.match(/(?:经常|通常|一般|平时|长期|以后)[^，。；,.]{0,8}(\d+)\s*(?:人|个人)/);
    if (playerMatch) {
        playerCounts.push(`${Number(playerMatch[1])}人`);
    }

    if (/(经常|通常|一般|平时|长期|以后).*(半小时|30\s*分钟)/.test(text)) {
        durations.push('30分钟内');
    } else if (/(经常|通常|一般|平时|长期|以后).*(一小时|60\s*分钟)/.test(text)) {
        durations.push('60分钟内');
    }

    if (stablePositive && /轻松|简单|新手|上手快/.test(text)) {
        complexities.push('轻策略');
    }
    if (stablePositive && /烧脑|重策|深度|硬核/.test(text)) {
        complexities.push('重策略');
    }

    return {
        positiveTags,
        negativeTags,
        playerCounts,
        durations,
        complexities,
        hasStableSignal: stablePositive || stableNegative,
    };
}

export function recordPreferenceFromUserTurn(input: string, ownerKey?: string) {
    const signals = extractStablePreferenceSignals(input);
    if (!signals.hasStableSignal && signals.negativeTags.length === 0) {
        return;
    }

    const memory = getUserMemory(ownerKey);

    signals.positiveTags.forEach(tag => bumpCounter(memory.likedTags, tag, 1));
    signals.negativeTags.forEach(tag => bumpCounter(memory.dislikedTags, tag, 1));
    signals.playerCounts.forEach(count => bumpCounter(memory.preferredPlayerCounts, count, 1));
    signals.durations.forEach(duration => bumpCounter(memory.preferredDurations, duration, 1));
    signals.complexities.forEach(complexity => bumpCounter(memory.preferredComplexities, complexity, 1));
    pushEvidence(memory, input, signals.hasStableSignal ? 1 : 0.5);
    saveUserMemory(memory, ownerKey);
}

function topEntries(counter: Record<string, number>, limit: number) {
    return Object.entries(counter)
        .filter(([, score]) => score > 0)
        .sort((a, b) => b[1] - a[1])
        .slice(0, limit)
        .map(entry => entry[0]);
}

// 格式化当前长线记忆，用于注入大模型的 Prompt 中
export function getPersistentContextForPrompt(ownerKey?: string): string {
    const memory = getUserMemory(ownerKey);
    const topTags = topEntries(memory.likedTags, 5);
    const dislikedTags = topEntries(memory.dislikedTags, 5);
    const playerCounts = topEntries(memory.preferredPlayerCounts, 3);
    const durations = topEntries(memory.preferredDurations, 3);
    const complexities = topEntries(memory.preferredComplexities, 3);

    if (
        topTags.length === 0
        && dislikedTags.length === 0
        && playerCounts.length === 0
        && durations.length === 0
        && complexities.length === 0
        && memory.likedGames.length === 0
        && memory.dislikedGames.length === 0
    ) {
        return "";
    }

    let promptContext = "【长期账号偏好记忆】\n以下是这名玩家跨会话积累的偏好信号。它们只能作为排序倾向，不能覆盖用户本轮明确提出的人数、时长、年龄、复杂度等硬约束：\n";

    if (topTags.length > 0) {
        promptContext += `- 偏好的体验/机制：${topTags.join('、')}。\n`;
    }
    if (dislikedTags.length > 0) {
        promptContext += `- 明确不喜欢或希望少推荐：${dislikedTags.join('、')}。\n`;
    }
    if (playerCounts.length > 0) {
        promptContext += `- 常见组局人数：${playerCounts.join('、')}。\n`;
    }
    if (durations.length > 0) {
        promptContext += `- 常见时长偏好：${durations.join('、')}。\n`;
    }
    if (complexities.length > 0) {
        promptContext += `- 常见复杂度偏好：${complexities.join('、')}。\n`;
    }
    if (memory.likedGames.length > 0) {
        promptContext += `- 曾收藏/点赞游戏 ID：${memory.likedGames.join('、')}。\n`;
    }
    if (memory.dislikedGames.length > 0) {
        promptContext += `- 曾明确不喜欢游戏 ID：${memory.dislikedGames.join('、')}。\n`;
    }

    promptContext += "请在候选排序和话术风格上参考这些偏好，但本轮用户明确需求永远优先。\n\n";

    return promptContext;
}
