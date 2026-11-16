// Launch Radar's model, checked from the outside.
//
// These tests pin the behaviour the dashboard and the gate rely on, without
// touching the snapshot or the board: the fitted curve recovers a known power
// law and a known bend, its multiple stays inside the stated guardrail, the
// blind test beats the straight line and the market median on law-abiding
// data, the board ranks by implied value, and the farm plans stay inside the
// gate's length window with gas priced per chain. Every fixture is synthetic,
// built here, so the tests run with no input files and no network.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MODEL,
  ageDays,
  boardIssue,
  buildBoard,
  dataScript,
  fitCurve,
  fitLine,
  fittedMultiple,
  fittedValue,
  gasText,
  gasUsdFor,
  globalMultiple,
  impliedValue,
  isPreToken,
  isRankable,
  lineValue,
  liveRows,
  nearestComps,
  oosValidation,
  parseSnapshot,
  farmSteps,
} from '../lib/model.ts';
import type { Snapshot, SnapshotProtocol } from '../lib/model.ts';

/** A token-bearing protocol sitting exactly on mcap = 1000 * sqrt(TVL). */
function lawProtocol(slug: string, listedAt: string, tvl: number): SnapshotProtocol {
  return {
    slug,
    name: `Law ${slug}`,
    category: 'Lending',
    chains: ['Ethereum'],
    tvl_usd: tvl,
    change_7d: 0,
    mcap_usd: 1000 * Math.sqrt(tvl),
    listed_at: listedAt,
    gecko_id: `law-${slug}`,
    symbol: slug.toUpperCase(),
  };
}

/** A token-bearing protocol sitting on a bent curve: mcap = 10^(4 + 0.2x + 0.02x^2). */
function bentProtocol(slug: string, listedAt: string, tvl: number): SnapshotProtocol {
  const x = Math.log10(tvl);
  return {
    slug,
    name: `Bent ${slug}`,
    category: 'Dexs',
    chains: ['Base'],
    tvl_usd: tvl,
    change_7d: 0,
    mcap_usd: Math.pow(10, 4 + 0.2 * x + 0.02 * x * x),
    listed_at: listedAt,
    gecko_id: `bent-${slug}`,
    symbol: slug.toUpperCase(),
  };
}

/** A pre-token protocol: no market cap, no CoinGecko id, no symbol. */
function earlyProtocol(slug: string, name: string, tvl: number, category: string | null = 'Lending'): SnapshotProtocol {
  return {
    slug,
    name,
    category,
    chains: ['Ethereum', 'Arbitrum'],
    tvl_usd: tvl,
    change_7d: 12,
    mcap_usd: null,
    listed_at: '2024-03-15',
    gecko_id: null,
    symbol: null,
  };
}

/** A snapshot holding the given protocols, with the given watchlist. */
function snapshotOf(protocols: SnapshotProtocol[], watchlist: string[]): Snapshot {
  return { as_of: '2025-11-01', source: 'test fixture', floor_usd: 50_000_000, protocols, watchlist };
}

test('fitCurve recovers a known power law almost exactly, with no bend', () => {
  const comps = [1e6, 1e7, 1e8, 1e9, 1e10].map((tvl, i) => lawProtocol(`law-${i}`, '2024-01-01', tvl));
  const fit = fitCurve(comps);
  assert.ok(Math.abs(fit.intercept - 3) < 1e-6, `intercept ${fit.intercept} should be 3`);
  assert.ok(Math.abs(fit.slope - 0.5) < 1e-6, `slope ${fit.slope} should be 0.5`);
  assert.ok(Math.abs(fit.quad) < 1e-9, `quad ${fit.quad} should be 0 on a straight law`);
  assert.equal(fit.n, 5);
  assert.ok(fit.r2 > 0.999999, `r2 ${fit.r2} should be near 1`);
  assert.equal(fit.tvl_min, 1e6);
  assert.equal(fit.tvl_max, 1e10);
});

test('fitCurve recovers a known bend in the log-log curve', () => {
  const comps = [1e6, 1e7, 1e8, 1e9, 1e10].map((tvl, i) => bentProtocol(`bent-${i}`, '2024-01-01', tvl));
  const fit = fitCurve(comps);
  assert.ok(Math.abs(fit.intercept - 4) < 1e-6, `intercept ${fit.intercept} should be 4`);
  assert.ok(Math.abs(fit.slope - 0.2) < 1e-6, `slope ${fit.slope} should be 0.2`);
  assert.ok(Math.abs(fit.quad - 0.02) < 1e-9, `quad ${fit.quad} should be 0.02`);
  assert.ok(fit.r2 > 0.999999, `r2 ${fit.r2} should be near 1`);
  for (const p of comps) {
    const got = fittedValue(p.tvl_usd, fit);
    assert.ok(Math.abs(got - p.mcap_usd!) / p.mcap_usd! < 1e-9, `fitted ${got} should match ${p.mcap_usd}`);
  }
});

