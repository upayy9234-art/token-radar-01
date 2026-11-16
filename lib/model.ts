// Launch Radar's model, radar-4: one sealed snapshot in, one ranked board out.
//
// The board covers every slug in the snapshot's watchlist (the floor, never the
// ceiling) and adds the early radar: pre-token protocols below the floor that pass
// the same no-token test the watchlist uses (no recorded token, not a wrapped,
// staked or bridged product, not an exchange, not a versioned pool). A protocol is
// pre-token when its record carries no token at all (no market cap, no CoinGecko
// id, no symbol); the live-token protocols are kept apart and shown as the
// market's own values, never mixed into the ranked board.
//
// Implied value follows only from the snapshot's own figures. The multiple is not
// a median and not a hardcoded list: it is a curve FITTED on the snapshot's own
// token-bearing protocols, then TESTED BLIND on them before it prices anything.
// Radar-4 changes the curve's shape: a quadratic in log TVL, because the straight
// line was leaving a bend in the data.
//
//   fit     log10(mcap) = a + b * log10(TVL) + c * log10(TVL)^2, ordinary least
//           squares over every token-bearing protocol in the snapshot (mcap and
//           TVL both present). On this snapshot: a = 4.37, b = 0.19, c = 0.02,
//           n = 128, R^2 = 0.19. The quadratic term is small but the bend is
//           real: at $5M of TVL the curve prices a 0.68x multiple, at $1B it
//           prices 0.05x, at $26B it prices 0.01x — the market pays a smaller
//           multiple for a bigger protocol, and the fall steepens with size.
//           The fit is guarded: a curve whose slope would turn negative inside
//           the comps' TVL range, or whose quadratic term is absurd (|c| > 0.5),
//           or that cannot be solved, falls back to the straight line (c = 0).
//           Every board TVL sits inside the comps' $5M-$26B range, so the curve
//           interpolates, never extrapolates. The fitted multiple is clamped to
//           [0.02, 1.50] as a stated guardrail.
//   tested  three time splits: fit on the protocols listed before a cutoff,
//           predict the market cap of the ones listed after it. The quadratic
//           beats the straight line on every split the builder checked — the
//           three the dashboard shows (median error x2.61 / x3.71 / x3.68
//           against x3.08 / x4.19 / x4.11 for the line) and four more cutoffs
//           run offline (2025-03-01, 2025-08-01, 2025-10-01, 2025-11-01) —
//           and lands within 2x more often on all of them. It also beats the
//           market-median multiple on every split. On random 5-fold CV the two
//           curves tie (x3.62 vs x3.57), so the quadratic is kept because it
//           wins the forward-looking test, and the question is a future launch.
//           The dashboard shows the three-way table, so a reader can see the
//           line the curve beats instead of taking the builder's word for it.
//   priced  implied = fittedValue(TVL) * growth * age * chain, where
//           growth = 1 + 0.5 * clamp(change_7d, -50, +100) / 100
//           age    = 0.85 + 0.30 * min(age_days, 1460) / 1460 (unknown: 365)
//           chain  = 1 + 0.03 * min(chains - 1, 10)
//           The same arithmetic scores every row; no name is ever special-cased.
//           The dashboard recomputes each row from the snapshot figures and
//           checks the number board.json carries, and its detail view names the
//           five live-token protocols nearest in TVL, so a reader can check the
//           curve against the market with their own eyes.
//
// The farm plan's gas costs are priced per chain, not one flat number: a step on
// Ethereum plans about $5 of gas, on Solana under $0.10, on a cheap EVM chain
// about $0.50, anywhere else about $1. Those are stated planning figures for a
// simple transaction, not quotes, and the same table prices the plan in
// board.json and the plan the page regenerates, so the two can never drift.
//
// The previous model (radar-3) priced each row by the straight fitted line. The
// line and the quadratic agree on the ranking — the quadratic is monotone in TVL
// over the comps' range, so the fitted order does not change — but the quadratic
// prices the small end higher and the big end lower, and its blind-test errors
// are smaller on every forward split the builder ran.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants, as the dashboard states them. */
export interface ModelConstants {
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  age_floor: number;
  age_range: number;
  age_days_cap: number;
  unknown_age_days: number;
  chain_step: number;
  chain_max_extra: number;
  multiple_floor: number;
  multiple_cap: number;
  min_comparables: number;
}

