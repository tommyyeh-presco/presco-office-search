from building_ages import attach_building_ages


def _geojson(features):
    return {"type": "FeatureCollection", "features": features}


def _feature(community_name):
    return {
        "type": "Feature",
        "geometry": {"type": "Point", "coordinates": [121.5, 25.0]},
        "properties": {"community_name": community_name, "units": []},
    }


def test_attach_building_ages_computes_age_from_year():
    geojson = _geojson([_feature("遠雄金融中心")])
    ages = {"遠雄金融中心": {"year": 2013, "confidence": "high", "source": "https://example.com"}}
    result = attach_building_ages(geojson, ages, current_year=2026)
    age = result["features"][0]["properties"]["building_age"]
    assert age == {"year": 2013, "age_years": 13, "confidence": "high", "source": "https://example.com"}


def test_attach_building_ages_leaves_unmatched_features_unchanged():
    geojson = _geojson([_feature("未知大樓")])
    result = attach_building_ages(geojson, {}, current_year=2026)
    assert "building_age" not in result["features"][0]["properties"]


def test_attach_building_ages_skips_entries_without_a_year():
    # A building we looked up but couldn't confidently find a year for.
    geojson = _geojson([_feature("查無資料大樓")])
    ages = {"查無資料大樓": {"year": None, "confidence": "none", "source": ""}}
    result = attach_building_ages(geojson, ages, current_year=2026)
    assert "building_age" not in result["features"][0]["properties"]


def test_attach_building_ages_does_not_mutate_input():
    geojson = _geojson([_feature("遠雄金融中心")])
    ages = {"遠雄金融中心": {"year": 2013, "confidence": "high", "source": "x"}}
    attach_building_ages(geojson, ages, current_year=2026)
    assert "building_age" not in geojson["features"][0]["properties"]
