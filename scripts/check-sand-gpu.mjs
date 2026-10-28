// Runs the sand simulation shaders in headless Chrome and checks the physical
// invariants that only the GPU can exercise. Requires Chrome or Chromium:
//   CHROME=/path/to/chrome node scripts/check-sand-gpu.mjs
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const chrome = process.env.CHROME
  ?? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium']
    .find((path) => existsSync(path));
if (!chrome) {
  console.error('Set CHROME to a Chrome or Chromium executable.');
  process.exit(1);
}

// Each module gets its own scope; its exports become page globals.
const sources = ['geometry', 'program', 'sim-shaders', 'height-field'].map((name) => {
  const js = stripTypeScriptTypes(readFileSync(new URL(`../src/components/sand/${name}.ts`, import.meta.url), 'utf8'))
    .replace(/^import[\s\S]*?from\s+['"][^'"]+['"];?\s*$/gm, '');
  const exported = [...js.matchAll(/^export\s+(?:const|function)\s+(\w+)/gm)].map((match) => match[1]);
  return `Object.assign(window, (() => {${js.replace(/^export\s+/gm, '')}\nreturn { ${exported.join(', ')} };})());`;
});

const scenario = `
const gl = document.createElement('canvas').getContext('webgl2', { antialias: false });
const buffer = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
gl.enableVertexAttribArray(0);
gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
const field = createHeightField(gl);
const inside = (x, y) => {
  const a = (x + 0.5) / CELLS * 2 - 1, b = (y + 0.5) / CELLS * 2 - 1;
  return a * a + b * b > HUB_RADIUS * HUB_RADIUS && a * a + b * b < SAND_RADIUS * SAND_RADIUS;
};
const height = (px, x, y) => px[(y * CELLS + x) * 4] * 256 + px[(y * CELLS + x) * 4 + 1];
function volume(px) {
  let total = 0, flowing = 0;
  for (let y = 0; y < CELLS; y++) for (let x = 0; x < CELLS; x++) {
    if (!inside(x, y)) continue;
    total += height(px, x, y);
    if (px[(y * CELLS + x) * 4 + 3] >= 128) flowing++;
  }
  return { total, flowing };
}
function check(blade) {
field.reset();
const results = {};
let angle = 0.65, direction = 1, highest = 0;
function run(seconds, speed, dt = 1 / 30) {
  for (let frame = 0; frame < Math.round(seconds / dt); frame++) {
    const next = angle + speed * dt;
    if (next !== angle) direction = Math.sign(next - angle);
    field.move(angle, next, dt, direction, blade);
    angle = next;
    if (frame % 10 === 0) {
      const px = field.read();
      for (let i = 0; i < px.length; i += 4) highest = Math.max(highest, px[i] * 256 + px[i + 1]);
    }
  }
}
const initial = field.read();
const start = volume(initial).total;
const drift = [];
run(6, 0.16); drift.push(volume(field.read()).total - start);
// Sand beyond the swept wedge, well clear of the rake, must be untouched.
const raked = field.read();
let untouched = 0, disturbed = 0;
for (let y = 0; y < CELLS; y++) for (let x = 0; x < CELLS; x++) {
  const a = Math.atan2((y + 0.5) / CELLS * 2 - 1, (x + 0.5) / CELLS * 2 - 1);
  const phase = ((a - 0.65) % Math.PI + Math.PI) % Math.PI;
  if (!inside(x, y) || phase < 1.2 || phase > 2.8) continue;
  const i = (y * CELLS + x) * 4;
  if (raked[i] === initial[i] && raked[i + 1] === initial[i + 1] && raked[i + 2] === initial[i + 2]) untouched++;
  else disturbed++;
}
results.untouched = { untouched, disturbed };
run(4, -0.32); drift.push(volume(field.read()).total - start);
run(1.2, 3, 1 / 60); drift.push(volume(field.read()).total - start);
run(0.6, -2, 1 / 60); drift.push(volume(field.read()).total - start);
run(2, 0);
const rested = field.read();
const rest = volume(rested);
drift.push(rest.total - start);
run(0.5, 0);
const later = field.read();
let changed = 0;
for (let i = 0; i < later.length; i++) if (later[i] !== rested[i]) changed++;
// Free sand slopes, measured between loose cells away from the resting teeth.
const slopes = [];
const barX = Math.cos(angle), barY = Math.sin(angle);
for (let y = 1; y < CELLS - 1; y++) for (let x = 1; x < CELLS - 1; x++) {
  const px = (x + 0.5) / CELLS * 2 - 1, py = (y + 0.5) / CELLS * 2 - 1;
  if (!inside(x, y) || !rested[(y * CELLS + x) * 4 + 2] || Math.abs(px * barY - py * barX) < 0.03) continue;
  for (const [dx, dy, d] of [[1, 0, 1], [0, 1, 1], [1, 1, Math.SQRT2], [1, -1, Math.SQRT2]]) {
    if (!inside(x + dx, y + dy) || !rested[((y + dy) * CELLS + x + dx) * 4 + 2]) continue;
    const drop = Math.abs(height(rested, x, y) - height(rested, x + dx, y + dy)) * HEIGHT_UNIT;
    slopes.push(Math.atan(drop / (d * CELL)) * 180 / Math.PI);
  }
}
slopes.sort((a, b) => a - b);
Object.assign(results, {
  drift, flowing: rest.flowing, changed, highest: (highest - 32768) * HEIGHT_UNIT,
  p99: slopes[Math.floor(slopes.length * 0.99)], steepest: slopes[slopes.length - 1],
});
return results;
}
document.getElementById('out').textContent = JSON.stringify({ teeth: check(false), blade: check(true) });
`;

