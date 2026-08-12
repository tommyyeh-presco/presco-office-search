# Employee Distribution Map — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a password-gated, interactive Leaflet.js choropleth map of Northern Taiwan (Taipei/New Taipei/Taoyuan/Keelung/Yilan, district level) showing employee residence counts per district, ready to host on GitHub Pages.

**Architecture:** A Python data-prep script (run once locally, not published) parses the raw employee xlsx, normalizes inconsistent district labels, and joins the counts against a vendored open-data district boundary GeoJSON to produce a single published `data/districts.geo.json`. A plain static HTML/CSS/JS site (Leaflet via CDN, no build step) reads that file and renders the choropleth behind a client-side password gate.

**Tech Stack:** Python 3 + openpyxl + pytest (data prep, local only), Leaflet.js 1.9.4 via CDN, vanilla JS (Web Crypto API for the password hash), plain HTML/CSS. Hosted on GitHub Pages (public repo, no Actions/build step needed).

---

Reference: [design spec](../specs/2026-08-12-office-search-map-design.md)

## File structure

```
/
├── .gitignore
├── README.md
├── index.html                       # site entry: password gate + map container
├── style.css
├── password-gate.js                 # SHA-256 password check, reveals #app
├── app.js                           # Leaflet map init + choropleth rendering
├── data/
│   └── districts.geo.json           # PUBLISHED build output (boundary + counts)
├── scripts/
│   ├── requirements.txt
│   ├── district_mapping.py          # canonicalize() + aggregate_counts()
│   ├── xlsx_parser.py               # parse_xlsx()
│   ├── geojson_builder.py           # build_geojson()
│   ├── prepare_data.py              # CLI: wires the three modules together
│   ├── .cache/                      # gitignored: downloaded national geojson
│   └── tests/
│       ├── conftest.py
│       ├── test_district_mapping.py
│       ├── test_xlsx_parser.py
│       └── test_geojson_builder.py
└── docs/superpowers/{specs,plans}/...
```

---

### Task 1: Project scaffold

**Files:**
- Create: `README.md`
- Create: `scripts/requirements.txt`
- Create: `scripts/tests/conftest.py`
- Modify: `.gitignore`

- [ ] **Step 1: Extend `.gitignore`**

Append to the existing `.gitignore`:

```
__pycache__/
*.pyc
scripts/.cache/
```

- [ ] **Step 2: Create `scripts/requirements.txt`**

```
openpyxl
pytest
```

- [ ] **Step 3: Install dependencies**

Run: `pip3 install -r scripts/requirements.txt`
Expected: pytest installs successfully (openpyxl is already present).

- [ ] **Step 4: Create `scripts/tests/conftest.py`**

```python
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
```

- [ ] **Step 5: Create `README.md`**

```markdown
# Presco Office Search — Employee Distribution Map

Interactive map of where Presco employees live across Northern Taiwan
(Taipei, New Taipei, Taoyuan, Keelung, Yilan), built as the first input
to an office-location proposal.

## Regenerating the map data

The published `data/districts.geo.json` is generated from the raw
employee residence spreadsheet — it is not committed by hand.

```bash
pip3 install -r scripts/requirements.txt
python3 scripts/prepare_data.py --xlsx "/path/to/employee_residence.xlsx"
```

This downloads and caches the district boundary GeoJSON
(g0v/twgeojson) on first run, joins it against the spreadsheet counts,
and writes `data/districts.geo.json`.

## Running the site locally

```bash
python3 -m http.server 8000
```

Then open http://localhost:8000 — the site is gated by a password
(ask the maintainer).

## Tests

```bash
python3 -m pytest scripts/tests/ -v
```
```

- [ ] **Step 6: Commit**

```bash
git add .gitignore README.md scripts/requirements.txt scripts/tests/conftest.py
git commit -m "Scaffold project: README, test config, dependencies"
```

---

### Task 2: District name normalization (`district_mapping.py`)

**Files:**
- Create: `scripts/district_mapping.py`
- Test: `scripts/tests/test_district_mapping.py`

