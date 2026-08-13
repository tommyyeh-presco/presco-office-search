"""Dissolve per-district boundaries into one outline polygon per county,
for a visually distinct county-level border overlay on the map.

Adjacent district polygons in the source boundary data don't always share
exact vertices at their common border (they were digitized independently),
which breaks exact-topology unions and leaves slivers of "missing" county
polygon between districts. Buffering out by a small amount before
unioning, then buffering back in by the same amount, closes those gaps
without visibly distorting real geography — verified against the actual
Northern Taiwan boundary data: 0.003 degrees (~330m) is enough to merge
every mainland gap (Taipei and New Taipei both come out as a single
Polygon each) while leaving genuinely separate offshore islands (e.g.
Keelung's Diaoyutai holdings, Yilan's Guishan Island) as their own pieces
of the resulting MultiPolygon, which is geographically correct.
"""

from shapely.geometry import mapping, shape
from shapely.ops import unary_union

from district_mapping import canonicalize
from geojson_builder import TARGET_COUNTIES, _drop_outlying_islands, _round_coords

GAP_CLOSING_BUFFER_DEGREES = 0.003


def build_county_boundaries(national_geojson):
    """national_geojson: parsed GeoJSON dict (g0v/twgeojson town-level).

    Returns a GeoJSON FeatureCollection with one dissolved (Multi)Polygon
    per target county."""
    geometries_by_county = {}
    for feature in national_geojson["features"]:
        raw_county = feature["properties"]["COUNTYNAME"]
        raw_district = feature["properties"]["TOWNNAME"]

        if raw_county not in TARGET_COUNTIES:
            continue
        if raw_district.endswith("(海)"):
            continue

        county, _ = canonicalize(raw_county, raw_district)
        geometry = _drop_outlying_islands(feature["geometry"])
        geometries_by_county.setdefault(county, []).append(shape(geometry))

    features = []
    for county, geometries in geometries_by_county.items():
        buffered = [g.buffer(GAP_CLOSING_BUFFER_DEGREES) for g in geometries]
        merged = unary_union(buffered).buffer(-GAP_CLOSING_BUFFER_DEGREES)
        geometry = mapping(merged)

        features.append({
            "type": "Feature",
            "geometry": {
                "type": geometry["type"],
                "coordinates": _round_coords(_to_lists(geometry["coordinates"])),
            },
            "properties": {"county": county},
        })

    return {"type": "FeatureCollection", "features": features}


def _to_lists(coords):
    """shapely's mapping() returns nested tuples; JSON needs lists."""
    if isinstance(coords[0], (int, float)):
        return list(coords)
    return [_to_lists(c) for c in coords]