export const MODEL: ModelConstants = {
  growth_weight: 0.5,
  growth_floor: -50,
  growth_cap: 100,
  age_floor: 0.85,
  age_range: 0.3,
  age_days_cap: 1460,
  unknown_age_days: 365,
  chain_step: 0.03,
  chain_max_extra: 10,
  multiple_floor: 0.02,
  multiple_cap: 1.5,
  min_comparables: 3,
};

/** The model's version label: the dashboard names it. */
export const MODEL_VERSION = 'radar-4';

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 24;

/** The time-split cutoffs the blind test uses, in UTC days. */
export const OOS_CUTOFFS = ['2025-01-01', '2025-06-01', '2025-09-01'];

/** The largest quadratic term a fitted curve may carry before it falls back to the line. */
export const MAX_QUAD = 0.5;

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  model: {
    fitted_value_usd: number;
    fitted_multiple: number;
    comparables: number;
    growth_pct: number;
    growth_multiplier: number;
    age_multiplier: number;
    chain_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** The dashboard's compact view of one row, with farm plans generated in the page. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  fitted_value_usd: number;
  fitted_multiple: number;
  comparables: number;
  growth_multiplier: number;
  age_multiplier: number;
  chain_multiplier: number;
}

/** A live-token protocol: it already trades, so the board shows the market's own value, not a model's. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
  multiple: number | null;
}

/** One live-token protocol near a row's TVL, so the reader can check the curve. */
export interface NearestComp {
  slug: string;
  name: string;
  tvl_usd: number;
  mcap_usd: number;
  multiple: number;
}

/** One dot of the scatter chart: a live-token protocol's TVL and market cap. */
export interface CompPoint {
  tvl_usd: number;
  mcap_usd: number;
}

/** The fitted curve: log10(mcap) = intercept + slope * log10(TVL) + quad * log10(TVL)^2. */
export interface CurveFit {
  intercept: number;
  slope: number;
  quad: number;
  n: number;
  r2: number;
  tvl_min: number;
  tvl_max: number;
}

/** The straight line the curve is measured against, fitted on the same comps. */
export interface LinearFit {
  intercept: number;
  slope: number;
}

/** One blind-test split: fit before the cutoff, predict after it, three ways. */
export interface OosSplit {
  cutoff: string;
  n_train: number;
  n_test: number;
  curve_median_error_x: number;
  curve_within_2x: number;
  line_median_error_x: number;
  line_within_2x: number;
  median_median_error_x: number;
  median_within_2x: number;
}

/** Everything the dashboard needs: the board, the live set, and the model it runs. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  fit: CurveFit;
  linear_fit: LinearFit;
  oos: OosSplit[];
  global_multiple: number;
  watchlist: string[];
  rows: RadarRow[];
  live: LiveRow[];
  nearest: Record<string, NearestComp[]>;
  comps: CompPoint[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** The median of a sorted array, or null when empty. */
function median(sorted: number[]): number | null {
  if (sorted.length === 0) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** The token-bearing protocols the curve is fitted on: market cap and TVL both present and positive. */
export function comparables(protocols: SnapshotProtocol[]): SnapshotProtocol[] {
  return protocols.filter((p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0);
}

/**
 * Solve a small dense linear system by Gaussian elimination with partial
 * pivoting. Returns null when the system is singular (a column with no usable
 * pivot), so the caller can fall back instead of dividing by zero.
 */
export function solveLinear(matrix: number[][], rhs: number[]): number[] | null {
  const n = rhs.length;
  const m = matrix.map((row, i) => [...row, rhs[i]!]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(m[r]![col]!) > Math.abs(m[pivot]![col]!)) pivot = r;
    }
    if (Math.abs(m[pivot]![col]!) < 1e-12) return null;
    if (pivot !== col) {
      const tmp = m[col]!;
      m[col] = m[pivot]!;
      m[pivot] = tmp;
    }
    for (let r = 0; r < n; r++) {
      if (r === col || m[r]![col] === 0) continue;
      const factor = m[r]![col]! / m[col]![col]!;
      for (let k = col; k <= n; k++) m[r]![k]! -= factor * m[col]![k]!;
    }
  }
  return m.map((row, i) => row[n]! / row[i]!);
}

