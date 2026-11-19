import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync, lstatSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const kit = process.env.RADAR_KIT;
const caps = { text_max_bytes: 65536, screenshots: { max: 4, max_bytes: 524288 }, dashboard: { max_files: 400, max_bytes: 4194304 } };
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
function files(dir, prefix = '') {
  return readdirSync(dir).sort().flatMap((name) => {
    const path = join(dir, name), rel = prefix + name, stat = lstatSync(path);
    assert.ok(stat.isFile() || stat.isDirectory(), `plain path: ${rel}`);
    return stat.isDirectory() ? files(path, `${rel}/`) : [{ rel, path, bytes: readFileSync(path) }];
  });
}

test('normal entry emits the complete sealed-file contract and the unmodified official dossier', { skip: !kit }, async (t) => {
  const { buildDossier, PLAIN_NAME } = await import(pathToFileURL(join(kit, 'starter/vendor/makefun-board.ts')));
  const source = readFileSync(join(kit, 'input/snapshot.json'), 'utf8');
  const snapshot = JSON.parse(source);
  const { boardIssue } = await import(pathToFileURL(join(kit, 'starter/lib/model.ts')));
  const dir = mkdtempSync(join(tmpdir(), 'loom-contract-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const run = spawnSync(process.execPath, [join(root, 'main.ts'), '--input', join(kit, 'input/snapshot.json')], {
    cwd: dir, env: { ...process.env, MAKEFUN_OUTPUT_DIR: dir }, encoding: 'utf8',
  });
  assert.equal(run.status, 0, run.stderr);
  const dossier = readFileSync(join(dir, 'dossier.json'));
  assert.deepEqual(dossier, Buffer.from(buildDossier(dir, caps)), 'official byte equality');
  assert.deepEqual(readFileSync(join(root, 'vendor/makefun-board.ts')), readFileSync(join(kit, 'starter/vendor/makefun-board.ts')));
  assert.ok(dossier.length <= 1572864, 'competition dossier cap');
  const doc = JSON.parse(dossier);
  assert.doesNotMatch(doc.text, /\[Cut at|lines not shown|bytes left out/, 'all dashboard source is visible');
  const boardBytes = readFileSync(join(dir, 'board.json'));
  assert.ok(boardBytes.length <= 8388608);
  const { rows } = JSON.parse(boardBytes);
  assert.equal(boardIssue(rows, snapshot), null, 'official starter board validator');
  assert.equal(rows.length, snapshot.protocols.length);
  assert.ok(rows.length >= 100 && rows.length <= 4000);
  const known = new Map(snapshot.protocols.map((r) => [r.slug, r]));
  assert.equal(new Set(rows.map((r) => r.slug)).size, rows.length);
  for (const [i, r] of rows.entries()) {
    assert.ok(known.has(r.slug) && /^\S{1,128}$/.test(r.slug));
    assert.equal(r.name, known.get(r.slug).name);
    assert.equal(r.rank, i + 1);
    assert.ok(Number.isSafeInteger(r.implied_value_usd) && r.implied_value_usd > 0 && r.implied_value_usd <= 1e14);
    if (i) assert.ok(rows[i - 1].implied_value_usd >= r.implied_value_usd);
    assert.ok(r.farm_steps.length >= 3 && r.farm_steps.length <= 12);
    assert.ok(r.farm_steps.every((s) => typeof s === 'string' && s.trim().length >= 20 && s.trim().length <= 600));
  }
  assert.ok(new Set(rows.map((r) => r.implied_value_usd)).size > 1);
  for (const slug of snapshot.watchlist) assert.ok(rows.some((r) => r.slug === slug));
  const dashboard = files(join(dir, 'dashboard'));
  assert.ok(dashboard.length <= 400 && dashboard.reduce((n, f) => n + f.bytes.length, 0) <= 4194304);
  assert.ok(['index.html', 'desk.css', 'desk.js'].every((name) => dashboard.some((f) => f.rel === name)));
  for (const f of dashboard) {
    assert.ok(f.rel.split('/').every((part) => PLAIN_NAME.test(part)));
    const text = f.bytes.toString('utf8');
    if (/\.css$/.test(f.rel)) assert.doesNotMatch(text, /https?:\/\//i, 'no remote CSS address');
    if (/\.html$/.test(f.rel)) {
      assert.doesNotMatch(text, /\b[\w:-]+\s*=\s*(?:"[^"]*https?:\/\/|'[^']*https?:\/\/)/i, 'no remote HTML attribute');
      assert.doesNotMatch(text, /<style\b[^>]*>[\s\S]*?https?:\/\/[\s\S]*?<\/style>/i, 'no remote inline style');
    }
    if (/\.(?:m?js)$/.test(f.rel)) assert.doesNotMatch(text, /(?:\bfrom\s*|\b(?:import|require)\s*\(?\s*)["']https?:\/\//i, 'no remote JavaScript import');
  }
  const images = files(join(dir, 'screenshots'));
  assert.ok(images.length >= 3 && images.length <= 4);
  for (const f of images) {
    assert.ok(PLAIN_NAME.test(f.rel) && f.bytes.length <= 524288);
    assert.ok(f.bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])));
    const w = f.bytes.readUInt32BE(16), h = f.bytes.readUInt32BE(20);
    assert.ok(Math.max(w, h) <= 1440 && Math.min(w, h) >= 800, `${f.rel}: ${w}×${h}`);
    assert.equal(doc.images.find((im) => im.name === f.rel).sha256, sha(f.bytes));
  }
  assert.ok(doc.text.length > 0 && doc.images.length === images.length);
});
