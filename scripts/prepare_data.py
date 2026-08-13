#!/usr/bin/env python3
"""Build data/districts.geo.json from the raw employee xlsx and the
vendored national town-boundary GeoJSON.

Usage:
    python3 scripts/prepare_data.py --xlsx "/path/to/employee_residence.xlsx"

Downloads and caches the national boundary GeoJSON on first run.
"""
import argparse
import json
import urllib.parse
import urllib.request
from pathlib import Path

from county_boundaries import build_county_boundaries
from district_mapping import aggregate_counts
from geojson_builder import build_geojson
from mrt_data import OVERPASS_QUERY, build_mrt_geojson
from xlsx_parser import parse_xlsx

NATIONAL_GEOJSON_URL = (
    "https://raw.githubusercontent.com/g0v/twgeojson/master/json/twTown1982.geo.json"
)
OVERPASS_URL = "https://overpass-api.de/api/interpreter"
DEFAULT_CACHE = Path(__file__).resolve().parent / ".cache" / "twTown1982.geo.json"
DEFAULT_MRT_CACHE = Path(__file__).resolve().parent / ".cache" / "mrt_overpass.json"
DEFAULT_OUTPUT = Path(__file__).resolve().parent.parent / "data" / "districts.geo.json"
DEFAULT_COUNTY_OUTPUT = Path(__file__).resolve().parent.parent / "data" / "counties.geo.json"
DEFAULT_MRT_OUTPUT = Path(__file__).resolve().parent.parent / "data" / "mrt.geo.json"


def load_national_geojson(cache_path):
    cache_path = Path(cache_path)
    if not cache_path.exists():
        cache_path.parent.mkdir(parents=True, exist_ok=True)
        print(f"Downloading {NATIONAL_GEOJSON_URL} -> {cache_path}")
        urllib.request.urlretrieve(NATIONAL_GEOJSON_URL, cache_path)
    return json.loads(cache_path.read_text(encoding="utf-8"))


def load_overpass_mrt_result(cache_path):
    cache_path = Path(cache_path)
    if not cache_path.exists():
        cache_path.parent.mkdir(parents=True, exist_ok=True)
        print(f"Querying {OVERPASS_URL} for metro/light-rail routes -> {cache_path}")
        data = urllib.parse.urlencode({"data": OVERPASS_QUERY}).encode("utf-8")
        request = urllib.request.Request(OVERPASS_URL, data=data)
        with urllib.request.urlopen(request, timeout=120) as response:
            cache_path.write_bytes(response.read())
    return json.loads(cache_path.read_text(encoding="utf-8"))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--xlsx", required=True, help="Path to the raw employee residence xlsx")
    parser.add_argument("--output", default=str(DEFAULT_OUTPUT))
    parser.add_argument("--county-output", default=str(DEFAULT_COUNTY_OUTPUT))
    parser.add_argument("--mrt-output", default=str(DEFAULT_MRT_OUTPUT))
    parser.add_argument("--geojson-cache", default=str(DEFAULT_CACHE))
    parser.add_argument("--mrt-cache", default=str(DEFAULT_MRT_CACHE))
    args = parser.parse_args()

    rows = parse_xlsx(args.xlsx)
    counts = aggregate_counts(rows)
    national = load_national_geojson(args.geojson_cache)
    result = build_geojson(national, counts)
    counties = build_county_boundaries(national)
    overpass_result = load_overpass_mrt_result(args.mrt_cache)
    mrt = build_mrt_geojson(overpass_result)

    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(
        json.dumps(result, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )

    county_output_path = Path(args.county_output)
    county_output_path.parent.mkdir(parents=True, exist_ok=True)
    county_output_path.write_text(
        json.dumps(counties, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )

    mrt_output_path = Path(args.mrt_output)
    mrt_output_path.parent.mkdir(parents=True, exist_ok=True)
    mrt_output_path.write_text(
        json.dumps(mrt, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )

    total = sum(f["properties"]["count"] for f in result["features"])
    print(f"Wrote {len(result['features'])} districts, {total} total employees, to {output_path}")
    print(f"Wrote {len(counties['features'])} county boundaries to {county_output_path}")
    print(f"Wrote {len(mrt['features'])} metro/light-rail lines to {mrt_output_path}")


if __name__ == "__main__":
    main()
