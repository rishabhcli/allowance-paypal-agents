'use client';

// The control surface: give an agent an errand, answer the purchases policy held for a person, settle or
// release the holds PayPal has, and tune each agent's mandate. Everything here calls the same API routes the
// tests cover (app/api/*); there is no logic in the browser beyond display.

import { useCallback, useEffect, useState } from 'react';
import type { Mandate } from '@/lib/allowance/policy';
import type { Purchase } from '@/lib/allowance/store';

type AgentRun = { messages: { role: string; text: string }[]; purchases: Purchase[]; turns: number };

const usd = (cents: number) => `$${(cents / 100).toFixed(2)}`;
const ago = (iso: string) => {
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  return s < 90 ? 'just now' : s < 5400 ? `${Math.round(s / 60)} min ago` : s < 129600 ? `${Math.round(s / 3600)} h ago` : `${Math.round(s / 86400)} d ago`;
};

const STATUS: Record<Purchase['status'], { label: string; tone: string }> = {
  proposed: { label: 'In progress', tone: 'bg-pp-canvas text-pp-muted' },
  denied: { label: 'Denied by policy', tone: 'bg-red-50 text-pp-danger' },
  awaiting_human: { label: 'Needs you', tone: 'bg-amber-50 text-pp-warning' },
  awaiting_buyer: { label: 'Waiting for buyer', tone: 'bg-amber-50 text-pp-warning' },
  authorized: { label: 'Hold on PayPal', tone: 'bg-pp-highlight text-pp-blue-dark' },
  captured: { label: 'Captured', tone: 'bg-emerald-50 text-pp-success' },
  voided: { label: 'Voided', tone: 'bg-pp-canvas text-pp-muted' },
  rejected: { label: 'Rejected', tone: 'bg-red-50 text-pp-danger' },
  failed: { label: 'Failed', tone: 'bg-red-50 text-pp-danger' },
};

const EXAMPLES = [
  'Find warm merino hiking socks under $40 as a gift.',
  'Buy a good insulated winter jacket for a hiking trip.',
  'Find a 100% wool blanket, the best one you can find under $200.',
];

