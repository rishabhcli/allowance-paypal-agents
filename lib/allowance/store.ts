// Small JSON-file store for mandates and purchases. Good enough for a demo and for judges who run it
// locally: state survives a restart in `.data/state.json`, and a missing or unwritable file just means
// in-memory state. Replace with a database for anything real.

import fs from 'node:fs';
import path from 'node:path';
import type { Decision, Mandate, PurchaseStatus } from './policy.ts';

export type Purchase = {
  id: string;
  mandateId: string;
  agent: string;
  productId: string;
  title: string;
  merchant: string;
  category?: string;
  amountCents: number;
  currency: string;
  buyUrl?: string;
  rationale: string; // why the agent wants it, in the agent's words
  status: PurchaseStatus;
  decision: Decision;
  approvedBy?: 'policy' | 'human';
  orderId?: string;
  approveUrl?: string;
  authorizationId?: string;
  captureId?: string;
  capturedCents?: number;
  createdAt: string;
  updatedAt: string;
  log: { at: string; event: string; note?: string }[];
};

type State = { mandates: Mandate[]; purchases: Purchase[] };

// ALLOWANCE_STATE_FILE=memory keeps everything in memory (used by the tests).
const FILE = process.env.ALLOWANCE_STATE_FILE ?? path.join(process.cwd(), '.data', 'state.json');
const MEMORY_ONLY = FILE === 'memory';
// Next can bundle route handlers and pages separately, so share one cache on globalThis and re-read the file when
// another bundle (or process) has written it.
const g = globalThis as unknown as { __allowance?: { state?: State; mtime?: number } };
const cache = (g.__allowance ??= {});

export const DEFAULT_MANDATES: Mandate[] = [
  {
    id: 'gift-finder',
    agent: 'gift-finder',
    currency: 'USD',
    perPurchaseCapCents: 15000,
    autoApproveUpToCents: 3000,
    dailyBudgetCents: 25000,
    monthlyBudgetCents: 100000,
    maxAutoApprovalsPerHour: 5,
    blockedMerchants: [],
    paused: false,
  },
  {
    id: 'office-restock',
    agent: 'office-restock',
    currency: 'USD',
    perPurchaseCapCents: 8000,
    autoApproveUpToCents: 2500,
    dailyBudgetCents: 10000,
    paused: false,
  },
];

// A fresh deployment (or a cleared state file) starts from real history recorded with scripts/seed-demo.mjs.
const SEED = path.join(process.cwd(), 'data', 'seed-state.json');

function fileMtime(): number {
  if (MEMORY_ONLY) return 0;
  try {
    return fs.statSync(FILE).mtimeMs;
  } catch {
    return 0;
  }
}

function seedState(): State {
  if (!MEMORY_ONLY && process.env.ALLOWANCE_SEED !== 'off') {
    try {
      return JSON.parse(fs.readFileSync(SEED, 'utf8')) as State;
    } catch {
      /* no seed file */
    }
  }
  return { mandates: structuredClone(DEFAULT_MANDATES), purchases: [] };
}

// On Vercel, serverless instances do not share a disk, so the hosted demo keeps its state in a private Vercel Blob
// (ALLOWANCE_REMOTE=blob). Handlers call hydrate() before reading and persist() after writing. Locally both are no-ops.
const REMOTE = process.env.ALLOWANCE_REMOTE === 'blob' && Boolean(process.env.BLOB_READ_WRITE_TOKEN);
const REMOTE_PATH = 'allowance/state.json';

export async function hydrate(): Promise<void> {
  if (!REMOTE) return;
  const { get } = await import('@vercel/blob');
  const result = await get(REMOTE_PATH, { access: 'private', useCache: false });
  cache.state = result && result.statusCode === 200 ? (JSON.parse(await new Response(result.stream).text()) as State) : seedState();
}

export async function persist(): Promise<void> {
  if (!REMOTE) return;
  const { put } = await import('@vercel/blob');
  await put(REMOTE_PATH, JSON.stringify(load()), { access: 'private', allowOverwrite: true, addRandomSuffix: false, contentType: 'application/json' });
}

function load(): State {
  if (REMOTE) return (cache.state ??= seedState());
  const mtime = fileMtime();
  if (cache.state && (MEMORY_ONLY || mtime === cache.mtime)) return cache.state;
  try {
    if (MEMORY_ONLY) throw new Error('memory');
    cache.state = JSON.parse(fs.readFileSync(FILE, 'utf8')) as State;
  } catch {
    cache.state = cache.state ?? seedState();
  }
  cache.mtime = mtime;
  return cache.state;
}

function save() {
  if (MEMORY_ONLY || REMOTE) return;
  try {
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify(cache.state, null, 2));
    cache.mtime = fileMtime();
  } catch {
    /* read-only filesystem: stay in memory */
  }
}

export const mandates = () => load().mandates;
export const purchases = () => load().purchases;
export const getMandate = (id: string) => load().mandates.find((m) => m.id === id);
export const getPurchase = (id: string) => load().purchases.find((p) => p.id === id);
export const findByOrder = (orderId: string) => load().purchases.find((p) => p.orderId === orderId);
export const findByAuthorization = (authId: string) => load().purchases.find((p) => p.authorizationId === authId);

export function addPurchase(p: Purchase) {
  load().purchases.unshift(p);
  save();
}

export function updateMandate(id: string, patch: Partial<Mandate>) {
  const m = getMandate(id);
  if (!m) return undefined;
  Object.assign(m, patch);
  save();
  return m;
}

export function touch(p: Purchase, event: string, note?: string) {
  const at = new Date().toISOString();
  p.updatedAt = at;
  p.log.push({ at, event, note });
  save();
}

/** Back to the recorded seed history (or empty when there is none). */
export function resetState() {
  cache.state = seedState();
  save();
}