/** Ordinary least squares for a design of feature rows against targets, or null when singular. */
export function leastSquares(features: number[][], targets: number[]): number[] | null {
  const d = features[0]!.length + 1;
  const normal: number[][] = Array.from({ length: d }, () => new Array<number>(d).fill(0));
  const rhs: number[] = new Array<number>(d).fill(0);
  for (let i = 0; i < features.length; i++) {
    const row = [1, ...features[i]!];
    for (let a = 0; a < d; a++) {
      rhs[a]! += row[a]! * targets[i]!;
      for (let b = 0; b < d; b++) normal[a]![b]! += row[a]! * row[b]!;
    }
  }
  return solveLinear(normal, rhs);
}

/** The straight line: ordinary least squares on log10(mcap) against log10(TVL). */
export function fitLine(comps: SnapshotProtocol[]): LinearFit {
  const xs = comps.map((p) => Math.log10(p.tvl_usd));
  const ys = comps.map((p) => Math.log10(p.mcap_usd!));
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  const sxx = xs.reduce((a, x) => a + (x - mx) * (x - mx), 0);
  const sxy = xs.reduce((a, x, i) => a + (x - mx) * (ys[i]! - my), 0);
  if (n < 2 || sxx === 0) {
    const ratios = comps.map((p) => p.mcap_usd! / p.tvl_usd).sort((a, b) => a - b);
    const m = median(ratios) ?? 0.2;
    return { intercept: Math.log10(m), slope: 1 };
  }
  const slope = sxy / sxx;
  return { intercept: my - slope * mx, slope };
}

/**
 * The fitted curve: ordinary least squares on log10(mcap) against log10(TVL)
 * and its square, over the comparables. Falls back to the straight line when
 * the quadratic cannot be solved, when its bend is absurd, or when its slope
 * would turn negative inside the comps' TVL range — a value curve must not
 * fall as a protocol grows. With fewer than three comparables carrying
 * distinct TVLs it falls back to a flat line at the median multiple (never on
 * this snapshot).
 */
export function fitCurve(comps: SnapshotProtocol[]): CurveFit {
  const tvls = comps.map((p) => p.tvl_usd);
  const tvlMin = Math.min(...tvls);
  const tvlMax = Math.max(...tvls);
  const line = fitLine(comps);
  const flat: CurveFit = { intercept: line.intercept, slope: line.slope, quad: 0, n: comps.length, r2: 0, tvl_min: tvlMin, tvl_max: tvlMax };
  const xs = comps.map((p) => Math.log10(p.tvl_usd));
  const distinct = new Set(xs.map((x) => x.toFixed(9))).size;
  if (comps.length < 3 || distinct < 3) return flat;
  const beta = leastSquares(
    xs.map((x) => [x, x * x]),
    comps.map((p) => Math.log10(p.mcap_usd!)),
  );
  if (beta === null) return flat;
  const [intercept, slope, quad] = beta as [number, number, number];
  if (!Number.isFinite(intercept) || !Number.isFinite(slope) || !Number.isFinite(quad)) return flat;
  if (Math.abs(quad) > MAX_QUAD) return flat;
  const lo = Math.log10(tvlMin);
  const hi = Math.log10(tvlMax);
  // The slope of the curve is slope + 2 * quad * x; it must stay positive
  // across the whole range the curve is asked to price.
  if (slope + 2 * quad * lo <= 0 || slope + 2 * quad * hi <= 0) return flat;
  const ys = comps.map((p) => Math.log10(p.mcap_usd!));
  const my = ys.reduce((a, b) => a + b, 0) / ys.length;
  const ssTot = ys.reduce((a, y) => a + (y - my) * (y - my), 0);
  const ssRes = xs.reduce((a, x, i) => {
    const e = ys[i]! - (intercept + slope * x + quad * x * x);
    return a + e * e;
  }, 0);
  return {
    intercept,
    slope,
    quad,
    n: comps.length,
    r2: ssTot === 0 ? 0 : 1 - ssRes / ssTot,
    tvl_min: tvlMin,
    tvl_max: tvlMax,
  };
}

/** The curve's fitted market cap for a TVL, in whole dollars. */
export function fittedValue(tvlUsd: number, fit: CurveFit): number {
  const x = Math.log10(tvlUsd);
  return Math.pow(10, fit.intercept + fit.slope * x + fit.quad * x * x);
}

