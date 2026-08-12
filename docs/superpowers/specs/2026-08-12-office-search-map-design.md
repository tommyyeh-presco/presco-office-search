# Presco Office Search — Employee Distribution Map (Design Spec)

Date: 2026-08-12

## Purpose

Presco is evaluating office locations in Northern Taiwan. As the first piece of a
larger proposal, we need a map showing where current employees live, so office
candidates can later be evaluated against commute distance / density of
employees nearby. This spec covers **only the map** (Phase 1). Plotting
candidate office locations is an explicitly deferred Phase 2, and the overall
proposal deck/page (built with Claude for design) is Phase 3.

## Source data

`20260812公司員工住居住地統計.xlsx` — one sheet, 3 columns (縣市, 區域, 合計),
235 total employee records grouped by county and district, with subtotal rows
per county and a grand total row.

## Scope

- **Included regions:** 台北市 (Taipei City), 新北市 (New Taipei City), 桃園市
  (Taoyuan), 基隆市 (Keelung City), 宜蘭縣 (Yilan County) — the 5 regions that
  currently have employees. Hsinchu is excluded (0 employees today).
- **Districts shown:** *all* districts within the 5 included regions/counties,
  even ones with 0 employees, so the map renders as one continuous shape
  rather than sparse islands. A district's employee-count number label is
  only drawn when count > 0, to avoid clutter in low-population/rural
  districts.
- **Excluded:** the 8 rows labeled "異常訊息" (unparseable/invalid addresses)
  are dropped entirely — they can't be geolocated to a district.

## Data normalization

The raw district labels aren't all clean administrative names. These are
normalized before rendering:

| Raw label (county / district) | Issue | Resolution |
|---|---|---|
| 台北市 / 內湖路 (1 person) | Road name, not a district | Folded into 內湖區 |
| 基隆市 / 碇內街 (1 person) | Road name, not a district | Folded into 暖暖區 |
| 桃園市 / 中壢區, 桃園區, 楊梅區 | Modern (post-2014) district naming | Matched to underlying geography |
| 桃園縣 / 平鎮市, 觀音鄉 | Legacy (pre-2014) town naming | Matched to underlying geography |

The boundary GeoJSON in use (see below) predates Taoyuan County's 2014
upgrade to a special municipality, so Taoyuan town names in that file are
still pre-2014 style (中壢市, 桃園市, 楊梅鎮, 平鎮市, 觀音鄉). A lookup table
maps our normalized district names to whatever label that specific GeoJSON
feature uses, so the boundary-matching logic is decoupled from display
labels (which always use modern names).

Where a raw row's county label conflicts with the normalized district's real
county (e.g. legacy "桃園縣" rows), the district's real modern county/region
is used for grouping and totals.

## Map technology

- **Leaflet.js** (loaded via CDN), no build step — plain static HTML/CSS/JS.
- **Boundary data:** g0v/twgeojson project's town/district-level GeoJSON
  (`twTown1982.geo.json`, despite the filename it reflects modern boundaries
  for most counties). Downloaded once and **vendored into the repo** (not
  fetched live at runtime) so the page doesn't depend on an external host
  staying available, and so we can pre-filter/pre-process it at build time.
- A small data-prep script (Python, run once locally, not part of the
  deployed site) parses the xlsx, applies the normalization table above,
  and emits a JSON file of `{district_id: {name, county, count}}` used by
  the page's JS to color/label the map. This keeps the published page free
  of any spreadsheet-parsing logic.

## Visual design

- **Choropleth**, single-hue blue gradient: light blue (few employees) →
  dark navy (many employees), scaled across the actual min/max count in the
  data. Districts with 0 employees get a neutral light-gray fill (distinct
  from the "few employees" light blue, so 0 doesn't look like data).
- Each district with count > 0 shows its number, centered on the district
  (via Leaflet marker/tooltip at the polygon's centroid).
- Hovering a district shows a tooltip: district name, county, employee
  count.
- A legend in the corner shows the color scale.
- Map initially frames to fit the bounding box of the 5 included regions;
  standard pan/zoom enabled.
- Page title: "數網找辦公室".

## Extensibility for Phase 2 (office pins — not built now)

The employee choropleth is one Leaflet layer. Office candidate locations
will be a second, independent Leaflet layer/data file added later
(pins/markers with popups for address, size, cost, etc.), so Phase 2 doesn't
require touching the choropleth code.

## Hosting & access

- **Repo:** new **public** GitHub repo `presco-office-search` under the
  `tommyyeh-presco` account (Pages requires public repos on the Free plan).
- **Deploy:** GitHub Pages serving from the repo, at
  `tommyyeh-presco.github.io/presco-office-search`.
- **Password gate:** a full-page overlay blocks the map until the correct
  password is entered. The entered value is SHA-256 hashed client-side
  (Web Crypto API) and compared against a stored hash constant in the JS —
  avoids the plaintext password sitting directly in view-source, but this
  is explicitly **not real security** (a determined visitor can read the
  client-side JS and work around it). This tradeoff was discussed and
  accepted: acceptable for a low-stakes internal proposal, not for
  protecting genuinely sensitive data.
  - Password: `presco0813`
  - On success, sets a `sessionStorage` flag so the user isn't re-prompted
    every navigation within the same browser tab session.

## Out of scope for this spec

- Office candidate location pins (Phase 2, explicitly deferred by the user).
- The overall proposal page/deck design (Phase 3, to be done with Claude's
  design/artifact tooling after the map is live).
- Any real authentication/access control beyond the client-side password
  gate.

## Repo/publish confirmation

Creating the public GitHub repo and pushing content to it will be confirmed
explicitly with the user before it happens (publishing action), even though
local implementation work does not require per-step confirmation.