- [ ] **Step 1: Write the failing tests**

Create `scripts/tests/test_district_mapping.py`:

```python
from district_mapping import canonicalize, aggregate_counts


def test_canonicalize_passthrough_for_normal_district():
    assert canonicalize("台北市", "大安區") == ("台北市", "大安區")


def test_canonicalize_folds_neihu_road_into_neihu_district():
    assert canonicalize("台北市", "內湖路") == ("台北市", "內湖區")


def test_canonicalize_folds_dingnei_street_into_nuannuan_district():
    assert canonicalize("基隆市", "碇內街") == ("基隆市", "暖暖區")


def test_canonicalize_maps_legacy_taoyuan_county_town_to_modern_district():
    assert canonicalize("桃園縣", "平鎮市") == ("桃園市", "平鎮區")
    assert canonicalize("桃園縣", "觀音鄉") == ("桃園市", "觀音區")
    assert canonicalize("桃園縣", "中壢市") == ("桃園市", "中壢區")


def test_canonicalize_modern_taoyuan_district_passes_through():
    assert canonicalize("桃園市", "中壢區") == ("桃園市", "中壢區")


def test_aggregate_counts_sums_rows_that_fold_into_same_district():
    rows = [
        ("台北市", "內湖區", 12),
        ("台北市", "內湖路", 1),
    ]
    assert aggregate_counts(rows) == {("台北市", "內湖區"): 13}


def test_aggregate_counts_keeps_distinct_districts_separate():
    rows = [
        ("台北市", "大安區", 12),
        ("台北市", "中山區", 15),
    ]
    assert aggregate_counts(rows) == {
        ("台北市", "大安區"): 12,
        ("台北市", "中山區"): 15,
    }


def test_aggregate_counts_merges_legacy_and_modern_taoyuan_labels():
    rows = [
        ("桃園市", "中壢區", 1),
        ("桃園縣", "中壢市", 2),
    ]
    assert aggregate_counts(rows) == {("桃園市", "中壢區"): 3}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python3 -m pytest scripts/tests/test_district_mapping.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'district_mapping'`

- [ ] **Step 3: Write `scripts/district_mapping.py`**

```python
"""Canonicalization and aggregation of raw employee-address rows into
standardized (county, district) keys used by the map.

The same lookup table is used to fix two independent problems:
  1. Rows in the raw spreadsheet where the "district" is actually a road
     name, not a real district (address-parsing errors upstream).
  2. Legacy pre-2014 Taoyuan County (縣) town names, which show up both
     in older rows of the raw spreadsheet AND in the vendored boundary
     GeoJSON (which predates Taoyuan's 2014 upgrade to a special
     municipality). Applying the same fix table to both sides means they
     always join on the same canonical key.
"""

CANONICAL_FIXES = {
    # Mis-parsed road names -> the district they actually belong to.
    ("台北市", "內湖路"): ("台北市", "內湖區"),
    ("基隆市", "碇內街"): ("基隆市", "暖暖區"),

    # Legacy Taoyuan County (縣) town names -> modern Taoyuan City (市)
    # district names. Covers all 13 former townships/county-administered
    # cities so every Taoyuan boundary feature resolves correctly, even
    # the ones with 0 employees today.
    ("桃園縣", "中壢市"): ("桃園市", "中壢區"),
    ("桃園縣", "桃園市"): ("桃園市", "桃園區"),
    ("桃園縣", "楊梅鎮"): ("桃園市", "楊梅區"),
    ("桃園縣", "平鎮市"): ("桃園市", "平鎮區"),
    ("桃園縣", "觀音鄉"): ("桃園市", "觀音區"),
    ("桃園縣", "大溪鎮"): ("桃園市", "大溪區"),
    ("桃園縣", "復興鄉"): ("桃園市", "復興區"),
    ("桃園縣", "八德市"): ("桃園市", "八德區"),
    ("桃園縣", "新屋鄉"): ("桃園市", "新屋區"),
    ("桃園縣", "龍潭鄉"): ("桃園市", "龍潭區"),
    ("桃園縣", "大園鄉"): ("桃園市", "大園區"),
    ("桃園縣", "龜山鄉"): ("桃園市", "龜山區"),
    ("桃園縣", "蘆竹鄉"): ("桃園市", "蘆竹區"),
}


def canonicalize(county, district):
    """Return (canonical_county, canonical_district) for a raw
    (county, district) pair. Pairs with no known issue pass through
    unchanged."""
    return CANONICAL_FIXES.get((county, district), (county, district))


def aggregate_counts(rows):
    """rows: iterable of (county, district, count) raw tuples.
    Returns dict {(canonical_county, canonical_district): total_count},
    summing counts that fold into the same canonical district."""
    totals = {}
    for county, district, count in rows:
        key = canonicalize(county, district)
        totals[key] = totals.get(key, 0) + count
    return totals
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python3 -m pytest scripts/tests/test_district_mapping.py -v`
Expected: all 8 tests PASS