test('fitCurve falls back to the line when the bend would turn the slope negative', () => {
  // A law that falls steeply at the top end: the quadratic wants a negative
  // slope inside the range, so the guard must hand back the straight line.
  const comps: SnapshotProtocol[] = [1e6, 1e7, 1e8, 1e9, 1e10].map((tvl, i) => {
    const x = Math.log10(tvl);
    return {
      slug: `fall-${i}`,
      name: `Fall ${i}`,
      category: 'Lending',
      chains: ['Ethereum'],
      tvl_usd: tvl,
      change_7d: 0,
      mcap_usd: Math.pow(10, 12 - 0.4 * x - 0.02 * x * x),
      listed_at: '2024-01-01',
      gecko_id: `fall-${i}`,
      symbol: `F${i}`,
    };
  });
  const fit = fitCurve(comps);
  assert.equal(fit.quad, 0, 'a curve that would fall must fall back to the line');
  const line = fitLine(comps);
  assert.ok(Math.abs(fit.intercept - line.intercept) < 1e-9, 'the fallback keeps the line');
  assert.ok(Math.abs(fit.slope - line.slope) < 1e-9, 'the fallback keeps the slope');
});

test('fitCurve falls back to the line on too few distinct TVLs', () => {
  const comps = [lawProtocol('same-a', '2024-01-01', 1e8), lawProtocol('same-b', '2024-01-01', 1e8)];
  const fit = fitCurve(comps);
  assert.equal(fit.quad, 0, 'two points cannot carry a quadratic');
  assert.equal(fit.n, 2);
});

test('fittedMultiple stays inside the stated guardrail', () => {
  const comps = [1e6, 1e7, 1e8, 1e9].map((tvl, i) => lawProtocol(`clamp-${i}`, '2024-01-01', tvl));
  const fit = fitCurve(comps);
  assert.equal(fittedMultiple(1e4, fit, MODEL), 1.5);
  assert.equal(fittedMultiple(1e12, fit, MODEL), 0.02);
  const mid = fittedMultiple(1e8, fit, MODEL);
  assert.ok(mid > 0.02 && mid < 1.5, `mid multiple ${mid} should sit inside the guardrail`);
});

test('lineValue and fittedValue agree when the curve has no bend', () => {
  const comps = [1e6, 1e7, 1e8, 1e9].map((tvl, i) => lawProtocol(`agree-${i}`, '2024-01-01', tvl));
  const fit = fitCurve(comps);
  const line = fitLine(comps);
  for (const tvl of [1e6, 1e7, 1e8, 1e9, 1e10]) {
    const ratio = fittedValue(tvl, fit) / lineValue(tvl, line);
    assert.ok(Math.abs(ratio - 1) < 1e-6, `fitted ${fittedValue(tvl, fit)} should match the line ${lineValue(tvl, line)}`);
  }
});

test('globalMultiple is the median ratio, not the mean', () => {
  const comps = [1e6, 1e7, 1e8].map((tvl, i) => lawProtocol(`med-${i}`, '2024-01-01', tvl));
  const got = globalMultiple(comps);
  const ratios = comps.map((p) => p.mcap_usd! / p.tvl_usd).sort((a, b) => a - b);
  assert.equal(got, ratios[1]);
});

test('ageDays counts whole days and refuses bad dates', () => {
  assert.equal(ageDays('2025-11-01', '2025-10-01'), 31);
  assert.equal(ageDays('2025-11-01', '2025-11-01'), 0);
  assert.equal(ageDays('2025-11-01', null), null);
  assert.equal(ageDays('2025-11-01', 'not-a-date'), null);
  assert.equal(ageDays('2025-11-01', '2026-01-01'), 0);
});

test('impliedValue clamps wild growth and prices an unknown age at one year', () => {
  const fit = fitCurve([1e6, 1e7, 1e8, 1e9].map((tvl, i) => lawProtocol(`imp-${i}`, '2024-01-01', tvl)));
  const hot: SnapshotProtocol = { ...earlyProtocol('hot-one', 'Hot One', 1e8), change_7d: 500, listed_at: null };
  const cold: SnapshotProtocol = { ...earlyProtocol('cold-one', 'Cold One', 1e8), change_7d: -200, listed_at: null };
  const hotValue = impliedValue(hot, '2025-11-01', fit);
  const coldValue = impliedValue(cold, '2025-11-01', fit);
  assert.equal(hotValue.growthPct, 100);
  assert.equal(coldValue.growthPct, -50);
  assert.ok(hotValue.growthMult > coldValue.growthMult, 'hot growth should outprice cold growth');
  assert.ok(hotValue.implied > 0 && coldValue.implied > 0, 'both implied values should be positive');
  assert.equal(hotValue.age, null);
  const knownAge = impliedValue(earlyProtocol('aged-one', 'Aged One', 1e8), '2025-11-01', fit);
  assert.ok(knownAge.age !== null && knownAge.age > 500, `age ${knownAge.age} should exceed 500 days`);
});

