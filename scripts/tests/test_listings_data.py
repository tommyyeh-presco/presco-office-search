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
    community_id=1,
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
        "community_id": community_id,
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


def test_build_listings_geojson_combines_same_building_listings_pinned_slightly_apart():
    # Regression test for a real case: two listings in the same 31-floor
    # building (板橋區 中山路一段, "馥華艾美"), posted by different
    # brokers who each pinned the map slightly differently — 28.3m apart,
    # which used to fall on opposite sides of the old coordinate-rounding
    # boundary and get wrongly treated as separate buildings.
    raw = [
        _listing(21741209, lat=25.0132447, lng=121.4698601, floor_name="10F/31F", area=649.8),
        _listing(21586151, lat=25.0134331, lng=121.4700485, floor_name="8F/31F", area=649.8),
    ]
    result = build_listings_geojson(raw)
    assert len(result["features"]) == 1
    assert len(result["features"][0]["properties"]["units"]) == 2


def test_build_listings_geojson_does_not_merge_buildings_further_than_the_radius():
    raw = [
        _listing(1, lat=25.0132447, lng=121.4698601),
        _listing(2, lat=25.0142447, lng=121.4698601),  # ~111m north
    ]
    result = build_listings_geojson(raw)
    assert len(result["features"]) == 2


def test_build_listings_geojson_clusters_transitively_through_a_chain():
    # A is close to B, B is close to C, but A and C alone would be just
    # outside the radius — proximity clustering should still merge all
    # three via the B <-> A and B <-> C links.
    raw = [
        _listing(1, lat=25.01000, lng=121.55000, floor_name="1F"),
        _listing(2, lat=25.01035, lng=121.55000, floor_name="2F"),  # ~39m from A
        _listing(3, lat=25.01070, lng=121.55000, floor_name="3F"),  # ~39m from B, ~78m from A
    ]
    result = build_listings_geojson(raw)
    assert len(result["features"]) == 1
    assert len(result["features"][0]["properties"]["units"]) == 3


def test_build_listings_geojson_prefers_community_name_with_verified_id():
    # One broker leaves a generic description instead of the building's
    # actual name; the other's posting is linked to a recognized
    # community record (non-zero community_id). Prefer the verified one.
    raw = [
        _listing(1, community_name="近板新站、大遠百", community_id=0),
        _listing(2, community_name="馥華艾美", community_id=3676277),
    ]
    result = build_listings_geojson(raw)
    assert result["features"][0]["properties"]["community_name"] == "馥華艾美"


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
