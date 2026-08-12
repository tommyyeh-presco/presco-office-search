"""Build the published choropleth GeoJSON by joining boundary polygons
with per-district employee counts."""

from district_mapping import canonicalize

TARGET_COUNTIES = {"台北市", "新北市", "基隆市", "宜蘭縣", "桃園縣"}
COORD_DECIMALS = 5

# Some districts (e.g. Keelung's 中正區, which administers the disputed
# Diaoyutai Islands ~120km offshore) have boundary data that includes
# small outlying-island polygons far from the Northern Taiwan mainland.
# Left in, they blow out the map's auto-fit bounding box to include open
# ocean, so any sub-polygon entirely east of this longitude is dropped.
MAINLAND_LON_MAX = 122.3


def _round_coords(coords):
    if isinstance(coords[0], (int, float)):
        return [round(c, COORD_DECIMALS) for c in coords]
    return [_round_coords(c) for c in coords]


def _polygon_is_mainland(polygon_rings):
    exterior_ring = polygon_rings[0]
    return all(lon <= MAINLAND_LON_MAX for lon, lat in exterior_ring)


def _drop_outlying_islands(geometry):
    if geometry["type"] == "Polygon":
        return geometry
    mainland_polygons = [p for p in geometry["coordinates"] if _polygon_is_mainland(p)]
    if len(mainland_polygons) == 1:
        return {"type": "Polygon", "coordinates": mainland_polygons[0]}
    return {"type": "MultiPolygon", "coordinates": mainland_polygons}


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
        geometry = _drop_outlying_islands(feature["geometry"])

        features.append({
            "type": "Feature",
            "geometry": {
                "type": geometry["type"],
                "coordinates": _round_coords(geometry["coordinates"]),
            },
            "properties": {
                "county": county,
                "name": district,
                "count": count,
            },
        })

    return {"type": "FeatureCollection", "features": features}
