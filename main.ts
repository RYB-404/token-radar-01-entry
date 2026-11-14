// Launch Radar — entry program for make.fun token-radar-01 (Node 22, standard library only).
//
// Reads the sealed snapshot (default /input/snapshot.json) and scores every
// protocol with dashboard/engine.js — the value model and farm-plan generator
// the page itself runs, loaded here through node:vm so board.json and the
// rendered dashboard are produced by the same code. Writes /output/board.json,
// /output/data.js (the page's data), copies dashboard/ and screenshots/ into
// /output, and last writes /output/dossier.json with the vendored make.fun
// library.
//
// Outside the grader's container, MAKEFUN_OUTPUT_DIR (or --output) stands in
// for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { buildDossier } from './vendor/makefun-board.ts';

const here = fileURLToPath(new URL('.', import.meta.url));

/** --name <value> out of the arguments, or the fallback. */
function arg(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1]!;
  const withEquals = process.argv.find((a) => a.startsWith(`--${name}=`));
  return withEquals === undefined ? fallback : withEquals.slice(name.length + 3);
}

function fail(msg: string): never {
  process.stderr.write(`launch radar: ${msg}\n`);
  process.exit(1);
}

// ---------------------------------------------------------------- input

const inputArg = arg('input', '/input');
const inputFile = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(inputFile)) {
  fail(`no snapshot at ${inputFile} — pass --input <snapshot.json|directory> or mount the sealed /input`);
}
const snap = JSON.parse(readFileSync(inputFile, 'utf8')) as {
  as_of: string; source: string; floor_usd: number;
  protocols: Array<Record<string, unknown>>; watchlist: string[];
};

// A quick shape check: ten fields per protocol, the watchlist inside it.
const FIELDS = ['slug', 'name', 'category', 'chains', 'tvl_usd', 'change_7d', 'mcap_usd', 'listed_at', 'gecko_id', 'symbol'];
if (!Array.isArray(snap.protocols) || !Array.isArray(snap.watchlist) || typeof snap.as_of !== 'string') {
  fail(`${inputFile} does not carry the snapshot's shape (as_of, protocols, watchlist)`);
}
for (const p of snap.protocols as Array<Record<string, unknown>>) {
  for (const f of FIELDS) if (!(f in p)) fail(`${inputFile}: a protocol is missing its ${f} field`);
}

// ---------------------------------------------------------------- the shared model, in a sandbox

/** Run one of the dashboard's classic scripts in a bare context, so the exact
 * bytes the browser executes also produce board.json here. */
function runDashboardScript(rel: string, ctx: Record<string, unknown>): void {
  const src = readFileSync(join(here, rel), 'utf8');
  vm.createContext(ctx);
  vm.runInContext(src, ctx, { filename: rel });
}

const sandbox: Record<string, unknown> = {};
runDashboardScript('dashboard/engine.js', sandbox);
const Model = sandbox.LaunchModel as {
  computeField: (protocols: unknown[], watchlist: string[], asOf: string, floor: number) => RadarField;
};
const Plans = sandbox.LaunchPlans as { stepsFor: (row: RadarRow) => string[] };
if (!Model || !Plans) fail('dashboard/engine.js did not load LaunchModel and LaunchPlans into the sandbox');

interface RadarRow {
  slug: string; name: string; rank: number; cls: string; category: string | null;
  chains: string[]; watchlist: boolean; below_floor: boolean;
  tvl_usd: number; implied_value_usd: number; score: number; band: string;
  economics: { position_usd: number; hours_per_week: number };
  [k: string]: unknown;
}
interface RadarField {
  ranked: RadarRow[]; parked: unknown[]; live: unknown[];
  context: { scan: { protocols: number; pre_token: number; ranked: number; parked: number; live: number; watchlist: number } };
}

const field = Model.computeField(snap.protocols as unknown[], snap.watchlist, snap.as_of, snap.floor_usd);

