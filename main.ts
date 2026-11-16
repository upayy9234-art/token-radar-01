// Launch Radar (radar-3): read the sealed snapshot, write the ranked board,
// the dashboard's data, and the dossier. Standard library only, no network,
// deterministic: two runs write the same bytes.
//
// Usage: mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json>
import { readFileSync, writeFileSync, mkdirSync, cpSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildRadar, parseSnapshot, boardIssue, dataScript } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const here = dirname(fileURLToPath(import.meta.url));

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(name);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1]! : fallback;
}

function main(): void {
  const input = arg('--input', '/input/snapshot.json');
  const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
  const snapshot = parseSnapshot(readFileSync(input, 'utf8'));
  const { board, radar } = buildRadar(snapshot);

  const issue = boardIssue(board, snapshot);
  if (issue !== null) throw new Error(`board refused: ${issue}`);

  mkdirSync(outDir, { recursive: true });
  mkdirSync(join(outDir, 'dashboard'), { recursive: true });
  mkdirSync(join(outDir, 'screenshots'), { recursive: true });

  writeFileSync(join(outDir, 'board.json'), `${JSON.stringify({ rows: board }, null, 2)}\n`, 'utf8');
  writeFileSync(join(outDir, 'data.js'), dataScript(radar), 'utf8');

  const dashSrc = join(here, 'dashboard');
  const shotSrc = join(here, 'screenshots');
  if (!existsSync(join(dashSrc, 'index.html'))) throw new Error('dashboard/index.html is missing');
  cpSync(dashSrc, join(outDir, 'dashboard'), { recursive: true });
  if (existsSync(shotSrc)) cpSync(shotSrc, join(outDir, 'screenshots'), { recursive: true });

  const dossier = buildDossier(outDir, { text_max_bytes: 65536 });
  writeFileSync(join(outDir, 'dossier.json'), dossier);

  const total = board.reduce((a, r) => a + r.implied_value_usd, 0);
  console.log(
    `radar-3: ${board.length} rows (${radar.watchlist_size} watchlist + ${radar.early_size} early), ` +
      `top ${board[0]!.name} ${board[0]!.implied_value_usd}, total ${total}, ` +
      `fit log10(mcap) = ${radar.fit.intercept} + ${radar.fit.slope} * log10(TVL) on ${radar.fit.n} comps, ` +
      `dossier ${dossier.byteLength} bytes`,
  );
}

main();
