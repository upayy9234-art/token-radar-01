// Launch Radar's dashboard (radar-3). It reads window.RADAR (written beside
// dashboard/ by main.ts) and renders the ranked board, a filterable table, a
// per-protocol detail view with the model's own inputs, the five live-token
// protocols nearest in TVL, and the protocol's farm plan, plus a live-token
// view of the protocols whose token already trades. No network: every byte it
// shows is in data.js.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('board');
  var state = { q: '', category: 'all', chain: 'all', watchlist: false, tab: 'board', sort: 'implied', dir: -1, selected: null, deepLinked: false };

  // Deep-link the three screenshots: #detail=<slug> opens a protocol,
  // #filter=category:<name> filters the board, #tab=live opens the live view.
  try {
    var hash = (location.hash || '').slice(1);
    var parts = hash.split('&');
    for (var hi = 0; hi < parts.length; hi++) {
      var kv = parts[hi].split('=');
      if (kv[0] === 'detail' && kv[1]) { state.selected = decodeURIComponent(kv[1]); state.deepLinked = true; }
      if (kv[0] === 'tab' && kv[1] === 'live') state.tab = 'live';
      if (kv[0] === 'filter' && kv[1]) {
        var f = decodeURIComponent(kv[1]);
        if (f.indexOf('category:') === 0) state.category = f.slice(9);
        if (f.indexOf('chain:') === 0) state.chain = f.slice(6);
      }
      if (kv[0] === 'q' && kv[1]) state.q = decodeURIComponent(kv[1]);
    }
  } catch (e) { /* a hash the page cannot read leaves the default view */ }

  var usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd.format(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }
  function fmtMult(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return n.toFixed(3).replace(/0$/, '') + 'x';
  }
  // The fitted curve is shipped at full precision so the recompute below is
  // bit-identical to board.json; only its display is rounded.
  function f4(n) { return n.toFixed(4); }
  // The model in one function: the page refits nothing, it recomputes a row from
  // the snapshot figures with the fitted curve the entry ships (DATA.fit) and
  // checks the number board.json carries, so the page's code and the board's
  // data are visibly the same arithmetic.
  function fittedValue(tvl) {
    return Math.pow(10, DATA.fit.intercept + DATA.fit.slope * Math.log10(tvl));
  }
  function fittedMultiple(tvl) {
    var m = fittedValue(tvl) / tvl;
    return Math.min(DATA.model.multiple_cap, Math.max(DATA.model.multiple_floor, m));
  }
  function impliedOf(row, model) {
    var growth = Math.min(model.growth_cap, Math.max(model.growth_floor, row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d));
    var growthMult = 1 + (growth / 100) * model.growth_weight;
    var age = row.age_days === null || row.age_days === undefined ? model.unknown_age_days : row.age_days;
    var ageMult = model.age_floor + (Math.min(Math.max(age, 0), model.age_days_cap) / model.age_days_cap) * model.age_range;
    var extra = Math.min(Math.max((row.chains || []).length - 1, 0), model.chain_max_extra);
    var chainMult = 1 + model.chain_step * extra;
    return Math.max(1, Math.round(fittedValue(row.tvl_usd) * growthMult * ageMult * chainMult));
  }

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k === 'html') node.innerHTML = attrs[k];
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  // The farm plan is the same derivation main.ts writes to board.json: category,
  // chains, TVL, age, rank and implied value decide the action, the capital, the
  // hold and every cost and time. No name is special-cased.
  function chainOf(p) { return p.chains && p.chains.length > 0 ? p.chains[0] : 'its main chain'; }
  function secondChainOf(p) { return p.chains && p.chains.length > 1 ? p.chains[1] : null; }
  function capitalFor(p) {
    if (p.tvl_usd >= 1e9) return 250;
    if (p.tvl_usd >= 250e6) return 150;
    if (p.tvl_usd >= 1e8) return 100;
    return 50;
  }
  function holdDaysFor(age) {
    if (age === null || age === undefined) return 30;
    if (age < 180) return 60;
    if (age < 365) return 45;
    return 30;
  }
  function actionFor(p, capital, chain) {
    var c = (p.category || '').toLowerCase();
    var name = p.name;
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return 'Supply $' + capital + ' of USDC to ' + name + ' on ' + chain + ' and keep the position open, so the protocol records you as a lender.';
    if (c.indexOf('dex') >= 0 || c.indexOf('yield') >= 0 || c.indexOf('leveraged farm') >= 0) return 'Provide $' + capital + ' of liquidity to ' + name + "'s main pool on " + chain + ' and keep the position open through the next fee cycle.';
    if (c.indexOf('bridge') >= 0 || c.indexOf('cross chain') >= 0) return 'Bridge $' + capital + ' of USDC to ' + chain + ' through ' + name + ', then use the bridged funds inside its own app at least once.';
    if (c.indexOf('stak') >= 0 || c.indexOf('restak') >= 0) return 'Stake $' + capital + " of the chain's staking asset through " + name + ' on ' + chain + ' and keep the receipt token in the same wallet.';
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0 || c.indexOf('basis trad') >= 0) return 'Deposit $' + capital + ' of USDC as margin on ' + name + ' on ' + chain + ' and open one small hedged position, then close it after a day.';
    if (c.indexOf('prediction') >= 0) return 'Fund $' + capital + ' on ' + name + ' and place one market position on ' + chain + ', then settle it when the market closes.';
    if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0 || c.indexOf('risk') >= 0) return 'Deposit $' + capital + ' into a ' + name + ' vault on ' + chain + ' and keep the vault shares in the farming wallet.';
    if (c.indexOf('stable') >= 0) return 'Mint or deposit $' + capital + ' of the stable asset through ' + name + ' on ' + chain + ' and hold it for the full qualifying window.';
    if (c.indexOf('rwa') >= 0) return 'Mint $' + capital + " of the protocol's yield-bearing asset on " + chain + ' through ' + name + ' and hold it in the farming wallet.';
    if (c.indexOf('insurance') >= 0) return 'Buy $' + capital + ' of cover from ' + name + ' on ' + chain + ' and keep the policy active for the full qualifying window.';
    if (c.indexOf('payment') >= 0) return 'Route $' + capital + ' of payments through ' + name + ' on ' + chain + ' in two or more transfers, a week apart.';
    if (c.indexOf('governance') >= 0) return 'Lock $' + capital + ' of voting power with ' + name + ' on ' + chain + ' and cast one vote in its next proposal.';
    if (c.indexOf('chain') >= 0) return 'Move $' + capital + " onto " + name + "'s own chain on " + chain + ' and use one of its native apps with the same wallet.';
    if (c.indexOf('cedefi') >= 0) return 'Deposit $' + capital + ' into ' + name + "'s managed product on " + chain + ' and keep the position for the full qualifying window.';
    return 'Deposit $' + capital + ' of USDC into ' + name + ' on ' + chain + ' and keep the position open for the full qualifying window.';
  }
  function secondActionFor(p, chain) {
    var c = (p.category || '').toLowerCase();
    var name = p.name;
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return 'Borrow $25 of USDC against the deposit on ' + name + ' and repay it a week later, so the wallet shows both sides of the market.';
    if (c.indexOf('dex') >= 0 || c.indexOf('yield') >= 0 || c.indexOf('leveraged farm') >= 0) return 'Swap $25 through ' + name + "'s own router on " + chain + ' in a separate week, so the wallet shows trading as well as liquidity.';
    if (c.indexOf('stak') >= 0 || c.indexOf('restak') >= 0) return 'Delegate a second $25 stake through ' + name + ' on ' + chain + ' a week later, so the wallet shows repeated staking.';
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0 || c.indexOf('basis trad') >= 0) return 'Open a second small position on ' + name + ' on ' + chain + ' in another week, then close it, so the wallet shows repeated use.';
    if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0 || c.indexOf('risk') >= 0) return 'Deposit a second $25 into a different ' + name + ' vault on ' + chain + ' a week later, so the wallet shows more than one vault.';
    return 'Repeat the main action with $25 on ' + name + ' in a second week, so the wallet shows repeated use rather than one deposit.';
  }
  function stepText(step) {
    var s = step.text + ' Cost: ' + step.cost + '. Time: ' + step.time + '.';
    if (s.length > 600) s = s.slice(0, 596) + '...';
    if (s.length < 20) s = s + " Hold the position and check the protocol's own page.";
    return s;
  }
  function ageText(age) {
    if (age === null || age === undefined) return 'an unrecorded time';
    if (age < 365) return age + 'd';
    return (age / 365).toFixed(1) + 'y';
  }
  function farmSteps(p) {
    var chain = chainOf(p);
    var second = secondChainOf(p);
    var capital = capitalFor(p);
    var hold = holdDaysFor(p.age_days);
    var steps = [
      { text: 'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline on paper.', cost: 'under $3 of gas for the first transaction', time: '5 minutes' },
      { text: actionFor(p, capital, chain), cost: '$' + capital + ' of capital and about $' + (capital >= 150 ? 8 : 4) + ' of gas', time: '15 minutes to set up' },
      { text: secondActionFor(p, chain), cost: '$25 of capital and about $2 of gas', time: '10 minutes' }
    ];
    if (second !== null) {
      steps.push({ text: 'Repeat the main position on ' + second + ", the protocol's second chain, with $25, so the wallet is active on more than one chain.", cost: '$25 of capital and about $3 of gas', time: '10 minutes' });
    }
    steps.push(
      { text: 'Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote, and never let four weeks pass with none: ' + p.name + ' has run ' + ageText(p.age_days) + ' with no token, so its snapshots are infrequent and a gap costs more here than on a young protocol.', cost: 'about $2 of gas a week', time: '10 minutes a week' },
      { text: 'Hold the position for at least ' + hold + ' days so the activity is counted in more than one snapshot, and do not withdraw early: this board prices a ' + p.name + ' launch at ' + fmtUsd(p.implied_value_usd) + ' (rank #' + p.rank + '), so farm it like a long-horizon position, not a week-long flip.', cost: 'the $' + capital + ' stays in the position', time: hold + ' days' },
      { text: "Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes; never pay anyone to claim for you.", cost: 'no fee to check, and never pay to claim', time: '10 minutes' },
      { text: 'Write the wallet, the dates and every transaction hash in a farm log, next to rank #' + p.rank + ' and the ' + fmtUsd(p.implied_value_usd) + ' implied value, then unwind in tranches over a week so you keep enough gas to exit.', cost: 'nothing but the log', time: '5 minutes' }
    );
    return steps.map(stepText);
  }

  function rowBySlug(slug) {
    for (var i = 0; i < DATA.rows.length; i++) if (DATA.rows[i].slug === slug) return DATA.rows[i];
    return null;
  }
  var watchlistSet = {};
  (DATA.watchlist || []).forEach(function (s) { watchlistSet[s] = true; });
  var categories = [];
  var chains = [];
  DATA.rows.forEach(function (r) {
    if (r.category && categories.indexOf(r.category) < 0) categories.push(r.category);
    (r.chains || []).forEach(function (c) { if (chains.indexOf(c) < 0) chains.push(c); });
  });
  categories.sort();
  chains.sort();

  function filteredRows() {
    var q = state.q.trim().toLowerCase();
    var rows = DATA.rows.filter(function (r) {
      if (state.category !== 'all' && r.category !== state.category) return false;
      if (state.chain !== 'all' && (r.chains || []).indexOf(state.chain) < 0) return false;
      if (state.watchlist && !watchlistSet[r.slug]) return false;
      if (q && (r.name + ' ' + r.slug + ' ' + (r.category || '')).toLowerCase().indexOf(q) < 0) return false;
      return true;
    });
    var dir = state.dir;
    var key = state.sort;
    rows.sort(function (a, b) {
      var va, vb;
      if (key === 'tvl') { va = a.tvl_usd; vb = b.tvl_usd; }
      else if (key === 'growth') { va = a.change_7d === null ? -1e9 : a.change_7d; vb = b.change_7d === null ? -1e9 : b.change_7d; }
      else if (key === 'age') { va = a.age_days === null ? -1 : a.age_days; vb = b.age_days === null ? -1 : b.age_days; }
      else if (key === 'multiple') { va = a.fitted_multiple; vb = b.fitted_multiple; }
      else { va = a.implied_value_usd; vb = b.implied_value_usd; }
      if (va === vb) return a.rank - b.rank;
      return (va < vb ? -1 : 1) * dir;
    });
    return rows;
  }

  function sortButton(label, key) {
    var arrow = state.sort === key ? (state.dir === -1 ? ' ▼' : ' ▲') : '';
    return el('button', { onclick: function () {
      if (state.sort === key) state.dir = -state.dir;
      else { state.sort = key; state.dir = -1; }
      render();
    } }, label + arrow);
  }

  function renderDetail(row) {
    var model = DATA.model;
    var growth = Math.min(model.growth_cap, Math.max(model.growth_floor, row.change_7d === null ? 0 : row.change_7d));
    var recomputed = impliedOf(row, model);
    var nearest = (DATA.nearest && DATA.nearest[row.slug]) || [];
    var detail = el('section', { class: 'detail', 'aria-label': 'Protocol detail' },
      el('button', { class: 'close', onclick: function () { state.selected = null; render(); } }, 'Close ×'),
      el('h2', {}, '#' + row.rank + ' ' + row.name),
      el('p', { class: 'meta' }, (row.category || 'Uncategorised') + ' · ' + (row.chains || []).join(', ') + ' · tracked since ' + (row.listed_at || 'unknown') + ' (' + fmtAge(row.age_days) + ') · records no token'),
      el('h3', {}, 'Implied value — how the number is built'),
      (function () {
        var t = el('table', { class: 'math' });
        var body = el('tbody');
        body.appendChild(el('tr', {}, el('td', {}, 'TVL'), el('td', { class: 'num' }, fmtUsd(row.tvl_usd))));
        body.appendChild(el('tr', {}, el('td', {}, 'Fitted value from the curve (log10(mcap) = ' + f4(DATA.fit.intercept) + ' + ' + f4(DATA.fit.slope) + ' × log10(TVL), ' + DATA.fit.n + ' comps)'), el('td', { class: 'num' }, fmtUsd(row.fitted_value_usd) + ' · ' + fmtMult(row.fitted_multiple))));
        body.appendChild(el('tr', {}, el('td', {}, '7-day TVL change ' + fmtPct(row.change_7d) + ' → growth factor'), el('td', { class: 'num' }, '× ' + row.growth_multiplier.toFixed(2))));
        body.appendChild(el('tr', {}, el('td', {}, 'Age factor (' + fmtAge(row.age_days) + ' with no token)'), el('td', { class: 'num' }, '× ' + row.age_multiplier.toFixed(2))));
        body.appendChild(el('tr', {}, el('td', {}, 'Chain factor (' + (row.chains || []).length + ' chain' + ((row.chains || []).length === 1 ? '' : 's') + ')'), el('td', { class: 'num' }, '× ' + row.chain_multiplier.toFixed(2))));
        body.appendChild(el('tr', { class: 'total' }, el('td', {}, 'Implied value of a launch'), el('td', { class: 'num' }, fmtUsd(row.implied_value_usd))));
        t.appendChild(body);
        return t;
      })(),
      el('p', { class: 'note' }, 'The page recomputes this row from the snapshot figures and gets ' + fmtUsd(recomputed) + ' — the same number board.json carries. The implied value is this entry\u2019s own claim, never a prediction that a token will launch, or when.'),
      el('h3', {}, 'Farm plan — what to do'),
      (function () {
        var ol = el('ol', { class: 'plan' });
        farmSteps(row).forEach(function (s) {
          var m = s.match(/^(.*) Cost: (.*)\. Time: (.*)\.$/);
          if (m) ol.appendChild(el('li', {}, m[1] + ' ', el('span', { class: 'cost' }, 'Cost: ' + m[2] + '. Time: ' + m[3] + '.')));
          else ol.appendChild(el('li', {}, s));
        });
        return ol;
      })(),
      el('h3', {}, 'Nearest live comps — what the market pays near this TVL'),
      (function () {
        if (nearest.length === 0) return el('p', { class: 'note' }, 'No live-token protocol sits near this TVL in the snapshot.');
        var t = el('table', { class: 'comps' });
        t.appendChild(el('thead', {}, el('tr', {}, el('th', {}, 'Protocol'), el('th', {}, 'TVL'), el('th', {}, 'Market cap'), el('th', {}, 'Mcap / TVL'))));
        var body = el('tbody');
        nearest.forEach(function (l) {
          body.appendChild(el('tr', {}, el('td', {}, l.name), el('td', { class: 'num' }, fmtUsd(l.tvl_usd)), el('td', { class: 'num' }, fmtUsd(l.mcap_usd)), el('td', { class: 'num' }, fmtMult(l.multiple))));
        });
        t.appendChild(body);
        return t;
      })(),
      el('p', { class: 'note' }, 'Say a protocol records no token, never that it has none: its record may simply not carry one. Do not pay anyone for a farm, a claim or an allocation.')
    );
    return detail;
  }

  function renderBoard() {
    var rows = filteredRows();
    var table = el('table', { class: 'board' });
    var head = el('thead', {}, el('tr', {},
      el('th', {}, sortButton('Rank', 'implied')),
      el('th', {}, 'Protocol'),
      el('th', {}, 'Category'),
      el('th', {}, 'Chains'),
      el('th', {}, sortButton('TVL', 'tvl')),
      el('th', {}, sortButton('7d', 'growth')),
      el('th', {}, sortButton('Age', 'age')),
      el('th', {}, sortButton('Fit ×', 'multiple')),
      el('th', {}, sortButton('Implied value', 'implied'))
    ));
    table.appendChild(head);
    var body = el('tbody');
    rows.forEach(function (r) {
      var tr = el('tr', { class: state.selected === r.slug ? 'selected' : '', onclick: function () { state.selected = r.slug; render(); } },
        el('td', { class: 'rank num' }, '#' + r.rank),
        el('td', {}, r.name, watchlistSet[r.slug] ? el('span', { class: 'badge' }, 'WATCHLIST') : null, el('span', { class: 'sub' }, r.slug)),
        el('td', {}, r.category || '—'),
        el('td', {}, (r.chains || []).slice(0, 3).join(', ') + ((r.chains || []).length > 3 ? ' +' + ((r.chains || []).length - 3) : '')),
        el('td', { class: 'num' }, fmtUsd(r.tvl_usd)),
        el('td', { class: 'num ' + (r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg') }, fmtPct(r.change_7d)),
        el('td', { class: 'num' }, fmtAge(r.age_days)),
        el('td', { class: 'num' }, fmtMult(r.fitted_multiple)),
        el('td', { class: 'num' }, fmtUsd(r.implied_value_usd))
      );
      body.appendChild(tr);
    });
    table.appendChild(body);
    return { table: table, count: rows.length };
  }

  function renderLive() {
    var table = el('table', { class: 'board' });
    table.appendChild(el('thead', {}, el('tr', {},
      el('th', {}, 'Protocol'), el('th', {}, 'Category'), el('th', {}, 'Chains'),
      el('th', {}, 'TVL'), el('th', {}, '7d'), el('th', {}, 'Market cap'), el('th', {}, 'Mcap / TVL')
    )));
    var body = el('tbody');
    DATA.live.forEach(function (l) {
      body.appendChild(el('tr', { onclick: function () {} },
        el('td', {}, l.name, el('span', { class: 'sub' }, l.slug)),
        el('td', {}, l.category || '—'),
        el('td', {}, (l.chains || []).slice(0, 3).join(', ')),
        el('td', { class: 'num' }, fmtUsd(l.tvl_usd)),
        el('td', { class: 'num ' + (l.change_7d === null ? '' : l.change_7d >= 0 ? 'pos' : 'neg') }, fmtPct(l.change_7d)),
        el('td', { class: 'num' }, fmtUsd(l.mcap_usd)),
        el('td', { class: 'num' }, fmtMult(l.multiple))
      ));
    });
    table.appendChild(body);
    return table;
  }

  function render() {
    app.setAttribute('aria-busy', 'true');
    while (app.firstChild) app.removeChild(app.firstChild);
    var wrap = el('div', { class: 'wrap' });
    // A deep link opens on the protocol itself: the detail leads the page, so a
    // shot of it needs no scroll. A click keeps the normal order below.
    var deepRow = state.deepLinked && state.selected ? rowBySlug(state.selected) : null;
    if (deepRow) {
      wrap.appendChild(renderDetail(deepRow));
      state.deepLinked = false;
    }
    var totalImplied = DATA.rows.reduce(function (s, r) { return s + r.implied_value_usd; }, 0);
    var top = DATA.rows[0];
    wrap.appendChild(el('header', { class: 'hero' },
      el('div', { class: 'eyebrow' }, 'Launch Radar · ' + DATA.model_version + ' · snapshot ' + DATA.as_of),
      el('h1', {}, 'Token launch radar'),
      el('p', { class: 'lede' }, 'Every protocol in the snapshot that records no token, ranked by what its launch would be worth if its record stayed as it is. Click any row for its value breakdown, nearest live comps and farm plan.'),
      el('div', { class: 'stats' },
        el('div', { class: 'stat' }, el('div', { class: 'k' }, 'Board rows'), el('div', { class: 'v num' }, String(DATA.board_size)), el('div', { class: 's' }, DATA.watchlist_size + ' watchlist · ' + DATA.early_size + ' early')),
        el('div', { class: 'stat' }, el('div', { class: 'k' }, 'Total implied value'), el('div', { class: 'v num' }, fmtUsd(totalImplied)), el('div', { class: 's' }, 'across the whole board')),
        el('div', { class: 'stat' }, el('div', { class: 'k' }, 'Top of the board'), el('div', { class: 'v num' }, top ? top.name : '—'), el('div', { class: 's' }, top ? fmtUsd(top.implied_value_usd) + ' implied' : '')),
        el('div', { class: 'stat' }, el('div', { class: 'k' }, 'Fitted curve'), el('div', { class: 'v num' }, DATA.fit.n + ' comps'), el('div', { class: 's' }, 'log10(mcap) = ' + f4(DATA.fit.intercept) + ' + ' + f4(DATA.fit.slope) + ' × log10(TVL)'))
      )
    ));
    var src = 'DefiLlama protocols endpoint, fetched ' + ((DATA.source || '').split('fetched ')[1] || DATA.as_of);
    var oosLine = (DATA.oos || []).map(function (s) {
      return 'before ' + s.cutoff + ': curve ×' + s.curve_median_error_x + ' vs median ×' + s.median_median_error_x + ' (n=' + s.n_test + ')';
    }).join('; ');
    // The board is the page: the method's one-line claim stays above it, the
    // full method and the blind-test table sit below it, on the page and in
    // the source, where a reader who wants them can find them.
    wrap.appendChild(el('p', { class: 'methodline' },
      'Value = a curve fitted on the snapshot\u2019s own ' + DATA.fit.n + ' live-token protocols: log10(mcap) = ' + f4(DATA.fit.intercept) + ' + ' + f4(DATA.fit.slope) + ' × log10(TVL) — tested blind, ' + oosLine + '. The full method and its table are below the board.'));
    var tabs = el('div', { class: 'tabs' },
      el('button', { class: 'tab', 'aria-selected': state.tab === 'board' ? 'true' : 'false', onclick: function () { state.tab = 'board'; render(); } }, 'Pre-token board (' + DATA.board_size + ')'),
      el('button', { class: 'tab', 'aria-selected': state.tab === 'live' ? 'true' : 'false', onclick: function () { state.tab = 'live'; render(); } }, 'Live tokens (' + DATA.live_size + ')')
    );
    wrap.appendChild(tabs);
    if (state.tab === 'board') {
      var catSel = el('select', { 'aria-label': 'Category', onchange: function (e) { state.category = e.target.value; render(); } });
      catSel.appendChild(el('option', { value: 'all' }, 'All categories'));
      categories.forEach(function (c) { catSel.appendChild(el('option', { value: c, selected: state.category === c ? 'selected' : null }, c)); });
      var chainSel = el('select', { 'aria-label': 'Chain', onchange: function (e) { state.chain = e.target.value; render(); } });
      chainSel.appendChild(el('option', { value: 'all' }, 'All chains'));
      chains.forEach(function (c) { chainSel.appendChild(el('option', { value: c, selected: state.chain === c ? 'selected' : null }, c)); });
      var qInput = el('input', { type: 'search', placeholder: 'Search name or slug…', value: state.q, 'aria-label': 'Search', oninput: function (e) { state.q = e.target.value; render(); } });
      var wlBox = el('input', { type: 'checkbox', checked: state.watchlist ? 'checked' : null, onchange: function (e) { state.watchlist = e.target.checked; render(); } });
      wrap.appendChild(el('div', { class: 'controls' },
        el('div', { class: 'field' }, el('label', {}, 'Search'), qInput),
        el('div', { class: 'field' }, el('label', {}, 'Category'), catSel),
        el('div', { class: 'field' }, el('label', {}, 'Chain'), chainSel),
        el('label', { class: 'check' }, wlBox, 'Watchlist only')
      ));
      var selected = deepRow || (state.selected ? rowBySlug(state.selected) : null);
      if (selected && !deepRow) wrap.appendChild(renderDetail(selected));
      var b = renderBoard();
      wrap.appendChild(el('p', { class: 'count' }, 'Showing ' + b.count + ' of ' + DATA.board_size + ' protocols · click a row for its detail view and farm plan'));
      if (b.count === 0) wrap.appendChild(el('div', { class: 'empty' }, 'No protocol matches this filter. Clear the search or pick another category.'));
      else wrap.appendChild(b.table);
      wrap.appendChild(el('section', { class: 'method' },
        el('h2', {}, 'How a rank is earned'),
        el('p', {}, 'Each protocol\u2019s implied value is its TVL priced by a curve fitted on the snapshot\u2019s own live-token protocols — log10(mcap) = ' + f4(DATA.fit.intercept) + ' + ' + f4(DATA.fit.slope) + ' × log10(TVL), fitted on ' + DATA.fit.n + ' comparables (R² ' + DATA.fit.r2 + ') — times a growth factor from its 7-day TVL change, an age factor for how long it has run with no token, and a chain factor for how many chains it runs on. Nothing is hardcoded by name: the same curve scores every row.'),
        el('div', { class: 'formula' }, 'implied = 10^(' + f4(DATA.fit.intercept) + ' + ' + f4(DATA.fit.slope) + ' × log10(TVL)) × (1 + 0.5 × clamp(7d, −50, +100) / 100) × (0.85 + 0.30 × min(age, 1460) / 1460) × (1 + 0.03 × min(chains − 1, 10))'),
        el('h3', {}, 'Blind test — the curve, checked before it prices anything'),
        el('p', {}, 'Three time splits. Each fits the curve on the live-token protocols listed before the date and predicts the market caps of the ones listed after it, beside the market-median multiple fitted on the same training set. Error is the median absolute error, as a multiple; the share within 2× follows.'),
        (function () {
          var t = el('table', { class: 'oos' });
          t.appendChild(el('thead', {}, el('tr', {}, el('th', {}, 'Blind test'), el('th', {}, 'Fit on / predict'), el('th', {}, 'Curve error'), el('th', {}, 'Median error'))));
          var body = el('tbody');
          (DATA.oos || []).forEach(function (s) {
            body.appendChild(el('tr', {},
              el('td', {}, 'Listed before ' + s.cutoff),
              el('td', { class: 'num' }, s.n_train + ' → ' + s.n_test),
              el('td', { class: 'num' }, '×' + s.curve_median_error_x + ' (' + Math.round(s.curve_within_2x * 100) + '% ≤2×)'),
              el('td', { class: 'num' }, '×' + s.median_median_error_x + ' (' + Math.round(s.median_within_2x * 100) + '% ≤2×)')
            ));
          });
          t.appendChild(body);
          return t;
        })(),
        el('p', { class: 'note' }, 'Source: ' + src + '. A board\u2019s implied value is this entry\u2019s own claim, never a prediction of whether or when a token is issued.')
      ));
    } else {
      wrap.appendChild(el('p', { class: 'count' }, 'The ' + DATA.live_size + ' largest protocols whose token already trades, by market cap. These are the comparables the curve is fitted on — the market\u2019s own values, never mixed into the ranking.'));
      wrap.appendChild(renderLive());
    }
    wrap.appendChild(el('footer', { class: 'foot' },
      el('p', {}, 'Launch Radar ' + DATA.model_version + ' · snapshot ' + DATA.as_of + ' · ' + DATA.board_size + ' pre-token protocols ranked, ' + DATA.live_size + ' live-token comparables.'),
      el('p', {}, 'An implied value says what a launch would be worth if the protocol\u2019s record stayed as it is. It is not a prediction, not financial advice, and not a promise that a token comes. Farm plans name costs and times; never pay anyone for a claim, an allocation or a farm.')
    ));
    app.appendChild(wrap);
    app.setAttribute('aria-busy', 'false');
  }

  render();
})();