// ---------------------------------------------------------------- board

const board = field.ranked.map((r) => ({
  slug: r.slug,
  name: r.name,
  rank: r.rank,
  implied_value_usd: r.implied_value_usd,
  farm_steps: Plans.stepsFor(r),
  // extra keys are allowed by the gate and make the board self-describing:
  score: r.score, band: r.band, odds: r.odds, category: r.category,
  chains: r.chains, tvl_usd: r.tvl_usd, watchlist: r.watchlist,
}));

/** The gate's checks, run here first: a board that fails never ships. */
function audit(rows: typeof board, watchlist: string[]): string | null {
  const bySlug = new Map<string, Record<string, unknown>>();
  for (const p of snap.protocols as Array<Record<string, unknown>>) bySlug.set(p.slug as string, p);
  if (rows.length < 100 || rows.length > 4000) return `${rows.length} rows, the gate wants 100 to 4000`;
  const seen = new Set<string>();
  let allSame = true, firstVal = -1;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]!;
    if (!bySlug.has(r.slug)) return `row ${i + 1}: slug ${r.slug} is not one of the snapshot's protocols`;
    if (seen.has(r.slug)) return `row ${i + 1}: slug ${r.slug} appears twice`;
    seen.add(r.slug);
    if (!r.name || typeof r.name !== 'string') return `row ${i + 1}: empty name`;
    if (!Number.isSafeInteger(r.rank) || r.rank !== i + 1) return `row ${i + 1}: rank is ${r.rank}, expected ${i + 1}`;
    const v = r.implied_value_usd;
    if (!Number.isSafeInteger(v) || v <= 0 || v > 100_000_000_000_000) return `row ${i + 1}: implied_value_usd ${v} is out of range`;
    if (firstVal < 0) firstVal = v; else if (v !== firstVal) allSame = false;
    if (i > 0 && v > rows[i - 1]!.implied_value_usd) return `row ${i + 1}: implied value rises as rank ascends`;
    const steps = r.farm_steps;
    if (!Array.isArray(steps) || steps.length < 3 || steps.length > 12) return `${r.slug}: ${steps.length} farm steps, the gate wants 3 to 12`;
    for (const s of steps) {
      const t = String(s).trim();
      if (t.length < 20 || t.length > 600) return `${r.slug}: a farm step is ${t.length} characters, the gate wants 20 to 600`;
    }
  }
  if (allSame && rows.length >= 2) return 'every implied value is identical: the board ranks nothing';
  for (const w of watchlist) if (!seen.has(w)) return `watchlist slug ${w} is missing from the board`;
  return null;
}

const issue = audit(board, snap.watchlist);
if (issue !== null) fail(`the model wrote a board the gate refuses: ${issue}`);

// ---------------------------------------------------------------- output

const out = arg('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');
mkdirSync(out, { recursive: true });

const boardBytes = Buffer.from(`${JSON.stringify({ rows: board }, null, 1)}\n`, 'utf8');
if (boardBytes.length > 8 * 1024 * 1024) fail(`board.json is ${boardBytes.length} bytes, over the 8 MiB the gate allows`);
writeFileSync(join(out, 'board.json'), boardBytes);

const dataJs = `globalThis.RADAR_DATA = ${JSON.stringify({
  as_of: snap.as_of,
  floor_usd: snap.floor_usd,
  protocols: snap.protocols,
  watchlist: snap.watchlist,
})};\n`;
writeFileSync(join(out, 'data.js'), dataJs);

/** Copy one directory's regular files into `to`, skipping dot names. */
function copyFiles(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const copied: string[] = [];
  for (const name of readdirSync(from)) {
    if (name.startsWith('.')) continue;
    const path = join(from, name);
    if (!statSync(path).isFile()) continue;
    copyFileSync(path, join(to, name));
    copied.push(name);
  }
  return copied;
}

