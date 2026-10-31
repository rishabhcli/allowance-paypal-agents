// Generates one ElevenLabs clip per narration segment and writes demo/audio/durations.json.
// Key is read from ~/Documents/GitHub/temp/.env inside this script and never printed.
import fs from 'node:fs';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
const env = Object.fromEntries(fs.readFileSync(os.homedir() + '/Documents/GitHub/temp/.env', 'utf8').split('\n').filter((l) => /^[A-Z_0-9]+=/.test(l)).map((l) => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1).replace(/^"|"$/g, '')]; }));
const segs = JSON.parse(fs.readFileSync('demo/narration.json', 'utf8'));
console.log('characters:', segs.reduce((n, s) => n + s.text.length, 0));
const durations = fs.existsSync('demo/audio/durations.json') ? JSON.parse(fs.readFileSync('demo/audio/durations.json', 'utf8')) : {};
const only = process.env.ONLY;
for (const s of segs) {
  if (only && s.id !== only) continue;
  const res = await fetch('https://api.elevenlabs.io/v1/text-to-speech/s3TPKV1kjDlVtZbl4Ksh?output_format=mp3_44100_128', {
    method: 'POST',
    headers: { 'xi-api-key': env.ELEVENLABS_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: s.text, model_id: 'eleven_multilingual_v2', voice_settings: { stability: 0.45, similarity_boost: 0.75, style: 0.1 } }),
  });
  if (!res.ok) { console.log(s.id, 'ElevenLabs error', res.status, (await res.text()).slice(0, 120)); process.exit(1); }
  fs.writeFileSync(`demo/audio/${s.id}.mp3`, Buffer.from(await res.arrayBuffer()));
  durations[s.id] = Number(execFileSync('/opt/homebrew/bin/ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', `demo/audio/${s.id}.mp3`]).toString().trim());
  console.log(s.id, durations[s.id].toFixed(2) + 's');
}
fs.writeFileSync('demo/audio/durations.json', JSON.stringify(durations, null, 2));