const dir = mkdtempSync(join(tmpdir(), 'sand-gpu-'));
try {
  const page = join(dir, 'check.html');
  writeFileSync(page, `<!doctype html><pre id="out"></pre><script>
try {\n${sources.join('\n')}\n${scenario}\n} catch (error) {
  document.getElementById('out').textContent = JSON.stringify({ error: String(error) });
}</script>`);
  const dom = execFileSync(chrome, [
    '--headless=new', `--user-data-dir=${join(dir, 'profile')}`, '--no-first-run', '--ignore-gpu-blocklist',
    '--virtual-time-budget=120000', '--dump-dom', `file://${page}`,
  ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 300000 });
  const text = dom.match(/<pre id="out">([\s\S]*?)<\/pre>/)?.[1] ?? '';
  const all = JSON.parse(text.replace(/&quot;/g, '"') || '{"error":"no output"}');
  if (all.error) throw new Error(all.error);
  const failures = [];
  for (const [tool, results] of Object.entries(all)) {
    const fail = (message) => failures.push(`${tool}: ${message}`);
    if (results.drift.some((value) => value !== 0)) fail(`volume drifted: ${results.drift}`);
    if (results.untouched.disturbed > 0) fail(`unswept sand changed: ${results.untouched.disturbed} cells`);
    if (results.flowing > 0 || results.changed > 0) fail(`not at rest: ${results.flowing} flowing, ${results.changed} bytes changed`);
    // Flow stops at 29° scaled by up to ±15% friction; it cannot start below 36° scaled the same way.
    if (results.p99 > 32.6) fail(`99th percentile slope ${results.p99.toFixed(1)}° exceeds the stopping angle`);
    if (results.steepest > 40) fail(`steepest free slope ${results.steepest.toFixed(1)}° exceeds the starting angle`);
    // Heaps must stay well below the rake bar and the 16-bit height range.
    if (results.highest > 0.04) fail(`sand piled to ${results.highest.toFixed(4)}`);
    console.log(`${tool}: volume drift ${results.drift.join(', ')}; ${results.untouched.untouched} unswept cells unchanged; `
      + `slopes p99 ${results.p99.toFixed(1)}°, max ${results.steepest.toFixed(1)}°; highest ${results.highest.toFixed(4)}; `
      + `at rest: ${results.changed === 0}`);
  }
  if (failures.length) {
    console.error(failures.join('\n'));
    process.exitCode = 1;
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}
