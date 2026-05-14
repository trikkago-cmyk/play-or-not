import {
    documentationResponse,
    jsonResponse,
    methodNotAllowed,
    optionsResponse,
    type EndpointDoc,
    validationError,
} from './_lib/agentDocs.js';

export const config = {
    runtime: 'edge',
};

const ARK_BASE_URL = 'https://ark.cn-beijing.volces.com/api/v3';
const DEFAULT_ARK_RESPONSES_MODEL = 'deepseek-v3-2-251201';
const DEFAULT_ARK_CHAT_MODEL = 'deepseek-v3-2-251201';
const DEFAULT_MAX_TOKENS = 1000;
const UPSTREAM_TIMEOUT_MS = 15000;
const ARK_RESPONSES_MODELS = new Set([
    'deepseek-v3-2-251201',
    'doubao-seed-2-0-mini-260428',
    'doubao-seed-2-0-pro-260215',
]);

type ChatMessage = {
    role?: string;
    content?: unknown;
};

type ResponseInputPart = {
    type: string;
    [key: string]: unknown;
};

type ArkResponseTool = {
    type: 'web_search';
    max_keyword?: number;
};

const DEFAULT_DM_SYSTEM_PROMPT = [
    '你叫“DM 洛思”，是一个热情、直率、懂气氛的桌游 DM。',
    '始终使用简体中文，像一个懂桌游、会带场子的朋友一样说话。',
    '不要自称 DeepSeek、豆包、GLM、AI 模型或其他供应商身份。',
    '闲聊时简短回应，并自然把话题引回桌游推荐或规则裁判。',
    '推荐游戏时每轮只推荐 1 款，先讲为什么适合当前用户意图，再给 2 到 3 个短亮点，最后自然收尾。',
    '裁判回答要先给结论，再用人话解释关键规则；不要泄露内部检索、候选池、参考依据或模型思考过程。',
].join('\n');