function Badge({ status }: { status: Purchase['status'] }) {
  const s = STATUS[status];
  return <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ${s.tone}`}>{s.label}</span>;
}

const button = 'inline-flex h-9 items-center justify-center rounded-full px-4 text-sm font-semibold disabled:opacity-50';
const primary = `${button} bg-pp-blue text-white hover:bg-pp-blue-dark`;
const quiet = `${button} border border-pp-border bg-white text-pp-navy hover:bg-pp-highlight`;

export function Approvals() {
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [mandates, setMandates] = useState<Mandate[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [run, setRun] = useState<AgentRun | null>(null);
  const [mandateId, setMandateId] = useState('gift-finder');
  const [goal, setGoal] = useState(EXAMPLES[0]);

  const load = useCallback(async () => {
    const [p, m] = await Promise.all([fetch('/api/purchases').then((r) => r.json()), fetch('/api/mandates').then((r) => r.json())]);
    setPurchases(p);
    setMandates(m);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
    const t = setInterval(load, 8000);
    return () => clearInterval(t);
  }, [load]);

  async function act(id: string, action: string, extra: object = {}) {
    setBusy(id + action);
    setError(null);
    const res = await fetch(`/api/purchases/${id}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, ...extra }) });
    if (!res.ok) setError(((await res.json()) as { error?: string }).error ?? 'That did not work');
    await load();
    setBusy(null);
  }

  async function runAgent() {
    setBusy('run');
    setError(null);
    setRun(null);
    const res = await fetch('/api/agent/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mandateId, goal }) });
    const json = await res.json();
    if (!res.ok) setError(json.error ?? 'The agent run failed');
    else setRun(json);
    await load();
    setBusy(null);
  }

  async function patchMandate(id: string, patch: object) {
    await fetch('/api/mandates', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, ...patch }) });
    await load();
  }

  const waiting = purchases.filter((p) => p.status === 'awaiting_human');
  const holds = purchases.filter((p) => p.status === 'authorized');
  const recent = purchases.slice(0, 12);
  const spentToday = (m: Mandate) =>
    purchases
      .filter((p) => p.mandateId === m.id && (p.status === 'authorized' || p.status === 'captured') && Date.now() - Date.parse(p.updatedAt) < 864e5)
      .reduce((t, p) => t + (p.capturedCents ?? p.amountCents), 0);

  return (
    <main className="mx-auto grid w-full max-w-[1280px] gap-6 px-6 py-8 lg:grid-cols-[minmax(0,1fr)_380px]">
      <div className="flex min-w-0 flex-col gap-6">
        <header>
          <h1 className="text-[28px] font-semibold text-pp-navy">Approvals</h1>
          <p className="mt-1 text-[15px] text-pp-muted">
            Agents shop under a mandate. Small purchases go through, larger ones wait for you, and anything outside the mandate is refused before PayPal is called. PayPal sandbox only, no real money.
          </p>
        </header>

        {error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-pp-danger">{error}</p>}

        <section className="rounded-2xl border border-pp-border bg-white p-5">
          <h2 className="text-lg font-semibold text-pp-navy">Give an agent an errand</h2>
          <div className="mt-3 flex flex-wrap gap-2">
            <select value={mandateId} onChange={(e) => setMandateId(e.target.value)} className="h-10 rounded-full border border-pp-border bg-white px-4 text-sm font-semibold" aria-label="Agent">
              {mandates.map((m) => (
                <option key={m.id} value={m.id}>{m.agent}{m.paused ? ' (paused)' : ''}</option>
              ))}
            </select>
            <input value={goal} onChange={(e) => setGoal(e.target.value)} aria-label="Errand" className="h-10 min-w-0 flex-1 rounded-full border border-pp-border px-4 text-sm" />
            <button className={primary} disabled={busy === 'run' || !goal.trim()} onClick={runAgent}>{busy === 'run' ? 'Agent is shopping…' : 'Run agent'}</button>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {EXAMPLES.map((ex) => (
              <button key={ex} onClick={() => setGoal(ex)} className="rounded-full bg-pp-canvas px-3 py-1 text-xs text-pp-muted hover:bg-pp-highlight">{ex}</button>
            ))}
          </div>
          {run && (
            <ol className="mt-4 space-y-2 border-t border-pp-border pt-4 text-sm">
              {run.messages.map((m, i) => (
                <li key={i} className="flex gap-3">
                  <span className="w-16 shrink-0 text-xs font-semibold uppercase tracking-wider text-pp-muted">{m.role === 'tool' ? 'step' : m.role}</span>
                  <span className={m.role === 'tool' ? 'font-mono text-xs text-pp-muted' : ''}>{m.text}</span>
                </li>
              ))}
            </ol>
          )}
        </section>

        <section>
          <h2 className="text-lg font-semibold text-pp-navy">Waiting for you {waiting.length > 0 && <span className="ml-1 rounded-full bg-amber-100 px-2 py-0.5 text-sm text-pp-warning">{waiting.length}</span>}</h2>
          {waiting.length === 0 ? (
            <p className="mt-2 rounded-2xl border border-dashed border-pp-border bg-white px-5 py-6 text-sm text-pp-muted">Nothing is waiting. Ask an agent for something above the auto approve limit and it will show up here.</p>
          ) : (
            <ul className="mt-3 grid gap-3">
              {waiting.map((p) => (
                <li key={p.id} className="rounded-2xl border border-amber-200 bg-white p-5">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p className="text-[17px] font-semibold">{p.title}</p>
                    <p className="text-xl font-semibold">{usd(p.amountCents)}</p>
                  </div>
                  <p className="text-sm text-pp-muted">{p.merchant} · asked by {p.agent} · {ago(p.createdAt)}</p>
                  <p className="mt-3 text-sm"><span className="font-semibold">Agent says:</span> {p.rationale}</p>
                  <p className="mt-1 text-sm text-pp-warning"><span className="font-semibold">Why it stopped:</span> {p.decision.reasons[0]?.detail}</p>
                  <div className="mt-4 flex gap-2">
                    <button className={primary} disabled={busy !== null} onClick={() => act(p.id, 'approve')}>Approve and authorize</button>
                    <button className={quiet} disabled={busy !== null} onClick={() => act(p.id, 'reject')}>Reject</button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section>
          <h2 className="text-lg font-semibold text-pp-navy">Holds on PayPal</h2>
          {holds.length === 0 ? (
            <p className="mt-2 rounded-2xl border border-dashed border-pp-border bg-white px-5 py-6 text-sm text-pp-muted">No open authorizations. Capture takes the money, void releases it.</p>
          ) : (
            <ul className="mt-3 divide-y divide-pp-border rounded-2xl border border-pp-border bg-white">
              {holds.map((p) => (
                <li key={p.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
                  <div className="min-w-0">
                    <p className="truncate font-semibold">{p.title}</p>
                    <p className="text-sm text-pp-muted">{p.merchant} · {usd(p.amountCents)} held · approved by {p.approvedBy === 'human' ? 'you' : 'policy'} · {ago(p.updatedAt)}</p>
                  </div>
                  <div className="flex gap-2">
                    <button className={primary} disabled={busy !== null} onClick={() => act(p.id, 'capture')}>Capture {usd(p.amountCents)}</button>
                    <button className={quiet} disabled={busy !== null} onClick={() => act(p.id, 'void')}>Void</button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section>
          <h2 className="text-lg font-semibold text-pp-navy">Recent activity</h2>
          <ul className="mt-3 divide-y divide-pp-border rounded-2xl border border-pp-border bg-white">
            {recent.length === 0 && <li className="px-5 py-6 text-sm text-pp-muted">No purchases yet.</li>}
            {recent.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-4 px-5 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">{p.title}</p>
                  <p className="truncate text-xs text-pp-muted">{p.agent} · {p.merchant} · {p.decision.reasons[0]?.detail}</p>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <span className="text-sm font-semibold">{usd(p.capturedCents ?? p.amountCents)}</span>
                  <Badge status={p.status} />
                </div>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <aside className="flex flex-col gap-4">
        <h2 className="text-lg font-semibold text-pp-navy">Mandates</h2>
        {mandates.map((m) => {
          const spent = spentToday(m);
          const pct = Math.min(100, Math.round((spent / m.dailyBudgetCents) * 100));
          return (
            <div key={m.id} className="rounded-2xl border border-pp-border bg-white p-5">
              <div className="flex items-center justify-between">
                <p className="font-semibold">{m.agent}</p>
                <button className={quiet} onClick={() => patchMandate(m.id, { paused: !m.paused })}>{m.paused ? 'Resume' : 'Pause'}</button>
              </div>
              <p className="mt-3 text-sm text-pp-muted">Spent in 24 h: {usd(spent)} of {usd(m.dailyBudgetCents)}</p>
              <div className="mt-1 h-2 overflow-hidden rounded-full bg-pp-canvas" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
                <div className={`h-full ${pct > 85 ? 'bg-pp-danger' : 'bg-pp-blue'}`} style={{ width: `${pct}%` }} />
              </div>
              <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                <LimitField label="Auto approve up to" cents={m.autoApproveUpToCents} onSave={(c) => patchMandate(m.id, { autoApproveUpToCents: c })} />
                <LimitField label="Per purchase cap" cents={m.perPurchaseCapCents} onSave={(c) => patchMandate(m.id, { perPurchaseCapCents: c })} />
                <LimitField label="Daily budget" cents={m.dailyBudgetCents} onSave={(c) => patchMandate(m.id, { dailyBudgetCents: c })} />
                <div>
                  <dt className="text-pp-muted">State</dt>
                  <dd className={`font-semibold ${m.paused ? 'text-pp-danger' : 'text-pp-success'}`}>{m.paused ? 'Paused' : 'Active'}</dd>
                </div>
              </dl>
            </div>
          );
        })}
      </aside>
    </main>
  );
}

function LimitField({ label, cents, onSave }: { label: string; cents: number; onSave: (cents: number) => void }) {
  const [value, setValue] = useState((cents / 100).toFixed(0));
  useEffect(() => setValue((cents / 100).toFixed(0)), [cents]);
  const commit = () => {
    const next = Math.round(Number(value) * 100);
    if (Number.isFinite(next) && next >= 0 && next !== cents) onSave(next);
  };
  return (
    <div>
      <dt className="text-pp-muted">{label}</dt>
      <dd className="flex items-center">
        <span className="font-semibold">$</span>
        <input
          value={value}
          onChange={(e) => setValue(e.target.value.replace(/[^\d]/g, ''))}
          onBlur={commit}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          inputMode="numeric"
          aria-label={label}
          className="ml-0.5 w-16 rounded border border-transparent bg-transparent font-semibold hover:border-pp-border focus:border-pp-blue focus:outline-none"
        />
      </dd>
    </div>
  );
}
