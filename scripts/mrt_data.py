"""Build a GeoJSON overlay of Northern Taiwan's metro/light-rail network
(Taipei/New Taipei Metro, Taoyuan Airport MRT, Danhai LRT, Ankeng LRT)
from an Overpass API query result.

Each OSM `route=subway`/`route=light_rail` relation becomes one
MultiLineString feature (one line segment per way member — segments
don't need to be stitched into an ordered path since they're rendered
independently, not as a single directional polyline).
"""

# Relations that come back from the Overpass query below but aren't real
# passenger metro/light-rail lines: the airport terminal's internal
# automated people-mover, and a depot/yard track.
EXCLUDED_NAME_SUBSTRINGS = ["電車運輸", "機廠"]

FALLBACK_COLOUR = "#888888"

OVERPASS_QUERY = """
[out:json][timeout:90];
(
  relation["route"="subway"](24.2,120.9,25.7,122.2);
  relation["route"="light_rail"](24.2,120.9,25.7,122.2);
);
out geom;
""".strip()


def _is_excluded(name):
    return any(s in name for s in EXCLUDED_NAME_SUBSTRINGS)


def build_mrt_geojson(overpass_result):
    """overpass_result: parsed JSON from the Overpass `out geom;` query
    above (a dict with an "elements" list of relations, each with
    "members" whose way members carry an inline "geometry" list).

    Returns a GeoJSON FeatureCollection of MultiLineString features, one
    per route relation, with properties {name, colour, ref}."""
    features = []
    for element in overpass_result["elements"]:
        if element["type"] != "relation":
            continue

        tags = element.get("tags", {})
        name = tags.get("name", "")
        if _is_excluded(name):
            continue

        segments = []
        for member in element.get("members", []):
            geometry = member.get("geometry")
            if not geometry:
                continue
            segments.append([[point["lon"], point["lat"]] for point in geometry])

        if not segments:
            continue

        features.append({
            "type": "Feature",
            "geometry": {
                "type": "MultiLineString",
                "coordinates": segments,
            },
            "properties": {
                "name": name,
                "colour": tags.get("colour") or FALLBACK_COLOUR,
                "ref": tags.get("ref", ""),
            },
        })

    return {"type": "FeatureCollection", "features": features}
