'use strict';

const data = globalThis.SIGNAL_LOOM;
const $ = (id) => document.getElementById(id);
const integer = new Intl.NumberFormat('en-US');
const compactUSD = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 2 });
const usd = (value) => value === null ? '—' : compactUSD.format(value);
const count = (value) => integer.format(value);
const track = (value) => value === null ? '—' : `${value.toFixed(1)}y`;
const percent = (value) => value === null ? '—' : `${value > 0 ? '+' : ''}${value.toFixed(1)}%`;
const scopes = {
  watch: { label: 'House watchlist', accepts: (row) => row.watchlist },
  early: { label: 'No token recorded', accepts: (row) => !row.token_recorded },
  market: { label: 'Token recorded', accepts: (row) => row.token_recorded },
  all: { label: 'All records', accepts: () => true },
};
let scope = 'watch';
let sortKey = 'implied_value_usd';
let direction = -1;
let returnTo = null;
const categoryName = (row) => row.category ?? 'Unclassified';

function node(tag, text, className) {
  const el = document.createElement(tag);
  if (text !== undefined) el.textContent = text;
  if (className) el.className = className;
  return el;
}

function tableRow(row) {
  const tr = node('tr');
  tr.dataset.slug = row.slug;
  const protocol = node('th', undefined, 'protocol');
  protocol.scope = 'row';
  const chain = `${row.chains[0] ?? 'Chain unreported'}${row.chains.length > 1 ? ` +${row.chains.length - 1}` : ''}`;
  const note = row.reference_only ? ' · Reference only' : scope === 'all' && row.token_recorded ? ' · Token recorded' : '';
  const link = node('a', row.name, 'case-link');
  link.href = `#case=${encodeURIComponent(row.slug)}`;
  link.addEventListener('click', () => { returnTo = link; });
  protocol.append(link, node('span', `${categoryName(row)} · ${chain}${note}`, 'record-meta'));
  const value = node('td', usd(row.implied_value_usd), 'num value-col');
  value.dataset.value = row.implied_value_usd;
  value.title = `${count(row.implied_value_usd)} USD`;
  tr.append(node('td', String(row.rank).padStart(2, '0'), 'rank-col'), protocol, value,
    node('td', usd(row.tvl_usd), 'num tvl-col'),
    node('td', percent(row.change_7d), `num ${row.change_7d > 0 ? 'up' : row.change_7d < 0 ? 'down' : ''}`),
    node('td', track(row.tracking_years), 'num age-col'));
  return tr;
}

function compareRows(a, b) {
  const x = a[sortKey], y = b[sortKey];
  if (x === null || y === null) return Number(x === null) - Number(y === null) || a.rank - b.rank;
  const order = typeof x === 'string' ? x.localeCompare(y, 'en') : x - y;
  return direction * order || a.rank - b.rank;
}

function renderBoard() {
  const { label, accepts } = scopes[scope];
  const query = $('search').value.trim().toLowerCase();
  const category = $('category').value;
  const chain = $('chain').value;
  const inScope = data.rows.filter(accepts);
  const rows = inScope.filter((row) =>
    (!category || categoryName(row) === category) && (!chain || row.chains.includes(chain)) &&
    (!query || [row.name, row.slug, row.symbol, ...row.chains].some((part) => part?.toLowerCase().includes(query)))).sort(compareRows);
  $('list-title').textContent = label;
  $('result-count').textContent = query || category || chain
    ? `${count(rows.length)} / ${count(inScope.length)} MATCH` : `${count(rows.length)} RECORDS`;
  $('results').replaceChildren(...rows.map(tableRow));
  $('empty').hidden = rows.length > 0;
  for (const button of $('scopes').querySelectorAll('button')) {
    button.setAttribute('aria-pressed', String(button.dataset.scope === scope));
  }
  for (const button of document.querySelectorAll('[data-sort]')) {
    if (button.dataset.sort === sortKey) button.parentElement.setAttribute('aria-sort', direction === 1 ? 'ascending' : 'descending');
    else button.parentElement.removeAttribute('aria-sort');
  }
}

