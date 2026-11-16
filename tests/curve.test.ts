// Launch Radar's curve, guardrails and board shape, checked from the outside.
//
// A second test file, written for the round that had to prove its authorship:
// the quadratic curve's edge cases, the three ways it falls back to the
// straight line, the solver refusing a singular system, gas priced per chain
// in the farm plans, the scatter chart's data, and the board ranking the same
// rows whatever order the snapshot lists them in — plus the two analyses the
// dashboard gained with this round, sector concentration and the market's own
// multiple distribution. Every fixture is synthetic, built here, so the tests
// run with no input files and no network.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MODEL,
  buildBoard,
  buildRadar,
  curveSlopeAt,
  dataScript,
  farmSteps,
  fitCurve,
  fittedMultiple,
  fittedValue,
  gasText,
  gasUsdFor,
  leastSquares,
  nearestComps,
  ratioDistribution,
  sectorConcentration,
  solveLinear,
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

/** A token-bearing protocol on a bent curve: mcap = 10^(4 + 0.2x + 0.02x^2). */
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

/** A token-bearing protocol with a chosen mcap/TVL ratio, for the distribution tests. */
function ratioProtocol(slug: string, tvl: number, ratio: number): SnapshotProtocol {
  return {
    slug,
    name: `Ratio ${slug}`,
    category: 'Dexs',
    chains: ['Ethereum'],
    tvl_usd: tvl,
    change_7d: 0,
    mcap_usd: ratio * tvl,
    listed_at: '2024-01-01',
    gecko_id: `ratio-${slug}`,
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

/** The straight-law fit the board tests price against. */
function lawFit() {
  return fitCurve([1e6, 1e7, 1e8, 1e9].map((tvl, i) => lawProtocol(`fit-${i}`, '2024-01-01', tvl)));
}

test('fitCurve holds its bend across a six-decade TVL spread', () => {
  const comps = [1e5, 1e6, 1e7, 1e8, 1e9, 1e10, 1e11].map((tvl, i) => bentProtocol(`wide-${i}`, '2024-01-01', tvl));
  const fit = fitCurve(comps);
  assert.ok(Math.abs(fit.intercept - 4) < 1e-6, `intercept ${fit.intercept} should be 4`);
  assert.ok(Math.abs(fit.slope - 0.2) < 1e-6, `slope ${fit.slope} should be 0.2`);
  assert.ok(Math.abs(fit.quad - 0.02) < 1e-9, `quad ${fit.quad} should be 0.02`);
  assert.equal(fit.tvl_min, 1e5);
  assert.equal(fit.tvl_max, 1e11);
});

test('fittedValue never falls as TVL grows while the guardrail holds', () => {
  const fit = fitCurve([1e6, 1e7, 1e8, 1e9, 1e10].map((tvl, i) => bentProtocol(`mono-${i}`, '2024-01-01', tvl)));
  let previous = 0;
  for (const tvl of [1e6, 5e6, 1e7, 5e7, 1e8, 5e8, 1e9, 5e9, 1e10]) {
    const value = fittedValue(tvl, fit);
    assert.ok(value > previous, `fitted value at $${tvl} should exceed the one below it`);
    previous = value;
  }
  // The multiple falls with size on this bend: the market pays less per TVL dollar for a bigger protocol.
  assert.ok(fittedMultiple(1e6, fit, MODEL) > fittedMultiple(1e10, fit, MODEL), 'the multiple should fall with size');
});

test('curveSlopeAt is the analytic derivative of the fitted curve', () => {
  const fit = fitCurve([1e6, 1e7, 1e8, 1e9, 1e10].map((tvl, i) => bentProtocol(`slope-${i}`, '2024-01-01', tvl)));
  for (const tvl of [1e6, 1e8, 1e10]) {
    const expected = fit.slope + 2 * fit.quad * Math.log10(tvl);
    assert.ok(Math.abs(curveSlopeAt(tvl, fit) - expected) < 1e-12, `slope at $${tvl} should be ${expected}`);
    assert.ok(curveSlopeAt(tvl, fit) > 0, 'the slope should stay positive across the comps range');
  }
  // On a straight law the slope is the same everywhere: the power.
  const line = fitCurve([1e6, 1e7, 1e8, 1e9].map((tvl, i) => lawProtocol(`flat-${i}`, '2024-01-01', tvl)));
  assert.ok(Math.abs(curveSlopeAt(1e6, line) - 0.5) < 1e-6, 'a straight law should slope at its power');
  assert.ok(Math.abs(curveSlopeAt(1e9, line) - 0.5) < 1e-6, 'a straight law should slope at its power everywhere');
});

test('fitCurve falls back to the line when the bend itself is absurd', () => {
  // A law with a 0.8 quadratic term and a slope that stays positive, so the
  // only guard that can fire is the |c| > 0.5 one.
  const comps: SnapshotProtocol[] = [1e6, 1e7, 1e8, 1e9, 1e10].map((tvl, i) => {
    const x = Math.log10(tvl);
    return {
      slug: `absurd-${i}`,
      name: `Absurd ${i}`,
      category: 'Lending',
      chains: ['Ethereum'],
      tvl_usd: tvl,
      change_7d: 0,
      mcap_usd: Math.pow(10, 2 + 0.5 * x + 0.8 * x * x),
      listed_at: '2024-01-01',
      gecko_id: `absurd-${i}`,
      symbol: `A${i}`,
    };
  });
  const fit = fitCurve(comps);
  assert.equal(fit.quad, 0, 'a quadratic term past 0.5 must fall back to the line');
  assert.ok(fit.slope > 0, 'the fallback line should still rise');
});

test('fitCurve falls back to the line when the slope would turn negative at the small end', () => {
  // A curve that bends down hard: its slope is already negative at the
  // smallest TVL, so the guard must hand back the straight line.
  const comps: SnapshotProtocol[] = [1e6, 1e7, 1e8, 1e9, 1e10].map((tvl, i) => {
    const x = Math.log10(tvl);
    return {
      slug: `down-${i}`,
      name: `Down ${i}`,
      category: 'Lending',
      chains: ['Ethereum'],
      tvl_usd: tvl,
      change_7d: 0,
      mcap_usd: Math.pow(10, 10 + 0.5 * x - 0.05 * x * x),
      listed_at: '2024-01-01',
      gecko_id: `down-${i}`,
      symbol: `D${i}`,
    };
  });
  const fit = fitCurve(comps);
  assert.equal(fit.quad, 0, 'a curve falling at the small end must fall back to the line');
  for (const tvl of [1e6, 1e10]) {
    assert.ok(fittedValue(tvl, fit) > 0, 'the fallback should still price every TVL');
  }
});

test('fitCurve falls back to the line when every comparable shares one TVL', () => {
  const comps = [lawProtocol('one-a', '2024-01-01', 1e8), lawProtocol('one-b', '2024-01-01', 1e8), lawProtocol('one-c', '2024-01-01', 1e8)];
  const fit = fitCurve(comps);
  assert.equal(fit.quad, 0, 'one TVL cannot carry a quadratic');
  assert.equal(fit.n, 3);
});

test('solveLinear refuses a singular system instead of dividing by zero', () => {
  assert.equal(solveLinear([[1, 2], [2, 4]], [3, 6]), null);
  assert.equal(solveLinear([[0, 0], [0, 0]], [0, 0]), null);
  const solved = solveLinear([[2, 0], [0, 3]], [4, 9]);
  assert.deepEqual(solved, [2, 3]);
});

test('leastSquares refuses a design with no independent direction', () => {
  // One row cannot pin three coefficients: the normal equations are singular.
  assert.equal(leastSquares([[1, 1]], [2]), null);
  // Two identical feature rows carry one direction between them.
  assert.equal(leastSquares([[2, 4], [2, 4]], [1, 1]), null);
  // Three honest rows on a line recover it.
  const beta = leastSquares([[1, 1], [2, 4], [3, 9]], [3, 5, 7]);
  assert.ok(beta !== null, 'a solvable design should solve');
  assert.ok(Math.abs(beta[0]! - 1) < 1e-9 && Math.abs(beta[1]! - 2) < 1e-9, 'the line should be 1 + 2x');
});

test('gasUsdFor prices every cheap chain at fifty cents', () => {
  const cheap = [
    'Arbitrum', 'Optimism', 'Base', 'Polygon', 'Binance', 'Avalanche', 'Linea', 'Sonic', 'Sui', 'Mantle',
    'Fantom', 'Scroll', 'Berachain', 'xDai', 'Celo', 'zkSync Era', 'Blast', 'Mode', 'Gnosis', 'Moonbeam',
    'Aptos', 'Near', 'Fraxtal', 'Unichain', 'World Chain', 'Abstract', 'Ink', 'Soneium', 'Starknet',
    'Hyperliquid L1', 'Tron',
  ];
  for (const chain of cheap) {
    assert.equal(gasUsdFor(chain), 0.5, `${chain} should plan fifty cents a step`);
    assert.equal(gasText(gasUsdFor(chain)), 'about $0.50');
  }
  assert.equal(gasUsdFor('Ethereum'), 5);
  assert.equal(gasUsdFor('Solana'), 0.01);
  assert.equal(gasText(gasUsdFor('Solana')), 'under $0.10');
});

test('farmSteps add a second-chain step only when the protocol runs on two chains', () => {
  const single = { ...earlyProtocol('single-one', 'Single One', 3e8), chains: ['Solana'] };
  const multi = { ...earlyProtocol('multi-one', 'Multi One', 3e8), chains: ['Ethereum', 'Arbitrum'] };
  const singleSteps = farmSteps(single, 600, 4, 123_456_789);
  const multiSteps = farmSteps(multi, 600, 4, 123_456_789);
  assert.equal(singleSteps.length, 7, 'one chain means seven steps');
  assert.equal(multiSteps.length, 8, 'two chains mean eight steps');
  const singleJoined = singleSteps.map((s) => `${s.text} ${s.cost}`).join(' ');
  const multiJoined = multiSteps.map((s) => `${s.text} ${s.cost}`).join(' ');
  assert.ok(singleJoined.includes('under $0.10 of gas'), 'a Solana plan should price Solana gas');
  assert.ok(!singleJoined.includes('Arbitrum'), 'a single-chain plan should name no second chain');
  assert.ok(multiJoined.includes('Arbitrum'), 'a two-chain plan should name the second chain');
  assert.ok(multiJoined.includes('about $0.50 of gas'), 'the Arbitrum step should price Arbitrum gas');
  assert.ok(multiJoined.includes('about $5 of gas'), 'the Ethereum steps should price Ethereum gas');
  // A chain the table has never seen plans a dollar, and says so.
  const unknown = { ...earlyProtocol('new-one', 'New One', 3e8), chains: ['Some New Chain'] };
  const unknownSteps = farmSteps(unknown, 600, 4, 123_456_789);
  assert.ok(unknownSteps.map((s) => `${s.text} ${s.cost}`).join(' ').includes('about $1 of gas'), 'an unlisted chain should plan a dollar');
});

test('the scatter chart data is the comparables, smallest TVL first', () => {
  const protocols = [
    lawProtocol('chart-big', '2024-01-01', 1e9),
    lawProtocol('chart-small', '2024-01-01', 1e6),
    lawProtocol('chart-mid', '2024-01-01', 1e7),
    earlyProtocol('chart-early', 'Chart Early', 5e8),
  ];
  const { radar } = buildRadar(snapshotOf(protocols, ['chart-early']));
  assert.equal(radar.comps.length, 3, 'the chart should carry every comparable');
  assert.deepEqual(radar.comps.map((c) => c.tvl_usd), [1e6, 1e7, 1e9], 'the chart should run smallest TVL first');
  for (const point of radar.comps) {
    const source = protocols.find((p) => p.tvl_usd === point.tvl_usd)!;
    assert.equal(point.mcap_usd, source.mcap_usd, 'each dot should be one protocol\u2019s own TVL and market cap');
  }
  assert.ok(radar.fit.tvl_min <= radar.comps[0]!.tvl_usd, 'the curve range should cover the chart');
  assert.ok(radar.fit.tvl_max >= radar.comps[radar.comps.length - 1]!.tvl_usd, 'the curve range should cover the chart');
});

test('nearestComps honours a smaller count and stays nearest first', () => {
  const comps = [1e6, 2e6, 5e6, 1e7, 2e7, 5e7, 1e8].map((tvl, i) => lawProtocol(`near-${i}`, '2024-01-01', tvl));
  const target = earlyProtocol('target-one', 'Target One', 9e6);
  const three = nearestComps(target, comps, 3);
  assert.equal(three.length, 3);
  assert.deepEqual(three.map((c) => c.tvl_usd), [1e7, 5e6, 2e7], 'the three nearest TVLs, nearest first');
  const one = nearestComps(target, comps, 1);
  assert.equal(one.length, 1);
  assert.equal(one[0]!.tvl_usd, 1e7);
});

test('buildBoard ranks the same rows whatever order the snapshot lists them in', () => {
  const protocols = [
    earlyProtocol('alpha-one', 'Alpha One', 4e8),
    earlyProtocol('beta-one', 'Beta One', 1e8),
    earlyProtocol('gamma-one', 'Gamma One', 2.5e8),
    earlyProtocol('delta-one', 'Delta One', 6e8, 'Dexs'),
  ];
  const fit = lawFit();
  const first = buildBoard(snapshotOf(protocols, ['alpha-one', 'beta-one', 'gamma-one', 'delta-one']), fit);
  const shuffled = buildBoard(
    snapshotOf([protocols[3]!, protocols[1]!, protocols[0]!, protocols[2]!], ['delta-one', 'gamma-one', 'beta-one', 'alpha-one']),
    fit,
  );
  assert.deepEqual(shuffled.map((r) => r.slug), first.map((r) => r.slug), 'shuffling the input should not shuffle the board');
  assert.deepEqual(shuffled.map((r) => r.implied_value_usd), first.map((r) => r.implied_value_usd), 'implied values should not move either');
  assert.deepEqual(shuffled.map((r) => r.rank), [1, 2, 3, 4], 'ranks should stay 1..n');
});

test('sectorConcentration names one category when the board has one', () => {
  const protocols = [earlyProtocol('only-a', 'Only A', 4e8), earlyProtocol('only-b', 'Only B', 1e8)];
  const board = buildBoard(snapshotOf(protocols, ['only-a', 'only-b']), lawFit());
  const sectors = sectorConcentration(board);
  assert.equal(sectors.categories.length, 1);
  assert.equal(sectors.categories[0]!.category, 'Lending');
  assert.equal(sectors.categories[0]!.rows, 2);
  assert.equal(sectors.categories[0]!.row_share, 1);
  assert.equal(sectors.categories[0]!.value_share, 1);
  assert.equal(sectors.herfindahl, 1, 'one category holding everything is maximally concentrated');
});

test('sectorConcentration shares add to one and the index is the sum of squares', () => {
  const protocols = [
    earlyProtocol('lend-a', 'Lend A', 4e8, 'Lending'),
    earlyProtocol('lend-b', 'Lend B', 1e8, 'Lending'),
    earlyProtocol('dex-a', 'Dex A', 2.5e8, 'Dexs'),
  ];
  const board = buildBoard(snapshotOf(protocols, ['lend-a', 'lend-b', 'dex-a']), lawFit());
  const sectors = sectorConcentration(board);
  assert.equal(sectors.categories.length, 2);
  const rowShare = sectors.categories.reduce((a, c) => a + c.row_share, 0);
  const valueShare = sectors.categories.reduce((a, c) => a + c.value_share, 0);
  assert.ok(Math.abs(rowShare - 1) < 1e-9, `row shares should add to 1, got ${rowShare}`);
  assert.ok(Math.abs(valueShare - 1) < 1e-9, `value shares should add to 1, got ${valueShare}`);
  const squares = sectors.categories.reduce((a, c) => a + c.value_share * c.value_share, 0);
  assert.ok(Math.abs(sectors.herfindahl - squares) < 1e-9, 'the index should be the sum of squared value shares');
  assert.ok(sectors.herfindahl > 0.5 && sectors.herfindahl < 1, 'two categories should sit between even and total');
  assert.ok(
    sectors.categories[0]!.value_share >= sectors.categories[1]!.value_share,
    'categories should run largest value share first',
  );
  assert.equal(sectors.categories.reduce((a, c) => a + c.rows, 0), 3, 'every row should sit in exactly one category');
});

test('ratioDistribution quartiles and bands match hand-counted ratios', () => {
  const ratios = [0.01, 0.05, 0.1, 0.2, 0.5, 1, 2];
  const comps = ratios.map((r, i) => ratioProtocol(`ratio-${i}`, 1e7 * (i + 1), r));
  const dist = ratioDistribution(comps);
  assert.equal(dist.n, 7);
  assert.equal(dist.min, 0.01);
  assert.equal(dist.max, 2);
  assert.equal(dist.median, 0.2);
  assert.ok(Math.abs(dist.p25 - 0.075) < 1e-12, `p25 ${dist.p25} should be 0.075`);
  assert.ok(Math.abs(dist.p75 - 0.75) < 1e-12, `p75 ${dist.p75} should be 0.75`);
  const bands = Object.fromEntries(dist.bands.map((b) => [b.label, b.count]));
  assert.equal(bands['<0.05x'], 1);
  assert.equal(bands['0.05–0.2x'], 2);
  assert.equal(bands['0.2–0.5x'], 1);
  assert.equal(bands['0.5–1x'], 1);
  assert.equal(bands['>1x'], 2);
  assert.equal(dist.bands.reduce((a, b) => a + b.count, 0), 7, 'every comparable should sit in exactly one band');
  const share = dist.bands.reduce((a, b) => a + b.share, 0);
  assert.ok(Math.abs(share - 1) < 1e-9, `band shares should add to 1, got ${share}`);
});

test('ratioDistribution on one comparable is a single point', () => {
  const dist = ratioDistribution([ratioProtocol('solo', 1e7, 0.4)]);
  assert.equal(dist.n, 1);
  assert.equal(dist.min, 0.4);
  assert.equal(dist.median, 0.4);
  assert.equal(dist.max, 0.4);
  assert.equal(dist.bands.find((b) => b.label === '0.2–0.5x')!.count, 1);
});

test('buildRadar carries the sector and ratio analyses into the dashboard data', () => {
  const protocols = [
    earlyProtocol('lend-a', 'Lend A', 4e8, 'Lending'),
    earlyProtocol('dex-a', 'Dex A', 2.5e8, 'Dexs'),
    lawProtocol('live-a', '2024-01-01', 1e8),
    lawProtocol('live-b', '2024-01-01', 1e9),
  ];
  const { board, radar } = buildRadar(snapshotOf(protocols, ['lend-a', 'dex-a']));
  assert.equal(radar.sectors.categories.length, 2, 'the dashboard data should carry the sector split');
  assert.ok(radar.sectors.herfindahl > 0 && radar.sectors.herfindahl <= 1, 'the index should sit in (0, 1]');
  assert.equal(radar.ratio_bands.n, 2, 'the dashboard data should carry the multiple distribution');
  assert.equal(radar.curve_slopes.length, 3, 'the dashboard data should carry the slope at three TVLs');
  assert.ok(radar.curve_slopes.every((s) => s.slope > 0), 'every shipped slope should be positive');
  assert.ok(
    radar.curve_slopes[0]!.tvl_usd < radar.curve_slopes[1]!.tvl_usd &&
      radar.curve_slopes[1]!.tvl_usd < radar.curve_slopes[2]!.tvl_usd,
    'the slopes should run small TVL to large',
  );
  const script = dataScript(radar);
  assert.ok(script.includes('"sectors"'), 'data.js should carry the sector analysis');
  assert.ok(script.includes('"ratio_bands"'), 'data.js should carry the ratio distribution');
  assert.ok(script.includes('"curve_slopes"'), 'data.js should carry the curve slopes');
  assert.equal(board.length, 2);
});