test('gasUsdFor prices Ethereum dear, Solana near-free, cheap chains in the middle', () => {
  assert.equal(gasUsdFor('Ethereum'), 5);
  assert.equal(gasUsdFor('Solana'), 0.01);
  assert.equal(gasUsdFor('Arbitrum'), 0.5);
  assert.equal(gasUsdFor('Base'), 0.5);
  assert.equal(gasUsdFor('Binance'), 0.5);
  assert.equal(gasUsdFor('Some New Chain'), 1);
  assert.equal(gasUsdFor(''), 1);
  assert.equal(gasText(0.01), 'under $0.10');
  assert.equal(gasText(0.5), 'about $0.50');
  assert.equal(gasText(1), 'about $1');
  assert.equal(gasText(5), 'about $5');
});

test('farmSteps price gas from the protocol chain, and stay inside the gate', () => {
  const eth = { ...earlyProtocol('eth-one', 'Eth One', 3e8), chains: ['Ethereum'] };
  const sol = { ...earlyProtocol('sol-one', 'Sol One', 3e8), chains: ['Solana'] };
  const ethSteps = farmSteps(eth, 600, 4, 123_456_789);
  const solSteps = farmSteps(sol, 600, 4, 123_456_789);
  assert.ok(ethSteps.length >= 7 && ethSteps.length <= 8, `expected 7 or 8 steps, got ${ethSteps.length}`);
  for (const step of [ethSteps, solSteps]) {
    for (const s of step) {
      const text = `${s.text} Cost: ${s.cost}. Time: ${s.time}.`;
      assert.ok(text.length >= 20 && text.length <= 600, `step of ${text.length} chars escapes the gate window`);
    }
  }
  const ethJoined = ethSteps.map((s) => `${s.text} ${s.cost}`).join(' ');
  const solJoined = solSteps.map((s) => `${s.text} ${s.cost}`).join(' ');
  assert.ok(ethJoined.includes('about $5 of gas'), 'an Ethereum plan should price Ethereum gas');
  assert.ok(solJoined.includes('under $0.10 of gas'), 'a Solana plan should price Solana gas');
  assert.ok(!ethJoined.includes('under $0.10'), 'an Ethereum plan should never carry Solana gas');
  assert.ok(ethJoined.includes('#4'), 'the plan should name its rank');
  assert.ok(ethJoined.includes('$123.5M'), 'the plan should name its implied value');
  assert.ok(ethJoined.includes('Ethereum'), 'the plan should name its chain');
});

test('isPreToken and isRankable keep the board clean', () => {
  const clean = earlyProtocol('clean-one', 'Clean One', 1e8);
  assert.equal(isPreToken(clean), true);
  assert.equal(isRankable(clean), true);
  assert.equal(isPreToken(lawProtocol('tok-one', '2024-01-01', 1e8)), false);
  assert.equal(isRankable({ ...clean, name: 'Wrapped Clean' }), false);
  assert.equal(isRankable({ ...clean, name: 'Clean V2' }), false);
  assert.equal(isRankable({ ...clean, name: 'Binance Clean' }), false);
  assert.equal(isRankable({ ...clean, category: 'Bridge' }), false);
  assert.equal(isRankable({ ...clean, category: 'Liquid Staking' }), false);
});

test('oosValidation beats the line and the market median on law-abiding data', () => {
  const protocols: SnapshotProtocol[] = [];
  const groups: Array<[string, number]> = [
    ['2024-06-01', 6],
    ['2025-02-01', 6],
    ['2025-07-01', 6],
    ['2025-10-01', 6],
  ];
  let n = 0;
  for (const [listedAt, count] of groups) {
    for (let i = 0; i < count; i++) {
      protocols.push(lawProtocol(`oos-${n}`, listedAt, 1e6 * (1 + n)));
      n += 1;
    }
  }
  const splits = oosValidation(snapshotOf(protocols, []));
  assert.equal(splits.length, 3);
  for (const split of splits) {
    assert.ok(split.n_train >= 3 && split.n_test >= 3, 'each split needs a real train and test set');
    assert.ok(
      split.curve_median_error_x <= split.median_median_error_x,
      `curve ${split.curve_median_error_x}x should beat median ${split.median_median_error_x}x at ${split.cutoff}`,
    );
    assert.ok(
      split.curve_median_error_x <= split.line_median_error_x,
      `curve ${split.curve_median_error_x}x should beat the line ${split.line_median_error_x}x at ${split.cutoff}`,
    );
    assert.ok(split.curve_within_2x >= split.median_within_2x, 'the curve should land within 2x at least as often');
    assert.ok(split.line_median_error_x <= split.median_median_error_x, 'the line should beat the median too');
  }
});

