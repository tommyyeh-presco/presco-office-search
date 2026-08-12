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
