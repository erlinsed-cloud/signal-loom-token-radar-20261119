import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { openChrome, until } from './chrome.mjs';

const entry = fileURLToPath(new URL('../main.ts', import.meta.url));
const browser = (name, fn, timeout = 15_000) => test(name, { skip: !process.env.RADAR_CHROME, timeout }, fn);
const exemplar = (slug, name, fields) => ({
  slug, name, category: 'Lending', chains: ['Base'], tvl_usd: 100_000_000, change_7d: 0,
  listed_at: '2025-11-14', mcap_usd: null, gecko_id: null, symbol: null, ...fields,
});
const fixture = {
  as_of: '2026-11-14', source: 'DefiLlama fixture', floor_usd: 50_000_000,
  protocols: [
    exemplar('iris', 'Iris Reserve', { tvl_usd: 140e6, change_7d: 2 }),
    exemplar('maple', 'Maple Desk', { category: 'Risk Curators', chains: ['Ethereum', 'Base'], change_7d: 5 }),
    exemplar('star', 'Star Pool', { tvl_usd: 20e6, category: 'Dexs', chains: ['Solana'], change_7d: null, listed_at: null }),
    exemplar('token', 'Vela Token', { gecko_id: 'vela', symbol: 'VELA', mcap_usd: 41e6, tvl_usd: 350e6 }),
    exemplar('cloak', '<Ledger & Co>', { symbol: 'LEDG', chains: ['Solana'], category: 'Bridge', tvl_usd: 5e6 }),
  ],
  watchlist: ['iris', 'maple'],
};

async function desk(t, dataset = fixture) {
  const dir = mkdtempSync(join(tmpdir(), 'loom-browser-'));
  const input = typeof dataset === 'string' ? dataset : join(dir, 'snapshot.json');
  if (typeof dataset !== 'string') writeFileSync(input, JSON.stringify(dataset));
  const out = join(dir, 'out');
  execFileSync(process.execPath, [entry, '--input', input, '--preview'], {
    cwd: dir, env: { ...process.env, MAKEFUN_OUTPUT_DIR: out },
  });
  const board = JSON.parse(readFileSync(join(out, 'board.json'), 'utf8'));
  try {
    const page = await openChrome(t, join(dir, 'profile'), join(out, 'dashboard/index.html'));
    return { ...page, board };
  } finally {
    // Chromium subprocesses can still drain profile writes after the main process exits.
    t.after(() => rm(dir, { recursive: true, force: true, maxRetries: 5 }));
  }
}

browser('fresh offline board defaults to the watchlist in model-rank order', async (t) => {
  const { value, board } = await desk(t);
  const visible = await value(`Array.from(document.querySelectorAll('#results tr[data-slug]'), (tr) => ({
    slug: tr.dataset.slug, value: Number(tr.querySelector('[data-value]').dataset.value),
  }))`);
  assert.deepEqual(visible, board.rows.filter((r) => r.watchlist).map((r) => ({ slug: r.slug, value: r.implied_value_usd })));
  assert.match(await value('document.body.innerText'), /No token recorded/);
  const widths = await value('({ scroll: document.documentElement.scrollWidth, content: document.documentElement.clientWidth, viewport: innerWidth })');
  assert.ok(widths.scroll <= widths.content, JSON.stringify(widths));
});

browser('valuation labels name the token-market-cap proxy and distinguish price and FDV', async (t) => {
  const { value } = await desk(t);
  assert.match(await value(`document.querySelector('[data-sort="implied_value_usd"]').textContent`), /Token-cap proxy/i);
  assert.match(await value(`document.getElementById('value-target').textContent`), /hypothetical token market cap.*not token price, FDV/i);
  await value(`document.querySelector('#results a').click()`);
  await until(() => value(`!document.getElementById('case-view').hidden`));
  assert.match(await value(`document.querySelector('.case-price .eyebrow').textContent`), /TOKEN-CAP PROXY.*USD/i);
});

browser('scope controls separate the house list, unrecorded tokens and recorded tokens', async (t) => {
  const { value, board } = await desk(t);
  const expected = {
    early: board.rows.filter((row) => !row.token_recorded),
    market: board.rows.filter((row) => row.token_recorded),
    all: board.rows,
  };
  for (const [scope, rows] of Object.entries(expected)) {
    await value(`document.querySelector('[data-scope="${scope}"]').click()`);
    assert.deepEqual(await value(`Array.from(document.querySelectorAll('#results [data-slug]'), (tr) => tr.dataset.slug)`), rows.map((r) => r.slug));
    assert.equal(await value(`document.querySelector('[data-scope="${scope}"]').getAttribute('aria-pressed')`), 'true');
  }
  assert.match(await value(`document.querySelector('tr[data-slug="cloak"]').textContent`), /<Ledger & Co>/);
});