test('buildBoard ranks by implied value and covers the watchlist', () => {
  const protocols = [
    earlyProtocol('alpha-one', 'Alpha One', 4e8),
    earlyProtocol('beta-one', 'Beta One', 1e8),
    earlyProtocol('gamma-one', 'Gamma One', 2.5e8),
  ];
  const fit = fitCurve([1e6, 1e7, 1e8, 1e9].map((tvl, i) => lawProtocol(`board-${i}`, '2024-01-01', tvl)));
  const board = buildBoard(snapshotOf(protocols, ['alpha-one', 'beta-one', 'gamma-one']), fit);
  assert.equal(board.length, 3);
  assert.deepEqual(board.map((r) => r.rank), [1, 2, 3]);
  assert.equal(board[0]!.slug, 'alpha-one');
  assert.equal(board[2]!.slug, 'beta-one');
  for (let i = 1; i < board.length; i++) {
    assert.ok(board[i]!.implied_value_usd <= board[i - 1]!.implied_value_usd, 'implied value should not rise down the board');
  }
  assert.equal(boardIssue(board, snapshotOf(protocols, ['alpha-one', 'beta-one', 'gamma-one'])), null);
});

test('boardIssue names a watchlist slug the board misses', () => {
  const protocols = [earlyProtocol('only-one', 'Only One', 1e8)];
  const fit = fitCurve([1e6, 1e7, 1e8].map((tvl, i) => lawProtocol(`miss-${i}`, '2024-01-01', tvl)));
  const board = buildBoard(snapshotOf(protocols, ['only-one']), fit);
  const problem = boardIssue(board, snapshotOf(protocols, ['only-one', 'ghost-one']));
  assert.ok(problem !== null && problem.includes('ghost-one'), `expected the missing slug named, got ${problem}`);
});

test('liveRows keeps only live tokens, biggest first', () => {
  const protocols = [
    lawProtocol('live-big', '2024-01-01', 1e9),
    lawProtocol('live-small', '2024-01-01', 1e6),
    earlyProtocol('early-one', 'Early One', 5e8),
  ];
  const live = liveRows(snapshotOf(protocols, []));
  assert.equal(live.length, 2);
  assert.equal(live[0]!.slug, 'live-big');
  assert.ok(live.every((r) => r.mcap_usd !== null), 'every live row should carry a market cap');
});

test('nearestComps returns the five closest TVLs', () => {
  const comps = [1e6, 2e6, 5e6, 1e7, 2e7, 5e7, 1e8, 2e8].map((tvl, i) => lawProtocol(`near-${i}`, '2024-01-01', tvl));
  const target = earlyProtocol('target-one', 'Target One', 9e6);
  const near = nearestComps(target, comps);
  assert.equal(near.length, 5);
  assert.equal(near[0]!.tvl_usd, 1e7);
  const distances = near.map((c) => Math.abs(Math.log10(c.tvl_usd) - Math.log10(9e6)));
  for (let i = 1; i < distances.length; i++) assert.ok(distances[i]! >= distances[i - 1]!, 'comps should widen from the target');
});

test('parseSnapshot refuses shapes the model cannot score', () => {
  const good = snapshotOf([earlyProtocol('ok-one', 'Ok One', 1e8)], ['ok-one']);
  assert.equal(parseSnapshot(JSON.stringify(good)).as_of, '2025-11-01');
  assert.throws(() => parseSnapshot('{nope'), /not JSON/);
  assert.throws(() => parseSnapshot(JSON.stringify({ ...good, floor_usd: -5 })), /floor_usd/);
  assert.throws(() => parseSnapshot(JSON.stringify({ ...good, protocols: 'none' })), /protocols array/);
});

test('dataScript wraps the radar payload as one script', () => {
  const script = dataScript({
    as_of: '2025-11-01',
    source: 'test fixture',
    floor_usd: 50_000_000,
    model: MODEL,
    model_version: 'radar-4',
    watchlist_size: 1,
    board_size: 0,
    early_size: 0,
    live_size: 0,
    fit: { intercept: 3, slope: 0.5, quad: 0, n: 4, r2: 1, tvl_min: 1e6, tvl_max: 1e9 },
    linear_fit: { intercept: 3, slope: 0.5 },
    oos: [],
    global_multiple: 0.1,
    watchlist: [],
    rows: [],
    live: [],
    nearest: {},
    comps: [],
  });
  assert.ok(script.startsWith('window.RADAR='), 'the dashboard reads window.RADAR');
  assert.ok(script.trimEnd().endsWith('};'), 'the payload should close as one statement');
});
