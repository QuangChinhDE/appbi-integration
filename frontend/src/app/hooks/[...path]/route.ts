/**
 * The public webhook surface, forwarded to the product gateway.
 *
 * Exists so a developer can point a sender at the frontend's origin and have it
 * reach the gateway. Same runtime-configured proxy as `/api`, for the same
 * reason: a destination baked in at build time cannot work in a container (see
 * `src/app/api/[...path]/route.ts`).
 *
 * In production this path belongs on the ingress in front of the API — the
 * frontend has no business being in the path of somebody else's webhook.
 */

import { type NextRequest } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function target(): string {
  return (
    process.env.API_PROXY_TARGET
    ?? process.env.API_INTERNAL_URL
    ?? 'http://127.0.0.1:8000'
  ).replace(/\/$/, '');
}

async function forward(request: NextRequest, path: string[]): Promise<Response> {
  const url = new URL(request.url);
  const destination = `${target()}/hooks/${path.join('/')}${url.search}`;

  const headers = new Headers();
  request.headers.forEach((value, key) => {
    if (!['host', 'connection', 'content-length'].includes(key.toLowerCase())) {
      headers.set(key, value);
    }
  });

  const hasBody = !['GET', 'HEAD'].includes(request.method);
  try {
    const upstream = await fetch(destination, {
      method: request.method,
      headers,
      // Buffered rather than streamed: the gateway caps the body anyway, and a
      // duplex stream through two hops is the kind of thing that fails only
      // under load.
      body: hasBody ? await request.arrayBuffer() : undefined,
      redirect: 'manual',
      cache: 'no-store',
    });
    return new Response(upstream.body, {
      status: upstream.status,
      headers: {
        'content-type': upstream.headers.get('content-type') ?? 'application/json',
        'cache-control': 'no-store',
      },
    });
  } catch {
    return Response.json(
      {
        error: {
          code: 'API_UNREACHABLE',
          message: 'Gateway unavailable.',
          category: 'NETWORK',
          trace_id: '',
        },
      },
      { status: 502 },
    );
  }
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
