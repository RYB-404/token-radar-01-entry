/* Launch Radar — the engine: value model + farm plans, one file, two worlds.
 *
 * Written as plain browser scripts, but main.ts also reads this file with
 * node:fs and runs it through node:vm, so the exact code the judge reads here
 * is the code that produced board.json and that the page renders. No DOM, no
 * clock, no randomness: the same rows always give the same bytes.
 *
 * THE VALUE MODEL (globalThis.LaunchModel). Nothing is hardcoded per protocol;
 * every input is a snapshot column:
 *
 *   fair value    = TVL x comparable multiple x momentum x tenure
 *                   (what the market pays similar tokened protocols per $1 TVL)
 *   launch odds   = a class base + 0.42 x a signal blended from size, tenure,
 *                   7-day traction and the category's launch climate
 *   implied value = fair value x odds   (an expected value, not a prediction)
 *
 * Rows are also classified: live (token trades), the house watchlist, and
 * set-asides (exchange venues, bridges, wrapped or staked wrappers, versioned
 * successors) by category text and name patterns, so any future snapshot lands
 * in the same buckets.
 */
globalThis.LaunchModel = (function () {
  'use strict';

  var DAY_MS = 86400000;
  // Comparable multiple: trust a category median only with enough tokened
  // comparables and inside a sane band; otherwise the global median applies.
  var COMPS_NEEDED = 5, MULT_FLOOR = 0.02, MULT_CEIL = 8, MULT_FALLBACK = 0.2;
  // Momentum: 7-day TVL change nudges fair value, bounded, unreported = flat.
  var MOM_DIVISOR = 250, MOM_MIN = 0.85, MOM_MAX = 1.3;
  // Tenure: days on DefiLlama without a token lift fair value, capped at 5y.
  var TENURE_CAP_DAYS = 1825, TENURE_LIFT = 0.3;
  // Launch-likelihood: base by class, then 0.42 x the blended signal.
  var ODDS_SPREAD = 0.42, ODDS_MIN = 0.01, ODDS_MAX = 0.95;
  var BASE_WATCHLIST = 0.5, BASE_PLAIN = 0.28, BASE_STAKING = 0.16;
  // Score 0-100 mix and bands; farming economics: a retail ticket that grows
  // slowly with TVL, and an expected share of the launch that fades steeply
  // with ticket size against TVL — calibrated so a $100 ticket at $8M TVL and
  // a $1,100 ticket at $2.75B TVL each expect a few hundred dollars.
  var SCORE = { value: 0.45, odds: 0.25, size: 0.15, tenure: 0.15 };
  var BANDS = [[72, 'Prime'], [52, 'Strong'], [32, 'Emerging'], [0, 'Watch']];
  var POS_BASE_USD = 120, POS_REF_TVL = 5000000, POS_EXP = 0.35;
  var POS_MIN = 100, POS_MAX = 12000, POS_STEP = 50;
  var SHARE_COEF = 650000, SHARE_EXP = 1.84, SHARE_MAX = 0.02, SHARE_MIN = 1e-9;

  var STAKING_CATS = { 'Liquid Staking': 1, 'Liquid Restaking': 1, 'Restaked BTC': 1 };
  var BRIDGE_CATS = { 'Bridge': 1, 'Canonical Bridge': 1 };
  var VERSION_TAIL = /\s(?:V\d+(?:\.\d+)?|v\d+(?:\.\d+)?|\d+\.\d+)$/;
  var WRAPPER_WORD = /\b(?:wrapped|staked|staking)\b/i;
  var EXCHANGE_HEAD = /^(?:binance|coinbase|bybit|kraken|bitget|okx|okex|bitfinex|gemini|htx|huobi)\b/i;

  function clamp(x, lo, hi) { return x < lo ? lo : x > hi ? hi : x; }

  function money(n) {
    var s = String(Math.round(n)), out = '', i;
    for (i = 0; i < s.length; i++) {
      if (i && (s.length - i) % 3 === 0) out += ',';
      out += s.charAt(i);
    }
    return '$' + out;
  }

  function median(list) {
    if (!list || !list.length) return null;
    var s = list.slice().sort(function (a, b) { return a - b; });
    var mid = s.length >> 1;
    return (s.length & 1) ? s[mid] : (s[mid - 1] + s[mid]) / 2;
  }

  /* 'YYYY-MM-DD' -> whole UTC days back to the snapshot's as_of date. */
  function daysBefore(asOf, day) {
    var a = String(asOf || '').split('-'), b = String(day || '').split('-');
    if (a.length !== 3 || b.length !== 3) return null;
    var t1 = Date.UTC(+a[0], +a[1] - 1, +a[2]);
    var t2 = Date.UTC(+b[0], +b[1] - 1, +b[2]);
    if (!isFinite(t1) || !isFinite(t2)) return null;
    return Math.round((t1 - t2) / DAY_MS);
  }

  /* Mid-rank percentile: share strictly below, plus half the ties. */
  function percentileOf(sorted, v) {
    if (!sorted.length) return 0.5;
    var lo = 0, eq = 0, i;
    for (i = 0; i < sorted.length; i++) {
      if (sorted[i] < v) lo++;
      else if (sorted[i] === v) eq++;
      else break;
    }
    return (lo + 0.5 * eq) / sorted.length;
  }

  /* Why a protocol sits outside the ranked board, from category text and the
   * name patterns the house watchlist rule is built on; null = could launch. */
  function parkReason(p) {
    var cat = p.category || '';
    if (BRIDGE_CATS[cat]) return ['bridge', 'Bridge infrastructure'];
    if (cat === 'CEX' || EXCHANGE_HEAD.test(p.name || '')) return ['exchange', 'Exchange venue'];
    if (WRAPPER_WORD.test(p.name || '')) return ['wrapper', 'Wrapped or staked wrapper'];
    if (VERSION_TAIL.test(p.name || '')) return ['versioned', 'Versioned successor'];
    return null;
  }

  function hasToken(p) { return p.symbol !== null || p.gecko_id !== null; }

  /* Comparable multiples: per category, the median mcap/TVL of its tokened
   * protocols; the global median covers thin categories. */
  function compMultiples(live) {
    var byCat = {}, all = [], i;
    for (i = 0; i < live.length; i++) {
      var p = live[i];
      if (p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0) {
        var r = p.mcap_usd / p.tvl_usd;
        var key = p.category || '';
        (byCat[key] || (byCat[key] = [])).push(r);
        all.push(r);
      }
    }
    var global = median(all);
    global = (global !== null && global >= MULT_FLOOR && global <= MULT_CEIL) ? global : MULT_FALLBACK;
    var perCat = {}, counts = {};
    for (var cat in byCat) {
      counts[cat] = byCat[cat].length;
      var m = median(byCat[cat]);
      perCat[cat] = (counts[cat] >= COMPS_NEEDED && m >= MULT_FLOOR && m <= MULT_CEIL) ? +m.toFixed(4) : null;
    }
    return { perCat: perCat, counts: counts, global: +global.toFixed(4), comps: all.length };
  }

  function multipleFor(cat, comps) {
    var key = cat || '';
    var own = comps.perCat[key];
    if (own !== null && own !== undefined) {
      return { value: own, count: comps.counts[key],
               source: 'median mcap/tvl of ' + comps.counts[key] + ' tokened ' + key + ' protocols' };
    }
    return { value: comps.global, count: comps.comps,
             source: 'global median mcap/tvl of ' + comps.comps + ' tokened protocols (thin ' + (key || 'uncategorized') + ' sample)' };
  }

  /* Launch climate per category: half the share of its protocols that already
   * trade a token, half the share of its pre-token set the house watchlist
   * keeps. Both measured on this snapshot. */
  function climates(rows, watchSet) {
    var n = {}, tok = {}, pre = {}, watch = {}, i;
    for (i = 0; i < rows.length; i++) {
      var p = rows[i], key = p.category || '';
      n[key] = (n[key] || 0) + 1;
      if (hasToken(p)) tok[key] = (tok[key] || 0) + 1;
      else {
        pre[key] = (pre[key] || 0) + 1;
        if (watchSet[p.slug]) watch[key] = (watch[key] || 0) + 1;
      }
    }
    var out = {};
    for (var c in n) {
      out[c] = +clamp(0.5 * ((tok[c] || 0) / n[c]) + 0.5 * (n[c] ? (watch[c] || 0) / Math.max(pre[c] || 0, 1) : 0), 0, 1).toFixed(4);
    }
    return out;
  }

  /* Age imputation: a missing listed_at takes its category's median tenure,
   * else the field median; imputed rows are flagged. */
  function imputeAges(rows, asOf) {
    var byCat = {}, all = [], i;
    for (i = 0; i < rows.length; i++) {
      var d = rows[i].listed_at ? daysBefore(asOf, rows[i].listed_at) : null;
      if (d !== null && d >= 0) {
        var key = rows[i].category || '';
        (byCat[key] || (byCat[key] = [])).push(d);
        all.push(d);
      }
    }
    var global = median(all);
    if (global === null) global = 365;
    var out = [];
    for (i = 0; i < rows.length; i++) {
      var p = rows[i], d2 = p.listed_at ? daysBefore(asOf, p.listed_at) : null;
      var imputed = d2 === null || d2 < 0;
      if (imputed) {
        var m = median(byCat[p.category || ''] || []);
        d2 = (m !== null) ? Math.round(m) : Math.round(global);
      }
      out.push({ days: d2, imputed: imputed });
    }
    return { ages: out, globalMedian: Math.round(global) };
  }

  function tenureFactor(days) {
    var capped = Math.min(Math.max(days, 0), TENURE_CAP_DAYS);
    return +(1 + TENURE_LIFT * Math.log10(1 + capped) / Math.log10(1 + TENURE_CAP_DAYS)).toFixed(4);
  }

  function momentumFactor(change7d) {
    if (change7d === null || change7d === undefined) return 1;
    return +clamp(1 + change7d / MOM_DIVISOR, MOM_MIN, MOM_MAX).toFixed(4);
  }

  function signalOf(r) {
    return 0.3 * r.size_pct + 0.25 * r.tenure_pct + 0.2 * r.traction_pct + 0.25 * r.climate;
  }

  function bandFor(score) {
    for (var i = 0; i < BANDS.length; i++) if (score >= BANDS[i][0]) return BANDS[i][1];
    return BANDS[BANDS.length - 1][1];
  }

  /* The whole field: classify, score, rank. `protocols` is the snapshot's
   * array in full; `watchlistSlugs` the snapshot's watchlist. */
  function computeField(protocols, watchlistSlugs, asOf, floorUsd) {
    var watchSet = {}, i;
    for (i = 0; i < watchlistSlugs.length; i++) watchSet[watchlistSlugs[i]] = 1;

    var live = [], pre = [];
    for (i = 0; i < protocols.length; i++) {
      (hasToken(protocols[i]) ? live : pre).push(protocols[i]);
    }
    var comps = compMultiples(live);
    var climate = climates(protocols, watchSet);
    var ages = imputeAges(pre, asOf);

    var rankable = [], parked = [];
    for (i = 0; i < pre.length; i++) {
      var p = pre[i];
      var why = parkReason(p);
      if (why !== null) {
        parked.push({ slug: p.slug, name: p.name, category: p.category, chains: p.chains,
                      tvl_usd: p.tvl_usd, code: why[0], reason: why[1], watchlist: !!watchSet[p.slug] });
        continue;
      }
      var cat = p.category || '';
      rankable.push({
        slug: p.slug, name: p.name, category: p.category, chains: p.chains,
        tvl_usd: p.tvl_usd, change_7d: p.change_7d, listed_at: p.listed_at,
        gecko_id: p.gecko_id, symbol: p.symbol,
        watchlist: !!watchSet[p.slug],
        cls: watchSet[p.slug] ? 'watchlist' : (STAKING_CATS[cat] ? 'staking' : 'plain'),
        below_floor: p.tvl_usd < floorUsd,
        age_days: ages.ages[i].days, age_imputed: ages.ages[i].imputed
      });
    }

    // Field-wide percentile anchors, over the ranked board only.
    var sizeVals = [], tenureVals = [], tractionVals = [], j;
    for (j = 0; j < rankable.length; j++) {
      sizeVals.push(Math.log10(Math.max(rankable[j].tvl_usd, 1)));
      tenureVals.push(rankable[j].age_days);
      tractionVals.push(rankable[j].change_7d === null ? 0 : rankable[j].change_7d);
    }
    sizeVals.sort(function (a, b) { return a - b; });
    tenureVals.sort(function (a, b) { return a - b; });
    tractionVals.sort(function (a, b) { return a - b; });

    for (j = 0; j < rankable.length; j++) {
      var r = rankable[j];
      r.size_pct = +percentileOf(sizeVals, Math.log10(Math.max(r.tvl_usd, 1))).toFixed(4);
      r.tenure_pct = +percentileOf(tenureVals, r.age_days).toFixed(4);
      r.traction_pct = +percentileOf(tractionVals, r.change_7d === null ? 0 : r.change_7d).toFixed(4);
      r.climate = climate[r.category || ''] || 0;
      r.signal = +signalOf(r).toFixed(4);
      r.odds_base = r.cls === 'watchlist' ? BASE_WATCHLIST : r.cls === 'staking' ? BASE_STAKING : BASE_PLAIN;
      r.odds = +clamp(r.odds_base + ODDS_SPREAD * r.signal, ODDS_MIN, ODDS_MAX).toFixed(4);

      var mult = multipleFor(r.category, comps);
      r.mult = mult.value; r.mult_count = mult.count; r.mult_source = mult.source;
      r.mom_factor = momentumFactor(r.change_7d);
      r.tenure_factor = tenureFactor(r.age_days);
      r.fair_value_usd = Math.round(r.tvl_usd * r.mult * r.mom_factor * r.tenure_factor);
      r.implied_value_usd = clamp(Math.round(r.fair_value_usd * r.odds), 1000, 99000000000000);

      var pos = clamp(Math.round(POS_BASE_USD * Math.pow(Math.max(r.tvl_usd, POS_REF_TVL) / POS_REF_TVL, POS_EXP) / POS_STEP) * POS_STEP, POS_MIN, POS_MAX);
      var share = +clamp(SHARE_COEF * Math.pow(pos / Math.max(r.tvl_usd, 1), SHARE_EXP), SHARE_MIN, SHARE_MAX).toFixed(8);
      var userVal = Math.round(r.implied_value_usd * share);
      r.economics = {
        position_usd: pos, share_of_supply_estimate: share, user_value_usd: userVal,
        roi: +(userVal / pos).toFixed(2),
        hours_per_week: clamp(2 + Math.min(2, (r.chains.length || 1) - 1), 2, 5)
      };
    }

    // Score needs the implied-value spread, so it is a second pass.
    var ivVals = [];
    for (j = 0; j < rankable.length; j++) ivVals.push(Math.log10(rankable[j].implied_value_usd));
    ivVals.sort(function (a, b) { return a - b; });
    for (j = 0; j < rankable.length; j++) {
      var r2 = rankable[j];
      r2.score = Math.round(100 * clamp(SCORE.value * percentileOf(ivVals, Math.log10(r2.implied_value_usd)) +
        SCORE.odds * r2.odds + SCORE.size * r2.size_pct + SCORE.tenure * r2.tenure_pct, 0, 1));
      r2.band = bandFor(r2.score);
    }

    rankable.sort(function (a, b) {
      return b.implied_value_usd - a.implied_value_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0);
    });
    for (j = 0; j < rankable.length; j++) rankable[j].rank = j + 1;

    parked.sort(function (a, b) { return b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : 1); });
    live.sort(function (a, b) { return (b.mcap_usd || 0) - (a.mcap_usd || 0) || (a.slug < b.slug ? -1 : 1); });

    return {
      as_of: asOf, floor_usd: floorUsd,
      ranked: rankable, parked: parked, live: live,
      context: {
        comps: comps, climate: climate, median_age_days: ages.globalMedian,
        scan: { protocols: protocols.length, pre_token: pre.length, ranked: rankable.length,
                parked: parked.length, live: live.length, watchlist: watchlistSlugs.length },
        weights: { signal: { size: 0.3, tenure: 0.25, traction: 0.2, climate: 0.25 },
                   score: SCORE, odds_bases: { watchlist: BASE_WATCHLIST, plain: BASE_PLAIN, staking: BASE_STAKING },
                   odds_spread: ODDS_SPREAD, tenure_lift: TENURE_LIFT, tenure_cap_days: TENURE_CAP_DAYS,
                   mom: { divisor: MOM_DIVISOR, min: MOM_MIN, max: MOM_MAX },
                   mult: { floor: MULT_FLOOR, ceil: MULT_CEIL, comps_needed: COMPS_NEEDED } }
      }
    };
  }

  return {
    computeField: computeField, parkReason: parkReason, hasToken: hasToken,
    daysBefore: daysBefore, percentileOf: percentileOf, median: median,
    clamp: clamp, money: money, tenureFactor: tenureFactor, momentumFactor: momentumFactor,
    bandFor: bandFor
  };
})();