function installFilters() {
  for (const [id, options] of [['category', data.rows.map(categoryName)], ['chain', data.rows.flatMap((r) => r.chains)]]) {
    for (const text of [...new Set(options)].sort((a, b) => a.localeCompare(b, 'en'))) {
      const option = node('option', text);
      option.value = text;
      $(id).append(option);
    }
    $(id).addEventListener('change', renderBoard);
  }
  $('search').addEventListener('input', renderBoard);
  $('clear-filters').addEventListener('click', () => {
    for (const id of ['search', 'category', 'chain']) $(id).value = '';
    renderBoard();
  });
}

function driverList(row) {
  const labels = ['Scale · TVL', 'Momentum · 7d TVL', 'Tenure · tracked'];
  const readings = [usd(row.tvl_usd), percent(row.change_7d), track(row.tracking_years)];
  const magnitude = Math.max(0.5, ...row.contributions_log2.map(Math.abs));
  return row.contributions_log2.map((term, i) => {
    const item = node('li');
    item.dataset.contribution = term;
    const bar = node('span', undefined, `driver-bar ${term < 0 ? 'negative' : 'positive'}`);
    bar.setAttribute('aria-hidden', 'true');
    bar.style.setProperty('--extent', `${Math.abs(term) / magnitude * 50}%`);
    item.append(node('span', labels[i], 'driver-name'), node('span', readings[i], 'driver-reading'),
      bar, node('strong', `${(2 ** term).toFixed(2)}×`, 'driver-factor'));
    return item;
  });
}

function renderCase(row) {
  const model = data.model;
  const token = row.token_recorded ? `Token recorded${row.symbol ? ` · ${row.symbol}` : ''}` : 'No token recorded';
  $('case-title').textContent = row.name;
  $('case-label').textContent = [categoryName(row), token, row.watchlist ? 'House watchlist' : row.reference_only ? 'Reference only' : null].filter(Boolean).join('  /  ');
  $('case-rank').textContent = `SNAPSHOT RANK ${count(row.rank)} / ${count(data.rows.length)}`;
  $('case-value').textContent = usd(row.implied_value_usd);
  $('case-value').title = `${count(row.implied_value_usd)} USD`;
  $('case-value').dataset.value = row.implied_value_usd;
  $('case-observed').textContent = row.mcap_usd === null ? 'Observed market cap: not recorded' : `Observed market cap: ${usd(row.mcap_usd)}`;
  $('case-facts').replaceChildren(...[
    ['TVL · USD', usd(row.tvl_usd)], ['TVL CHANGE · 7 DAYS', percent(row.change_7d)],
    ['TRACKED SINCE', row.tracking_years === null ? 'Not usable' : `${row.listed_at} · ${track(row.tracking_years)}`],
    ['RECORDED CHAINS', row.chains.join(', ') || 'Unreported'],
  ].map(([label, value]) => {
    const field = node('div');
    field.append(node('dt', label, 'eyebrow'), node('dd', value));
    return field;
  }));
  $('case-base').textContent = `Start at ${usd(Math.round(2 ** model.base_log2_usd))}: $100M TVL, flat 7d change, one year tracked. Multiply by the factors below.`;
  $('drivers').replaceChildren(...driverList(row));
  $('case-range').textContent = row.range_usd ? `${usd(row.range_usd[0])} – ${usd(row.range_usd[1])}` : 'Too few comparable tokens';
  const missing = [row.change_7d === null ? 'growth' : null, row.tracking_years === null ? 'tracking date' : null].filter(Boolean);
  const evidence = `${row.peer_count} same-category anchors; the model pools all ${model.anchor_count} anchors. Tracking is not tokenless tenure.`;
  $('case-cautions').textContent = [evidence,
    missing.length ? `Unreported or unusable ${missing.join(' and ')} use a neutral factor.` : '',
    row.reference_only ? 'This is a reference record, not evidence of an independent launch.' : 'The snapshot cannot establish future issuance or a reward.',
  ].filter(Boolean).join(' ');
  const [scale, momentum, tenure] = model.coefficients.map((weight) => weight.toFixed(6));
  $('method-formula').textContent = `log2(value USD) = ${model.base_log2_usd.toFixed(6)} + ${scale} × log2(TVL / $100M) + ${momentum} × G + ${tenure} × A. Displayed coefficients are rounded; calculation uses full precision.`;
  const held = model.holdout;
  $('method-holdout').textContent = held
    ? `Five-fold deterministic holdout by token: ${held.samples} observed-cap anchors, each fitted without its own fold. Median absolute log2 error becomes a ${held.error_factor.toFixed(2)}× error factor; the TVL-only refit is ${held.tvl_only_factor.toFixed(2)}×. P10–P90 signed held-out residuals give the displayed spread. This is a traded-token cross-section, not a time-series or launch forecast; a small baseline difference establishes no forecast skill.`
    : `Too few independent anchors for a five-fold evaluation (minimum 15); no empirical spread is shown.${model.anchor_count < 8 ? ' Fewer than eight anchors: prior slopes are retained and only median scale is calibrated.' : ''} No launch forecast or accuracy claim is made.`;
  $('plan-summary').textContent = `${row.research.label} · ${row.research.chain} · ${row.research.minutes} min estimated · $0 actual spend`;
  $('case-plan').replaceChildren(...row.farm_steps.map((step) => {
    const at = step.indexOf(' — ');
    const item = node('li');
    item.append(node('strong', step.slice(0, at)), node('p', step.slice(at + 3)));
    return item;
  }));
}