- [ ] **Step 5: Commit**

```bash
git add scripts/district_mapping.py scripts/tests/test_district_mapping.py
git commit -m "Add district name canonicalization and count aggregation"
```

---

### Task 3: Spreadsheet parsing (`xlsx_parser.py`)

**Files:**
- Create: `scripts/xlsx_parser.py`
- Test: `scripts/tests/test_xlsx_parser.py`

- [ ] **Step 1: Write the failing tests**

Create `scripts/tests/test_xlsx_parser.py`:

```python
import openpyxl

from xlsx_parser import parse_xlsx


def _make_workbook(path, rows):
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.append(("縣市", "區域", "合計"))
    for row in rows:
        ws.append(row)
    wb.save(path)


def test_parse_xlsx_forward_fills_county_for_merged_cells(tmp_path):
    path = tmp_path / "sample.xlsx"
    _make_workbook(path, [
        ("台北市", "士林區", 8),
        (None, "大同區", 3),
        ("台北市 合計", None, 11),
    ])
    assert parse_xlsx(path) == [
        ("台北市", "士林區", 8),
        ("台北市", "大同區", 3),
    ]


def test_parse_xlsx_skips_invalid_address_group(tmp_path):
    path = tmp_path / "sample.xlsx"
    _make_workbook(path, [
        ("台北市", "士林區", 8),
        ("台北市 合計", None, 8),
        ("異常訊息", None, 8),
        ("異常訊息 合計", None, 8),
        ("總計", None, 8),
    ])
    assert parse_xlsx(path) == [("台北市", "士林區", 8)]


def test_parse_xlsx_handles_multiple_county_groups(tmp_path):
    path = tmp_path / "sample.xlsx"
    _make_workbook(path, [
        ("台北市", "士林區", 8),
        ("台北市 合計", None, 8),
        ("宜蘭縣", "宜蘭市", 1),
        (None, "礁溪鄉", 1),
        ("宜蘭縣 合計", None, 2),
        ("總計", None, 10),
    ])
    assert parse_xlsx(path) == [
        ("台北市", "士林區", 8),
        ("宜蘭縣", "宜蘭市", 1),
        ("宜蘭縣", "礁溪鄉", 1),
    ]
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python3 -m pytest scripts/tests/test_xlsx_parser.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'xlsx_parser'`

- [ ] **Step 3: Write `scripts/xlsx_parser.py`**

```python
"""Parse the raw employee residence xlsx into (county, district, count)
tuples, skipping subtotal, grand-total, and invalid-address rows."""

import openpyxl


def parse_xlsx(path):
    wb = openpyxl.load_workbook(path, data_only=True)
    ws = wb.worksheets[0]

    current_county = None
    rows = []
    for county, district, count in ws.iter_rows(min_row=2, values_only=True):
        if county is not None and "合計" not in str(county) and county != "總計":
            current_county = county
        if district is None:
            continue
        if current_county is None or current_county == "異常訊息":
            continue
        rows.append((current_county, district, count))
    return rows
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python3 -m pytest scripts/tests/test_xlsx_parser.py -v`
Expected: all 3 tests PASS

