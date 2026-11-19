import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const entry = fileURLToPath(new URL('../main.ts', import.meta.url));
const protocol = (slug, fields = {}) => ({
  slug, name: slug, category: 'Lending', chains: ['Base'], tvl_usd: 100_000_000,
  change_7d: 0, listed_at: '2025-11-14', mcap_usd: null, gecko_id: null, symbol: null, ...fields,
});
const snapshot = (protocols, watchlist = []) => ({
  as_of: '2026-11-14', source: 'Frozen test fixture', floor_usd: 50_000_000, protocols, watchlist,
});

function preview(t, data) {
  const dir = mkdtempSync(join(tmpdir(), 'signal-loom-test-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const input = join(dir, 'snapshot.json');
  writeFileSync(input, JSON.stringify(data));
  const output = join(dir, 'out');
  const result = spawnSync(process.execPath, [entry, '--input', input, '--preview'], {
    env: { ...process.env, MAKEFUN_OUTPUT_DIR: output }, encoding: 'utf8', cwd: dir,
  });
  assert.equal(result.status, 0, result.stderr);
  return { output, board: JSON.parse(readFileSync(join(output, 'board.json'), 'utf8')) };
}

test('the entry ranks the whole snapshot, including market and watchlist rows', (t) => {
  const { board } = preview(t, snapshot([
    protocol('small', { tvl_usd: 10_000_000 }),
    protocol('observed', { gecko_id: 'observed', mcap_usd: 24_000_000 }),
    protocol('watch', { tvl_usd: 200_000_000 }),
  ], ['watch']));
  assert.deepEqual(board.rows.map(({ slug, rank }) => [slug, rank]), [['watch', 1], ['observed', 2], ['small', 3]]);
  const values = board.rows.map((row) => row.implied_value_usd);
  assert.ok(values.every((value) => Number.isSafeInteger(value) && value > 0));
  assert.ok(values[0] > values[1] && values[1] > values[2]);
});

test('growth and tracking age move the estimate at equal TVL', (t) => {
  const { board } = preview(t, snapshot([
    protocol('flat'), protocol('growing', { change_7d: 20 }),
    protocol('older', { listed_at: '2022-11-14' }),
    protocol('clipped', { change_7d: 25 }), protocol('spike', { change_7d: 2_500 }),
  ]));
  const value = Object.fromEntries(board.rows.map((row) => [row.slug, row.implied_value_usd]));
  assert.ok(value.growing > value.flat, 'positive 7d growth contributes');
  assert.ok(value.older > value.flat, 'longer DefiLlama tracking contributes');
  assert.equal(value.spike, value.clipped, 'a growth outlier cannot extrapolate the effect');
});

test('the fit learns scale from independent token records, not repeated listings or custody TVL', (t) => {
  const anchors = [25, 100, 400].flatMap((tvl) => [-20, 0, 20].map((growth) => {
    const id = `coin-${tvl}-${growth}`;
    return protocol(id, { gecko_id: id, change_7d: growth, tvl_usd: tvl * 1e6,
      mcap_usd: Math.round(32e6 * (tvl / 100) ** 0.95 * 2 ** (0.2 * growth / 25)) });
  }));
  const subject = protocol('subject', { tvl_usd: 400e6 });
  const aliases = Array.from({ length: 20 }, (_, i) => protocol(`alias-${i}`, {
    gecko_id: 'coin-400-20', tvl_usd: 5e6, mcap_usd: 9e10,
  }));
  const custody = protocol('custody', { category: 'CEX', gecko_id: 'custody', mcap_usd: 2e12 });
  const calibrated = (rows) => preview(t, snapshot([subject, ...rows])).board;
  const estimate = (board) => board.rows.find((row) => row.slug === subject.slug).implied_value_usd;
  const clean = calibrated(anchors);
  const noisy = calibrated([...aliases, custody, ...anchors].reverse());
  assert.equal(estimate(noisy), estimate(clean));
  assert.equal(noisy.model.anchor_count, 9);
  assert.ok(estimate(clean) > 110e6 && estimate(clean) < 130e6, 'learns a steeper slope than the TVL prior');
});

test('case values carry reproducible driver math and a held-out peer range', (t) => {
  const peers = Array.from({ length: 25 }, (_, i) => protocol(`peer-${i}`, {
    gecko_id: `token-${i}`, tvl_usd: 10e6 * (i + 1), mcap_usd: 16e6 * (1 + (i % 5)), change_7d: i - 12,
  }));
  const { board } = preview(t, snapshot([...peers, protocol('target', { tvl_usd: 150e6, change_7d: 5 })]));
  const { model } = board;
  assert.equal(model.holdout?.samples, peers.length);
  assert.equal(model.holdout.folds, 5);
  assert.ok(model.holdout.error_factor > 1 && model.holdout.tvl_only_factor >= 1);
  const row = board.rows.find((p) => p.slug === 'target');
  const reconstructed = model.base_log2_usd + row.contributions_log2.reduce((sum, term) => sum + term, 0);
  assert.equal(row.implied_value_usd, Math.round(2 ** reconstructed));
  assert.deepEqual(row.range_usd, model.holdout.residual_p10_p90.map((r) => Math.round(2 ** (reconstructed + r))));
  assert.ok(row.range_usd[0] < row.range_usd[1]);
});

test('farm tracks are chain-specific, costed and gated by product type and token evidence', (t) => {
  const { board } = preview(t, snapshot([
    protocol('reserve'),
    protocol('curator', { category: 'Risk Curators', chains: ['Ethereum'], symbol: 'RISK' }),
    protocol('route', { category: 'Bridge', chains: ['Arbitrum', 'Ethereum'] }),
  ], ['reserve']));
  const bySlug = Object.fromEntries(board.rows.map((row) => [row.slug, row]));
  for (const { farm_steps, research } of board.rows) {
    assert.ok(farm_steps?.length >= 3 && farm_steps.length <= 12, 'every row has a bounded plan');
    const minutes = farm_steps.map((step) => {
      assert.ok(step.trim().length >= 20 && step.trim().length <= 600);
      assert.match(step, / · \d+ min · \$0 — /);
      return Number(step.match(/ · (\d+) min/)[1]);
    });
    assert.equal(research.minutes, minutes.reduce((sum, n) => sum + n, 0));
  }
  assert.match(bySlug.reserve.farm_steps.join(' '), /Base.*utilization.*\$100.*liquidation/i);
  assert.match(bySlug.curator.farm_steps.join(' '), /Ethereum.*withdrawal queue.*recorded token/i);
  assert.match(bySlug.route.farm_steps.join(' '), /Arbitrum.*finality.*no bridge/i);
  assert.notEqual(bySlug.reserve.research.fee_scenario, bySlug.curator.research.fee_scenario);
  assert.equal(bySlug.route.research.fee_scenario, null);
});

test('collateral-market research inspects shared-security slashing instead of loan utilization', (t) => {
  const { board } = preview(t, snapshot([protocol('security', { category: 'Collateral Markets' })]));
  const plan = board.rows[0].farm_steps.join(' ');
  assert.match(plan, /slashing/i);
  assert.match(plan, /unlock|lock|exit/i);
  assert.doesNotMatch(plan, /95% utilization|reserve asset/i);
});

test('NFT marketplace research inspects ownership and executable bids instead of pool yield', (t) => {
  const { board } = preview(t, snapshot([protocol('collectibles', { category: 'NFT Marketplace' })]));
  const plan = board.rows[0].farm_steps.join(' ');
  assert.match(plan, /ownership/i);
  assert.match(plan, /royalt|bids/i);
  assert.doesNotMatch(plan, /pool pair|liquidity position/i);
});

test('OTC research checks quote expiry and delivery instead of assuming a liquidity pool', (t) => {
  const row = preview(t, snapshot([protocol('quote-desk', { category: 'OTC Marketplace' })])).board.rows[0];
  assert.equal(row.research.label, 'Quote and delivery');
  assert.match(row.farm_steps.join(' '), /quote expiry|quote expiration/i);
  assert.match(row.farm_steps.join(' '), /counterparty|delivery/i);
  assert.doesNotMatch(row.farm_steps.join(' '), /pool pair|fee tier|liquidity position/i);
});

test('uncollateralized lending research checks borrower credit and defaults, not liquidation ratios', (t) => {
  const row = preview(t, snapshot([protocol('credit', { category: 'Uncollateralized Lending' })])).board.rows[0];
  assert.equal(row.research.label, 'Credit and recourse');
  assert.match(row.farm_steps.join(' '), /credit|borrower/i);
  assert.match(row.farm_steps.join(' '), /default|recovery/i);
  assert.doesNotMatch(row.farm_steps.join(' '), /liquidation threshold|95% utilization/i);
});

test('prediction-market research checks resolution disputes rather than assumed leverage', (t) => {
  const row = preview(t, snapshot([protocol('outcomes', { category: 'Prediction Market' })])).board.rows[0];
  assert.equal(row.research.label, 'Resolution and claims');
  assert.match(row.farm_steps.join(' '), /resolution|outcome/i);
  assert.match(row.farm_steps.join(' '), /dispute|oracle/i);
  assert.doesNotMatch(row.farm_steps.join(' '), /margin asset|liquidation thresholds|funding/i);
});

test('invalid TVL fails clearly before any misleading board is written', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'loom-invalid-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const input = join(dir, 'snapshot.json'), output = join(dir, 'out');
  writeFileSync(input, JSON.stringify(snapshot([protocol('zero', { tvl_usd: 0 })])));
  const run = spawnSync(process.execPath, [entry, '--input', input, '--preview'], {
    env: { ...process.env, MAKEFUN_OUTPUT_DIR: output }, encoding: 'utf8',
  });
  assert.notEqual(run.status, 0);
  assert.match(run.stderr, /invalid snapshot.*tvl_usd/i);
  assert.equal(existsSync(join(output, 'board.json')), false);
});

test('CLI accepts an input directory and diagnoses malformed JSON without writing a board', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'loom-cli-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, 'snapshot.json'), JSON.stringify(snapshot([protocol('known')])));
  const output = join(dir, 'good');
  let run = spawnSync(process.execPath, [entry, '--input', dir, '--preview'], {
    env: { ...process.env, MAKEFUN_OUTPUT_DIR: output }, encoding: 'utf8',
  });
  assert.equal(run.status, 0, run.stderr);
  assert.equal(JSON.parse(readFileSync(join(output, 'board.json'))).rows[0].slug, 'known');
  writeFileSync(join(dir, 'snapshot.json'), '{not-json');
  const badOut = join(dir, 'bad');
  run = spawnSync(process.execPath, [entry, '--input', dir, '--preview'], {
    env: { ...process.env, MAKEFUN_OUTPUT_DIR: badOut }, encoding: 'utf8',
  });
  assert.notEqual(run.status, 0);
  assert.match(run.stderr, /Signal Loom: cannot read snapshot.*JSON/i);
  assert.equal(existsSync(join(badOut, 'board.json')), false);
});
