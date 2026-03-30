import {
  documentationResponse,
  jsonResponse,
  methodNotAllowed,
  optionsResponse,
  type EndpointDoc,
} from './_lib/agentDocs.js';

const DEFAULT_RAG_SERVICE_URL = 'http://127.0.0.1:8001';

const RAG_DOC: EndpointDoc = {
  endpoint: '/api/rag',
  title: 'RAG 代理接口',
  description: '代理本地 Python RAG 服务。GET 默认返回健康检查，GET /api/rag?describe=1 返回接口说明，POST 转发查询请求。',
  allowedMethods: ['GET', 'POST', 'OPTIONS'],
  requestContentType: 'application/json',
  capabilities: [
    '检查本地 RAG 服务健康状态',
    '向 Python RAG 服务发送结构化查询请求',
  ],
  limitations: [
    '当前依赖部署环境中的 RAG_SERVICE_URL，默认转发到本地 127.0.0.1:8001。',
    '请求和响应 schema 由 Python RAG 服务决定，此代理不会强约束业务字段。',
  ],
  exampleRequest: {
    query: '推荐一个适合 6 人聚会、规则好讲的桌游',
    mode: 'recommendation',
  },
  exampleResponse: {
    answer: '推荐试试《机密代号》或《阿瓦隆》。',
    hits: [],
  },
};

function normalizeBaseUrl(rawBaseUrl?: string) {
  return (rawBaseUrl || DEFAULT_RAG_SERVICE_URL).trim().replace(/\/+$/, '');
}

export default async function handler(req: Request) {
  if (req.method === 'OPTIONS') {
    return optionsResponse(RAG_DOC);
  }

  if (req.method !== 'GET' && req.method !== 'POST') {
    return methodNotAllowed(req.method, RAG_DOC);
  }

  const baseUrl = normalizeBaseUrl(process.env.RAG_SERVICE_URL);
  const url = new URL(req.url);

  if (req.method === 'GET' && url.searchParams.get('describe') === '1') {
    return documentationResponse(RAG_DOC);
  }

  const targetPath = req.method === 'GET' ? '/health' : '/query';

  try {
    const targetUrl = `${baseUrl}${targetPath}`;
    const requestInit: RequestInit = {
      method: req.method,
      headers: {
        'Content-Type': 'application/json',
      },
    };

    if (req.method === 'POST') {
      const body = await req.json().catch(() => ({}));
      requestInit.body = JSON.stringify(body);
    }

    const response = await fetch(targetUrl, requestInit);
    const payload = await response.text();

    return new Response(payload, {
      status: response.status,
      headers: {
        'Content-Type': response.headers.get('content-type') || 'application/json',
        'Cache-Control': 'no-store',
        'Link': '</openapi.json>; rel="service-desc", </developers/>; rel="help", </llms.txt>; rel="describedby"',
      },
    });
  } catch (error: any) {
    return jsonResponse({
      error: error?.message || 'RAG proxy request failed',
      ragServiceUrl: baseUrl,
      code: 'rag_proxy_error',
      hint: 'Try GET /api/rag for health or GET /api/rag?describe=1 for the proxy contract.',
    }, {
      status: 502,
    });
  }
}