- [ ] **Step 5: Commit**

```bash
git add scripts/xlsx_parser.py scripts/tests/test_xlsx_parser.py
git commit -m "Add xlsx parsing for employee residence data"
```

---

### Task 4: Boundary + count join (`geojson_builder.py`)

**Files:**
- Create: `scripts/geojson_builder.py`
- Test: `scripts/tests/test_geojson_builder.py`

- [ ] **Step 1: Write the failing tests**

Create `scripts/tests/test_geojson_builder.py`:

```python
from geojson_builder import build_geojson


def _feature(county, town, town_suffix=""):
    return {
        "type": "Feature",
        "properties": {"COUNTYNAME": county, "TOWNNAME": town + town_suffix},
        "geometry": {"type": "Polygon", "coordinates": [[[121.123456, 25.123456]]]},
    }


def test_build_geojson_attaches_counts_by_canonical_key():
    national = {"type": "FeatureCollection", "features": [_feature("台北市", "大安區")]}
    counts = {("台北市", "大安區"): 12}
    result = build_geojson(national, counts)
    assert result["features"][0]["properties"] == {
        "county": "台北市", "name": "大安區", "count": 12,
    }


def test_build_geojson_defaults_to_zero_for_districts_with_no_employees():
    national = {"type": "FeatureCollection", "features": [_feature("宜蘭縣", "南澳鄉")]}
    result = build_geojson(national, {})
    assert result["features"][0]["properties"]["count"] == 0


def test_build_geojson_excludes_counties_outside_target_scope():
    national = {"type": "FeatureCollection", "features": [_feature("新竹市", "東區")]}
    result = build_geojson(national, {})
    assert result["features"] == []


def test_build_geojson_drops_sea_boundary_duplicate_features():
    national = {"type": "FeatureCollection", "features": [
        _feature("基隆市", "中山區"),
        _feature("基隆市", "中山區", town_suffix="(海)"),
    ]}
    counts = {("基隆市", "中山區"): 4}
    result = build_geojson(national, counts)
    assert len(result["features"]) == 1
    assert result["features"][0]["properties"]["name"] == "中山區"


def test_build_geojson_canonicalizes_legacy_taoyuan_boundary_names():
    national = {"type": "FeatureCollection", "features": [_feature("桃園縣", "中壢市")]}
    counts = {("桃園市", "中壢區"): 3}
    result = build_geojson(national, counts)
    assert result["features"][0]["properties"] == {
        "county": "桃園市", "name": "中壢區", "count": 3,
    }


def test_build_geojson_rounds_coordinates():
    national = {"type": "FeatureCollection", "features": [_feature("台北市", "大安區")]}
    result = build_geojson(national, {})
    assert result["features"][0]["geometry"]["coordinates"] == [[[121.12346, 25.12346]]]
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python3 -m pytest scripts/tests/test_geojson_builder.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'geojson_builder'`

- [ ] **Step 3: Write `scripts/geojson_builder.py`**

```python
"""Build the published choropleth GeoJSON by joining boundary polygons
with per-district employee counts."""

from district_mapping import canonicalize

TARGET_COUNTIES = {"台北市", "新北市", "基隆市", "宜蘭縣", "桃園縣"}
COORD_DECIMALS = 5


def _round_coords(coords):
    if isinstance(coords[0], (int, float)):
        return [round(c, COORD_DECIMALS) for c in coords]
    return [_round_coords(c) for c in coords]


def build_geojson(national_geojson, counts_by_district):
    """national_geojson: parsed GeoJSON dict (g0v/twgeojson town-level).
    counts_by_district: dict {(canonical_county, canonical_district): count},
    as produced by district_mapping.aggregate_counts.

    Returns a new GeoJSON dict covering only the target counties, with
    canonical name/county/count properties, sea-boundary duplicate
    features dropped, and coordinates rounded for a smaller file size."""
    features = []
    for feature in national_geojson["features"]:
        raw_county = feature["properties"]["COUNTYNAME"]
        raw_district = feature["properties"]["TOWNNAME"]

        if raw_county not in TARGET_COUNTIES:
            continue
        if raw_district.endswith("(海)"):
            continue

        county, district = canonicalize(raw_county, raw_district)
        count = counts_by_district.get((county, district), 0)

        features.append({
            "type": "Feature",
            "geometry": {
                "type": feature["geometry"]["type"],
                "coordinates": _round_coords(feature["geometry"]["coordinates"]),
            },
            "properties": {
                "county": county,
                "name": district,
                "count": count,
            },
        })

    return {"type": "FeatureCollection", "features": features}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python3 -m pytest scripts/tests/test_geojson_builder.py -v`