function routeCase() {
  const slug = new URLSearchParams(location.hash.slice(1)).get('case');
  const row = slug && data.rows.find((record) => record.slug === slug);
  const wasInCase = !$('case-view').hidden;
  $('board-view').hidden = Boolean(row);
  $('case-view').hidden = !row;
  if (row) {
    renderCase(row);
    window.scrollTo(0, 0);
    $('case-title').focus({ preventScroll: true });
  } else if (wasInCase) {
    (returnTo?.isConnected ? returnTo : $('board-title')).focus();
    returnTo = null;
  }
}

function init() {
  if (!data) { $('data-error').hidden = false; return; }
  $('edition-date').dateTime = data.as_of;
  $('edition-date').textContent = data.as_of;
  $('universe-size').textContent = `${count(data.rows.length)} protocol records`;
  for (const button of $('scopes').querySelectorAll('button')) {
    const key = button.dataset.scope;
    button.append(node('span', count(data.rows.filter(scopes[key].accepts).length), 'scope-count'));
    button.addEventListener('click', () => { scope = key; renderBoard(); });
  }
  for (const button of document.querySelectorAll('[data-sort]')) {
    button.addEventListener('click', () => {
      const key = button.dataset.sort;
      direction = key === sortKey ? -direction : key === 'name' ? 1 : -1;
      sortKey = key;
      renderBoard();
    });
  }
  installFilters();
  renderBoard();
  $('floor-note').textContent = `The house watchlist starts at ${usd(data.floor_usd)} TVL and excludes specified product, custody and bridge records. It is a floor, not the full universe.`;
  $('peer-note').textContent = `${count(data.model.anchor_count)} deduplicated token records calibrate ${data.model.anchor_count < 8 ? 'a prior-based model' : 'a robust fit'} on TVL, 7d TVL change and tracking age.`;
  const held = data.model.holdout;
  if (held) {
    $('holdout').append(node('dt', 'Held-out error factor'), node('dd', `${held.error_factor.toFixed(2)}×`),
      node('dt', 'TVL-only baseline'), node('dd', `${held.tvl_only_factor.toFixed(2)}×`));
  }
  $('snapshot-source').textContent = data.source;
  window.addEventListener('hashchange', routeCase);
  routeCase();
}

init();
