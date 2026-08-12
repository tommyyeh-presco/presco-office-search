# Presco Office Search — Employee Distribution Map

Interactive map of where Presco employees live across Northern Taiwan
(Taipei, New Taipei, Taoyuan, Keelung, Yilan), built as the first input
to an office-location proposal.

## Setup

```bash
python3 -m venv .venv
.venv/bin/pip install -r scripts/requirements.txt
```

## Regenerating the map data

The published `data/districts.geo.json` is generated from the raw
employee residence spreadsheet — it is not committed by hand.

```bash
.venv/bin/python3 scripts/prepare_data.py --xlsx "/path/to/employee_residence.xlsx"
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
.venv/bin/python3 -m pytest scripts/tests/ -v
```
