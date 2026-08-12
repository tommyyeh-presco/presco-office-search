import openpyxl

from xlsx_parser import parse_xlsx


def _make_workbook(path, rows):
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.append(("縣市", "區域", "合計"))
    for row in rows:
        ws.append(row)
    wb.save(path)


def test_parse_xlsx_forward_fills_county_for_merged_cells(tmp_path):
    path = tmp_path / "sample.xlsx"
    _make_workbook(path, [
        ("台北市", "士林區", 8),
        (None, "大同區", 3),
        ("台北市 合計", None, 11),
    ])
    assert parse_xlsx(path) == [
        ("台北市", "士林區", 8),
        ("台北市", "大同區", 3),
    ]


def test_parse_xlsx_skips_invalid_address_group(tmp_path):
    path = tmp_path / "sample.xlsx"
    _make_workbook(path, [
        ("台北市", "士林區", 8),
        ("台北市 合計", None, 8),
        ("異常訊息", None, 8),
        ("異常訊息 合計", None, 8),
        ("總計", None, 8),
    ])
    assert parse_xlsx(path) == [("台北市", "士林區", 8)]


def test_parse_xlsx_handles_multiple_county_groups(tmp_path):
    path = tmp_path / "sample.xlsx"
    _make_workbook(path, [
        ("台北市", "士林區", 8),
        ("台北市 合計", None, 8),
        ("宜蘭縣", "宜蘭市", 1),
        (None, "礁溪鄉", 1),
        ("宜蘭縣 合計", None, 2),
        ("總計", None, 10),
    ])
    assert parse_xlsx(path) == [
        ("台北市", "士林區", 8),
        ("宜蘭縣", "宜蘭市", 1),
        ("宜蘭縣", "礁溪鄉", 1),
    ]
