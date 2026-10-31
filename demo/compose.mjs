// Turns the raw Playwright recording plus the narration clips into demo/allowance-demo.mp4.
// Each clip is delayed to the moment its segment started on screen (demo/marks.json).
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
const FF = '/opt/homebrew/bin/ffmpeg';
const { marks, video, total: scriptTotal } = JSON.parse(fs.readFileSync('demo/marks.json', 'utf8'));
const dur = JSON.parse(fs.readFileSync('demo/audio/durations.json', 'utf8'));
const ids = Object.keys(marks);
const probe = (f) => Number(execFileSync('/opt/homebrew/bin/ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f]).toString().trim());

execFileSync(FF, ['-y', '-i', video, '-vf', 'fps=30,scale=1920:1080:flags=lanczos,format=yuv420p', '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-an', 'demo/video-only.mp4'], { stdio: 'ignore' });
const videoDur = probe('demo/video-only.mp4');
const lastEnd = Math.max(...ids.map((id) => marks[id] + dur[id])) + 1;
// The recording keeps a frozen frame after the last action; cut to the script clock (video time matches it).
const total = Math.max(lastEnd, Math.min(videoDur, scriptTotal));

const inputs = ['-i', 'demo/video-only.mp4', ...ids.flatMap((id) => ['-i', `demo/audio/${id}.mp3`])];
const delays = ids.map((id, i) => `[${i + 1}:a]adelay=${Math.round(marks[id] * 1000)}|${Math.round(marks[id] * 1000)}[a${i}]`);
const mix = `${ids.map((_, i) => `[a${i}]`).join('')}amix=inputs=${ids.length}:normalize=0:duration=longest,apad[aout]`;
execFileSync(FF, ['-y', ...inputs, '-filter_complex', [...delays, mix].join(';'), '-map', '0:v', '-map', '[aout]', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '160k', '-t', total.toFixed(2), '-movflags', '+faststart', 'demo/allowance-demo.mp4'], { stdio: 'ignore' });
console.log('video', videoDur.toFixed(1) + 's', 'final', probe('demo/allowance-demo.mp4').toFixed(1) + 's');