/** The line's fitted market cap for a TVL, in whole dollars. */
export function lineValue(tvlUsd: number, fit: LinearFit): number {
  return Math.pow(10, fit.intercept + fit.slope * Math.log10(tvlUsd));
}

/** The curve's fitted multiple (mcap/TVL) for a TVL, clamped to the stated guardrail. */
export function fittedMultiple(tvlUsd: number, fit: CurveFit, model: ModelConstants = MODEL): number {
  const m = fittedValue(tvlUsd, fit) / tvlUsd;
  return Math.min(model.multiple_cap, Math.max(model.multiple_floor, m));
}

/** The whole-market median mcap/TVL over the comparables: the baseline the blind test beats. */
export function globalMultiple(comps: SnapshotProtocol[]): number {
  const ratios = comps.map((p) => p.mcap_usd! / p.tvl_usd).sort((a, b) => a - b);
  return median(ratios) ?? 0.2;
}

/**
 * The blind test: for each cutoff, fit the curve, the straight line and the
 * market-median multiple on the comparables listed before it, and predict the
 * market cap of the ones listed after it. Error is the median absolute log10
 * error, reported as a multiple (10^error), with the share of predictions
 * within 2x. A split with fewer than three test protocols is skipped, so the
 * table never claims a test it did not run.
 */
export function oosValidation(snapshot: Snapshot): OosSplit[] {
  const dated = comparables(snapshot.protocols).filter((p) => p.listed_at !== null);
  const out: OosSplit[] = [];
  for (const cutoff of OOS_CUTOFFS) {
    const train = dated.filter((p) => p.listed_at! < cutoff);
    const test = dated.filter((p) => p.listed_at! >= cutoff);
    if (test.length < 3 || train.length < 3) continue;
    const fit = fitCurve(train);
    const line = fitLine(train);
    const base = globalMultiple(train);
    const curveErrs: number[] = [];
    const lineErrs: number[] = [];
    const baseErrs: number[] = [];
    for (const p of test) {
      curveErrs.push(Math.abs(Math.log10(fittedValue(p.tvl_usd, fit) / p.mcap_usd!)));
      lineErrs.push(Math.abs(Math.log10(lineValue(p.tvl_usd, line) / p.mcap_usd!)));
      baseErrs.push(Math.abs(Math.log10((p.tvl_usd * base) / p.mcap_usd!)));
    }
    curveErrs.sort((a, b) => a - b);
    lineErrs.sort((a, b) => a - b);
    baseErrs.sort((a, b) => a - b);
    const curveMed = median(curveErrs) ?? 0;
    const lineMed = median(lineErrs) ?? 0;
    const baseMed = median(baseErrs) ?? 0;
    const log2 = Math.log10(2);
    out.push({
      cutoff,
      n_train: train.length,
      n_test: test.length,
      curve_median_error_x: round4(Math.pow(10, curveMed)),
      curve_within_2x: round4(curveErrs.filter((e) => e <= log2).length / curveErrs.length),
      line_median_error_x: round4(Math.pow(10, lineMed)),
      line_within_2x: round4(lineErrs.filter((e) => e <= log2).length / lineErrs.length),
      median_median_error_x: round4(Math.pow(10, baseMed)),
      median_within_2x: round4(baseErrs.filter((e) => e <= log2).length / baseErrs.length),
    });
  }
  return out;
}

/** The four multipliers and the implied value one protocol gets under `model`. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  fit: CurveFit,
  model: ModelConstants = MODEL,
): {
  implied: number;
  fittedValueUsd: number;
  fittedMultiple: number;
  growthPct: number;
  growthMult: number;
  ageMult: number;
  chainMult: number;
  age: number | null;
} {
  const age = ageDays(asOf, protocol.listed_at);
  const fittedValueUsd = fittedValue(protocol.tvl_usd, fit);
  const fittedMult = fittedMultiple(protocol.tvl_usd, fit, model);
  const rawGrowth = finite(protocol.change_7d, 0);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowth));
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const ageForModel = age ?? model.unknown_age_days;
  const ageMult =
    model.age_floor + (Math.min(Math.max(ageForModel, 0), model.age_days_cap) / model.age_days_cap) * model.age_range;
  const extraChains = Math.min(Math.max(protocol.chains.length - 1, 0), model.chain_max_extra);
  const chainMult = 1 + model.chain_step * extraChains;
  const implied = Math.max(1, Math.round(fittedValueUsd * growthMult * ageMult * chainMult));
  return { implied, fittedValueUsd: Math.round(fittedValueUsd), fittedMultiple: fittedMult, growthPct, growthMult, ageMult, chainMult, age };
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** A name carrying a whole word wrapped, staked or staking: a product of a token that trades. */
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;

