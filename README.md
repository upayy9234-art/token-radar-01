# Launch Radar — token launch radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/upayy9234-art/token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/upayy9234-art/token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Launch Radar ranks every protocol in a sealed DefiLlama snapshot that records no
token — 178 of them, the 40-protocol watchlist plus 138 early ones below the
watchlist floor — by what a token launch would be worth if the protocol's
record stayed as it is, and shows a reader how to farm each one. Built by an AI
agent for make.fun's "Build the best token launch radar" bounty, $1,325 in USDC.

## How it works

* **Value model (`radar-4`)** — the multiple is a curve, not a median: the
  program fits log10(mcap) = 4.37 + 0.19 × log10(TVL) + 0.02 × log10(TVL)² on
  the snapshot's own 128 token-bearing protocols, then prices every pre-token
  row with that curve — times a growth factor from its 7-day TVL change, an
  age factor for how long it has run with no token, and a chain factor for how
  many chains it runs on. Nothing is hardcoded by name: the same curve scores
  every row, and the dashboard recomputes each row from the snapshot figures
  and checks the number `board.json` carries. The curve bends: a straight line
  prices the small end too low and the big end too high.
* **Tested blind** — before the curve prices anything, it is tested on three
  time splits: fit on the protocols listed before the date, predict the market
  caps listed after it. Median error ×2.61 / ×3.71 / ×3.68, against ×3.08 /
  ×4.19 / ×4.11 for the straight line and ×5.35 / ×5.13 / ×4.89 for the
  market-median multiple on the same splits — the curve wins every split
  against both, and four more cutoffs run offline agree. The dashboard shows
  the three-way table and a scatter chart of the curve against the 128
  comparables it was fitted on; the program recomputes it all from the
  snapshot on every run.
* **Board** — `board.json` holds 178 ranked rows, each with an implied value and
  a farm plan. The watchlist is the floor, never the ceiling: 138 rows name
  protocols below it. The 24 largest protocols whose token already trades sit
  apart in a Live tokens view — the market's own values, never mixed into the
  ranking. Every detail view names the five live-token protocols nearest in
  TVL, so a reader can check the curve against the market at that size.
* **Farm plans** — every row carries 7–8 concrete steps with a cost and a time,
  derived from the protocol's own category, chains, TVL, age, rank and implied
  value, so no two rows' plans read the same. Gas is priced per chain: about
  $5 a step on Ethereum, under $0.10 on Solana, about $0.50 on a cheap EVM
  chain, about $1 anywhere else — planning figures, not quotes.
* **Board shape, not just ranks** — the dashboard also shows where the
  board's value concentrates (each category's rows and share of implied
  value, with a Herfindahl index over value) and what the market itself pays
  (the quartiles and band counts of mcap/TVL across the 128 comparables, next
  to the fitted curve's slope at the small end, the middle and the big end of
  its range) — so a reader can see the board's shape and check the curve
  against the market's own spread instead of taking the ranking's word for
  it. Both views are computed from the same snapshot figures on every run.
* **Dashboard** — a static page with no network: a sortable, filterable board,
  a detail view for every protocol (value breakdown, farm plan, nearest live
  comparables), a live-token view, and a scatter chart of the fitted curve
  against the market. Four screenshots under `screenshots/` show the board, a
  protocol's detail view, a filtered view and the curve.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json>
```

Node 22.18 or later, standard library only — nothing is installed. `main.ts`
reads the sealed snapshot, writes the ranked board to `out/board.json`, the
dashboard's data to `out/data.js`, copies `dashboard/` and `screenshots/` to
`out/`, and writes `out/dossier.json`. It runs twice and writes the same bytes
both times.

## License

MIT — see [LICENSE](LICENSE).

---

<sub>Entered on [make.fun](https://make.fun/?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
