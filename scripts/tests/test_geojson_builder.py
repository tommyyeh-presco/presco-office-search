from geojson_builder import build_geojson


def _feature(county, town, town_suffix=""):
    return {
        "type": "Feature",
        "properties": {"COUNTYNAME": county, "TOWNNAME": town + town_suffix},
        "geometry": {"type": "Polygon", "coordinates": [[[121.123456, 25.123456]]]},
    }


def test_build_geojson_attaches_counts_by_canonical_key():
    national = {"type": "FeatureCollection", "features": [_feature("台北市", "大安區")]}
    counts = {("台北市", "大安區"): 12}
    result = build_geojson(national, counts)
    assert result["features"][0]["properties"] == {
        "county": "台北市", "name": "大安區", "count": 12,
    }


def test_build_geojson_defaults_to_zero_for_districts_with_no_employees():
    national = {"type": "FeatureCollection", "features": [_feature("宜蘭縣", "南澳鄉")]}
    result = build_geojson(national, {})
    assert result["features"][0]["properties"]["count"] == 0


def test_build_geojson_excludes_counties_outside_target_scope():
    national = {"type": "FeatureCollection", "features": [_feature("新竹市", "東區")]}
    result = build_geojson(national, {})
    assert result["features"] == []


def test_build_geojson_drops_sea_boundary_duplicate_features():
    national = {"type": "FeatureCollection", "features": [
        _feature("基隆市", "中山區"),
        _feature("基隆市", "中山區", town_suffix="(海)"),
    ]}
    counts = {("基隆市", "中山區"): 4}
    result = build_geojson(national, counts)
    assert len(result["features"]) == 1
    assert result["features"][0]["properties"]["name"] == "中山區"


def test_build_geojson_canonicalizes_legacy_taoyuan_boundary_names():
    national = {"type": "FeatureCollection", "features": [_feature("桃園縣", "中壢市")]}
    counts = {("桃園市", "中壢區"): 3}
    result = build_geojson(national, counts)
    assert result["features"][0]["properties"] == {
        "county": "桃園市", "name": "中壢區", "count": 3,
    }


def test_build_geojson_rounds_coordinates():
    national = {"type": "FeatureCollection", "features": [_feature("台北市", "大安區")]}
    result = build_geojson(national, {})
    assert result["features"][0]["geometry"]["coordinates"] == [[[121.12346, 25.12346]]]