const slugs = (value) => value(`Array.from(document.querySelectorAll('#results tr[data-slug]'), (tr) => tr.dataset.slug)`);
const choose = (value, id, input, event = 'change') => value(`(() => {
  const el = document.getElementById(${JSON.stringify(id)});
  el.value = ${JSON.stringify(input)};
  el.dispatchEvent(new Event(${JSON.stringify(event)}, { bubbles: true }));
})()`);

browser('search, category and any recorded chain intersect and can be cleared', async (t) => {
  const { value } = await desk(t);
  await value(`document.querySelector('[data-scope="early"]').click()`);
  await choose(value, 'chain', 'Base');
  assert.deepEqual(await slugs(value), ['iris', 'maple']);
  await choose(value, 'category', 'Risk Curators');
  assert.deepEqual(await slugs(value), ['maple']);
  await choose(value, 'search', '  NO MATCH  ', 'input');
  assert.deepEqual(await slugs(value), []);
  assert.equal(await value(`document.getElementById('empty').hidden`), false);
  await choose(value, 'search', '  MAPLE  ', 'input');
  assert.deepEqual(await slugs(value), ['maple']);
  await value(`document.getElementById('clear-filters').click()`);
  assert.deepEqual(await slugs(value), ['iris', 'maple', 'star']);
});

browser('numeric header sort toggles direction and leaves unreported values last', async (t) => {
  const { value } = await desk(t);
  await value(`document.querySelector('[data-scope="early"]').click()`);
  const sort = `document.querySelector('[data-sort="change_7d"]')`;
  await value(`${sort}.click()`);
  assert.deepEqual(await slugs(value), ['maple', 'iris', 'star']);
  assert.equal(await value(`${sort}.parentElement.getAttribute('aria-sort')`), 'descending');
  await value(`${sort}.click()`);
  assert.deepEqual(await slugs(value), ['iris', 'maple', 'star']);
  assert.equal(await value(`${sort}.parentElement.getAttribute('aria-sort')`), 'ascending');
});

