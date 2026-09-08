/**
 * The product API proxy.
 *
 * The browser only ever talks to its own origin (guardrail 1), so something has
 * to forward `/api/**` to the product API. This is a route handler rather than
 * a `rewrites()` entry for one reason: with `output: 'standalone'`, Next
 * serialises rewrites into the build and evaluates their destination **at build
 * time**. A container built without `API_PROXY_TARGET` therefore ships with
 * `127.0.0.1:8000` baked in and cannot reach the API service at all — which is
 * exactly what the first browser test found.
 *
 * A handler reads the environment per request, so one image runs in
 * development, in compose and behind an ingress with no rebuild.
 */

import { type NextRequest } from 'next/server';

// Node, not edge: this needs streaming request bodies and full header control.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function target(): string {
  return (
    process.env.API_PROXY_TARGET
    ?? process.env.API_INTERNAL_URL
    ?? 'http://127.0.0.1:8000'
  ).replace(/\/$/, '');
}

/**
 * Headers that must not be forwarded.
 *
 * `host` would make the API think it is serving the frontend's hostname, and
 * the hop-by-hop headers belong to this connection rather than the next one.
 */
const STRIP_REQUEST = new Set([
  'host', 'connection', 'keep-alive', 'transfer-encoding', 'upgrade',
  'proxy-authorization', 'proxy-connection', 'te', 'trailer',
  'content-length',
]);

const STRIP_RESPONSE = new Set([
  'connection', 'keep-alive', 'transfer-encoding', 'upgrade', 'content-encoding',
  'content-length',
]);

async function forward(request: NextRequest, path: string[]): Promise<Response> {
  const url = new URL(request.url);
  const destination = `${target()}/api/${path.join('/')}${url.search}`;

  const headers = new Headers();
  request.headers.forEach((value, key) => {
    if (!STRIP_REQUEST.has(key.toLowerCase())) headers.set(key, value);
  });
  // The API reads the client address for audit rows and webhook rate limits;
  // without this every request appears to come from the frontend container.
  const forwardedFor = request.headers.get('x-forwarded-for');
  const clientIp = (request as unknown as { ip?: string }).ip;
  if (clientIp) {
    headers.set('x-forwarded-for', forwardedFor ? `${forwardedFor}, ${clientIp}` : clientIp);
  }

  const hasBody = !['GET', 'HEAD'].includes(request.method);

  let upstream: Response;
  try {
    upstream = await fetch(destination, {
      method: request.method,
      headers,
      body: hasBody ? await request.arrayBuffer() : undefined,
      redirect: 'manual',
      cache: 'no-store',
    });
  } catch (error) {
    // The API is unreachable. Answered in the product's own error envelope so
    // the client parses it like any other failure -- a plain-text 500 from the
    // proxy is what made this bug show up as a JSON parse error in the UI.
    return Response.json(
      {
        error: {
          code: 'API_UNREACHABLE',
          message: 'Không kết nối được tới máy chủ. Vui lòng thử lại.',
          category: 'NETWORK',
          trace_id: '',
          technical_message:
            process.env.NODE_ENV === 'production'
              ? undefined
              : `${(error as Error)?.message ?? error} -> ${destination}`,
        },
      },
      { status: 502, headers: { 'cache-control': 'no-store' } },
    );
  }

  const responseHeaders = new Headers();
  upstream.headers.forEach((value, key) => {
    if (!STRIP_RESPONSE.has(key.toLowerCase())) responseHeaders.append(key, value);
  });
  // `getSetCookie` keeps multiple Set-Cookie headers separate; a plain
  // `headers.get` would fold them into one string and the session would be lost.
  const cookies = (upstream.headers as unknown as { getSetCookie?: () => string[] })
    .getSetCookie?.() ?? [];
  if (cookies.length > 0) {
    responseHeaders.delete('set-cookie');
    for (const cookie of cookies) responseHeaders.append('set-cookie', cookie);
  }
  responseHeaders.set('cache-control', 'no-store');

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: responseHeaders,
  });
}

type Context = { params: Promise<{ path: string[] }> };

export async function GET(request: NextRequest, context: Context) {
  return forward(request, (await context.params).path);
}
export async function POST(request: NextRequest, context: Context) {
  return forward(request, (await context.params).path);
}
export async function PUT(request: NextRequest, context: Context) {
  return forward(request, (await context.params).path);
}
export async function PATCH(request: NextRequest, context: Context) {
  return forward(request, (await context.params).path);
}
export async function DELETE(request: NextRequest, context: Context) {
  return forward(request, (await context.params).path);
}
export async function HEAD(request: NextRequest, context: Context) {
  return forward(request, (await context.params).path);
}
export async function OPTIONS(request: NextRequest, context: Context) {
  return forward(request, (await context.params).path);
}
