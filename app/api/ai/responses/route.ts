import { aiModels, fireworksKey } from '@/lib/ai';

// Proxy for AG Studio's assistant adapter (app/dashboard/studio/openai-adapter.ts). The adapter runs in
// the browser and POSTs to `${endpoint}/responses`; with its endpoint set to /api/ai it lands here. This adds
// the server's Fireworks key, forwards the body to Fireworks' Responses API and streams the SSE reply
// straight back, so the key never leaves the server.

const RESPONSES_URL = 'https://api.fireworks.ai/inference/v1/responses';
const MAX_OUTPUT_TOKENS = 16_000;

// A public demo must not be an open model relay: cap requests per client per minute.
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 20;
const hits = new Map<string, number[]>();
function limited(ip: string) {
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  recent.push(now);
  hits.set(ip, recent);
  return recent.length > MAX_PER_WINDOW;
}

const error = (status: number, message: string) => Response.json({ error: { message } }, { status });

export async function POST(request: Request) {
  const apiKey = fireworksKey();
  if (!apiKey) return error(503, 'The assistant is not configured: set FIREWORKS_API_KEY.');
  if (limited(request.headers.get('x-forwarded-for')?.split(',')[0] ?? 'local')) return error(429, 'Slow down: too many assistant requests.');

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return error(400, 'Request body must be JSON.');
  }

  const models = aiModels();
  const model = typeof body.model === 'string' && body.model ? body.model : models[0];
  if (!models.includes(model)) return error(400, `Model "${model}" is not enabled.`);

  // Fireworks implements the core of the Responses API. Drop request fields it does not know.
  const { include: _include, prompt_cache_key: _pck, service_tier: _tier, safety_identifier: _safety, ...rest } = body;
  const upstream = await fetch(RESPONSES_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ ...rest, model, store: false, max_output_tokens: MAX_OUTPUT_TOKENS }),
    signal: request.signal,
  });

  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      'Content-Type': upstream.headers.get('Content-Type') ?? 'application/json',
      'Cache-Control': 'no-store',
    },
  });
}