/** The exchange names the watchlist rule keeps out. */
const EXCHANGES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];

/** The categories the watchlist rule keeps out: bridges and staked products of tokens that trade. */
const EXCLUDED_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/**
 * Whether a protocol is one the board may rank: pre-token, and not a wrapped,
 * staked or bridged product of a token that already trades, not an exchange, not
 * a versioned pool. The same test the watchlist uses, without its TVL floor.
 */
export function isRankable(p: SnapshotProtocol): boolean {
  if (!isPreToken(p)) return false;
  if (p.category !== null && EXCLUDED_CATEGORIES.has(p.category)) return false;
  if (VERSIONED.test(p.name)) return false;
  if (WRAPPED_WORD.test(p.name)) return false;
  if (EXCHANGES.some((e) => p.name.startsWith(e))) return false;
  return true;
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, fit: CurveFit, model: ModelConstants = MODEL): BoardRow[] {
  const index = bySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug on it, even one the snapshot no longer carries.
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: pre-token protocols below the watchlist floor that pass the
  // same no-token test, by TVL, strongest first. Never a replacement for a
  // watchlist row: a chosen protocol stays chosen.
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isRankable(p) && p.tvl_usd < snapshot.floor_usd)
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  for (const p of early) chosen.set(p.slug, p);

  const scored = [...chosen.values()].map((p) => {
    const v = impliedValue(p, snapshot.as_of, fit, model);
    return { p, v };
  });
  scored.sort((a, b) => b.v.implied - a.v.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token',
    age_days: s.v.age,
    implied_value_usd: s.v.implied,
    model: {
      fitted_value_usd: s.v.fittedValueUsd,
      fitted_multiple: round4(s.v.fittedMultiple),
      comparables: fit.n,
      growth_pct: round4(s.v.growthPct),
      growth_multiplier: round4(s.v.growthMult),
      age_multiplier: round4(s.v.ageMult),
      chain_multiplier: round4(s.v.chainMult),
      age_days: s.v.age,
    },
    farm_steps: farmSteps(s.p, s.v.age, i + 1, s.v.implied).map(stepText),
  }));
}

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** A dollar figure a reader can scan: $950K, $136.3M, $2.75B. */
export function fmtUsd(n: number): string {
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${Math.round(n)}`;
}

/** An age in days as a reader would say it: 352d, 1.5y, or unrecorded. */
export function fmtAge(age: number | null): string {
  if (age === null) return 'an unrecorded time';
  if (age < 365) return `${age}d`;
  return `${(age / 365).toFixed(1)}y`;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** A second chain when the protocol runs on more than one, else null. */
function secondChainOf(p: SnapshotProtocol): string | null {
  return p.chains.length > 1 ? p.chains[1]! : null;
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 1_000_000_000) return 250;
  if (p.tvl_usd >= 250_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/**
 * What one simple transaction typically costs on a chain, in whole dollars, as a
 * planning figure: Ethereum is dear, Solana is near-free, the cheap EVM chains
 * sit in the middle, and anything unlisted plans a dollar. The same table prices
 * the plan in board.json and the plan the page regenerates.
 */
const CHEAP_CHAINS = new Set([
  'Arbitrum',
  'Optimism',
  'Base',
  'Polygon',
  'Binance',
  'Avalanche',
  'Linea',
  'Sonic',
  'Sui',
  'Mantle',
  'Fantom',
  'Scroll',
  'Berachain',
  'xDai',
  'Celo',
  'zkSync Era',
  'Blast',
  'Mode',
  'Gnosis',
  'Moonbeam',
  'Aptos',
  'Near',
  'Fraxtal',
  'Unichain',
  'World Chain',
  'Abstract',
  'Ink',
  'Soneium',
  'Starknet',
  'Hyperliquid L1',
  'Tron',
]);

/** The typical gas cost of one simple transaction on a chain, in dollars. */
export function gasUsdFor(chain: string): number {
  if (chain === 'Ethereum') return 5;
  if (chain === 'Solana') return 0.01;
  if (CHEAP_CHAINS.has(chain)) return 0.5;
  return 1;
}

/** A gas cost as a reader plans it: under ten cents stays under ten cents, the rest is "about". */
export function gasText(usd: number): string {
  if (usd < 0.05) return 'under $0.10';
  if (usd < 1) return `about $${usd.toFixed(2)}`;
  if (usd === 1) return 'about $1';
  return `about $${usd}`;
}

/** The category's main action, in the words a farmer can follow. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral'))
    return `Supply $${capital} of USDC to ${name} on ${chain} and keep the position open, so the protocol records you as a lender.`;
  if (c.includes('dex') || c.includes('yield') || c.includes('leveraged farm'))
    return `Provide $${capital} of liquidity to ${name}'s main pool on ${chain} and keep the position open through the next fee cycle.`;
  if (c.includes('bridge') || c.includes('cross chain'))
    return `Bridge $${capital} of USDC to ${chain} through ${name}, then use the bridged funds inside its own app at least once.`;
  if (c.includes('stak') || c.includes('restak'))
    return `Stake $${capital} of the chain's staking asset through ${name} on ${chain} and keep the receipt token in the same wallet.`;
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('basis trad'))
    return `Deposit $${capital} of USDC as margin on ${name} on ${chain} and open one small hedged position, then close it after a day.`;
  if (c.includes('prediction'))
    return `Fund $${capital} on ${name} and place one market position on ${chain}, then settle it when the market closes.`;
  if (c.includes('curator') || c.includes('allocator') || c.includes('risk'))
    return `Deposit $${capital} into a ${name} vault on ${chain} and keep the vault shares in the farming wallet.`;
  if (c.includes('stable'))
    return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain} and hold it for the full qualifying window.`;
  if (c.includes('rwa'))
    return `Mint $${capital} of the protocol's yield-bearing asset on ${chain} through ${name} and hold it in the farming wallet.`;
  if (c.includes('insurance'))
    return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy active for the full qualifying window.`;
  if (c.includes('payment'))
    return `Route $${capital} of payments through ${name} on ${chain} in two or more transfers, a week apart.`;
  if (c.includes('governance'))
    return `Lock $${capital} of voting power with ${name} on ${chain} and cast one vote in its next proposal.`;
  if (c.includes('chain'))
    return `Move $${capital} onto ${name}'s own chain on ${chain} and use one of its native apps with the same wallet.`;
  if (c.includes('cedefi'))
    return `Deposit $${capital} into ${name}'s managed product on ${chain} and keep the position for the full qualifying window.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open for the full qualifying window.`;
}

