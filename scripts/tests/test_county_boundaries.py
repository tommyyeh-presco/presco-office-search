from county_boundaries import build_county_boundaries


def _feature(county, town, ring, town_suffix=""):
    return {
        "type": "Feature",
        "properties": {"COUNTYNAME": county, "TOWNNAME": town + town_suffix},
        "geometry": {"type": "Polygon", "coordinates": [ring]},
    }


def test_build_county_boundaries_merges_adjacent_districts_with_tiny_gap():
    # Two unit squares that would share an edge at x=1, but with a
    # deliberate 0.0001-degree gap (smaller than the gap-closing buffer),
    # mimicking independently-digitized district boundaries that don't
    # share exact vertices.
    square_a = [[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]
    square_b = [[1.0001, 0], [2, 0], [2, 1], [1.0001, 1], [1.0001, 0]]
    national = {"type": "FeatureCollection", "features": [
        _feature("台北市", "甲區", square_a),
        _feature("台北市", "乙區", square_b),
    ]}
    result = build_county_boundaries(national)
    assert len(result["features"]) == 1
    assert result["features"][0]["properties"] == {"county": "台北市"}
    assert result["features"][0]["geometry"]["type"] == "Polygon"


def test_build_county_boundaries_keeps_counties_separate():
    national = {"type": "FeatureCollection", "features": [
        _feature("台北市", "甲區", [[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]),
        _feature("新北市", "乙區", [[5, 5], [6, 5], [6, 6], [5, 6], [5, 5]]),
    ]}
    result = build_county_boundaries(national)
    counties = {f["properties"]["county"] for f in result["features"]}
    assert counties == {"台北市", "新北市"}


def test_build_county_boundaries_excludes_counties_outside_target_scope():
    national = {"type": "FeatureCollection", "features": [
        _feature("新竹市", "東區", [[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]),
    ]}
    result = build_county_boundaries(national)
    assert result["features"] == []


def test_build_county_boundaries_drops_sea_boundary_duplicate_features():
    square = [[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]
    national = {"type": "FeatureCollection", "features": [
        _feature("基隆市", "中山區", square),
        _feature("基隆市", "中山區", square, town_suffix="(海)"),
    ]}
    result = build_county_boundaries(national)
    assert len(result["features"]) == 1


def test_build_county_boundaries_canonicalizes_legacy_taoyuan_names():
    national = {"type": "FeatureCollection", "features": [
        _feature("桃園縣", "中壢市", [[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]),
    ]}
    result = build_county_boundaries(national)
    assert result["features"][0]["properties"] == {"county": "桃園市"}
