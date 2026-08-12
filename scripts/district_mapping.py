"""Canonicalization and aggregation of raw employee-address rows into
standardized (county, district) keys used by the map.

The same lookup table is used to fix two independent problems:
  1. Rows in the raw spreadsheet where the "district" is actually a road
     name, not a real district (address-parsing errors upstream).
  2. Legacy pre-2014 Taoyuan County (縣) town names, which show up both
     in older rows of the raw spreadsheet AND in the vendored boundary
     GeoJSON (which predates Taoyuan's 2014 upgrade to a special
     municipality). Applying the same fix table to both sides means they
     always join on the same canonical key.
"""

CANONICAL_FIXES = {
    # Mis-parsed road names -> the district they actually belong to.
    ("台北市", "內湖路"): ("台北市", "內湖區"),
    ("基隆市", "碇內街"): ("基隆市", "暖暖區"),

    # Legacy Taoyuan County (縣) town names -> modern Taoyuan City (市)
    # district names. Covers all 13 former townships/county-administered
    # cities so every Taoyuan boundary feature resolves correctly, even
    # the ones with 0 employees today.
    ("桃園縣", "中壢市"): ("桃園市", "中壢區"),
    ("桃園縣", "桃園市"): ("桃園市", "桃園區"),
    ("桃園縣", "楊梅鎮"): ("桃園市", "楊梅區"),
    ("桃園縣", "平鎮市"): ("桃園市", "平鎮區"),
    ("桃園縣", "觀音鄉"): ("桃園市", "觀音區"),
    ("桃園縣", "大溪鎮"): ("桃園市", "大溪區"),
    ("桃園縣", "復興鄉"): ("桃園市", "復興區"),
    ("桃園縣", "八德市"): ("桃園市", "八德區"),
    ("桃園縣", "新屋鄉"): ("桃園市", "新屋區"),
    ("桃園縣", "龍潭鄉"): ("桃園市", "龍潭區"),
    ("桃園縣", "大園鄉"): ("桃園市", "大園區"),
    ("桃園縣", "龜山鄉"): ("桃園市", "龜山區"),
    ("桃園縣", "蘆竹鄉"): ("桃園市", "蘆竹區"),
}


def canonicalize(county, district):
    """Return (canonical_county, canonical_district) for a raw
    (county, district) pair. Pairs with no known issue pass through
    unchanged."""
    return CANONICAL_FIXES.get((county, district), (county, district))


def aggregate_counts(rows):
    """rows: iterable of (county, district, count) raw tuples.
    Returns dict {(canonical_county, canonical_district): total_count},
    summing counts that fold into the same canonical district."""
    totals = {}
    for county, district, count in rows:
        key = canonicalize(county, district)
        totals[key] = totals.get(key, 0) + count
    return totals