Expected: all 6 tests PASS

- [ ] **Step 5: Commit**

```bash
git add scripts/geojson_builder.py scripts/tests/test_geojson_builder.py
git commit -m "Add boundary/count join producing the published GeoJSON"
```

---

### Task 5: CLI wiring and real data generation (`prepare_data.py`)

**Files:**
- Create: `scripts/prepare_data.py`
- Create: `data/districts.geo.json` (generated output, not hand-written)

- [ ] **Step 1: Write `scripts/prepare_data.py`**

```python
#!/usr/bin/env python3
"""Build data/districts.geo.json from the raw employee xlsx and the
vendored national town-boundary GeoJSON.

Usage:
    python3 scripts/prepare_data.py --xlsx "/path/to/employee_residence.xlsx"

Downloads and caches the national boundary GeoJSON on first run.
"""
import argparse
import json
import urllib.request
from pathlib import Path

from district_mapping import aggregate_counts
from geojson_builder import build_geojson
from xlsx_parser import parse_xlsx

NATIONAL_GEOJSON_URL = (
    "https://raw.githubusercontent.com/g0v/twgeojson/master/json/twTown1982.geo.json"
)
DEFAULT_CACHE = Path(__file__).resolve().parent / ".cache" / "twTown1982.geo.json"
DEFAULT_OUTPUT = Path(__file__).resolve().parent.parent / "data" / "districts.geo.json"


def load_national_geojson(cache_path):
    cache_path = Path(cache_path)
    if not cache_path.exists():
        cache_path.parent.mkdir(parents=True, exist_ok=True)
        print(f"Downloading {NATIONAL_GEOJSON_URL} -> {cache_path}")
        urllib.request.urlretrieve(NATIONAL_GEOJSON_URL, cache_path)
    return json.loads(cache_path.read_text(encoding="utf-8"))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--xlsx", required=True, help="Path to the raw employee residence xlsx")
    parser.add_argument("--output", default=str(DEFAULT_OUTPUT))
    parser.add_argument("--geojson-cache", default=str(DEFAULT_CACHE))
    args = parser.parse_args()

    rows = parse_xlsx(args.xlsx)
    counts = aggregate_counts(rows)
    national = load_national_geojson(args.geojson_cache)
    result = build_geojson(national, counts)

    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(
        json.dumps(result, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )

    total = sum(f["properties"]["count"] for f in result["features"])
    print(f"Wrote {len(result['features'])} districts, {total} total employees, to {output_path}")


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Run it against the real spreadsheet**

Run:
```bash
python3 scripts/prepare_data.py --xlsx "/Users/tommy.yeh/Downloads/20260812公司員工住居住地統計.xlsx"
```
Expected: downloads the boundary file on first run, then prints something like
`Wrote 73 districts, 227 total employees, to .../data/districts.geo.json`
(73 districts across the 5 counties; 227 = 235 raw records minus the 8 invalid-address rows.)

- [ ] **Step 3: Spot-check the output**

Run:
```bash
python3 -c "
import json
data = json.load(open('data/districts.geo.json'))
by_name = {f['properties']['name']: f['properties'] for f in data['features']}
print(by_name['內湖區'])   # expect count 13 (12 + the folded 內湖路 row)
print(by_name['暖暖區'])   # expect count 2 (1 + the folded 碇內街 row)
print(by_name['中和區'])   # expect count 24 (highest in the dataset)
print(by_name['楊梅區'])   # expect count 1 (from 桃園市 raw rows)
print(by_name['大溪區'])   # expect count 0 (no employees, still present)
"
```
Expected output:
```
{'county': '台北市', 'name': '內湖區', 'count': 13}
{'county': '基隆市', 'name': '暖暖區', 'count': 2}
{'county': '新北市', 'name': '中和區', 'count': 24}
{'county': '桃園市', 'name': '楊梅區', 'count': 1}
{'county': '桃園市', 'name': '大溪區', 'count': 0}
```

- [ ] **Step 4: Commit**

```bash
git add scripts/prepare_data.py data/districts.geo.json
git commit -m "Add data-prep CLI and generate published district GeoJSON"
```

---

### Task 6: Site shell and password gate

**Files:**
- Create: `index.html`
- Create: `style.css`
- Create: `password-gate.js`

- [ ] **Step 1: Create `style.css`**

```css
:root {
  --brand: #08519c;
  --bg: #f5f7fa;
}

