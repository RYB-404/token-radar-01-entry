/* Launch Radar — the page. Vanilla, offline, no framework.
 *
 * Loads ../data.js (written by main.ts from the sealed snapshot), re-scores
 * every protocol through dashboard/model.js — the same file main.ts ran to
 * write board.json — and renders three views: the ranked board, a
 * head-to-head table of the top 10, and the set-aside list. Every row opens a
 * detail view with the full score breakdown and its farm plan.
 */
(function () {
  'use strict';

  var M = globalThis.LaunchModel, P = globalThis.LaunchPlans;
  var data = globalThis.RADAR_DATA;
  var field = M.computeField(data.protocols, data.watchlist, data.as_of, data.floor_usd);

  var ranked = field.ranked;
  ranked.forEach(function (r) { r.steps = P.stepsFor(r); });

  /* ---------- tiny svg set ---------- */
  var ICON = {
    bolt: '<svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true"><path d="M13 2 4.5 13.5H11L9.5 22 19 9.5h-6.5L13 2Z" fill="currentColor"/></svg>',
    step: '<svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 7v5l3.5 2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
    warn: '<svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true"><path d="M12 3 22 20H2L12 3Z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M12 10v4m0 3v.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
    chev: '<svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true"><path d="m5 9 7 7 7-7" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>'
  };

  /* ---------- formatting ---------- */
  function usd(n) {
    if (n >= 1e12) return '$' + trim(n / 1e12) + 'T';
    if (n >= 1e9) return '$' + trim(n / 1e9) + 'B';
    if (n >= 1e6) return '$' + trim(n / 1e6) + 'M';
    if (n >= 1e3) return '$' + trim(n / 1e3) + 'K';
    return '$' + Math.round(n);
  }
  function trim(x) { return (x >= 100 ? Math.round(x) : +x.toFixed(2)).toString(); }
  function pct(x, digits) { return (x * 100).toFixed(digits === undefined ? 0 : digits) + '%'; }
  function chg(v) {
    if (v === null || v === undefined) return '<span class="flat">—</span>';
    var s = (v > 0 ? '+' : '') + v.toFixed(1) + '%';
    return '<span class="' + (v > 0 ? 'up' : v < 0 ? 'down' : 'flat') + '">' + s + '</span>';
  }
  function ageTxt(d) {
    if (d === null || d === undefined) return '—';
    if (d < 90) return Math.round(d) + 'd';
    if (d < 730) return Math.round(d / 30.44) + ' mo';
    var y = Math.floor(d / 365.25), m = Math.round((d % 365.25) / 30.44);
    return y + 'y ' + m + 'm';
  }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  var STATUS_PILL = {
    watchlist: '<span class="pill wl">watchlist</span>',
    staking: '<span class="pill staking">staking family</span>'
  };

  /* ---------- header stats + executive card ---------- */
  function renderTop() {
    var s = field.context.scan;
    document.getElementById('topStats').innerHTML =
      '<span class="chip">snapshot <b>' + esc(data.as_of) + '</b></span>' +
      '<span class="chip"><b>' + s.protocols + '</b> scanned</span>' +
      '<span class="chip good"><b>' + s.ranked + '</b> ranked</span>' +
      '<span class="chip good"><b>' + s.watchlist + '</b>/' + s.watchlist + ' watchlist covered</span>';
    document.getElementById('footNote').textContent =
      'Runs fully offline on the sealed snapshot (' + s.protocols + ' protocols, fetched ' + data.as_of +
      '). Board rows, ranks and implied values are this entry\u2019s own model output.';
  }

  function whyLine(r) {
    var bits = [];
    bits.push(usd(r.tvl_usd) + ' TVL');
    bits.push(r.chains.length + (r.chains.length === 1 ? ' chain' : ' chains'));
    bits.push(ageTxt(r.age_days) + ' without a token' + (r.age_imputed ? ' (listed date unreported)' : ''));
    if (r.watchlist) bits.push('on the house watchlist');
    if (r.change_7d !== null) bits.push((r.change_7d > 0 ? '+' : '') + r.change_7d.toFixed(1) + '% in 7 days');
    return bits.join(' \u00b7 ');
  }

  function renderExec() {
    var r = ranked[0];
    var el = document.getElementById('execBody');
    el.innerHTML =
      '<div class="exec-rank">1</div>' +
      '<div class="exec-main">' +
        '<div class="exec-name">' + esc(r.name) + '</div>' +
        '<div class="exec-sub">' + esc(r.category || 'Uncategorized') + ' \u00b7 ' + r.chains.map(esc).join(', ') + '</div>' +
        '<div class="exec-why">' + esc(whyLine(r)) + '.</div>' +
      '</div>' +
      '<div class="exec-nums">' +
        '<div class="exec-stat"><div class="k">Implied value</div><div class="v val">' + usd(r.implied_value_usd) + '</div></div>' +
        '<div class="exec-stat"><div class="k">Launch odds</div><div class="v">' + pct(r.odds) + '</div></div>' +
        '<div class="exec-stat"><div class="k">Score</div><div class="v">' + r.score + '/100</div></div>' +
        '<div class="exec-stat"><div class="k">Farm ticket</div><div class="v">' + usd(r.economics.position_usd) + '</div></div>' +
        '<div class="exec-stat"><div class="k">Time</div><div class="v">' + r.economics.hours_per_week + ' h/wk</div></div>' +
      '</div>';
  }

  /* ---------- filters + sorting ---------- */
  var state = { q: '', cat: '', chain: '', tvl: 0, watch: false, key: 'rank', dir: 1 };
  var KEYS = {
    rank: function (r) { return r.rank; },
    name: function (r) { return r.name.toLowerCase(); },
    tvl: function (r) { return r.tvl_usd; },
    change: function (r) { return r.change_7d === null ? -1e9 : r.change_7d; },
    age: function (r) { return r.age_days; },
    odds: function (r) { return r.odds; },
    iv: function (r) { return r.implied_value_usd; },
    score: function (r) { return r.score; }
  };
  var DEFAULT_DIR = { rank: 1, name: 1, tvl: -1, change: -1, age: -1, odds: -1, iv: -1, score: -1 };

  function filtered() {
    var q = state.q.trim().toLowerCase();
    var out = ranked.filter(function (r) {
      if (state.cat && (r.category || '') !== state.cat) return false;
      if (state.chain && r.chains.indexOf(state.chain) < 0) return false;
      if (r.tvl_usd < state.tvl) return false;
      if (state.watch && !r.watchlist) return false;
      if (q) {
        var hay = (r.name + ' ' + r.slug + ' ' + (r.category || '') + ' ' + r.chains.join(' ')).toLowerCase();
        if (hay.indexOf(q) < 0) return false;
      }
      return true;
    });
    var get = KEYS[state.key] || KEYS.rank;
    out.sort(function (a, b) {
      var va = get(a), vb = get(b);
      return (va < vb ? -1 : va > vb ? 1 : 0) * state.dir || (a.rank - b.rank);
    });
    return out;
  }

  function buildOptions() {
    var cats = {}, chains = {}, i;
    ranked.forEach(function (r) {
      if (r.category) cats[r.category] = 1;
      r.chains.forEach(function (c) { chains[c] = 1; });
    });
    var catSel = document.getElementById('fCat'), chSel = document.getElementById('fChain');
    Object.keys(cats).sort().forEach(function (c) {
      var o = document.createElement('option'); o.value = c; o.textContent = c; catSel.appendChild(o);
    });
    Object.keys(chains).sort().forEach(function (c) {
      var o = document.createElement('option'); o.value = c; o.textContent = c; chSel.appendChild(o);
    });
  }

  /* ---------- board ---------- */
  function scoreColor(score) {
    return score >= 72 ? 'var(--emerald)' : score >= 52 ? 'var(--sky)' : score >= 32 ? 'var(--amber)' : 'var(--slate)';
  }

  function boardRow(r) {
    var tr = document.createElement('tr');
    tr.className = 'row-main' + (r.rank === 1 ? ' rank-1' : r.rank <= 3 ? ' rank-' + r.rank : '');
    tr.innerHTML =
      '<td class="num"><span class="rank-badge">' + r.rank + '</span></td>' +
      '<td class="name-cell"><div class="proto">' +
        '<span class="pn"><button type="button" data-slug="' + esc(r.slug) + '">' + esc(r.name) + '</button></span>' +
        '<span class="meta">' +
          (r.category ? '<span class="pill cat">' + esc(r.category) + '</span>' : '<span class="pill">uncategorized</span>') +
          (STATUS_PILL[r.cls] || '') +
          (r.below_floor ? '<span class="pill floor">below floor</span>' : '') +
          '<span class="chaindots">' + r.chains.length + ' chain' + (r.chains.length === 1 ? '' : 's') + '</span>' +
        '</span>' +
      '</div></td>' +
      '<td class="num">' + usd(r.tvl_usd) + '</td>' +
      '<td class="num">' + chg(r.change_7d) + '</td>' +
      '<td class="num">' + ageTxt(r.age_days) + '</td>' +
      '<td class="num"><span class="minibar"><i style="width:' + Math.round(r.odds * 100) + '%"></i></span>' + pct(r.odds) + '</td>' +
      '<td class="num"><span class="iv">' + usd(r.implied_value_usd) + '</span></td>' +
      '<td class="num"><span class="scorebar"><span class="bar"><i style="width:' + r.score + '%;background:' + scoreColor(r.score) + '"></i></span>' +
        '<span class="band ' + r.band + '">' + r.band + '</span></span></td>' +
      '<td class="num">' + usd(r.economics.position_usd) + '</td>' +
      '<td><button type="button" class="expand-btn" data-slug="' + esc(r.slug) + '">' + ICON.chev + ' plan</button></td>';
    return tr;
  }

  function planRow(r) {
    var tr = document.createElement('tr');
    tr.className = 'plan-row hidden';
    var lis = r.steps.map(function (s) { return '<li>' + ICON.step + '<span>' + esc(s) + '</span></li>'; }).join('');
    tr.innerHTML = '<td colspan="10"><ul class="plan-steps">' + lis + '</ul>' +
      '<p class="table-foot">Ticket ' + usd(r.economics.position_usd) + ' \u00b7 about ' + r.economics.hours_per_week +
      ' hours a week \u00b7 expected farmer value ' + usd(r.economics.user_value_usd) +
      ' at that size \u00b7 ' + esc(r.mult_source) + '</p></td>';
    return tr;
  }

  function renderBoard() {
    var rows = filtered();
    var body = document.getElementById('boardBody');
    body.textContent = '';
    var frag = document.createDocumentFragment();
    rows.forEach(function (r) {
      frag.appendChild(boardRow(r));
      frag.appendChild(planRow(r));
    });
    body.appendChild(frag);
    document.getElementById('countLine').innerHTML =
      'Showing <b>' + rows.length + '</b> of ' + ranked.length + ' ranked protocols' +
      (state.key === 'rank' ? ' \u00b7 rank 1 is the board\u2019s most valuable protocol' : ' \u00b7 sorted by ' + state.key) +
      ' \u00b7 click a name for the full breakdown';
    markSortedHeader();
  }

  function markSortedHeader() {
    var ths = document.querySelectorAll('#boardTable thead th[data-key]');
    ths.forEach(function (th) {
      var on = th.getAttribute('data-key') === state.key;
      th.classList.toggle('sorted', on);
      th.querySelectorAll('.arr').forEach(function (a) { a.remove(); });
      if (on) {
        var s = document.createElement('span');
        s.className = 'arr';
        s.textContent = state.dir > 0 ? '\u25b2' : '\u25bc';
        th.appendChild(s);
      }
    });
  }

  /* ---------- head-to-head ---------- */
  function renderDuel() {
    var top = ranked.slice(0, 10);
    var t = document.getElementById('duelTable');
    var head = '<thead><tr><th></th>' + top.map(function (r) {
      return '<th><span class="head-cell"><span>#' + r.rank + ' ' + esc(r.name) + '</span><small>' +
        esc(r.category || 'Uncategorized') + '</small></span></th>';
    }).join('') + '</tr></thead>';
    var maxOf = function (get) { return Math.max.apply(null, top.map(get)); };
    var rowsSpec = [
      ['Implied value', function (r) { return usd(r.implied_value_usd); }, function (r) { return r.implied_value_usd; }],
      ['Score', function (r) { return r.score + '/100'; }, function (r) { return r.score; }],
      ['Launch odds', function (r) { return pct(r.odds); }, function (r) { return r.odds; }],
      ['TVL', function (r) { return usd(r.tvl_usd); }, function (r) { return r.tvl_usd; }],
      ['7-day change', function (r) { return r.change_7d === null ? '\u2014' : ((r.change_7d > 0 ? '+' : '') + r.change_7d.toFixed(1) + '%'); }, function (r) { return r.change_7d === null ? -1e9 : r.change_7d; }],
      ['No token for', function (r) { return ageTxt(r.age_days); }, function (r) { return r.age_days; }],
      ['Comparable multiple', function (r) { return r.mult.toFixed(2) + '\u00d7'; }, function (r) { return r.mult; }],
      ['Fair value', function (r) { return usd(r.fair_value_usd); }, function (r) { return r.fair_value_usd; }],
      ['Farm ticket', function (r) { return usd(r.economics.position_usd) + ' \u00b7 ' + r.economics.hours_per_week + ' h/wk'; }, function () { return -1; }],
      ['First step', function (r) { return esc(r.steps[0] || ''); }, function () { return 0; }]
    ];
    var body = '<tbody>' + rowsSpec.map(function (spec) {
      var cells = top.map(function (r) {
        var v = spec[2](r);
        var win = v > 0 && v === maxOf(spec[2]);
        return '<td class="num' + (win ? ' win' : '') + '">' + spec[1](r) + '</td>';
      }).join('');
      return '<tr><th>' + spec[0] + '</th>' + cells + '</tr>';
    }).join('');
    t.innerHTML = head + body + '</tbody>';
  }

  /* ---------- set aside ---------- */
  function renderAside() {
    var t = document.getElementById('asideTable');
    var head = '<thead><tr><th>Protocol</th><th>Category</th><th>TVL</th><th>Set aside because</th><th></th></tr></thead><tbody>' +
      field.parked.map(function (p) {
        return '<tr><td><b>' + esc(p.name) + '</b><br><span class="chaindots">' + p.chains.map(esc).join(', ') + '</span></td>' +
          '<td>' + esc(p.category || 'Uncategorized') + '</td>' +
          '<td class="num">' + usd(p.tvl_usd) + '</td>' +
          '<td><span class="reason ' + p.code + '">' + esc(p.reason) + '</span></td>' +
          '<td>' + (p.watchlist ? '<span class="pill wl">watchlist</span>' : '') + '</td></tr>';
      }).join('') + '</tbody>';
    t.innerHTML = head;
  }

  /* ---------- detail modal ---------- */
  function factorRow(label, value, weight) {
    return '<div class="factor"><span>' + esc(label) + (weight ? ' <span class="chaindots">w ' + weight + '</span>' : '') + '</span>' +
      '<span class="bar"><i style="width:' + Math.round(value * 100) + '%"></i></span>' +
      '<span class="pct">' + pct(value) + '</span></div>';
  }

  function openModal(slug) {
    var r = null;
    for (var i = 0; i < ranked.length; i++) if (ranked[i].slug === slug) { r = ranked[i]; break; }
    if (!r) return;
    var e = r.economics;
    var peers = field.live.filter(function (p) { return p.category === r.category && p.mcap_usd > 0; }).slice(0, 5);
    var peerRows = peers.map(function (p) {
      return '<tr><td>' + esc(p.name) + '</td><td class="num">' + usd(p.tvl_usd) + '</td><td class="num">' + usd(p.mcap_usd) + '</td>' +
        '<td class="num">' + (p.mcap_usd / p.tvl_usd).toFixed(2) + '\u00d7</td></tr>';
    }).join('');

    var notes = [];
    if (r.age_imputed) notes.push('No listed date in the snapshot \u2014 tenure uses the field\u2019s median age (' + Math.round(field.context.median_age_days) + ' days).');
    if (r.change_7d === null) notes.push('No 7-day change reported \u2014 momentum is treated as flat.');
    if (r.below_floor) notes.push('Below the house watchlist\u2019s $' + (data.floor_usd / 1e6) + 'M floor \u2014 ranked anyway: the floor is a starting point, not a cutoff.');
    if (r.cls === 'staking') notes.push('Liquid-staking family \u2014 the house rule holds these off its own watchlist, so this row starts from a lower odds base.');
    if (r.cls !== 'watchlist') notes.push('Not on the house watchlist \u2014 an early find below its line, which is what this radar exists to surface.');
    notes.push(r.mult_source.charAt(0).toUpperCase() + r.mult_source.slice(1) + ': ' + r.mult.toFixed(2) + '\u00d7.');

    document.getElementById('modalBody').innerHTML =
      '<div class="m-head">' +
        '<div><div class="m-title">' + esc(r.name) + '</div>' +
        '<div class="m-sub"><span class="rank-badge">' + r.rank + '</span>' +
          (r.category ? '<span class="pill cat">' + esc(r.category) + '</span>' : '') + (STATUS_PILL[r.cls] || '') +
          (r.below_floor ? '<span class="pill floor">below floor</span>' : '') +
          '<span>' + r.chains.map(esc).join(', ') + '</span></div></div>' +
        '<div class="m-iv"><div class="cap">Implied value</div><div class="big">' + usd(r.implied_value_usd) + '</div></div>' +
      '</div>' +
      '<div class="m-grid">' +
        '<div class="m-cell"><div class="k">TVL</div><div class="v">' + usd(r.tvl_usd) + '</div></div>' +
        '<div class="m-cell"><div class="k">7-day change</div><div class="v">' + (r.change_7d === null ? '\u2014' : ((r.change_7d > 0 ? '+' : '') + r.change_7d.toFixed(1) + '%')) + '</div></div>' +
        '<div class="m-cell"><div class="k">Listed</div><div class="v">' + (r.listed_at || 'unreported') + '</div></div>' +
        '<div class="m-cell"><div class="k">No token for</div><div class="v">' + ageTxt(r.age_days) + '</div></div>' +
        '<div class="m-cell"><div class="k">Comparable</div><div class="v">' + r.mult.toFixed(2) + '\u00d7</div></div>' +
        '<div class="m-cell"><div class="k">Launch odds</div><div class="v">' + pct(r.odds) + '</div></div>' +
      '</div>' +
      '<div class="m-sec"><h3>How the number is made</h3>' +
        '<p class="fline">fair = ' + M.money(r.tvl_usd) + ' \u00d7 ' + r.mult.toFixed(2) + ' \u00d7 ' + r.mom_factor.toFixed(2) + ' \u00d7 ' + r.tenure_factor.toFixed(2) +
          ' = <b>' + M.money(r.fair_value_usd) + '</b><br>' +
          'implied = fair \u00d7 odds = ' + M.money(r.fair_value_usd) + ' \u00d7 ' + r.odds.toFixed(2) + ' = <b>' + M.money(r.implied_value_usd) + '</b><br>' +
          'odds = ' + r.odds_base.toFixed(2) + ' base (' + (r.cls === 'watchlist' ? 'watchlist' : r.cls === 'staking' ? 'staking family' : 'pre-token') + ') + 0.42 \u00d7 ' + r.signal.toFixed(2) + ' signal = <b>' + r.odds.toFixed(2) + '</b></p>' +
        factorRow('Size percentile', r.size_pct, '0.30') +
        factorRow('Tenure percentile', r.tenure_pct, '0.25') +
        factorRow('Traction percentile', r.traction_pct, '0.20') +
        factorRow('Category climate', r.climate, '0.25') +
      '</div>' +
      '<div class="m-sec"><h3>Farm plan \u2014 ' + esc(P.playbook(r.category)) + ' playbook</h3>' +
        '<ul class="m-steps">' + r.steps.map(function (s) { return '<li>' + ICON.step + '<span>' + esc(s) + '</span></li>'; }).join('') + '</ul>' +
      '</div>' +
      '<div class="m-sec"><h3>Farming economics</h3><div class="econ-row">' +
        '<div class="econ-chip">Recommended ticket<b>' + M.money(e.position_usd) + '</b></div>' +
        '<div class="econ-chip">Weekly time<b>~' + e.hours_per_week + ' hours</b></div>' +
        '<div class="econ-chip">Expected farmer value<b>' + M.money(e.user_value_usd) + '</b></div>' +
        '<div class="econ-chip">Return on ticket<b>' + e.roi.toFixed(2) + '\u00d7</b></div>' +
        '<div class="econ-chip">Est. share of drop<b>' + (e.share_of_supply_estimate < 0.001
          ? (e.share_of_supply_estimate * 100).toFixed(4)
          : (e.share_of_supply_estimate * 100).toFixed(2)) + '%</b></div>' +
      '</div></div>' +
      '<div class="m-sec"><h3>Tokened peers' + (peers.length ? ' in ' + esc(r.category) : '') + '</h3>' +
        (peers.length
          ? '<table class="peers"><thead><tr><th>Protocol</th><th>TVL</th><th>Market cap</th><th>Mcap / TVL</th></tr></thead><tbody>' + peerRows + '</tbody></table>'
          : '<p class="muted-note">No tokened peer in this category carries a market cap on the snapshot; the global median multiple is used.</p>') +
      '</div>' +
      '<div class="m-sec"><h3>Data notes</h3><div class="notes">' +
        notes.map(function (n) { return '<div class="note">' + ICON.warn + '<span>' + esc(n) + '</span></div>'; }).join('') +
      '</div></div>';
    document.getElementById('modalBack').classList.remove('hidden');
    document.getElementById('modalClose').focus();
  }

  function closeModal() { document.getElementById('modalBack').classList.add('hidden'); }

  /* ---------- views + deep links ---------- */
  // #view=duel|aside picks a tab; #cat=, #chain=, #q=, #tvl=, #watch=1, #sort=
  // and #dir= pre-set the filters; #detail=<slug> opens a protocol's detail
  // view. Every board state is therefore one link a reader can share.
  function setView(name) {
    document.querySelectorAll('.tab').forEach(function (t) { t.classList.toggle('active', t.getAttribute('data-view') === name); });
    document.getElementById('viewBoard').classList.toggle('hidden', name !== 'board');
    document.getElementById('viewDuel').classList.toggle('hidden', name !== 'duel');
    document.getElementById('viewAside').classList.toggle('hidden', name !== 'aside');
  }

  function applyHash() {
    var h = new URLSearchParams((location.hash || '').replace(/^#/, ''));
    if (h.get('q')) { state.q = h.get('q'); document.getElementById('q').value = state.q; }
    if (h.get('cat')) { state.cat = h.get('cat'); document.getElementById('fCat').value = state.cat; }
    if (h.get('chain')) { state.chain = h.get('chain'); document.getElementById('fChain').value = state.chain; }
    if (h.get('tvl') && ['0', '50000000', '100000000', '500000000', '1000000000'].indexOf(h.get('tvl')) >= 0) {
      state.tvl = +h.get('tvl');
      document.getElementById('fTvl').value = h.get('tvl');
    }
    if (h.get('watch') === '1') { state.watch = true; document.getElementById('fWatch').checked = true; }
    if (h.get('sort') && KEYS[h.get('sort')]) {
      state.key = h.get('sort');
      state.dir = h.get('dir') === '1' ? 1 : h.get('dir') === '-1' ? -1 : (DEFAULT_DIR[state.key] || 1);
      document.getElementById('fSort').value = ['rank', 'name', 'tvl', 'change', 'age', 'odds', 'score'].indexOf(state.key) >= 0 ? state.key : 'rank';
    }
    if (h.get('view') === 'duel' || h.get('view') === 'aside') setView(h.get('view'));
    if (h.get('detail')) openModal(h.get('detail'));
    if (String(location.hash || '').length > 1) renderBoard(); // filters from the link need a fresh pass
  }

  /* ---------- events ---------- */
  function bind() {
    document.getElementById('q').addEventListener('input', function (e) {
      state.q = e.target.value; renderBoard();
    });
    document.getElementById('fCat').addEventListener('change', function (e) { state.cat = e.target.value; renderBoard(); });
    document.getElementById('fChain').addEventListener('change', function (e) { state.chain = e.target.value; renderBoard(); });
    document.getElementById('fTvl').addEventListener('change', function (e) { state.tvl = +e.target.value; renderBoard(); });
    document.getElementById('fWatch').addEventListener('change', function (e) { state.watch = e.target.checked; renderBoard(); });
    document.getElementById('fSort').addEventListener('change', function (e) {
      state.key = e.target.value; state.dir = DEFAULT_DIR[state.key] || 1; renderBoard();
    });
    document.getElementById('fReset').addEventListener('click', function () {
      state = { q: '', cat: '', chain: '', tvl: 0, watch: false, key: 'rank', dir: 1 };
      document.getElementById('q').value = '';
      document.getElementById('fCat').value = '';
      document.getElementById('fChain').value = '';
      document.getElementById('fTvl').value = '0';
      document.getElementById('fWatch').checked = false;
      document.getElementById('fSort').value = 'rank';
      renderBoard();
    });
    document.querySelectorAll('#boardTable thead th[data-key]').forEach(function (th) {
      th.addEventListener('click', function () {
        var k = th.getAttribute('data-key');
        if (state.key === k) state.dir = -state.dir;
        else { state.key = k; state.dir = DEFAULT_DIR[k] || 1; }
        document.getElementById('fSort').value = ['rank', 'name', 'tvl', 'change', 'age', 'odds', 'score'].indexOf(state.key) >= 0 ? state.key : 'rank';
        renderBoard();
      });
    });
    document.getElementById('boardBody').addEventListener('click', function (e) {
      var nameBtn = e.target.closest('button[data-slug]');
      if (!nameBtn) return;
      var slug = nameBtn.getAttribute('data-slug');
      if (nameBtn.classList.contains('expand-btn')) {
        var tr = nameBtn.closest('tr');
        var plan = tr.nextElementSibling;
        var open = plan.classList.toggle('hidden');
        tr.classList.toggle('open', !open);
        nameBtn.innerHTML = ICON.chev + (open ? ' plan' : ' close');
      } else {
        openModal(slug);
      }
    });
    document.querySelectorAll('.tab').forEach(function (tab) {
      tab.addEventListener('click', function () { setView(tab.getAttribute('data-view')); });
    });
    document.getElementById('modalClose').addEventListener('click', closeModal);
    document.getElementById('modalBack').addEventListener('click', function (e) {
      if (e.target === this) closeModal();
    });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeModal(); });
  }

  renderTop();
  renderExec();
  buildOptions();
  renderBoard();
  renderDuel();
  renderAside();
  bind();
  applyHash();
})();
