// Offline research recipes. Every fee is either zero for the task or a labelled paper assumption.
// A recipe describes where to look and what could invalidate it, not an available campaign.
const lanes = [
  [/^Uncollateralized Lending$/, 'Credit and recourse',
    'Identify the borrower, credit assessment, loan seniority, maturity, eligibility and enforceable recovery rights; do not assume posted collateral.',
    'Stress a borrower default with zero recovery and delayed settlement. Compare the paper loss with stated reserves and fees; make no loan or deposit.',
    'Stop if borrower concentration, legal recourse, default handling or the earliest withdrawal date is undisclosed.'],
  [/^Lending$/, 'Reserve check',
    'Record the reserve asset, utilization, available withdrawal liquidity and any minimum from the deployment documentation.',
    'Model supply only at 95% utilization. Record the borrow-side liquidation threshold as a risk you are not taking. Do not borrow or loop collateral.',
    'Stop if bad debt is unresolved or stressed withdrawal liquidity cannot cover the notional.'],
  [/Risk Curators|Capital Allocator|Yield|Farm|Liquidity Manager|Indexes|Options Vault|Collateral Management/, 'Vault diligence',
    'Identify the host vault and curator, asset allocations, share accounting, fees and withdrawal queue. Check whether two strategies share the same underlying exposure.',
    'Model one unlevered vault share position. Stress its largest allocation at a 20% loss and assume immediate withdrawals are unavailable.',
    'Stop if the valuation oracle, curator permissions or withdrawal queue are unclear; note the first possible exit and the maximum wait.'],
  [/NFT Marketplace/, 'Ownership and bids',
    'Check collection ownership, provenance, transfer permissions, royalties and executable bids; an advertised floor is not an exit quote.',
    'Compare a paper purchase with holding cash after a 30% floor decline and zero bids. Include royalties, marketplace fees and a possible total loss; buy nothing.',
    'Stop if ownership rights or real bid depth cannot be established; reject wash-volume and unverified incentive claims.'],
  [/^OTC Marketplace$/, 'Quote and delivery',
    'Record the quoted pair, quote expiry, minimum size, maker identity, custody and delivery-versus-payment terms; a quote is not a pool reserve.',
    'Compare a hypothetical matched quote with holding cash after expiry or a failed counterparty delivery. Record spread, settlement fees and recovery rights; request or accept nothing.',
    'Stop if delivery is not atomic or documented recourse, executable size and quote expiration cannot be established.'],
  [/^Dexs$/, 'Pool economics',
    'Write down the pool pair, fee tier, depth and documented liquidity incentives; separate trading fees from unverified points.',
    'Compare one paper liquidity position against holding the pair after a 20% relative price move and time outside its range.',
    'Stop if stressed slippage plus fees exceed 5% of notional or one leg lacks independent exit liquidity.'],
  [/^Prediction Market$/, 'Resolution and claims',
    'Read the exact outcome wording, resolution oracle, dispute window, permitted users and redemption asset; do not infer certainty from displayed odds.',
    'Paper-test a losing outcome, an invalid market and a disputed resolution with a 30-day delay. Include redemption fees; place no bet or order.',
    'Stop if outcome interpretation, dispute authority, loss bounds or redemption terms are ambiguous.'],
  [/Basis Trading|Derivatives|Synthetics|^Options$|CeDeFi/, 'Margin exposure',
    'Write down margin asset, funding and settlement source, counterparty and liquidation thresholds. Verify where collateral is held.',
    'Model an unlevered paper position with adverse funding and a 20% move; record how margin would be marked without opening a position.',
    'Stop if loss bounds, liquidation fees or the final settlement venue are not documented.'],
  [/^CDP|Dual-Token|Algo-Stables|Reserve Currency/, 'Collateral stress',
    'Record eligible collateral, debt ceiling, oracle, peg mechanism and liquidation ratio. Separate collateral TVL from stablecoin supply.',
    'Stress the collateral price down 30%; recompute the collateral ratio and compare it with the liquidation threshold. Do not mint or borrow.',
    'Stop if the stress touches liquidation or redemptions depend on a thin secondary market.'],
  [/^RWA$|Insurance/, 'Redemption rights',
    'Find issuer or underwriter, access restrictions, minimum ticket and settlement currency. Read the approved redemption or claims process.',
    'On paper, compare a normal redemption with a 30-day delay. Record eligibility, transfer restrictions and fees; do not infer retail access.',
    'Stop if your jurisdiction, beneficial ownership, redemption rights or claims exclusions cannot be verified.'],
  [/Staking|Restaking|Locker|Governance Incentives|Collateral Markets/, 'Lock and exit',
    'Identify reward source and asset, minimum, lock duration, administrator powers, and where any penalties are defined.',
    'Record the net payout assuming zero discretionary rewards, maximum documented lock time and the disclosed slashing or penalty case.',
    'Stop if exits rely on a thin secondary market or loss and unlock terms are unclear.'],
  [/Payments|^Chain$|^Privacy$/, 'Service route',
    'Map the documented origin and destination, supported asset, operator and settlement conditions; look for a written eligibility rule.',
    'Compare the documented service with a no-reward baseline including a failed settlement and a delayed refund.',
    'Stop if refund, downtime or operator risks are not documented.'],
];

