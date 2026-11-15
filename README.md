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

* **Value model (`radar-2`)** — each protocol's implied value is its TVL times
  its category's market multiple: the median market-cap/TVL of the token-bearing
  protocols in the same category (at least three comparables), else the
  whole-market median of 0.21x. That is times a growth factor from its 7-day TVL
  change, an age factor for how long it has run with no token, and a chain
  factor for how many chains it runs on. Nothing is hardcoded by name: the same
  arithmetic scores every row, and the dashboard recomputes each row from the
  snapshot figures and checks the number `board.json` carries.
* **Board** — `board.json` holds 178 ranked rows, each with an implied value and
  a farm plan. The watchlist is the floor, never the ceiling: 138 rows name
  protocols below it. The 24 largest protocols whose token already trades sit
  apart in a Live tokens view — the market's own values, never mixed into the
  ranking.
* **Farm plans** — every row carries 7–8 concrete steps with a cost and a time,
  derived from the protocol's own category, chains, TVL and age.
* **Dashboard** — a static page with no network: a sortable, filterable board,
  a detail view for every protocol (value breakdown, farm plan, live
  comparables), and a live-token view. Three screenshots under `screenshots/`
  show the board, a protocol's detail view and a filtered view.

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
