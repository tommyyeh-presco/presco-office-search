"""Parse the raw employee residence xlsx into (county, district, count)
tuples, skipping subtotal, grand-total, and invalid-address rows."""

import openpyxl


def parse_xlsx(path):
    wb = openpyxl.load_workbook(path, data_only=True)
    ws = wb.worksheets[0]

    current_county = None
    rows = []
    for county, district, count in ws.iter_rows(min_row=2, values_only=True):
        if county is not None and "合計" not in str(county) and county != "總計":
            current_county = county
        if district is None:
            continue
        if current_county is None or current_county == "異常訊息":
            continue
        rows.append((current_county, district, count))
    return rows
