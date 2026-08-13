"""Build a GeoJSON pin layer from raw 591.com.tw commercial listing data.

Listings at the same location (building) are collapsed into one pin with
a list of units, so different floors of the same building show as
separate units under one pin rather than as separate overlapping pins.
Near-duplicate re-postings of the same physical unit are dropped.
"""

# ~11m at this latitude — listings in the same building share the exact
# same lat/lng from 591's own building-level geocoding, so this only
# groups genuinely co-located listings, not merely nearby ones.
COORD_GROUP_DECIMALS = 4


def _location_key(listing):
    return (round(listing["lat"], COORD_GROUP_DECIMALS), round(listing["lng"], COORD_GROUP_DECIMALS))


def _unit_key(listing):
    """Identifies likely-duplicate postings of the same physical unit:
    same location, same floor, same listing type (rent/sale). Different
    brokers re-listing the same floor commonly quote slightly different
    areas (e.g. 327坪 vs 326.7坪), so area isn't part of the key — two
    postings on the same floor of the same building are treated as the
    same unit."""
    return (_location_key(listing), listing.get("floor_name"), listing.get("type"))


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


def build_listings_geojson(raw_listings):
    """raw_listings: list of dicts from the 591 list-page API (see
    scripts/fetch_591_listings.js), each augmented with lat/lng from its
    detail page (or None if that fetch failed).

    Returns a GeoJSON FeatureCollection of Point features, one per unique
    location, each with a "units" property listing every distinct unit
    posted at that location."""
    seen_units = set()
    groups = {}

    for listing in raw_listings:
        if listing.get("lat") is None or listing.get("lng") is None:
            continue

        key = _unit_key(listing)
        if key in seen_units:
            continue
        seen_units.add(key)

        loc_key = _location_key(listing)
        group = groups.setdefault(loc_key, {
            "lat": listing["lat"],
            "lng": listing["lng"],
            "address": listing.get("address", ""),
            "community_name": listing.get("community_name", ""),
            "units": [],
        })
        group["units"].append(_to_unit(listing))

    features = []
    for group in groups.values():
        features.append({
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": [group["lng"], group["lat"]]},
            "properties": {
                "district": _district_from_address(group["address"]),
                "address": group["address"],
                "community_name": group["community_name"],
                "units": group["units"],
            },
        })

    return {"type": "FeatureCollection", "features": features}
