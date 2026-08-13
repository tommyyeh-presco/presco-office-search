from mrt_data import build_mrt_geojson


def _relation(name, colour="#FF0000", ref="R", members=None):
    return {
        "type": "relation",
        "tags": {"name": name, "colour": colour, "ref": ref},
        "members": members if members is not None else [
            {
                "type": "way",
                "geometry": [
                    {"lat": 25.03, "lon": 121.51},
                    {"lat": 25.04, "lon": 121.52},
                ],
            }
        ],
    }


def test_build_mrt_geojson_converts_relation_to_multilinestring():
    overpass_result = {"elements": [_relation("淡水信義線")]}
    result = build_mrt_geojson(overpass_result)
    assert len(result["features"]) == 1
    feature = result["features"][0]
    assert feature["geometry"]["type"] == "MultiLineString"
    assert feature["geometry"]["coordinates"] == [[[121.51, 25.03], [121.52, 25.04]]]
    assert feature["properties"] == {"name": "淡水信義線", "colour": "#FF0000", "ref": "R"}


def test_build_mrt_geojson_one_segment_per_way_member():
    members = [
        {"type": "way", "geometry": [{"lat": 25.0, "lon": 121.5}, {"lat": 25.1, "lon": 121.6}]},
        {"type": "way", "geometry": [{"lat": 25.1, "lon": 121.6}, {"lat": 25.2, "lon": 121.7}]},
    ]
    overpass_result = {"elements": [_relation("板南線", members=members)]}
    result = build_mrt_geojson(overpass_result)
    assert len(result["features"][0]["geometry"]["coordinates"]) == 2


def test_build_mrt_geojson_excludes_airport_shuttle_and_depot_tracks():
    overpass_result = {"elements": [
        _relation("桃園國際機場旅客自動電車運輸系統 (往程)"),
        _relation("新北捷運淡海機廠"),
        _relation("淡水信義線"),
    ]}
    result = build_mrt_geojson(overpass_result)
    names = [f["properties"]["name"] for f in result["features"]]
    assert names == ["淡水信義線"]


def test_build_mrt_geojson_falls_back_to_default_colour_when_missing():
    relation = _relation("測試線", colour=None)
    del relation["tags"]["colour"]
    overpass_result = {"elements": [relation]}
    result = build_mrt_geojson(overpass_result)
    assert result["features"][0]["properties"]["colour"] == "#888888"


def test_build_mrt_geojson_skips_non_relation_elements():
    overpass_result = {"elements": [
        {"type": "node", "lat": 25.0, "lon": 121.5},
        _relation("淡水信義線"),
    ]}
    result = build_mrt_geojson(overpass_result)
    assert len(result["features"]) == 1
