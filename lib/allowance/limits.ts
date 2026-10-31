// A public demo must not be an open relay for a model and a payments sandbox. Per client and per day caps,
// kept in memory per server instance (good enough to stop casual abuse; not a security boundary).

const buckets = new Map<string, number[]>();

export function allow(key: string, max: number, windowMs: number, now = Date.now()): boolean {
  const recent = (buckets.get(key) ?? []).filter((t) => now - t < windowMs);
  if (recent.length >= max) {
    buckets.set(key, recent);
    return false;
  }
  recent.push(now);
  buckets.set(key, recent);
  return true;
}

export const clientKey = (req: Request) => req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'local';
