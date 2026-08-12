from district_mapping import canonicalize, aggregate_counts


def test_canonicalize_passthrough_for_normal_district():
    assert canonicalize("台北市", "大安區") == ("台北市", "大安區")


def test_canonicalize_folds_neihu_road_into_neihu_district():
    assert canonicalize("台北市", "內湖路") == ("台北市", "內湖區")


def test_canonicalize_folds_dingnei_street_into_nuannuan_district():
    assert canonicalize("基隆市", "碇內街") == ("基隆市", "暖暖區")


def test_canonicalize_maps_legacy_taoyuan_county_town_to_modern_district():
    assert canonicalize("桃園縣", "平鎮市") == ("桃園市", "平鎮區")
    assert canonicalize("桃園縣", "觀音鄉") == ("桃園市", "觀音區")
    assert canonicalize("桃園縣", "中壢市") == ("桃園市", "中壢區")


def test_canonicalize_modern_taoyuan_district_passes_through():
    assert canonicalize("桃園市", "中壢區") == ("桃園市", "中壢區")


def test_aggregate_counts_sums_rows_that_fold_into_same_district():
    rows = [
        ("台北市", "內湖區", 12),
        ("台北市", "內湖路", 1),
    ]
    assert aggregate_counts(rows) == {("台北市", "內湖區"): 13}


def test_aggregate_counts_keeps_distinct_districts_separate():
    rows = [
        ("台北市", "大安區", 12),
        ("台北市", "中山區", 15),
    ]
    assert aggregate_counts(rows) == {
        ("台北市", "大安區"): 12,
        ("台北市", "中山區"): 15,
    }


def test_aggregate_counts_merges_legacy_and_modern_taoyuan_labels():
    rows = [
        ("桃園市", "中壢區", 1),
        ("桃園縣", "中壢市", 2),
    ]
    assert aggregate_counts(rows) == {("桃園市", "中壢區"): 3}