* { box-sizing: border-box; }

html, body {
  margin: 0;
  height: 100%;
  font-family: -apple-system, "PingFang TC", "Microsoft JhengHei", sans-serif;
  background: var(--bg);
}

#gate {
  height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
}

#gate-form {
  background: #fff;
  padding: 2.5rem;
  border-radius: 12px;
  box-shadow: 0 10px 30px rgba(0,0,0,0.08);
  text-align: center;
  width: 320px;
}

#gate-form h1 {
  margin: 0 0 0.5rem;
  font-size: 1.4rem;
  color: var(--brand);
}

#gate-form p {
  color: #555;
  font-size: 0.9rem;
}

#gate-password {
  width: 100%;
  padding: 0.6rem 0.8rem;
  margin: 1rem 0;
  border: 1px solid #ccc;
  border-radius: 8px;
  font-size: 1rem;
}

#gate-form button {
  width: 100%;
  padding: 0.6rem;
  border: none;
  border-radius: 8px;
  background: var(--brand);
  color: #fff;
  font-size: 1rem;
  cursor: pointer;
}

.error {
  color: #c0392b;
  font-size: 0.85rem;
}

#app {
  height: 100vh;
  display: flex;
  flex-direction: column;
}

header {
  padding: 1rem 1.5rem;
  background: #fff;
  border-bottom: 1px solid #e2e2e2;
}

header h1 {
  margin: 0;
  font-size: 1.2rem;
  color: var(--brand);
}

.subtitle {
  margin: 0.25rem 0 0;
  color: #666;
  font-size: 0.85rem;
}

#map {
  flex: 1;
}

.district-label {
  background: transparent !important;
  border: none !important;
  box-shadow: none !important;
  font-weight: 700;
  font-size: 12px;
  color: #0b2545;
  text-align: center;
  text-shadow: 0 0 3px #fff, 0 0 3px #fff, 0 0 3px #fff;
}

.legend {
  background: #fff;
  padding: 0.6rem 0.8rem;
  border-radius: 8px;
  box-shadow: 0 2px 8px rgba(0,0,0,0.15);
  font-size: 0.8rem;
  line-height: 1.4;
}