const dashFiles = copyFiles(join(here, 'dashboard'), join(out, 'dashboard'));
if (!dashFiles.includes('index.html')) fail('dashboard/ has no index.html');
if (!dashFiles.some((f) => f.endsWith('.css'))) fail('dashboard/ has no .css file');
if (!dashFiles.some((f) => f.endsWith('.js'))) fail('dashboard/ has no .js file');

// ---------------------------------------------------------------- screenshots

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG_MAGIC = [0xff, 0xd8, 0xff];
const IMAGE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

/** Whole-image dimensions: PNG's IHDR, or a JPEG baseline/progressive SOF marker. */
function imageSize(bytes: Uint8Array): { w: number; h: number } | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (PNG_MAGIC.every((b, i) => bytes[i] === b)) return { w: view.getUint32(16), h: view.getUint32(20) };
  if (!JPEG_MAGIC.every((b, i) => bytes[i] === b)) return null;
  let at = 2;
  while (at + 9 < bytes.length) {
    if (bytes[at] !== 0xff) { at++; continue; }
    const marker = bytes[at + 1]!;
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd9) || marker === 0x01) { at += 2; continue; }
    const len = view.getUint16(at + 2);
    if ((marker >= 0xc0 && marker <= 0xcf) && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { h: view.getUint16(at + 5), w: view.getUint16(at + 7) };
    }
    at += 2 + len;
  }
  return null;
}

const shotsDir = join(here, 'screenshots');
const shots = existsSync(shotsDir) ? readdirSync(shotsDir).filter((n) => !n.startsWith('.')) : [];
if (shots.length < 3 || shots.length > 4) {
  fail(`screenshots/ holds ${shots.length} image${shots.length === 1 ? '' : 's'} — hand in 3 or 4 (board, detail view, filtered view), then rerun`);
}
mkdirSync(join(out, 'screenshots'), { recursive: true });
for (const name of shots) {
  if (!IMAGE_NAME.test(name)) fail(`screenshots/${name}: a name is letters, digits and . _ -, 1 to 128 characters`);
  const bytes = readFileSync(join(shotsDir, name));
  if (bytes.length > 524288) fail(`screenshots/${name} is ${bytes.length} bytes, over the 512 KiB cap`);
  const isPng = PNG_MAGIC.every((b, i) => bytes[i] === b);
  const isJpeg = JPEG_MAGIC.every((b, i) => bytes[i] === b);
  if (!isPng && !isJpeg) fail(`screenshots/${name} is neither a PNG nor a JPEG`);
  const dims = imageSize(bytes);
  if (dims === null) fail(`screenshots/${name}: dimensions cannot be read`);
  const long = Math.max(dims.w, dims.h), short = Math.min(dims.w, dims.h);
  if (long > 1440 || short < 800) fail(`screenshots/${name} is ${dims.w}x${dims.h} — the long side tops out at 1440 and the short side at 800`);
  copyFileSync(join(shotsDir, name), join(out, 'screenshots', name));
}

// ---------------------------------------------------------------- dossier (last)

const dossier = buildDossier(out, {
  text_max_bytes: 65536,
  screenshots: { max: 4, max_bytes: 524288 },
  dashboard: { max_files: 400, max_bytes: 4194304 },
});
writeFileSync(join(out, 'dossier.json'), dossier);

const scan = field.context.scan;
process.stdout.write(
  `launch radar: snapshot ${snap.as_of} — ${scan.protocols} protocols scanned, ${scan.ranked} ranked ` +
  `(watchlist ${scan.watchlist}/${scan.watchlist} covered), ${scan.parked} set aside, ${scan.live} already tokened\n` +
  `launch radar: board.json ${boardBytes.length} bytes, data.js ${dataJs.length} bytes, ` +
  `dashboard/ ${dashFiles.length} files, screenshots/ ${shots.length} images, dossier.json ${dossier.length} bytes\n`,
);
