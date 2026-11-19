import { buildResearchPlan } from './plans.mjs';

const bySlug = (a, b) => a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
const MAX_VALUE = 100_000_000_000_000;
const YEAR_MS = 365.25 * 86_400_000;
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const tvlTerm = (tvl) => Math.log2(tvl / 100_000_000);
const dollars = (logValue) => Math.min(MAX_VALUE, Math.max(1, Math.round(2 ** logValue)));
const hasTokenRecord = (p) => Boolean(p.gecko_id || p.symbol);

function trackingYears(listed, asOf) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(listed ?? '')) return null;
  const start = Date.parse(listed);
  if (!Number.isFinite(start) || new Date(start).toISOString().slice(0, 10) !== listed || start > asOf) return null;
  return (asOf - start) / YEAR_MS;
}

function features(protocol, years) {
  return [
    tvlTerm(protocol.tvl_usd),
    Number.isFinite(protocol.change_7d) ? clamp(protocol.change_7d / 25, -1, 1) : 0,
    years === null ? 0 : Math.log2(1 + Math.min(years, 8)) - 1,
  ];
}

const prior = [0.65, 0.16, 0.30];
const bounds = [[0.20, 1.30], [0.04, 0.50], [0.08, 0.70]];
const dot = (weights, x) => weights.reduce((score, weight, i) => score + weight * x[i], 0);

const referenceOnly = new Set([
  'CEX', 'Bridge', 'Canonical Bridge', 'Cross Chain Bridge', 'Stablecoin Issuer', 'Stablecoin Wrapper',
  'Anchor BTC', 'Restaked BTC', 'Liquid Staking', 'Liquid Restaking', 'Crypto Card Issuer',
]);

function percentile(values, q) {
  const sorted = [...values].sort((a, b) => a - b);
  const at = (sorted.length - 1) * q;
  const lo = Math.floor(at);
  return sorted[lo] + (sorted[Math.ceil(at)] - sorted[lo]) * (at - lo);
}
const median = (values) => percentile(values, 0.5);

function anchorSamples(protocols, asOf) {
  // A token cap must not be counted again for every deployment or product record.
  const byToken = new Map();
  for (const p of protocols) {
    if (!hasTokenRecord(p) || !Number.isFinite(p.mcap_usd) || p.mcap_usd <= 0 || referenceOnly.has(p.category)) continue;
    const key = p.gecko_id ? `id:${p.gecko_id.toLowerCase()}` : `symbol:${p.symbol.toLowerCase()}`;
    const prev = byToken.get(key);
    if (!prev || p.tvl_usd > prev.tvl_usd || (p.tvl_usd === prev.tvl_usd && bySlug(p, prev) < 0)) byToken.set(key, p);
  }
  return [...byToken.entries()].sort(([a], [b]) => a < b ? -1 : 1).map(([, p]) => ({
    category: p.category, x: features(p, trackingYears(p.listed_at, asOf)), y: Math.log2(p.mcap_usd),
  }));
}

function fit(samples, dimensions = 3) {
  const beta = prior.slice(0, dimensions);
  let base = samples.length
    ? median(samples.map(({ x, y }) => y - dot(beta, x)))
    : Math.log2(15_000_000);
  if (samples.length < 8) return { beta, base };

  // Huber loss at 1.5 log2 units; ridge toward monotone priors stabilizes thin designs.
  // Reweight, then solve the bounded weighted problem by cyclic coordinate updates.
  const ridge = 2;
  for (let pass = 0; pass < 8; pass++) {
    const weights = samples.map(({ x, y }) => Math.min(1, 1.5 / Math.abs(y - base - dot(beta, x))));
    const total = weights.reduce((a, b) => a + b, 0);
    for (let sweep = 0; sweep < 12; sweep++) {
      base = samples.reduce((sum, { x, y }, i) => sum + weights[i] * (y - dot(beta, x)), 0) / total;
      for (let j = 0; j < dimensions; j++) {
        let numerator = ridge * prior[j];
        let denominator = ridge;
        for (let i = 0; i < samples.length; i++) {
          const { x, y } = samples[i];
          const residualWithoutJ = y - base - dot(beta, x) + beta[j] * x[j];
          numerator += weights[i] * x[j] * residualWithoutJ;
          denominator += weights[i] * x[j] ** 2;
        }
        beta[j] = clamp(numerator / denominator, ...bounds[j]);
      }
    }
  }
  return { beta, base };
}

function holdoutPeers(samples) {
  if (samples.length < 15) return null;
  const folds = 5;
  const errors = [];
  const tvlOnly = [];
  for (let fold = 0; fold < folds; fold++) {
    const train = samples.filter((_, i) => i % folds !== fold);
    const model = fit(train);
    const baseline = fit(train, 1);
    for (let i = fold; i < samples.length; i += folds) {
      const { x, y } = samples[i];
      errors.push(y - (model.base + dot(model.beta, x)));
      tvlOnly.push(Math.abs(y - (baseline.base + dot(baseline.beta, x))));
    }
  }
  return {
    samples: errors.length,
    folds,
    error_factor: 2 ** median(errors.map(Math.abs)),
    tvl_only_factor: 2 ** median(tvlOnly),
    residual_p10_p90: [percentile(errors, 0.1), percentile(errors, 0.9)],
  };
}

export function buildBoard(snapshot) {
  for (const p of snapshot.protocols) {
    if (!Number.isSafeInteger(p.tvl_usd) || p.tvl_usd <= 0) throw new Error(`Invalid snapshot: ${p.slug} tvl_usd must be positive whole dollars`);
  }
  const asOf = Date.parse(snapshot.as_of);
  const watch = new Set(snapshot.watchlist);
  const anchors = anchorSamples(snapshot.protocols, asOf);
  const { beta, base } = fit(anchors);
  const holdout = holdoutPeers(anchors);
  const peerCounts = new Map();
  for (const { category } of anchors) peerCounts.set(category, (peerCounts.get(category) ?? 0) + 1);
  const rows = snapshot.protocols.map((p) => {
    const years = trackingYears(p.listed_at, asOf);
    const x = features(p, years);
    const terms = beta.map((weight, i) => weight * x[i]);
    const logValue = base + terms.reduce((sum, term) => sum + term, 0);
    return {
      ...p,
      watchlist: watch.has(p.slug),
      token_recorded: hasTokenRecord(p),
      reference_only: referenceOnly.has(p.category),
      tracking_years: years,
      peer_count: peerCounts.get(p.category) ?? 0,
      implied_value_usd: dollars(logValue),
      contributions_log2: terms,
      range_usd: holdout?.residual_p10_p90.map((error) => dollars(logValue + error)) ?? null,
    };
  }).sort((a, b) => b.implied_value_usd - a.implied_value_usd || bySlug(a, b));
  return {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model: { anchor_count: anchors.length, base_log2_usd: base, coefficients: beta, holdout },
    rows: rows.map((row, i) => ({ ...row, rank: i + 1, ...buildResearchPlan(row) })),
  };
}
