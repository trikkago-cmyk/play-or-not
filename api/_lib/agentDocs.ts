export interface EndpointDoc {
  endpoint: string;
  title: string;
  description: string;
  allowedMethods: string[];
  requestContentType?: string;
  requiredFields?: string[];
  optionalFields?: Record<string, string>;
  capabilities?: string[];
  limitations?: string[];
  notes?: string[];
  authentication?: string;
  statefulness?: string;
  recommendedTasks?: Array<{
    id: string;
    title: string;
    description: string;
    examplePrompt?: string;
  }>;
  exampleRequest?: unknown;
  exampleResponse?: unknown;
}

const DISCOVERY_LINKS = {
  docs: '/developers/',
  llms: '/llms.txt',
  openapi: '/openapi.json',
  capabilities: '/capabilities.json',
};

function buildLinkHeader() {
  return [
    `</openapi.json>; rel="service-desc"`,
    `</developers/>; rel="help"`,
    `</llms.txt>; rel="describedby"`,
    `</capabilities.json>; rel="alternate"; type="application/json"`,
  ].join(', ');
}

function mergeHeaders(headers?: HeadersInit, options: { includeDiscoveryLinks?: boolean } = {}) {
  const merged = new Headers(headers);
  if (!merged.has('Cache-Control')) {
    merged.set('Cache-Control', 'no-store');
  }
  if (options.includeDiscoveryLinks && !merged.has('Link')) {
    merged.set('Link', buildLinkHeader());
  }
  return merged;
}

export function jsonResponse(body: unknown, init: ResponseInit = {}) {
  const headers = mergeHeaders(init.headers);
  if (!headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json; charset=utf-8');
  }

  return new Response(JSON.stringify(body), {
    ...init,
    headers,
  });
}

export function endpointDescription(doc: EndpointDoc) {
  return {
    product: '玩吗 - 桌游DM',
    endpoint: doc.endpoint,
    title: doc.title,
    description: doc.description,
    allowed_methods: doc.allowedMethods,
    request_content_type: doc.requestContentType,
    required_fields: doc.requiredFields ?? [],
    optional_fields: doc.optionalFields ?? {},
    capabilities: doc.capabilities ?? [],
    limitations: doc.limitations ?? [],
    notes: doc.notes ?? [],
    authentication: doc.authentication,
    statefulness: doc.statefulness,
    recommended_tasks: doc.recommendedTasks ?? [],
    example_request: doc.exampleRequest,
    example_response: doc.exampleResponse,
    docs_url: DISCOVERY_LINKS.docs,
    openapi_url: DISCOVERY_LINKS.openapi,
    llms_url: DISCOVERY_LINKS.llms,
    capabilities_url: DISCOVERY_LINKS.capabilities,
    last_updated: '2026-03-24',
  };
}

export function documentationResponse(doc: EndpointDoc) {
  return jsonResponse(endpointDescription(doc), {
    status: 200,
    headers: mergeHeaders({
      Allow: doc.allowedMethods.join(', '),
    }, {
      includeDiscoveryLinks: true,
    }),
  });
}

export function optionsResponse(doc: EndpointDoc) {
  return new Response(null, {
    status: 204,
    headers: mergeHeaders({
      Allow: doc.allowedMethods.join(', '),
    }, {
      includeDiscoveryLinks: true,
    }),
  });
}

export function methodNotAllowed(method: string, doc: EndpointDoc) {
  return jsonResponse({
    error: `Method ${method} is not supported for ${doc.endpoint}.`,
    code: 'method_not_allowed',
    allowed_methods: doc.allowedMethods,
    hint: `Use one of: ${doc.allowedMethods.join(', ')}.`,
    docs_url: DISCOVERY_LINKS.docs,
    openapi_url: DISCOVERY_LINKS.openapi,
    llms_url: DISCOVERY_LINKS.llms,
    capabilities_url: DISCOVERY_LINKS.capabilities,
  }, {
    status: 405,
    headers: mergeHeaders({
      Allow: doc.allowedMethods.join(', '),
    }, {
      includeDiscoveryLinks: true,
    }),
  });
}

export function validationError(
  doc: EndpointDoc,
  code: string,
  message: string,
  hint: string,
  details?: Record<string, unknown>,
  status = 400,
) {
  return jsonResponse({
    error: message,
    code,
    hint,
    details,
    docs_url: DISCOVERY_LINKS.docs,
    openapi_url: DISCOVERY_LINKS.openapi,
    llms_url: DISCOVERY_LINKS.llms,
    capabilities_url: DISCOVERY_LINKS.capabilities,
  }, { status });
}