.legend-gradient {
  width: 120px;
  height: 12px;
  margin: 6px 0 2px;
  border-radius: 3px;
  background: linear-gradient(to right, #e9edf1, #deebf7, #08306b);
}

.legend-scale {
  display: flex;
  justify-content: space-between;
  font-size: 0.75rem;
  color: #555;
}
```

- [ ] **Step 2: Create `index.html`**

```html
<!DOCTYPE html>
<html lang="zh-Hant">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>數網找辦公室</title>
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
<link rel="stylesheet" href="style.css">
</head>
<body>
  <div id="gate">
    <form id="gate-form">
      <h1>數網找辦公室</h1>
      <p>請輸入密碼以檢視員工居住地分佈圖</p>
      <input type="password" id="gate-password" placeholder="密碼" autocomplete="off" required>
      <button type="submit">進入</button>
      <p id="gate-error" class="error" hidden>密碼錯誤，請再試一次</p>
    </form>
  </div>

  <div id="app" hidden>
    <header>
      <h1>數網找辦公室 — 員工居住地分佈</h1>
      <p class="subtitle">北台灣各行政區員工人數（依居住地區域統計）</p>
    </header>
    <div id="map"></div>
  </div>

  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
  <script src="password-gate.js"></script>
  <script src="app.js"></script>
</body>
</html>
```

- [ ] **Step 3: Create `password-gate.js`**

The stored hash below is `sha256("presco0813")`, computed with
`python3 -c "import hashlib; print(hashlib.sha256(b'presco0813').hexdigest())"`.

```javascript
(function () {
  const STORED_HASH = "49733ab3453b0232e1e91203ba5a3b1b8df66c790e7c3f67377600ace2cf7dc3";
  const SESSION_KEY = "presco-office-search-authed";

  async function sha256Hex(text) {
    const data = new TextEncoder().encode(text);
    const digest = await crypto.subtle.digest("SHA-256", data);
    return Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }

  function showApp() {
    document.getElementById("gate").hidden = true;
    document.getElementById("app").hidden = false;
    document.dispatchEvent(new Event("presco:authed"));
  }

  if (sessionStorage.getItem(SESSION_KEY) === "1") {
    showApp();
  }

  document.getElementById("gate-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const input = document.getElementById("gate-password").value;
    const hash = await sha256Hex(input);
    const errorEl = document.getElementById("gate-error");
    if (hash === STORED_HASH) {
      sessionStorage.setItem(SESSION_KEY, "1");
      errorEl.hidden = true;
      showApp();
    } else {
      errorEl.hidden = false;
    }
  });
})();
```

- [ ] **Step 4: Create a placeholder `app.js` so the page loads without errors**

```javascript
document.addEventListener("presco:authed", () => {
  console.log("authed — map init added in Task 7");
});
```

- [ ] **Step 5: Manually verify the password gate in a browser**

Run: `python3 -m http.server 8000` (from the repo root), then open
`http://localhost:8000` in a browser.

Expected:
- The password form is shown, the map area is hidden.
- Entering a wrong password shows "密碼錯誤，請再試一次" and the form stays.
- Entering `presco0813` hides the form and reveals the (still empty) `#app`
  header/subtitle.
- Reloading the page skips the form (session-persisted).

- [ ] **Step 6: Commit**

```bash
git add index.html style.css password-gate.js app.js
git commit -m "Add site shell with password gate"
```

---

### Task 7: Choropleth rendering (`app.js`)

**Files:**
- Modify: `app.js`

- [ ] **Step 1: Replace `app.js` with the full map implementation**

```javascript
document.addEventListener("presco:authed", initMap, { once: true });

const LIGHT_RGB = [222, 235, 247]; // #deebf7
const DARK_RGB = [8, 48, 107];     // #08306b
const ZERO_COLOR = "#e9edf1";

function interpolateColor(t) {
  const rgb = LIGHT_RGB.map((c, i) => Math.round(c + (DARK_RGB[i] - c) * t));
  return `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
}

function colorForCount(count, maxCount) {
  if (count === 0) return ZERO_COLOR;
  return interpolateColor(count / maxCount);
}