browser('keyboard-opened case shows the selected valuation and plan, then restores board focus', async (t) => {
  const { cdp, value, board } = await desk(t);
  await choose(value, 'category', 'Risk Curators');
  const link = `document.querySelector('tr[data-slug="maple"] a')`;
  await value(`${link}.focus()`);
  for (const type of ['keyDown', 'keyUp']) {
    await cdp('Input.dispatchKeyEvent', { type, key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  }
  await until(() => value(`!document.getElementById('case-view').hidden`));
  const row = board.rows.find((record) => record.slug === 'maple');
  assert.equal(await value(`document.activeElement.id`), 'case-title');
  assert.equal(await value(`document.getElementById('case-title').textContent`), row.name);
  assert.equal(await value(`Number(document.getElementById('case-value').dataset.value)`), row.implied_value_usd);
  assert.deepEqual(await value(`Array.from(document.querySelectorAll('#drivers [data-contribution]'), el => Number(el.dataset.contribution))`), row.contributions_log2);
  assert.deepEqual(await value(`Array.from(document.querySelectorAll('#case-plan li'), el => el.querySelector('strong').textContent + ' — ' + el.querySelector('p').textContent)`), row.farm_steps);
  await value(`document.getElementById('back-to-board').click()`);
  await until(() => value('!document.getElementById("board-view").hidden'));
  assert.deepEqual(await slugs(value), ['maple']);
  assert.equal(await value(`${link} === document.activeElement`), true);
});

browser('farm case labels research time as an estimate and forbids live financial actions', async (t) => {
  const { value } = await desk(t);
  await value(`document.querySelector('#results a').click()`);
  await until(() => value(`!document.getElementById('case-view').hidden`));
  assert.match(await value(`document.getElementById('plan-summary').textContent`), /estimated/i);
  assert.match(await value(`document.getElementById('plan-boundary').textContent`), /no wallets.*trades.*deposits/i);
});

browser('observed-cap quality labels preserve null, zero, negative and positive raw values in the DOM', async (t) => {
  const cases = [
    { slug: 'missing-cap', name: 'Missing Cap', mcap_usd: null },
    { slug: 'zero-cap', name: 'Zero Cap', mcap_usd: 0 },
    { slug: 'negative-cap', name: 'Negative Cap', mcap_usd: -1 },
    { slug: 'positive-cap', name: 'Positive Cap', mcap_usd: 42_000_000 },
  ].map((fields) => exemplar(fields.slug, fields.name, {
    ...fields, gecko_id: `token-${fields.slug}`, symbol: fields.slug.toUpperCase().replaceAll('-', '_'),
  }));
  const dataset = { ...fixture, protocols: cases, watchlist: cases.map(({ slug }) => slug) };
  const { value, board } = await desk(t, dataset);
  const seen = [];
  for (const record of cases) {
    await value(`location.hash = 'case=' + encodeURIComponent(${JSON.stringify(record.slug)})`);
    await until(() => value(`document.getElementById('case-title').textContent === ${JSON.stringify(record.name)}`));
    seen.push(await value(`(() => ({
      label: document.getElementById('case-observed').textContent,
      raw: document.getElementById('case-observed').dataset.rawMcap,
      token: document.getElementById('case-label').textContent,
    }))()`));
  }
  assert.deepEqual(seen, [
    { label: 'Observed market cap: not recorded', raw: 'null', token: 'Lending  /  Token recorded · MISSING_CAP  /  House watchlist' },
    { label: 'Observed market cap: unusable / non-positive (raw mcap_usd=0)', raw: '0', token: 'Lending  /  Token recorded · ZERO_CAP  /  House watchlist' },
    { label: 'Observed market cap: unusable / non-positive (raw mcap_usd=-1)', raw: '-1', token: 'Lending  /  Token recorded · NEGATIVE_CAP  /  House watchlist' },
    { label: 'Observed market cap: $42.00M', raw: '42000000', token: 'Lending  /  Token recorded · POSITIVE_CAP  /  House watchlist' },
  ]);
  const expectedRaw = Object.fromEntries(cases.map(({ slug, mcap_usd }) => [slug, [mcap_usd, true]]));
  assert.deepEqual(Object.fromEntries(board.rows.map(({ slug, mcap_usd, token_recorded }) => [slug, [mcap_usd, token_recorded]])), expectedRaw);
  assert.deepEqual(
    Object.fromEntries(await value(`SIGNAL_LOOM.rows.map(({ slug, mcap_usd, token_recorded }) => [slug, [mcap_usd, token_recorded]])`)),
    expectedRaw,
  );
});

browser('model notes disclose transformations, bounded assumptions and the measured holdout', async (t) => {
  if (!process.env.RADAR_SNAPSHOT) return t.skip('set RADAR_SNAPSHOT to the sealed snapshot');
  const { value, board } = await desk(t, process.env.RADAR_SNAPSHOT);
  await value(`document.querySelector('#results a').click()`);
  await until(() => value(`!document.getElementById('case-view').hidden`));
  const notes = await value(`document.querySelector('#methodology').textContent`);
  for (const pattern of [/log2/i, /25%/, /eight years/i, /bounded positive slopes/i, /five.fold/i, /no.*forecast/i]) assert.match(notes, pattern);
  for (const coefficient of board.model.coefficients) assert.ok(notes.includes(coefficient.toFixed(6)));
  assert.ok(notes.includes(String(board.model.holdout.samples)));
});

browser('every sealed record opens a case backed by the same exact value and five-step plan', async (t) => {
  if (!process.env.RADAR_SNAPSHOT) return t.skip('set RADAR_SNAPSHOT to the sealed snapshot');
  const { value, board } = await desk(t, process.env.RADAR_SNAPSHOT);
  const audit = await value(`(async () => {
    const bad = [];
    let checked = 0;
    for (const row of SIGNAL_LOOM.rows) {
      const changed = new Promise(resolve => window.addEventListener('hashchange', resolve, { once:true }));
      location.hash = 'case=' + encodeURIComponent(row.slug);
      const navigation = await Promise.race([changed, new Promise(resolve => setTimeout(() => resolve('timeout'), 1000))]);
      if (navigation === 'timeout') return { checked, bad, blockedAt:row.slug, href:location.href };
      checked++;
      const name = document.getElementById('case-title').textContent;
      const dollars = Number(document.getElementById('case-value').dataset.value);
      const steps = Array.from(document.querySelectorAll('#case-plan li'), el => el.querySelector('strong').textContent + ' — ' + el.querySelector('p').textContent);
      if (name !== row.name || dollars !== row.implied_value_usd || JSON.stringify(steps) !== JSON.stringify(row.farm_steps)) bad.push(row.slug);
    }
    return { checked, bad };
  })()`);
  assert.equal(audit.checked, board.rows.length, JSON.stringify(audit));
  assert.deepEqual(audit.bad, []);
}, 90_000);

browser('full snapshot stays inside the viewport on board and case at desktop and mobile sizes', async (t) => {
  if (!process.env.RADAR_SNAPSHOT) return t.skip('set RADAR_SNAPSHOT to the sealed snapshot');
  const { value, cdp, board } = await desk(t, process.env.RADAR_SNAPSHOT);
  for (const width of [1400, 1024, 800, 390]) {
    await cdp('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: false });
    await value(`location.hash = 'board'`);
    await until(() => value(`!document.getElementById('board-view').hidden`));
    await value(`document.querySelector('[data-scope="all"]').click()`);
    assert.deepEqual(await slugs(value), board.rows.map((r) => r.slug));
    const measure = () => value(`({scroll:document.documentElement.scrollWidth,client:document.documentElement.clientWidth})`);
    let size = await measure();
    assert.ok(size.scroll <= size.client, `board ${width}: ${JSON.stringify(size)}`);
    await value(`location.hash = 'case=steakhouse-financial'`);
    await until(() => value(`!document.getElementById('case-view').hidden`));
    size = await measure();
    assert.ok(size.scroll <= size.client, `case ${width}: ${JSON.stringify(size)}`);
  }
});
