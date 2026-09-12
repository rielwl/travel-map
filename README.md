# Places I've been

A personal world map of places lived in, visited and passed through. One static
page — no build step, no framework, no server — deployed to GitHub Pages and
embedded in Notion as an iframe.

**Live:** https://rielwl.github.io/travel-map/

> **`data/places.json` starts empty**, so the page opens on its empty state
> until you add somewhere. See [Adding places](#adding-places). The design's
> 44-place sample set was removed — it was invented data, not a travel history.

---

## Running it locally

```bash
python3 -m http.server 8000
```

Then open http://localhost:8000.

**Do not open `index.html` by double-clicking it.** Browsers block `fetch()` on
`file://` URLs, so the map comes up blank and looks broken. It has to be served
over http.

---

## Deploying

Pages builds from the `main` branch root, so a push to `main` is a deploy; it
goes live in a minute or two. To set that up the first time:

1. **Settings → Pages**
2. *Source*: **Deploy from a branch**
3. *Branch*: **main**, folder **/ (root)** → **Save**

The repo must be public for Pages on the free plan. `.nojekyll` is committed so
Pages serves the files as-is rather than running them through Jekyll.

## Embedding in Notion

1. In the Notion page, type `/embed` and press Enter
2. Paste the Pages URL
3. **Embed link**, then drag the bottom edge to about 700px tall

The page is fluid from 320px to 1400px and caps at 1060px, so it sits inside a
Notion column without overflowing. Notion iframes don't inherit Notion's own
theme, so the page reads the viewer's OS setting instead and falls back to dark.
Append `?theme=light` or `?theme=dark` to the embed URL to pin one.

If the block comes up blank, open the URL in a normal tab first. If that works,
delete the embed block and re-add it — Notion caches hard.

---

## Adding places

Two ways to set a location, because a static page has no geocoder:

- **Click the map** — drops a pin where you clicked and fills in the country by
  working out which country polygon contains that point.
- **Type a place name** — picks from the ~5000 cities bundled in
  `data/cities.json`, which fills coordinates and country for you. The search
  ignores accents, so "Valparaiso" finds Valparaíso.

New places show up immediately and are held in `localStorage` as a working
draft. **A draft is not saved anywhere permanent.** To keep it:

1. **Copy updated places.json**
2. In GitHub, open `data/places.json` → pencil icon → select all → paste
3. **Commit changes**

On the next load the committed file wins and the entry drops out of the draft,
so nothing appears twice. Your travel history ends up as a plain JSON file in
your own repo — readable, portable, and in git history. That is the payoff for
the extra commit step.

### `data/places.json`

```json
{
  "id": "lisbon-2019",
  "city": "Lisbon",
  "country": "Portugal",
  "iso3": "PRT",
  "lat": 38.72,
  "lon": -9.14,
  "type": "lived",
  "from": "2019",
  "to": "2021",
  "note": "Two years on a hill in Graça.",
  "photo": null
}
```

`type` is `lived` | `visited` | `passed`. `to` is `""` for a single-year entry.
`id` must be unique — the app builds it as `city-slug` + `-` + `from`. `photo`
takes any image URL and fills the 4:3 slot in the detail card; `null` leaves the
dashed placeholder.

---

## How it fits together

```
index.html            page shell — static markup, filled in by js/app.js
css/tokens.css        design tokens. Edit in Design, not here
css/app.css           component styles
js/map.js             d3-geo rendering, zoom, click-to-drop-pin
js/app.js             state, filtering, side column, draft/commit flow
data/places.json      your places — the only file you edit by hand
data/iso-lookup.json  ISO numeric -> alpha-3 -> name  (generated)
data/cities.json      ~5000 cities for the typeahead (generated)
tools/build-data.js   regenerates the two generated files
```

Dependencies are three pinned CDN files, with subresource-integrity hashes on
the two scripts: `d3@7.9.0`, `topojson-client@3.1.0`, and
`world-atlas@2.0.2/countries-110m.json` for the country shapes. Fonts are
Spectral and IBM Plex Mono from Google Fonts.

### The country join

`world-atlas` identifies countries by ISO 3166-1 **numeric** id (`"620"`), not
alpha-3 and not name. Every join goes through `data/iso-lookup.json`. Matching
on country name does not line up and is not attempted anywhere in the code.

If a country will not tint, the browser console has two helpers:

```js
__pmmap.hasCountry("SGP")   // false -> 110m has no polygon for it at all
__pmmap.stepOf("PRT")       // 1..3 -> which visited fill it ended up with
```

### Regenerating the data files

```bash
npm install --no-save world-atlas@2.0.2 world-countries@5.1.0 all-the-cities@3.1.0
node tools/build-data.js
```

It refuses to write anything if a country in the map cannot be resolved to an
alpha-3, so a silent join failure can't slip through. `data/places.json` is
hand-maintained and is never touched by the script.

---

## Known limitation

**Very small countries do not tint.** Natural Earth at 110m resolution has no
polygon for them, so they get a pin and count in the stats but the country
never fills in. Singapore, Monaco, Bahrain, Malta and similar are affected.

To fix it, change `WORLD_URL` in `js/map.js` from `countries-110m.json` to
`countries-50m.json`. That is roughly 6x the payload and nothing else has to
change.

---

## Where this came from

Built from a design handoff (`places-map-embed.html` plus its spec). The design
is the authority on how it looks; where the build spec and the design disagreed,
these are the calls made:

| | Design said | Built as | Why |
|---|---|---|---|
| Country join | Match on `properties.name` with a fixup table | ISO numeric → alpha-3 via `iso-lookup.json` | Name matching is the documented failure mode; the design's own fixup table is evidence of it |
| Visited fill | One `--visited` tint | Three steps by visit count | Build spec asked for it. Step 1 is the design's exact value; steps 2–3 stay well below `--accent` so pins keep contrast, which is the constraint the design called out |
| Theme | Default dark for Notion | OS preference, then dark | Build spec asked for `prefers-color-scheme` plus a persisting toggle. `?theme=` still pins either |
| City list | — | ~5000, not ~1000 | 1000 stops around 600k population and cannot find Porto or Valparaíso — ordinary destinations for this app |
| Pan/zoom | Not specified | d3-zoom, clamped, double-click resets | Build spec asked for it. Pins counter-scale so they hold their size |

Additions not in the artboards, all built in the existing button/card language:
the theme toggle, the hover tooltip, the zoom controls, the draft banner, and
the place type as text in each list row so colour is never the only thing
separating the three types.

`css/tokens.css` is owned by the design. Editing hex values in `app.css`
instead is what makes the two drift apart.
