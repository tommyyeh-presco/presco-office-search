from listings_data import build_listings_geojson


def _listing(
    id,
    lat=25.03,
    lng=121.55,
    floor_name="5F/10F",
    area=600.0,
    type_=1,
    address="大安區-敦化南路",
    community_name="測試大樓",
):
    return {
        "id": id,
        "url": f"https://business.591.com.tw/rent/{id}",
        "title": f"listing {id}",
        "type": type_,
        "price": "100,000",
        "price_unit": "元/月",
        "price_per": 166.7,
        "price_per_unit": "元/坪/月",
        "floor_name": floor_name,
        "area": area,
        "area_name": f"{area}坪",
        "community_name": community_name,
        "community_id": 1,
        "address": address,
        "tags": [],
        "lat": lat,
        "lng": lng,
    }


def test_build_listings_geojson_one_feature_per_location():
    raw = [_listing(1, floor_name="3F/10F"), _listing(2, floor_name="7F/10F")]
    result = build_listings_geojson(raw)
    assert len(result["features"]) == 1
    assert len(result["features"][0]["properties"]["units"]) == 2


def test_build_listings_geojson_different_floors_kept_as_separate_units():
    raw = [_listing(1, floor_name="3F/10F"), _listing(2, floor_name="5F/10F")]
    result = build_listings_geojson(raw)
    floors = {u["floor_name"] for u in result["features"][0]["properties"]["units"]}
    assert floors == {"3F/10F", "5F/10F"}


def test_build_listings_geojson_drops_exact_duplicate_postings():
    raw = [
        _listing(1, floor_name="5F/10F", area=600.0),
        _listing(2, floor_name="5F/10F", area=600.0),
    ]
    result = build_listings_geojson(raw)
    assert len(result["features"][0]["properties"]["units"]) == 1


def test_build_listings_geojson_drops_same_floor_duplicates_with_slightly_different_area():
    # Different brokers re-listing the same floor commonly quote slightly
    # different areas (e.g. 327坪 vs 326.7坪) — still the same unit.
    raw = [
        _listing(1, floor_name="24F/27F", area=327.0),
        _listing(2, floor_name="24F/27F", area=326.7),
    ]
    result = build_listings_geojson(raw)
    assert len(result["features"][0]["properties"]["units"]) == 1


def test_build_listings_geojson_keeps_same_area_different_floor_as_separate_units():
    raw = [
        _listing(1, floor_name="5F/10F", area=600.0),
        _listing(2, floor_name="6F/10F", area=600.0),
    ]
    result = build_listings_geojson(raw)
    assert len(result["features"][0]["properties"]["units"]) == 2


def test_build_listings_geojson_separate_locations_get_separate_pins():
    raw = [_listing(1, lat=25.03, lng=121.55), _listing(2, lat=25.10, lng=121.60)]
    result = build_listings_geojson(raw)
    assert len(result["features"]) == 2


def test_build_listings_geojson_extracts_district_from_address():
    raw = [_listing(1, address="中山區-敬業二路")]
    result = build_listings_geojson(raw)
    assert result["features"][0]["properties"]["district"] == "中山區"


def test_build_listings_geojson_skips_listings_without_coordinates():
    listing = _listing(1)
    listing["lat"] = None
    listing["lng"] = None
    result = build_listings_geojson([listing])
    assert result["features"] == []
