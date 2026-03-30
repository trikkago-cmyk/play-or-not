import type { Game } from '../types';

interface UserPreference {
    likedTags: Record<string, number>; // tag -> weight
    likedGames: string[]; // game IDs
    dislikedGames: string[];
}

const MEMORY_STORAGE_KEY = 'dm_agent_memory';

export function getUserMemory(): UserPreference {
    try {
        const raw = localStorage.getItem(MEMORY_STORAGE_KEY);
        if (raw) {
            return JSON.parse(raw) as UserPreference;
        }
    } catch (e) {
        console.warn('Failed to parse user memory', e);
    }

    // Default empty memory
    return {
        likedTags: {},
        likedGames: [],
        dislikedGames: [],
    };
}

export function saveUserMemory(memory: UserPreference) {
    try {
        localStorage.setItem(MEMORY_STORAGE_KEY, JSON.stringify(memory));
    } catch (e) {
        console.error('Failed to save user memory', e);
    }
}

function getPreferenceTags(game: Game): string[] {
    return game.recommendationProfile?.allTags ?? game.tags;
}

// 当玩家在详情页点赞游戏时调用，强化长期偏好
export function recordGameLike(game: Game) {
    const memory = getUserMemory();

    if (!memory.likedGames.includes(game.id)) {
        memory.likedGames.push(game.id);

        // 强化该游戏的标签特征权重
        getPreferenceTags(game).forEach(tag => {
            if (!memory.likedTags[tag]) {
                memory.likedTags[tag] = 0;
            }
            memory.likedTags[tag] += 1;
        });

        saveUserMemory(memory);
    }
}

// 当玩家取消点赞时调用，衰减特征权重
export function recordGameUnlike(game: Game) {
    const memory = getUserMemory();

    const index = memory.likedGames.indexOf(game.id);
    if (index > -1) {
        memory.likedGames.splice(index, 1);

        getPreferenceTags(game).forEach(tag => {
            if (memory.likedTags[tag] && memory.likedTags[tag] > 0) {
                memory.likedTags[tag] -= 1;
                // Clean up empty tags
                if (memory.likedTags[tag] === 0) {
                    delete memory.likedTags[tag];
                }
            }
        });

        saveUserMemory(memory);
    }
}

// 格式化当前长线记忆，用于注入大模型的 Prompt 中
export function getPersistentContextForPrompt(): string {
    const memory = getUserMemory();

    // Pick top 3 preferred tags
    const topTags = Object.entries(memory.likedTags)
        .sort((a, b) => b[1] - a[1]) // Sort by weight descending
        .slice(0, 3)
        .map(entry => entry[0]);

    if (topTags.length === 0 && memory.likedGames.length === 0) {
        return ""; // 没有任何长期记忆积累
    }

    let promptContext = "【系统提示：长期个性化偏好库 (Long-term Asset Library)】\n以下是这名玩家跨会话积累的个性化记忆资产：\n";

    if (topTags.length > 0) {
        promptContext += `- 玩家偏好的游戏核心机制/标签：${topTags.join('、')}。\n`;
    }
    if (memory.likedGames.length > 0) {
        promptContext += `- 玩家曾经点赞/收藏过这几款游戏（供参考寻找类似代餐）：${memory.likedGames.join('、')}\n`;
    }

    promptContext += "请你在推荐时尽可能迎合上述长期记忆偏好（如果用户的当下询问没有严格相反要求的话）。\n\n";

    return promptContext;
}
