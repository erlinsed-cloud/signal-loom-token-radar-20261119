import { cpSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildBoard } from './dashboard/model.mjs';
import { buildDossier } from './vendor/makefun-board.ts';

const args = process.argv.slice(2);
const inputFlag = args.indexOf('--input');
let input = inputFlag < 0 ? '/input/snapshot.json' : args[inputFlag + 1];
const output = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
let snapshot;
try {
  if (typeof input !== 'string' || input.startsWith('--')) throw new Error('--input requires a file or directory');
  if (statSync(input).isDirectory()) input = join(input, 'snapshot.json');
  snapshot = JSON.parse(readFileSync(input, 'utf8'));
} catch (error) {
  process.stderr.write(`Signal Loom: cannot read snapshot ${input ?? '(missing)'}: ${error.message}\n`);
  process.exit(2);
}
const board = buildBoard(snapshot);

mkdirSync(output, { recursive: true });
const json = JSON.stringify(board);
writeFileSync(join(output, 'board.json'), `${json}\n`);
// A classic script allows dashboard/index.html to open directly from disk, without fetch.
writeFileSync(join(output, 'data.js'), `globalThis.SIGNAL_LOOM = ${json.replaceAll('<', '\\u003c')};\n`);
cpSync(fileURLToPath(new URL('./dashboard', import.meta.url)), join(output, 'dashboard'), { recursive: true });

// Preview is only for isolated fixture tests and taking build-time screenshots.
// The no-flag sandbox run always emits the official dossier and real captured evidence.
if (!args.includes('--preview')) {
  const shots = fileURLToPath(new URL('./screenshots', import.meta.url));
  const names = readdirSync(shots).filter((name) => !name.startsWith('.'));
  if (names.length < 3 || names.length > 4) throw new Error('Signal Loom requires 3–4 real dashboard screenshots');
  cpSync(shots, join(output, 'screenshots'), { recursive: true });
  const dossier = buildDossier(output, {
    text_max_bytes: 65_536,
    screenshots: { max: 4, max_bytes: 524_288 },
    dashboard: { max_files: 400, max_bytes: 4_194_304 },
  });
  if (dossier.length > 1_572_864) throw new Error('Signal Loom dossier exceeds the competition cap');
  writeFileSync(join(output, 'dossier.json'), dossier);
}