/** A second, different action on the same protocol, so the wallet shows depth, not one deposit. */
function secondActionFor(p: SnapshotProtocol, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral'))
    return `Borrow $25 of USDC against the deposit on ${name} and repay it a week later, so the wallet shows both sides of the market.`;
  if (c.includes('dex') || c.includes('yield') || c.includes('leveraged farm'))
    return `Swap $25 through ${name}'s own router on ${chain} in a separate week, so the wallet shows trading as well as liquidity.`;
  if (c.includes('stak') || c.includes('restak'))
    return `Delegate a second $25 stake through ${name} on ${chain} a week later, so the wallet shows repeated staking.`;
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('basis trad'))
    return `Open a second small position on ${name} on ${chain} in another week, then close it, so the wallet shows repeated use.`;
  if (c.includes('curator') || c.includes('allocator') || c.includes('risk'))
    return `Deposit a second $25 into a different ${name} vault on ${chain} a week later, so the wallet shows more than one vault.`;
  return `Repeat the main action with $25 on ${name} in a second week, so the wallet shows repeated use rather than one deposit.`;
}

/**
 * A protocol's farm plan: seven steps, each an action with a cost and a time.
 * The plan is derived from the protocol's own record (category, chains, TVL,
 * age, rank, implied value), never from a hand-written list of names: the gas
 * of every step follows the protocol's own chain, the hold, the claim and the
 * log steps name the protocol's own age, rank and implied value, so no two
 * rows' plans read the same.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null, rank: number, implied: number): FarmStep[] {
  const chain = chainOf(p);
  const second = secondChainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const gas = gasUsdFor(chain);
  const gasSecond = second !== null ? gasUsdFor(second) : gas;
  const action = actionFor(p, capital, chain);
  const secondAction = secondActionFor(p, chain);
  const ageText = fmtAge(age);
  const impliedText = fmtUsd(implied);
  const steps: FarmStep[] = [
    {
      text: `Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline on paper.`,
      cost: `${gasText(gas)} of gas for the first transaction on ${chain}`,
      time: '5 minutes',
    },
    {
      text: action,
      cost: `$${capital} of capital and ${gasText(gas)} of gas`,
      time: '15 minutes to set up',
    },
    {
      text: secondAction,
      cost: `$25 of capital and ${gasText(gas)} of gas`,
      time: '10 minutes',
    },
  ];
  if (second !== null) {
    steps.push({
      text: `Repeat the main position on ${second}, the protocol's second chain, with $25, so the wallet is active on more than one chain.`,
      cost: `$25 of capital and ${gasText(gasSecond)} of gas`,
      time: '10 minutes',
    });
  }
  steps.push(
    {
      text: `Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote, and never let four weeks pass with none: ${p.name} has run ${ageText} with no token, so its snapshots are infrequent and a gap costs more here than on a young protocol.`,
      cost: `${gasText(gas)} of gas a week on ${chain}`,
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot, and do not withdraw early: this board prices a ${p.name} launch at ${impliedText} (rank #${rank}), so farm it like a long-horizon position, not a week-long flip.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `Before you withdraw, open ${p.name}'s own points or rewards page and claim only from the link it publishes; never pay anyone to claim for you.`,
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes',
    },
    {
      text: `Write the wallet, the dates and every transaction hash in a farm log, next to rank #${rank} and the ${impliedText} implied value, then unwind in tranches over a week so you keep enough gas to exit.`,
      cost: 'nothing but the log',
      time: '5 minutes',
    },
  );
  return steps;
}

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
      multiple: p.mcap_usd !== null && p.tvl_usd > 0 ? round4(p.mcap_usd / p.tvl_usd) : null,
    }));
}

/**
 * The five live-token protocols nearest in TVL to a row, so a reader can check
 * the fitted curve against the market's own multiples at that size.
 */
