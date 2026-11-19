import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const image = process.env.RADAR_NODE_IMAGE ?? 'node@sha256:de170b39439eb0e5a3444ad7d60b015614a381e10fecae2e30ec9e735122f38d';
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
function manifest(dir, rel = '') {
  return readdirSync(join(dir, rel), { withFileTypes: true }).sort((a, b) => a.name < b.name ? -1 : 1).flatMap((item) => {
    const path = rel + item.name;
    if (item.isDirectory()) return manifest(dir, `${path}/`);
    const bytes = readFileSync(join(dir, path));
    return [{ path, bytes: bytes.length, sha256: sha(bytes) }];
  });
}

test('two independent Node 22 containers produce byte-identical artifacts within the sealed resource budget', {
  skip: !process.env.RADAR_DOCKER || !process.env.RADAR_KIT, timeout: 240_000,
}, () => {
  const evidence = resolve(process.env.RADAR_EVIDENCE_DIR ?? mkdtempSync(join(tmpdir(), 'loom-sandbox-')));
  mkdirSync(evidence, { recursive: true });
  const runs = [];
  for (const [i, timezone, language] of [[1, 'UTC', 'C'], [2, 'Pacific/Kiritimati', 'de_DE.UTF-8']]) {
    const out = join(evidence, `run-${i}`);
    mkdirSync(out, { recursive: true });
    assert.deepEqual(readdirSync(out), [], 'each container receives a fresh output directory');
    const launch = process.hrtime.bigint();
    const run = spawnSync('docker', ['run', '--rm', '--pull=never', '--network=none', '--read-only',
      '--cpus=1', '--memory=1024m', '--memory-swap=1024m', '--pids-limit=64',
      '--cap-drop=ALL', '--security-opt=no-new-privileges', `--user=${process.getuid()}:${process.getgid()}`,
      '--mount', `type=bind,src=${root},dst=/bot,readonly`,
      '--mount', `type=bind,src=${resolve(process.env.RADAR_KIT, 'input')},dst=/input,readonly`,
      '--mount', `type=bind,src=${out},dst=/output`,
      '--workdir=/bot', '-e', `TZ=${timezone}`, '-e', `LANG=${language}`,
      image, 'node', '--input-type=module', '-e',
      `const start=performance.now();await import('./main.ts');console.log(JSON.stringify({node:process.version,wall_ms:performance.now()-start,resources:process.resourceUsage()}));`,
    ], { encoding: 'utf8', timeout: 125_000, maxBuffer: 1024 * 1024 });
    assert.equal(run.status, 0, run.stderr || String(run.error));
    const metrics = JSON.parse(run.stdout.trim());
    assert.ok(metrics.wall_ms < 120_000);
    assert.ok(metrics.resources.maxRSS < 1024 * 1024);
    runs.push({ run: i, out, timezone, language, container_wall_ms: Number(process.hrtime.bigint() - launch) / 1e6, ...metrics, files: manifest(out) });
  }
  assert.deepEqual(runs[0].files, runs[1].files, 'all output paths, sizes and hashes match');
  const canonicalManifest = runs[0].files.map((f) => `${f.sha256}  ${f.path}\n`).join('');
  const result = { image, deterministic: true, manifest_sha256: sha(canonicalManifest), runs };
  writeFileSync(join(evidence, 'sandbox-evidence.json'), `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify({ evidence, image, deterministic: true, manifest_sha256: result.manifest_sha256,
    runs: runs.map(({ files, ...metrics }) => ({ ...metrics, file_count: files.length, total_bytes: files.reduce((n, f) => n + f.bytes, 0) })) }, null, 2));
});