async function initMap() {
  const map = L.map("map");
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "&copy; OpenStreetMap contributors",
    maxZoom: 18,
  }).addTo(map);

  const response = await fetch("data/districts.geo.json");
  const geojson = await response.json();
  const maxCount = Math.max(...geojson.features.map((f) => f.properties.count));

  const layer = L.geoJSON(geojson, {
    style: (feature) => ({
      fillColor: colorForCount(feature.properties.count, maxCount),
      fillOpacity: 0.85,
      color: "#5b6b7a",
      weight: 1,
    }),
    onEachFeature: (feature, lyr) => {
      const { name, county, count } = feature.properties;
      lyr.bindTooltip(`${county}${name}：${count} 人`, { sticky: true });
      if (count > 0) {
        const center = lyr.getBounds().getCenter();
        L.marker(center, {
          icon: L.divIcon({
            className: "district-label",
            html: String(count),
            iconSize: [30, 16],
          }),
          interactive: false,
        }).addTo(map);
      }
    },
  }).addTo(map);

  map.fitBounds(layer.getBounds());

  const legend = L.control({ position: "bottomright" });
  legend.onAdd = () => {
    const div = L.DomUtil.create("div", "legend");
    div.innerHTML =
      "<strong>員工人數</strong>" +
      '<div class="legend-gradient"></div>' +
      `<div class="legend-scale"><span>0</span><span>${maxCount}</span></div>`;
    return div;
  };
  legend.addTo(map);
}
```

- [ ] **Step 2: Manually verify in the browser**

Run: `python3 -m http.server 8000` (if not still running), open
`http://localhost:8000`, enter the password.

Expected:
- A basemap of Northern Taiwan loads, framed to the 5-county extent.
- Districts are filled blue, darker where employee count is higher (中和區
  should be the darkest, since it has the highest count, 24).
- Each district with count > 0 shows its number centered on the district.
- 0-count districts (e.g. 大溪區, 復興區) show a light gray fill with no
  number.
- Hovering a district shows a tooltip with county, district name, and count.
- A legend in the bottom-right shows a gradient bar labeled 0 to the max
  count (24).
- Pan/zoom work normally.

- [ ] **Step 3: Commit**

```bash
git add app.js
git commit -m "Render employee-count choropleth on the map"
```

---

### Task 8: Final review pass

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite**

Run: `python3 -m pytest scripts/tests/ -v`
Expected: all tests PASS (17 tests total across the 3 modules).

- [ ] **Step 2: Confirm working tree is clean**

Run: `git status`
Expected: `nothing to commit, working tree clean`

- [ ] **Step 3: Review `git log`**

Run: `git log --oneline`
Expected: one commit per task, in order, e.g.:
```
Render employee-count choropleth on the map
Add site shell with password gate
Add data-prep CLI and generate published district GeoJSON
Add boundary/count join producing the published GeoJSON
Add xlsx parsing for employee residence data
Add district name canonicalization and count aggregation
Scaffold project: README, test config, dependencies
Add design spec for employee-distribution office-search map
```

---

### Task 9: Publish to GitHub Pages — REQUIRES EXPLICIT USER CONFIRMATION

**Do not run this task's commands until the user has explicitly said to
proceed with creating the repo and pushing.** Creating a public repo and
pushing content is a publishing action per the assistant's operating
rules, distinct from the local work in Tasks 1–8.

**Files:** none (repo/hosting operations only)

- [ ] **Step 1: Create the GitHub repo**

Run:
```bash
gh repo create presco-office-search --public --source=. --remote=origin --push
```
Expected: repo created under `tommyyeh-presco`, local `main` branch pushed,
`origin` remote configured.

- [ ] **Step 2: Enable GitHub Pages from the repo root**

Run:
```bash
gh api repos/tommyyeh-presco/presco-office-search/pages \
  -X POST -f "source[branch]=main" -f "source[path]=/"
```
Expected: `201 Created` (or `409` if Pages is already enabled, which is
fine — it means it's already configured).

- [ ] **Step 3: Verify the live site**

Run:
```bash
curl -s -o /dev/null -w "%{http_code}\n" https://tommyyeh-presco.github.io/presco-office-search/
```
Expected: `200` (may take a minute or two after first enabling Pages —
retry if it initially 404s).

Then open `https://tommyyeh-presco.github.io/presco-office-search/` in a
browser and confirm the password gate and map both work exactly as in the
Task 6/7 local verification.