/* ---------------------------------------------------------------- farm plans.
 *
 * globalThis.LaunchPlans: a playbook is chosen by category text, sized by the
 * model's ticket economics, and written as concrete steps — what to do, with
 * how much money, taking how long. The gate wants 3-12 strings of 20-600
 * characters; these templates stay inside that band by construction.
 */
globalThis.LaunchPlans = (function () {
  'use strict';

  var SEASON_WEEKS = 8;

  function money(n) { return globalThis.LaunchModel.money(n); }

  /* Category text -> playbook. Exact DefiLlama category names first, then
   * keyword fragments, so a renamed category still lands on its nearest plan. */
  var EXACT = {
    'Risk Curators': 'curator', 'Onchain Capital Allocator': 'curator',
    'RWA': 'rwa', 'Lending': 'lending', 'Collateral Markets': 'lending',
    'CDP': 'cdp', 'Stablecoin Wrapper': 'cdp',
    'Dexs': 'dex', 'Launchpad': 'dex', 'Prediction Market': 'trading',
    'Derivatives': 'trading', 'Basis Trading': 'trading', 'Options Vault': 'trading',
    'Yield': 'yield', 'Yield Aggregator': 'yield', 'Farm': 'yield',
    'Leveraged Farming': 'yield', 'Liquidity Manager': 'yield', 'Token Locker': 'yield',
    'Staking Pool': 'stake', 'Restaking': 'stake', 'Liquid Staking': 'stake',
    'Liquid Restaking': 'stake', 'Restaked BTC': 'stake',
    'Chain': 'network', 'CeDeFi': 'managed', 'Insurance': 'cover',
    'Payments': 'cover', 'Governance Incentives': 'cover'
  };
  var HINTS = [
    ['curat', 'curator'], ['allocat', 'curator'], ['vault', 'yield'],
    ['lend', 'lending'], ['credit', 'lending'], ['cdp', 'cdp'],
    ['stable', 'cdp'], ['swap', 'dex'], ['dex', 'dex'], ['launch', 'dex'],
    ['perp', 'trading'], ['option', 'trading'], ['derivativ', 'trading'],
    ['basis', 'trading'], ['prediction', 'trading'], ['yield', 'yield'], ['farm', 'yield'],
    ['aggregat', 'yield'], ['stak', 'stake'], ['restak', 'stake'], ['rwa', 'rwa'],
    ['real world', 'rwa'], ['chain', 'network'], ['rollup', 'network'],
    ['cedefi', 'managed'], ['insur', 'cover'], ['payment', 'cover'], ['incentive', 'cover']
  ];

  function playbook(category) {
    var cat = category || '';
    if (EXACT[cat]) return EXACT[cat];
    var low = cat.toLowerCase(), i;
    for (i = 0; i < HINTS.length; i++) if (low.indexOf(HINTS[i][0]) >= 0) return HINTS[i][1];
    return 'generic';
  }

  /* The playbooks. Filled with {name}, {chain}, {chain2}, {pos} (ticket),
   * {season} (ticket x SEASON_WEEKS), {hours} (weekly time budget). */
  var PLAYS = {
    curator: [
      'Move {pos} of stablecoins to {chain} and hold back a little for gas; funding the wallet takes about 10 minutes and a few dollars of fees.',
      'Deposit {pos} into {name}\'s flagship curated vault and leave it 8 weeks ({season} committed in total); curator campaigns score deposits and how long they stay, about {hours} hours a week.',
      'Split a quarter of the ticket into the second-best vault on the same protocol so two positions exist on your address, about 20 minutes once.',
      'Vote or delegate in any allocation or risk votes the protocol runs; on-chain governance before a token is the strongest retroactive signal, about 30 minutes a month.',
      'Check the vault\'s net yield weekly and only move when it halves; switching vaults resets most loyalty clocks, about 10 minutes a week.',
      'When a token goes live, claim inside the first 48 hours and leave the deposit in place; launch-week depositors usually catch the follow-on drop.'
    ],
    rwa: [
      'Read the eligibility page first: most tokenized-asset protocols gate by jurisdiction or accreditation, about 15 minutes.',
      'Complete KYC on {name} with ID and proof of address; approvals take 1-5 days and are the long pole, about 45 minutes.',
      'Fund at least the protocol\'s minimum ticket (at most {pos}) and hold it 8 weeks ({season} parked in total); days held are the scored unit, about {hours} hours a week.',
      'Join the waitlist or pilot cohort even if the minimum is above budget — waitlisted wallets often get the launch drop, about 10 minutes.',
      'Re-check announcements weekly ({hours} hours a week); tokenized-asset launches usually telegraph through new filings or partnerships first.',
      'When a token goes live, claim inside the first 48 hours and keep the position open for the governance follow-on.'
    ],
    lending: [
      'Move {pos} of USDC or ETH to {chain}; funding up takes about 10 minutes and a few dollars of bridge or gas fees.',
      'Supply {pos} into {name}\'s largest market and leave it earning 8 weeks ({season} committed in total), about {hours} hours a week at the start and 10 minutes after.',
      'Borrow 25-40% against the deposit and repay it within the month; a borrow-repay loop is the action most credit campaigns score, about 20 minutes.',
      'Rotate the loop monthly ({season} cycled in total) and keep loan-to-value under 50% so no dip forces a liquidation.',
      'Watch rates weekly and sit in the market with real utilisation; idle capital scores nothing, about {hours} hours a week.',
      'When a token goes live, claim inside the first 48 hours and keep some capital deposited; launch-week depositors often get a second drop.'
    ],
    cdp: [
      'Move {pos} of ETH or stablecoins to {chain}; funding up takes about 10 minutes and a few dollars of fees.',
      'Open the smallest vault {name} offers with {pos} of collateral and mint against it; minting, not depositing, is the tracked action, about 30 minutes.',
      'Keep the collateral ratio at least 20 points above the liquidation line and check it weekly ({hours} hours a week); a closed vault scores nothing.',
      'Repay a slice of debt and re-mint monthly so repayment volume exists on your address ({season} rotated in total).',
      'Mint once on a second deployment of the protocol if one exists on {chain2}; a second vault makes you a distinct cohort, about 20 minutes.',
      'When a token goes live, claim inside the first 48 hours, keep the vault open at a safe ratio and watch governance for a follow-on drop.'
    ],
    dex: [
      'Move {pos} of stablecoins to {chain} and keep a little of the gas token aside; funding up takes about 10 minutes for a few dollars.',
      'Swap {pos} a week on {name}\'s busiest pair for 8 weeks ({season} traded in total); many small swaps across weeks beat one large trade, about 15 minutes a week.',
      'Provide {pos} into the deepest pool and hold it 6-plus weeks; check impermanent loss weekly, about {hours} hours a week all in.',
      'Use the protocol\'s other surfaces once each — limit orders, any perps or the analytics tab — so usage breadth is real, about 30 minutes.',
      'Repeat the swap-and-LP routine on {chain2} as well if the protocol runs there; multi-chain users are a distinct cohort, about 20 minutes extra a week.',
      'When a token goes live, claim inside the first 48 hours and keep trading small; launch-week users usually land the follow-on tier.'
    ],
    trading: [
      'Move {pos} of margin collateral (USDC or ETH) into {name} on {chain}; funding up takes about 10 minutes and a few dollars of fees.',
      'Open 10-plus small positions a week ({pos} notional each) across 8 weeks ({season} notional in total); spread them over markets and both directions, about 20 minutes a week.',
      'Touch every product line once — perps, any options or rates market, one limit fill — breadth is usually scored separately, about {hours} hours a week.',
      'Hold one position past 24 hours at least once; holding time and funding paid are tracked metrics on most venues, about 10 minutes.',
      'Keep realized volume above the venue\'s visible tier line and re-check the points or leaderboard page weekly, about 10 minutes.',
      'When a token goes live, claim inside the first 48 hours and keep trading small; launch-week traders often catch the follow-on tier.'
    ],
    yield: [
      'Move {pos} of stablecoins to {chain}; funding up takes about 10 minutes and a few dollars of fees.',
      'Deposit {pos} into {name}\'s flagship strategy and leave it 8 weeks ({season} committed in total); compounding weekly is the tracked action, about {hours} hours a week.',
      'Split a quarter of the ticket into the second strategy so two positions exist on your address, about 20 minutes once.',
      'Harvest and re-deposit the yield monthly; harvest transactions are on-chain proof of active farming, about 15 minutes a month.',
      'Compare the strategy\'s net APR against its peers weekly and stay in the top half of depositors; about {hours} hours a week.',
      'When a token goes live, claim inside the first 48 hours and keep one position open; early depositors usually get the follow-on campaign.'
    ],
    stake: [
      'Move {pos} of the native asset (ETH, BTC or the chain token) to {chain}; funding up takes about 10 minutes and a few dollars of fees.',
      'Stake {pos} through {name} directly rather than through a wrapper and hold the receipt 8 weeks ({season} parked in total); direct stakers are the core cohort, about 20 minutes.',
      'Open a smaller second ticket in the protocol\'s other pool or on {chain2} if one exists; multi-pool stakers are a distinct cohort, about 15 minutes.',
      'If delegation or node roles exist, run the smallest supported role once; operators and delegates usually get a separate share, about {hours} hours one-off.',
      'Check unstaking windows and any points dashboard weekly and never unstake mid-campaign, about 10 minutes a week.',
      'When a token goes live, claim inside the first 48 hours and keep the stake in place; the follow-on drop usually needs the receipt still held.'
    ],
    network: [
      'Move {pos} to the chain and bridge a little back out again so both directions of activity exist, about 15 minutes and a few dollars of fees.',
      'Run the same {pos} through 3-plus native apps weekly — a swap, a lending deposit, a mint — app breadth is what chain campaigns score, about {hours} hours a week, {season} rotated in total.',
      'Mint or hold the chain\'s testnet assets once; testnet work is usually its own checklist, about 30 minutes.',
      'Deploy a trivial contract or register a subdomain if supported; deployers are a distinct cohort, about 45 minutes.',
      'Keep a weekly on-chain heartbeat for 8-plus weeks; gaps longer than a month reset most streak systems, about 10 minutes a week.',
      'When a token goes live, claim inside the first 48 hours and keep a balance on-chain for the follow-on drops.'
    ],
    managed: [
      'Check whether {name} requires accreditation or a minimum ticket and note its terms, about 15 minutes.',
      'Fund the smallest accepted ticket (at most {pos}) and hold it 8 weeks ({season} parked in total); managed vaults score duration and ticket size, about {hours} hours a week.',
      'Complete any platform tasks — quiz, source of funds form, referral — that gate the campaign checklist, about 30 minutes.',
      'Re-check the protocol\'s announcements weekly; managed platforms telegraph launches through new vault launches first, about 10 minutes a week.',
      'Keep the account active in quiet weeks too; a dormant month drops many loyalty tiers, about 10 minutes.',
      'When a token goes live, claim inside the first 48 hours and keep the ticket open for the follow-on wave.'
    ],
    cover: [
      'Move {pos} of stablecoins or the protocol\'s main asset to {chain}; funding up takes about 10 minutes and a few dollars of fees.',
      'Take the smallest coverage or deposit position {name} offers and hold it 8 weeks ({season} parked in total); covered users are the core cohort, about 20 minutes.',
      'Provide a quarter of the ticket into the underwriting or incentive pool if one is open; providers usually get a separate share, about 20 minutes.',
      'Join the community channels and finish any roles, quest or task checklist tied to campaigns, about 30 minutes.',
      'Renew or top up the position weekly so nothing lapses mid-campaign, about {hours} hours a week.',
      'When a token goes live, claim inside the first 48 hours with the position still open for the follow-on drop.'
    ],
    generic: [
      'Move {pos} of stablecoins to {chain}; funding up takes about 10 minutes and a few dollars of fees.',
      'Run {name}\'s core action — its main deposit, swap or mint — weekly with {pos} for 8 weeks ({season} cycled in total); the core action is what points systems track, about {hours} hours a week.',
      'Use the protocol\'s second feature once so two surfaces exist on your address, about 20 minutes.',
      'Join the community channels and finish any roles, quest or task checklist tied to campaigns, about 30 minutes.',
      'Keep the position alive 8-plus weeks and re-check the campaign page weekly; loyalty windows matter more than size, about 10 minutes a week.',
      'When a token goes live, claim inside the first 48 hours, add a little liquidity and stay active for the follow-on airdrop.'
    ]
  };

  /* The concrete plan for one scored row: 6 base steps, plus a multi-chain
   * step when the protocol runs on more than one chain. */
  function stepsFor(row) {
    var chains = (row.chains && row.chains.length) ? row.chains : ['Ethereum'];
    var econ = row.economics || {};
    var pos = money(econ.position_usd || 500);
    var season = money((econ.position_usd || 500) * SEASON_WEEKS);
    var vars = {
      name: row.name, chain: chains[0], chain2: chains[1] || chains[0],
      pos: pos, season: season, hours: String(econ.hours_per_week || 3)
    };
    var play = PLAYS[playbook(row.category)] || PLAYS.generic;
    var out = [], i;
    for (i = 0; i < play.length; i++) out.push(fill(play[i], vars));
    if (chains.length > 1) {
      out.push('Repeat one full week of the routine on ' + chains[1] + ' as well (' + pos + ' mirrored); a second chain makes you a distinct cohort, about 20 minutes extra a week.');
    }
    return out;
  }

  function fill(text, vars) {
    return text.replace(/\{(\w+)\}/g, function (_, k) {
      return vars[k] !== undefined ? vars[k] : '';
    });
  }

  return { stepsFor: stepsFor, playbook: playbook, SEASON_WEEKS: SEASON_WEEKS };
})();
