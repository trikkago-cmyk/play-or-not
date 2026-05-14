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

const PRODUCTION_STT_HOSTNAME = 'play-or-not-dm.vercel.app';
const STT_PROXY_FALLBACK_URL = process.env.STT_PROXY_FALLBACK_URL?.trim() || `https://${PRODUCTION_STT_HOSTNAME}/api/stt`;

const STT_DOC: EndpointDoc = {
    endpoint: '/api/stt',
    title: '语音转文字接口',
    description: '上传音频文件并返回转写文本。POST 使用 multipart/form-data，GET 返回接口说明。',
    allowedMethods: ['GET', 'POST', 'OPTIONS'],
    requestContentType: 'multipart/form-data',
    requiredFields: ['file'],
    optionalFields: {
        language: '通过服务端环境变量 STT_LANGUAGE 控制，默认 zh。',
        model: '通过服务端环境变量 STT_MODEL 控制，默认 whisper-large-v3。',
        prompt: '通过服务端环境变量 STT_PROMPT 控制。',
    },
    capabilities: [
        '将浏览器录音或上传音频转成文本',
        '适合作为聊天输入前的语音转写层',
    ],
    limitations: [
        '当前不提供公开的上传鉴权、配额或异步任务查询机制。',
        '请求体必须包含 file 字段，且服务端需要已配置 STT 提供方。',
    ],
    exampleRequest: {
        content_type: 'multipart/form-data',
        fields: ['file=<audio binary>'],
    },
    exampleResponse: {
        text: '推荐一个适合 4 人破冰的桌游',
    },
};

function baseUrlRequiresApiKey(baseUrl: string) {
    return /groq\.com|openai\.com/i.test(baseUrl);
}

function resolveRequestHostname(req: Request) {
    const forwardedHost = req.headers.get('x-forwarded-host')?.trim();
    if (forwardedHost) {
        return forwardedHost;
    }

    try {
        return new URL(req.url).hostname;
    } catch {
        return '';
    }
}

function shouldUsePreviewSttProxyFallback(req: Request, requiresApiKey: boolean, sttApiKey: string) {
    if (!requiresApiKey || sttApiKey) {
        return false;
    }

    if (req.headers.get('x-stt-proxy-fallback') === '1') {
        return false;
    }

    const deploymentEnv = (process.env.VERCEL_ENV || process.env.VERCEL_TARGET_ENV || '').trim().toLowerCase();
    if (deploymentEnv === 'preview') {
        return true;
    }

    if (deploymentEnv === 'production') {
        return false;
    }

    const hostname = resolveRequestHostname(req);
    if (!hostname || hostname === PRODUCTION_STT_HOSTNAME) {
        return false;
    }

    return hostname.endsWith('.vercel.app');
}

function isBlobLike(value: unknown): value is Blob {
    return typeof value === 'object'
        && value !== null
        && typeof (value as Blob).arrayBuffer === 'function'
        && typeof (value as Blob).type === 'string';
}

function isFileLike(value: unknown): value is File {
    return isBlobLike(value) && typeof (value as File).name === 'string';
}

export default async function handler(req: Request) {
    if (req.method === 'OPTIONS') {
        return optionsResponse(STT_DOC);
    }

    if (req.method === 'GET') {
        return documentationResponse(STT_DOC);
    }

    if (req.method !== 'POST') {
        return methodNotAllowed(req.method, STT_DOC);
    }

    try {
        const contentType = req.headers.get('content-type') || '';
        if (!contentType.includes('multipart/form-data')) {
            return validationError(
                STT_DOC,
                'unsupported_content_type',
                'POST /api/stt requires multipart/form-data.',
                'Upload the audio as form-data with a file field named "file".',
                { received_content_type: contentType || 'none' },
                415,
            );
        }

        const sttBaseUrl = (process.env.STT_BASE_URL || 'https://api.groq.com/openai/v1').trim();
        const sttApiKey = process.env.STT_API_KEY?.trim() || '';
        const sttModel = (process.env.STT_MODEL || 'whisper-large-v3').trim();
        const sttLanguage = (process.env.STT_LANGUAGE || 'zh').trim();
        const sttPrompt = (process.env.STT_PROMPT || 'The audio is Mandarin Chinese. Transcribe faithfully in Chinese and do not translate.').trim();
        const requiresApiKey = baseUrlRequiresApiKey(sttBaseUrl);

        if (shouldUsePreviewSttProxyFallback(req, requiresApiKey, sttApiKey)) {
            const proxyResponse = await fetch(STT_PROXY_FALLBACK_URL, {
                method: 'POST',
                headers: {
                    'content-type': contentType,
                    'x-stt-proxy-fallback': '1',
                },
                body: await req.arrayBuffer(),
            });

            const proxyHeaders = new Headers(proxyResponse.headers);
            proxyHeaders.set('x-stt-fallback', 'production-proxy');
            proxyHeaders.set('Cache-Control', 'no-store');

            return new Response(proxyResponse.body, {
                status: proxyResponse.status,
                headers: proxyHeaders,
            });
        }

        const formData = await req.formData();
        const file = formData.get('file');

        if (!isBlobLike(file)) {
            return validationError(
                STT_DOC,
                'missing_parameter',
                'No audio file provided.',
                'Attach an audio file in the "file" field.',
                { required_fields: STT_DOC.requiredFields },
            );
        }

        const audioBlob: Blob = file;
        const audioFile = isFileLike(audioBlob)
            ? audioBlob
            : new File([audioBlob], 'audio.webm', { type: audioBlob.type || 'audio/webm' });

        if (!sttApiKey && requiresApiKey) {
            return jsonResponse({
                error: '后端 STT 尚未配置。请在部署平台设置 STT_API_KEY；若你使用 Groq，推荐同时设置 STT_BASE_URL=https://api.groq.com/openai/v1 与 STT_MODEL=whisper-large-v3。'
            }, {
                status: 503,
            });
        }

        const proxyFormData = new FormData();
        proxyFormData.append('file', audioFile, audioFile.name || 'audio.webm');
        proxyFormData.append('model', sttModel);
        proxyFormData.append('response_format', 'json');
        proxyFormData.append('temperature', '0');
        if (sttLanguage) {
            proxyFormData.append('language', sttLanguage);
        }
        if (sttPrompt) {
            proxyFormData.append('prompt', sttPrompt);
        }

        const headers: Record<string, string> = {};
        if (sttApiKey) {
            headers.Authorization = `Bearer ${sttApiKey}`;
        }

        const response = await fetch(`${sttBaseUrl}/audio/transcriptions`, {
            method: 'POST',
            headers,
            body: proxyFormData as any,
        });

        const rawText = await response.text();
        let data: any;

        try {
            data = JSON.parse(rawText);
        } catch {
            data = { text: rawText };
        }

        if (!response.ok) {
            return jsonResponse({
                error: data?.error?.message || data?.error || rawText || 'STT Engine Error'
            }, {
                status: response.status,
            });
        }

        return jsonResponse(data, { status: 200 });

    } catch (error: any) {
        return jsonResponse({
            error: error.message,
            code: 'internal_error',
            hint: 'GET /api/stt for the endpoint contract, then retry with multipart/form-data.',
        }, {
            status: 500,
        });
    }
}
