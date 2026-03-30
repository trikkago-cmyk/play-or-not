import {
    documentationResponse,
    jsonResponse,
    methodNotAllowed,
    optionsResponse,
    type EndpointDoc,
    validationError,
} from './_lib/agentDocs.js';

export const config = {
    runtime: 'edge', // Use Edge runtime for better performance
};

const CHAT_DOC: EndpointDoc = {
    endpoint: '/api/chat',
    title: '桌游推荐与规则问答接口',
    description: '面向桌游推荐、规则解释和裁判追问的聊天接口。POST 使用 JSON 请求体，GET 返回接口说明。',
    allowedMethods: ['GET', 'POST', 'OPTIONS'],
    requestContentType: 'application/json',
    requiredFields: ['messages'],
    optionalFields: {
        task: '可选，推荐的任务类型：recommend_game、explain_rules、referee_followup。',
        model: '可选，上游模型名称；默认使用服务端配置或默认值。',
        max_tokens: '可选，最大输出 token 数，默认 1000。',
        temperature: '可选，采样温度；推荐推荐模式 0.7、规则问答更低。',
        providerBaseUrl: '可选，上游兼容 OpenAI chat completions 的 base URL。',
        userApiKey: '可选，自带上游 API key；若服务端已配置则可省略。',
    },
    capabilities: [
        '根据人数、时长、氛围推荐桌游',
        '解释规则、胜利条件、平局和常见问题',
        '支持持续追问，适合作为桌游 DM / 裁判助手',
    ],
    limitations: [
        '当前接口不公开创建账号、写入用户偏好或持久化会话状态。',
        '当前没有公开的 OAuth、service account 或 API key 管理页。',
        '返回结果为上游聊天补全格式透传，字段可能随模型提供方略有差异。',
    ],
    notes: [
        '若只想先了解怎么调用，直接 GET /api/chat 即可获得机器可读说明。',
        '更多站点说明见 /developers/，结构化 schema 见 /openapi.json。',
    ],
    authentication: '公开服务端接口；当前没有公开的 API key 发放页或 service account。',
    statefulness: '接口本身无状态。若需要持续对话，调用方应自行携带完整 messages 历史。',
    recommendedTasks: [
        {
            id: 'recommend_game',
            title: '桌游推荐',
            description: '根据人数、时长、氛围和场景推荐合适桌游。',
            examplePrompt: '推荐一个适合 4 人破冰、30 分钟内能讲完规则的桌游',
        },
        {
            id: 'explain_rules',
            title: '规则解释',
            description: '解释某个桌游的规则、胜利条件、平局处理和常见问题。',
            examplePrompt: '德国心脏病怎么赢？',
        },
        {
            id: 'referee_followup',
            title: '裁判追问',
            description: '围绕一局正在进行的游戏继续追问特定细节。',
            examplePrompt: '如果两个人同时拍牌，德国心脏病怎么算？',
        },
    ],
    exampleRequest: {
        task: 'recommend_game',
        messages: [
            {
                role: 'user',
                content: '推荐一个适合 4 人破冰、30 分钟内能讲完规则的桌游',
            },
        ],
        temperature: 0.7,
        max_tokens: 800,
    },
    exampleResponse: {
        choices: [
            {
                message: {
                    role: 'assistant',
                    content: '可以试试《德国心脏病》或《机密代号》，都很适合 4 人破冰。',
                },
            },
        ],
    },
};

export default async function handler(req: Request) {
    if (req.method === 'OPTIONS') {
        return optionsResponse(CHAT_DOC);
    }

    if (req.method === 'GET') {
        return documentationResponse(CHAT_DOC);
    }

    if (req.method !== 'POST') {
        return methodNotAllowed(req.method, CHAT_DOC);
    }

    try {
        const contentType = req.headers.get('content-type') || '';
        if (!contentType.includes('application/json')) {
            return validationError(
                CHAT_DOC,
                'unsupported_content_type',
                'POST /api/chat requires application/json.',
                'Send a JSON body with a non-empty messages array.',
                { received_content_type: contentType || 'none' },
                415,
            );
        }

        const body = await req.json().catch(() => null);
        if (!body || typeof body !== 'object') {
            return validationError(
                CHAT_DOC,
                'invalid_json',
                'Request body must be valid JSON.',
                'POST /api/chat with {"messages":[{"role":"user","content":"推荐一个 4 人破冰桌游"}]}.',
            );
        }

        const { model, messages, max_tokens, temperature, providerBaseUrl, userApiKey, task } = body;
        if (!Array.isArray(messages) || messages.length === 0) {
            return validationError(
                CHAT_DOC,
                'missing_parameter',
                'Request body must include a non-empty messages array.',
                'Provide messages like [{"role":"user","content":"德国心脏病怎么赢？"}].',
                {
                    required_fields: CHAT_DOC.requiredFields,
                },
            );
        }

        const supportedTasks = new Set(['recommend_game', 'explain_rules', 'referee_followup']);
        if (typeof task !== 'undefined' && (typeof task !== 'string' || !supportedTasks.has(task))) {
            return validationError(
                CHAT_DOC,
                'invalid_task',
                'Unsupported task value.',
                'Use one of: recommend_game, explain_rules, referee_followup. Or omit task entirely.',
                { received_task: task },
            );
        }

        const resolvedTemperature = typeof temperature === 'number'
            ? temperature
            : task === 'recommend_game'
                ? 0.7
                : 0.2;

        // Read secure credentials from Vercel Environment Variables
        // Fallback to the provided key ONLY IF env is not set (for seamless migration)
        const apiKey = userApiKey || process.env.LLM_API_KEY || '8fdd5782-0a66-40b7-9a0d-88b755c4a5bc';
        const baseUrl = providerBaseUrl || process.env.LLM_BASE_URL || 'https://ark.cn-beijing.volces.com/api/v3';

        const response = await fetch(`${baseUrl}/chat/completions`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                model: model || 'doubao-1-5-pro-32k-250115',
                messages,
                max_tokens: max_tokens || 1000,
                temperature: resolvedTemperature
            }),
        });

        if (!response.ok) {
            const errorText = await response.text();
            return jsonResponse({
                error: errorText,
                code: 'upstream_error',
                provider_base_url: baseUrl,
                hint: 'Check the upstream model name, credentials, and request shape. GET /api/chat for the local contract.',
            }, {
                status: response.status,
            });
        }

        const data = await response.json();

        return jsonResponse(data, { status: 200 });

    } catch (error: any) {
        return jsonResponse({
            error: error.message,
            code: 'internal_error',
            hint: 'If this keeps happening, check /developers/ for endpoint usage and verify upstream provider settings.',
        }, {
            status: 500,
        });
    }
}