const CHAT_DOC: EndpointDoc = {
    endpoint: '/api/chat',
    title: '桌游推荐与规则问答接口',
    description: '面向桌游推荐、规则解释和裁判追问的聊天接口。POST 使用 JSON 请求体，GET 返回接口说明。',
    allowedMethods: ['GET', 'POST', 'OPTIONS'],
    requestContentType: 'application/json',
    requiredFields: ['messages | input'],
    optionalFields: {
        task: '可选，推荐的任务类型：recommend_game、explain_rules、referee_followup。',
        model: '可选，上游模型名称；默认使用服务端配置或默认值。',
        max_tokens: '可选，最大输出 token 数，默认 1000。',
        temperature: '可选，采样温度；推荐推荐模式 0.7、规则问答更低。',
        input: '可选，直接透传给 Ark Responses API 的 input 结构，适合多模态或自定义消息格式。',
        stream: '可选，true 时透传上游 SSE 流。',
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
        '服务端会把 Ark Responses API 结果归一成 chat completions 风格，便于前端兼容。',
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

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeRole(role: unknown): 'system' | 'user' | 'assistant' {
    if (role === 'system' || role === 'assistant' || role === 'user') {
        return role;
    }

    return 'user';
}

function normalizeResponseInputPart(part: unknown): ResponseInputPart | null {
    if (typeof part === 'string') {
        return {
            type: 'input_text',
            text: part,
        };
    }

    if (!isPlainObject(part)) {
        if (typeof part === 'undefined' || part === null) {
            return null;
        }

        return {
            type: 'input_text',
            text: String(part),
        };
    }

    if (part.type === 'input_text' && typeof part.text === 'string') {
        return {
            type: 'input_text',
            text: part.text,
        };
    }

    if (part.type === 'text' && typeof part.text === 'string') {
        return {
            type: 'input_text',
            text: part.text,
        };
    }

    if (part.type === 'input_image' && typeof part.image_url !== 'undefined') {
        return {
            type: 'input_image',
            image_url: part.image_url,
        };
    }

    if (part.type === 'image_url' && typeof part.image_url !== 'undefined') {
        return {
            type: 'input_image',
            image_url: part.image_url,
        };
    }

    if (typeof part.image_url !== 'undefined') {
        return {
            type: 'input_image',
            image_url: part.image_url,
        };
    }

    if (typeof part.text === 'string') {
        return {
            type: 'input_text',
            text: part.text,
        };
    }

    return {
        type: 'input_text',
        text: JSON.stringify(part),
    };
}

function normalizeResponseInputContent(content: unknown): ResponseInputPart[] {
    if (Array.isArray(content)) {
        return content
            .map((part) => normalizeResponseInputPart(part))
            .filter((part): part is ResponseInputPart => Boolean(part));
    }

    const normalizedPart = normalizeResponseInputPart(content);
    return normalizedPart ? [normalizedPart] : [];
}

function buildResponsesInputFromMessages(messages: ChatMessage[]): Array<{ role: 'system' | 'user' | 'assistant'; content: ResponseInputPart[] }> {
    return messages
        .map((message) => ({
            role: normalizeRole(message.role),
            content: normalizeResponseInputContent(message.content),
        }))
        .filter((message) => message.content.length > 0);
}

function messageHasSystemPrompt(messages: ChatMessage[]): boolean {
    return messages.some((message) => normalizeRole(message.role) === 'system');
}

function withDefaultDmSystemPrompt(messages: ChatMessage[]): ChatMessage[] {
    if (messageHasSystemPrompt(messages)) {
        return messages;
    }

    return [
        {
            role: 'system',
            content: DEFAULT_DM_SYSTEM_PROMPT,
        },
        ...messages,
    ];
}

function isArkBaseUrl(baseUrl: string): boolean {
    return baseUrl.includes('ark.cn-beijing.volces.com/api/v3');
}

function shouldUseResponsesApi(baseUrl: string, model: string, input: unknown): boolean {
    if (typeof input !== 'undefined') {
        return true;
    }

    return isArkBaseUrl(baseUrl) && ARK_RESPONSES_MODELS.has(model);
}

function normalizeArkResponseTools(tools: unknown): ArkResponseTool[] | undefined {
    if (!Array.isArray(tools)) {
        return undefined;
    }

    const normalizedTools = tools
        .map((tool): ArkResponseTool | null => {
            if (!isPlainObject(tool) || tool.type !== 'web_search') {
                return null;
            }

            const requestedMaxKeyword = typeof tool.max_keyword === 'number'
                ? Math.trunc(tool.max_keyword)
                : 3;

            return {
                type: 'web_search',
                max_keyword: Math.min(5, Math.max(1, requestedMaxKeyword)),
            };
        })
        .filter((tool): tool is ArkResponseTool => Boolean(tool));

    return normalizedTools.length > 0 ? normalizedTools : undefined;
}

function extractAssistantTextFromResponses(payload: any): string {
    const textParts: string[] = [];

    if (Array.isArray(payload?.output)) {
        for (const item of payload.output) {
            if (!item || item.type !== 'message' || item.role !== 'assistant' || !Array.isArray(item.content)) {
                continue;
            }

            for (const part of item.content) {
                if (!part) {
                    continue;
                }

                if (typeof part.text === 'string' && (part.type === 'output_text' || part.type === 'text')) {
                    textParts.push(part.text);
                }
            }
        }
    }

    if (textParts.length > 0) {
        return textParts.join('\n\n').trim();
    }

    if (typeof payload?.output_text === 'string') {
        return payload.output_text.trim();
    }

    return '';
}

function normalizeResponsesPayloadToChatShape(payload: any, model: string) {
    const content = extractAssistantTextFromResponses(payload);

    return {
        id: payload?.id,
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model: payload?.model || model,
        choices: [
            {
                index: 0,
                message: {
                    role: 'assistant',
                    content,
                },
                finish_reason: 'stop',
            },
        ],
        usage: payload?.usage,
        response_id: payload?.id,
    };
}

function passThroughStreamResponse(upstreamResponse: Response, upstreamFormat: 'ark_responses' | 'chat_completions') {
    const headers = new Headers(upstreamResponse.headers);
    if (!headers.has('Content-Type')) {
        headers.set('Content-Type', 'text/event-stream; charset=utf-8');
    }
    headers.set('Cache-Control', 'no-store');
    headers.set('x-llm-upstream-format', upstreamFormat);

    return new Response(upstreamResponse.body, {
        status: upstreamResponse.status,
        headers,
    });
}

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

        const { model, messages, input, max_tokens, temperature, providerBaseUrl, userApiKey, task, stream, tools } = body;
        const hasMessages = Array.isArray(messages) && messages.length > 0;
        const hasInput = typeof input !== 'undefined';

        if (!hasMessages && !hasInput) {
            return validationError(
                CHAT_DOC,
                'missing_parameter',
                'Request body must include a non-empty messages array or a valid input payload.',
                'Provide messages like [{"role":"user","content":"德国心脏病怎么赢？"}] or pass an Ark Responses API input field.',
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
        const baseUrl = providerBaseUrl || process.env.LLM_BASE_URL || ARK_BASE_URL;
        const requestedModel = model
            || process.env.LLM_MODEL
            || (isArkBaseUrl(baseUrl)
                ? (hasInput ? DEFAULT_ARK_RESPONSES_MODEL : DEFAULT_ARK_CHAT_MODEL)
                : DEFAULT_ARK_CHAT_MODEL);
        const shouldStream = stream === true;
        const useResponsesApi = shouldUseResponsesApi(baseUrl, requestedModel, input);

        const upstreamMessages = hasMessages
            ? withDefaultDmSystemPrompt(messages as ChatMessage[])
            : [];
        const responseInput = hasInput
            ? input
            : buildResponsesInputFromMessages(upstreamMessages);
        const responseTools = normalizeArkResponseTools(tools);

        if (useResponsesApi && Array.isArray(responseInput) && responseInput.length === 0) {
            return validationError(
                CHAT_DOC,
                'invalid_messages_content',
                'messages content could not be converted into a valid Ark Responses API input.',
                'Use string content, or pass structured input content such as input_text / input_image parts.',
            );
        }

        const upstreamController = new AbortController();
        const upstreamTimeout = setTimeout(() => upstreamController.abort(), UPSTREAM_TIMEOUT_MS);
        let response: Response;

        try {
            response = await fetch(`${baseUrl}${useResponsesApi ? '/responses' : '/chat/completions'}`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json',
                    ...(shouldStream ? { Accept: 'text/event-stream' } : {}),
                },
                signal: upstreamController.signal,
                body: JSON.stringify(
                    useResponsesApi
                        ? {
                            model: requestedModel,
                            input: responseInput,
                            max_output_tokens: max_tokens || DEFAULT_MAX_TOKENS,
                            temperature: resolvedTemperature,
                            stream: shouldStream,
                            ...(responseTools ? { tools: responseTools } : {}),
                        }
                        : {
                            model: requestedModel,
                            messages: upstreamMessages,
                            max_tokens: max_tokens || DEFAULT_MAX_TOKENS,
                            temperature: resolvedTemperature,
                            stream: shouldStream,
                        },
                ),
            });
        } catch (error: any) {
            if (error?.name === 'AbortError') {
                return jsonResponse({
                    error: 'Upstream LLM request timed out.',
                    code: 'upstream_timeout',
                    provider_base_url: baseUrl,
                    model: requestedModel,
                    upstream_format: useResponsesApi ? 'ark_responses' : 'chat_completions',
                    timeout_ms: UPSTREAM_TIMEOUT_MS,
                    hint: 'The API route is healthy, but the upstream model call did not return quickly enough.',
                }, {
                    status: 504,
                    headers: {
                        'x-llm-model': requestedModel,
                        'x-llm-upstream-format': useResponsesApi ? 'ark_responses' : 'chat_completions',
                    },
                });
            }

            throw error;
        } finally {
            clearTimeout(upstreamTimeout);
        }

        if (!response.ok) {
            const errorText = await response.text();
            return jsonResponse({
                error: errorText,
                code: 'upstream_error',
                provider_base_url: baseUrl,
                model: requestedModel,
                upstream_format: useResponsesApi ? 'ark_responses' : 'chat_completions',
                hint: 'Check the upstream model name, credentials, and request shape. GET /api/chat for the local contract.',
            }, {
                status: response.status,
                headers: {
                    'x-llm-model': requestedModel,
                    'x-llm-upstream-format': useResponsesApi ? 'ark_responses' : 'chat_completions',
                },
            });
        }

        if (shouldStream) {
            return passThroughStreamResponse(
                response,
                useResponsesApi ? 'ark_responses' : 'chat_completions',
            );
        }

        const data = await response.json();

        if (useResponsesApi) {
            return jsonResponse(normalizeResponsesPayloadToChatShape(data, requestedModel), {
                status: 200,
                headers: {
                    'x-llm-model': requestedModel,
                    'x-llm-upstream-format': 'ark_responses',
                },
            });
        }

        return jsonResponse(data, {
            status: 200,
            headers: {
                'x-llm-model': requestedModel,
                'x-llm-upstream-format': 'chat_completions',
            },
        });

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