const defaultLane = ['Product diligence',
  'Identify the actual product, asset and entry/exit mechanics in dated docs. Record the minimum and any jurisdiction or access limits.',
  'Keep the reward at zero and write a paper comparison against doing nothing; mark all unquoted fees as unknown.',
  'Park the case if you cannot independently establish exit terms, costs and eligibility.'];
const routeLane = ['Reference only',
  'Check the underlying asset or custody operator, route permissions, finality and recovery time; a sizeable record is not an independent token signal.',
  'Record minimums, quotes, custody and redemption terms for comparison only. No bridge, wrap, trade or deposit is part of this plan.',
  'Park the case unless official terms establish an independent, permitted research opportunity; never infer rewards from use.'];

function feeScenario(chain) {
  if (chain === 'Ethereum' || chain === 'Bitcoin') return '$4–$24 (two hypothetical calls at $2–$12 each)';
  if (['Base', 'Arbitrum', 'Optimism', 'Solana', 'Polygon', 'BNB Chain', 'BSC'].includes(chain)) {
    return '$0.20–$4 (two hypothetical calls at $0.10–$2 each)';
  }
  return '$1 / $10 total sensitivity cases (network quote unknown)';
}

export function buildResearchPlan(row) {
  const chain = row.chains[0] ?? 'Chain unreported';
  const [label, map, stress, exit] = row.reference_only
    ? routeLane : lanes.find(([match]) => match.test(row.category ?? ''))?.slice(1) ?? defaultLane;
  const fee = row.reference_only ? null : feeScenario(chain);
  const paper = fee === null ? stress : `Paper only: assume $100 notional where eligible. ${stress} Network friction: ${fee}, not a quote; add documented protocol fees separately or leave them unknown.`;
  const tokenCheck = row.token_recorded
    ? 'A recorded token is not evidence of an active campaign. Verify the official reward asset and dated program terms; never treat model value as observed cap.'
    : 'No token is recorded here. Verify whether an official program or token exists; without dated terms, assume zero points, eligibility and payout.';
  const stages = [
    ['Verify the route', 8, `Cross-check ${row.name} and its ${chain} record against dated official docs. Match chain and product names before using any figures; do not connect a wallet or sign.`],
    ['Map the product', 10, map],
    [fee === null ? 'Park the route' : 'Run a paper case', 14, paper],
    ['Set a stop rule', 8, `${exit} For a $100 paper case, mark fees above $5 or an unknown exit as a stop, not a reason to increase size.`],
    ['Recheck in 7 days', 5, `${tokenCheck} Compare dated docs and record only changes that you can substantiate.`],
  ];
  return {
    farm_steps: stages.map(([title, mins, body]) => `${title} · ${mins} min · $0 — ${body}`),
    research: { label, chain, minutes: stages.reduce((sum, [, mins]) => sum + mins, 0), fee_scenario: fee },
  };
}
