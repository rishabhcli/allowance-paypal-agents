// Fills a running app with real history by driving its own API: agents shop through Channel3 and a
// Fireworks model, PayPal sandbox orders are created, and a person's decisions are applied.
//   npm run dev &   then   node scripts/seed-demo.mjs http://localhost:3000
const base = process.argv[2] ?? 'http://localhost:3000';
const post = async (path, body) => {
  const res = await fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) console.log(`  ! ${path} ${res.status} ${json.error ?? ''}`.slice(0, 200));
  return json;
};
const errands = [
  ['gift-finder', 'Find warm merino hiking socks under $40 as a gift.'],
  ['gift-finder', 'Find a nice ceramic coffee mug under $25 as a stocking stuffer.'],
  ['gift-finder', 'Buy a good insulated winter jacket for a hiking trip.'],
  ['gift-finder', 'Find a 100% wool blanket, the best one you can find under $200.'],
  ['gift-finder', 'Buy a luxury Swiss mechanical watch as a gift.'],
  ['office-restock', 'Buy a pack of 12 black ballpoint pens.'],
  ['office-restock', 'Restock one ream of 8.5x11 printer paper, the cheapest reliable one.'],
  ['office-restock', 'Buy an ergonomic office chair for the team room.'],
  ['office-restock', 'Get a desk lamp with a warm light for the front desk.'],
];
for (const [mandateId, goal] of errands) {
  console.log(`${mandateId}: ${goal}`);
  const run = await post('/api/agent/run', { mandateId, goal });
  for (const p of run.purchases ?? []) console.log(`  -> ${p.title.slice(0, 50)} @ ${p.merchant} $${(p.amountCents / 100).toFixed(2)} ${p.status}`);
}
const all = await (await fetch(base + '/api/purchases')).json();
const waiting = all.filter((p) => p.status === 'awaiting_human');
console.log(`${waiting.length} waiting for a person`);
if (waiting[0]) await post(`/api/purchases/${waiting[0].id}`, { action: 'approve' });
if (waiting[1]) await post(`/api/purchases/${waiting[1].id}`, { action: 'reject' });
// Settle most holds, release one.
const holds = (await (await fetch(base + '/api/purchases')).json()).filter((p) => p.status === 'authorized');
for (const [i, p] of holds.entries()) {
  if (i === 1) await post(`/api/purchases/${p.id}`, { action: 'void' });
  else if (i % 2 === 0) await post(`/api/purchases/${p.id}`, { action: 'capture', finalCents: i === 0 ? p.amountCents - 100 : undefined });
}
const final = await (await fetch(base + '/api/purchases')).json();
const counts = {};
for (const p of final) counts[p.status] = (counts[p.status] ?? 0) + 1;
console.log('final', counts);
