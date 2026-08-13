#!/usr/bin/env python3
"""Build data/listings.geo.json from the raw JSON produced by
scripts/fetch_591_listings.js.

Usage:
    node scripts/fetch_591_listings.js > scripts/.cache/591_listings_raw.json
    python3 scripts/build_listings.py
"""
import argparse
import json
from pathlib import Path

from listings_data import build_listings_geojson

DEFAULT_INPUT = Path(__file__).resolve().parent / ".cache" / "591_listings_raw.json"
DEFAULT_OUTPUT = Path(__file__).resolve().parent.parent / "data" / "listings.geo.json"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", default=str(DEFAULT_INPUT))
    parser.add_argument("--output", default=str(DEFAULT_OUTPUT))
    args = parser.parse_args()

    raw_listings = json.loads(Path(args.input).read_text(encoding="utf-8"))
    result = build_listings_geojson(raw_listings)

    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(
        json.dumps(result, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )

    total_units = sum(len(f["properties"]["units"]) for f in result["features"])
    skipped = len(raw_listings) - total_units
    print(
        f"Wrote {len(result['features'])} pins, {total_units} units "
        f"(from {len(raw_listings)} fetched listings, {skipped} missing "
        f"coords/deduped) to {output_path}"
    )


if __name__ == "__main__":
    main()
