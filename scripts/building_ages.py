"""Attach externally-researched building construction-year data to
listing pins, matched by community_name.

Building age isn't available from 591 itself (verified empty across
every commercial listing sampled). This is a small, manually curated
dataset built from web research (see data/building_ages.json), not a
deterministic pipeline output — only buildings with a name specific
enough to identify uniquely are covered (~90 of ~370 pins); the rest
report a generic area/street description that can't be reliably
matched to one physical building, so they're left without an age
rather than guessed at.
"""
from datetime import datetime


def attach_building_ages(geojson, ages_by_name, current_year=None):
    """ages_by_name: dict {building_name: {"year": int, "confidence": str,
    "source": str}}, e.g. loaded from data/building_ages.json.

    Returns a new GeoJSON dict; features whose community_name matches a
    key with a known year get a "building_age" property with the
    computed age. Features with no match, or a match with no year
    (not found), are left unchanged."""
    year_now = current_year or datetime.now().year
    features = []
    for feature in geojson["features"]:
        name = feature["properties"].get("community_name", "")
        info = ages_by_name.get(name)
        properties = dict(feature["properties"])
        if info and info.get("year"):
            properties["building_age"] = {
                "year": info["year"],
                "age_years": year_now - info["year"],
                "confidence": info.get("confidence", "low"),
                "source": info.get("source", ""),
            }
        features.append({**feature, "properties": properties})
    return {**geojson, "features": features}
