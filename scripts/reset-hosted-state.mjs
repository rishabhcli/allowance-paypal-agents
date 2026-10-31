import fs from 'node:fs';
import { put, get } from '@vercel/blob';
const env = Object.fromEntries(fs.readFileSync('.env.local', 'utf8').split('\n').filter((l) => /^[A-Z_0-9]+=/.test(l)).map((l) => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1).replace(/^"|"$/g, '')]; }));
process.env.BLOB_READ_WRITE_TOKEN = env.BLOB_READ_WRITE_TOKEN;
try {
  const seed = fs.readFileSync('data/seed-state.json', 'utf8');
  await put('allowance/state.json', seed, { access: 'private', allowOverwrite: true, addRandomSuffix: false, contentType: 'application/json' });
  const r = await get('allowance/state.json', { access: 'private', useCache: false });
  const st = JSON.parse(await new Response(r.stream).text());
  console.log('blob now', st.purchases.length, 'purchases');
} catch (e) { console.log('ERR', String(e.message).slice(0, 200)); }
