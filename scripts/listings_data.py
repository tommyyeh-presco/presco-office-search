"""Build a GeoJSON pin layer from raw 591.com.tw commercial listing data.

Listings at the same location (building) are collapsed into one pin with
a list of units, so different floors of the same building show as
separate units under one pin rather than as separate overlapping pins.
Near-duplicate re-postings of the same physical unit are dropped.
"""
import math

# Different brokers listing the same building commonly pin slightly
# different points on the map (each posting is geocoded independently,
# not from one canonical building location) — two confirmed-same-building
# listings in the real data sit 28m apart. Coordinate rounding has hard
# edge effects (two points a couple meters apart can round to different
# buckets depending on where the boundary falls), so locations are
# clustered by actual distance instead: any listing within this radius of
# another (transitively) is treated as the same building. 50m comfortably
# covers that real-world variance without reaching into the 100m+ range
# where distinct nearby buildings start.
COORD_GROUP_RADIUS_METERS = 50
EARTH_RADIUS_METERS = 6371000


def _distance_meters(a, b):
    mean_lat = math.radians((a["lat"] + b["lat"]) / 2)
    dx = math.radians(b["lng"] - a["lng"]) * math.cos(mean_lat) * EARTH_RADIUS_METERS
    dy = math.radians(b["lat"] - a["lat"]) * EARTH_RADIUS_METERS
    return math.hypot(dx, dy)


def _cluster_by_proximity(listings, radius_meters):
    """Union-find clustering: listings within radius_meters of each other,
    transitively, form one cluster. Returns a list of clusters (each a
    list of listings)."""
    parent = list(range(len(listings)))

    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    def union(i, j):
        ri, rj = find(i), find(j)
        if ri != rj:
            parent[ri] = rj

    for i in range(len(listings)):
        for j in range(i + 1, len(listings)):
            if _distance_meters(listings[i], listings[j]) <= radius_meters:
                union(i, j)

    clusters = {}
    for i in range(len(listings)):
        clusters.setdefault(find(i), []).append(listings[i])
    return list(clusters.values())


def _unit_key(cluster_id, listing):
    """Identifies likely-duplicate postings of the same physical unit:
    same building cluster, same floor, same listing type (rent/sale).
    Different brokers re-listing the same floor commonly quote slightly
    different areas (e.g. 327坪 vs 326.7坪), so area isn't part of the
    key — two postings on the same floor of the same building are
    treated as the same unit."""
    return (cluster_id, listing.get("floor_name"), listing.get("type"))


def _district_from_address(address):
    # e.g. "中山區-敬業二路" -> "中山區"
    return address.split("-")[0] if address else ""


def _to_unit(listing):
    return {
        "id": listing["id"],
        "url": listing["url"],
        "title": listing["title"],
        "type": listing["type"],  # 1 = rent, 2 = sale
        "price": listing.get("price"),
        "price_unit": listing.get("price_unit"),
        "price_per": listing.get("price_per"),
        "price_per_unit": listing.get("price_per_unit"),
        "floor_name": listing.get("floor_name"),
        "area": listing.get("area"),
        "area_name": listing.get("area_name"),
        "tags": listing.get("tags", []),
    }


def _representative_text(listings, field):
    """Prefer a non-empty value, since some postings leave this blank or
    fill it with a generic street-list instead of an actual building
    name."""
    for listing in listings:
        value = listing.get(field)
        if value:
            return value
    return ""


def _representative_community_name(listings):
    """Prefer the community_name from a listing with a non-zero
    community_id — that means 591 linked it to a recognized building
    record, rather than the broker leaving a generic description (e.g.
    "近板新站、大遠百" instead of the building's actual name)."""
    for listing in listings:
        if listing.get("community_id") and listing.get("community_name"):
            return listing["community_name"]
    return _representative_text(listings, "community_name")


def build_listings_geojson(raw_listings):
    """raw_listings: list of dicts from the 591 list-page API (see
    scripts/fetch_591_listings.js), each augmented with lat/lng from its
    detail page (or None if that fetch failed).

    Returns a GeoJSON FeatureCollection of Point features, one per
    building cluster, each with a "units" property listing every
    distinct unit posted at that location."""
    located = [
        listing for listing in raw_listings
        if listing.get("lat") is not None and listing.get("lng") is not None
    ]
    clusters = _cluster_by_proximity(located, COORD_GROUP_RADIUS_METERS)

    features = []
    for cluster_id, cluster in enumerate(clusters):
        seen_units = set()
        units = []
        for listing in cluster:
            key = _unit_key(cluster_id, listing)
            if key in seen_units:
                continue
            seen_units.add(key)
            units.append(_to_unit(listing))

        if not units:
            continue

        lat = sum(listing["lat"] for listing in cluster) / len(cluster)
        lng = sum(listing["lng"] for listing in cluster) / len(cluster)
        address = _representative_text(cluster, "address")

        features.append({
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": [lng, lat]},
            "properties": {
                "district": _district_from_address(address),
                "address": address,
                "community_name": _representative_community_name(cluster),
                "units": units,
            },
        })

    return {"type": "FeatureCollection", "features": features}