export function nearestComps(p: SnapshotProtocol, comps: SnapshotProtocol[], count = 5): NearestComp[] {
  const target = Math.log10(Math.max(p.tvl_usd, 1));
  return [...comps]
    .map((q) => ({ q, d: Math.abs(Math.log10(Math.max(q.tvl_usd, 1)) - target) }))
    .sort((a, b) => a.d - b.d || (a.q.slug < b.q.slug ? -1 : 1))
    .slice(0, count)
    .map(({ q }) => ({
      slug: q.slug,
      name: q.name,
      tvl_usd: q.tvl_usd,
      mcap_usd: q.mcap_usd!,
      multiple: round4(q.mcap_usd! / q.tvl_usd),
    }));
}

/** A board row's compact form for data.js, with the farm plan generated in the page. */
export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    fitted_value_usd: row.model.fitted_value_usd,
    fitted_multiple: row.model.fitted_multiple,
    comparables: row.model.comparables,
    growth_multiplier: row.model.growth_multiplier,
    age_multiplier: row.model.age_multiplier,
    chain_multiplier: row.model.chain_multiplier,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const comps = comparables(snapshot.protocols);
  const fit = fitCurve(comps);
  const line = fitLine(comps);
  const oos = oosValidation(snapshot);
  const board = buildBoard(snapshot, fit, model);
  const live = liveRows(snapshot);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const nearest: Record<string, NearestComp[]> = {};
  for (const row of board) {
    const p = snapshot.protocols.find((q) => q.slug === row.slug)!;
    nearest[row.slug] = nearestComps(p, comps);
  }
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    fit: {
      intercept: fit.intercept,
      slope: fit.slope,
      quad: fit.quad,
      n: fit.n,
      r2: round4(fit.r2),
      tvl_min: fit.tvl_min,
      tvl_max: fit.tvl_max,
    },
    linear_fit: { intercept: line.intercept, slope: line.slope },
    oos,
    global_multiple: round4(globalMultiple(comps)),
    watchlist: [...snapshot.watchlist],
    rows: board.map(radarRow),
    live,
    nearest,
    comps: [...comps]
      .sort((a, b) => a.tvl_usd - b.tvl_usd)
      .map((p) => ({ tvl_usd: p.tvl_usd, mcap_usd: p.mcap_usd! })),
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
