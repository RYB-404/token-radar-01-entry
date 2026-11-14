# Launch Radar

A token launch radar for make.fun's `token-radar-01` bounty: it reads the
sealed DefiLlama snapshot, ranks every token-less protocol that could plausibly
launch its own token by an **expected launch value**, and hands the reader a
concrete farm plan for each one.

## Run it

```bash
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json
```

Node 22.18+ (a newer major works), standard library only, no install, no
network. The grader mounts the snapshot at `/input/snapshot.json` and writes to
`/output`; `--input` and `--output` (or `MAKEFUN_OUTPUT_DIR`) stand in for them
elsewhere. Two runs on the same input write identical bytes.

## What it writes

| File | What it is |
| --- | --- |
| `board.json` | 227 ranked rows (`slug`, `name`, `rank`, `implied_value_usd`, `farm_steps`, plus score/band/odds/category/chains/TVL/watchlist), every watchlist protocol covered |
| `data.js` | the page's data: the raw snapshot fields, loaded by `dashboard/index.html` |
| `dashboard/` | the page: `index.html`, `theme.css`, `app.js`, `engine.js` |
| `screenshots/` | the board, a detail view and a filtered view, captured at 1440×900 |
| `dossier.json` | what the judge reads, built with the vendored `makefun-board` library |

## The model

`dashboard/engine.js` holds the whole value model and the farm-plan
generator — the same file runs in the page and, through `node:vm`, in
`main.ts`, so the numbers on screen and the rows in `board.json` come from the
byte-for-byte same code:

```
fair value    = TVL × comparable multiple × momentum × tenure
implied value = fair value × launch odds
```

- **Comparable multiple** — the median market-cap-to-TVL ratio of the tokened
  protocols in the same category, from the snapshot's own `mcap_usd` figures;
  the global median covers thin categories.
- **Momentum** — the 7-day TVL change, bounded, unreported treated as flat.
- **Tenure** — months already spent live without a token, up to five years.
- **Launch odds** — a class base (watchlisted protocols 0.50, plain pre-token
  0.28, staking families 0.16) plus 0.42 × a signal blended from size, tenure,
  traction and the category's launch climate, all measured on the snapshot.
- **Farm economics** — a retail ticket that grows slowly with TVL, and an
  expected share of the launch that fades steeply with ticket size against TVL.

No protocol name is hardcoded anywhere; classification (exchange venue, bridge
infrastructure, wrapped or staked wrapper, versioned successor) uses category
text and name patterns only, and those rows are set aside unranked rather than
given a value.

## The page

A dark single-page dashboard, system fonts, inline SVG icons, no framework and
no network: an executive card naming the #1 opportunity, sortable and
filterable board (search, category, chain, minimum TVL, watchlist-only, sort),
an expandable farm plan on every row, a detail view per protocol with the full
score breakdown and tokened peers, a top-10 head-to-head table, a set-aside
list with reasons, and the methodology on the page. Every view state is a deep
link (`#detail=<slug>`, `#cat=…`, `#view=duel`, …).

## Layout

```
main.ts                 reads the snapshot, runs the engine, writes /output
dashboard/index.html    page skeleton
dashboard/theme.css     the palette and spacing
dashboard/app.js        board, filters, detail view, head-to-head, deep links
dashboard/engine.js     the value model + farm plans (page and main.ts share it)
vendor/makefun-board.ts make.fun's dossier library, vendored unmodified
screenshots/            three captures: board, detail, filtered
```

MIT licensed. Implied values are this entry's own model output — a ranking aid,
never a prediction that a token will come.
