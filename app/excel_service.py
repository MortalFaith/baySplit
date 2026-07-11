from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from openpyxl import Workbook
import xlrd


ORIGIN_SHEET_CANDIDATES = ("Origin", "origin", "Sheet")
BASE_STATUS = "IE"
BASE_TYPE = "GP"


@dataclass(frozen=True)
class ContainerRecord:
    box_no: str
    ship_slot: str
    bay: str
    deck: str
    holder: str
    size: str
    height: str


@dataclass(frozen=True)
class BayWarning:
    bay: str
    fr_count: int
    oversize_count: int
    track_in_count: int


def analyze_workbook(file_bytes: bytes, filename: str) -> dict[str, Any]:
    workbook = xlrd.open_workbook(file_contents=file_bytes)
    source_sheet = _select_source_sheet(workbook)
    rows = _load_filtered_records(source_sheet)
    warnings = _load_bay_warnings(source_sheet)
    return {
        "session_name": Path(filename).stem,
        "source_sheet": source_sheet.name,
        "records": rows,
        "warnings": warnings,
    }


def load_sample_workbook(path: Path) -> dict[str, Any]:
    return analyze_workbook(path.read_bytes(), path.name)


def build_dashboard_payload(
    records: list[ContainerRecord],
    warnings: dict[str, BayWarning],
    session_name: str,
    source_sheet: str,
    active_holders: bool,
    active_decks: bool,
    active_heights: bool,
    active_sizes: bool,
    selected_holders: set[str] | None = None,
    selected_decks: set[str] | None = None,
    selected_heights: set[str] | None = None,
    selected_sizes: set[str] | None = None,
) -> dict[str, Any]:
    available_holders = sorted({record.holder for record in records})
    available_decks = [value for value in ("舱上", "舱下", "未知") if any(r.deck == value for r in records)]
    available_heights = sorted({record.height for record in records})
    available_sizes = sorted({record.size for record in records}, key=_natural_order)

    holders = _resolve_selected_values(available_holders, active_holders, selected_holders)
    decks = _resolve_selected_values(available_decks, active_decks, selected_decks)
    heights = _resolve_selected_values(available_heights, active_heights, selected_heights)
    sizes = _resolve_selected_values(available_sizes, active_sizes, selected_sizes)

    filtered_records = filter_records(
        records=records,
        active_holders=active_holders,
        active_decks=active_decks,
        active_heights=active_heights,
        active_sizes=active_sizes,
        selected_holders=holders,
        selected_decks=decks,
        selected_heights=heights,
        selected_sizes=sizes,
    )

    columns = _build_columns(filtered_records, active_holders=active_holders, active_heights=active_heights)
    matrix = _build_matrix(
        filtered_records,
        warnings,
        columns,
        active_holders=active_holders,
        active_heights=active_heights,
    )
    summary = _build_summary(filtered_records)

    return {
        "meta": {
            "sessionName": session_name,
            "sourceSheet": source_sheet,
            "baseFilters": {"箱状态": BASE_STATUS, "箱型": BASE_TYPE},
        },
        "filters": {
            "available": {
                "holders": available_holders,
                "decks": available_decks,
                "heights": available_heights,
                "sizes": available_sizes,
            },
            "active": {
                "holders": active_holders,
                "decks": active_decks,
                "heights": active_heights,
                "sizes": active_sizes,
            },
            "selected": {
                "holders": sorted(holders),
                "decks": sorted(decks),
                "heights": sorted(heights),
                "sizes": sorted(sizes, key=_natural_order),
            },
        },
        "summary": summary,
        "matrix": matrix,
        "rowCount": len(filtered_records),
    }


def filter_records(
    *,
    records: list[ContainerRecord],
    active_holders: bool,
    active_decks: bool,
    active_heights: bool,
    active_sizes: bool,
    selected_holders: set[str],
    selected_decks: set[str],
    selected_heights: set[str],
    selected_sizes: set[str],
) -> list[ContainerRecord]:
    return [
        record
        for record in records
        if (not active_holders or record.holder in selected_holders)
        and (not active_decks or record.deck in selected_decks)
        and (not active_heights or record.height in selected_heights)
        and (not active_sizes or record.size in selected_sizes)
    ]


def _select_source_sheet(workbook: xlrd.book.Book) -> xlrd.sheet.Sheet:
    for candidate in ORIGIN_SHEET_CANDIDATES:
        if candidate in workbook.sheet_names():
            return workbook.sheet_by_name(candidate)

    sheets = [workbook.sheet_by_index(index) for index in range(workbook.nsheets)]
    return max(sheets, key=lambda sheet: sheet.ncols)


def _load_filtered_records(sheet: xlrd.sheet.Sheet) -> list[ContainerRecord]:
    headers = [_cell_to_text(sheet.cell_value(0, column)) for column in range(sheet.ncols)]
    column_map = {header: index for index, header in enumerate(headers)}

    required_columns = ("箱号", "船箱位", "尺寸", "箱型", "箱高", "箱状态", "持箱人")
    missing = [column for column in required_columns if column not in column_map]
    if missing:
        raise ValueError(f"缺少必要列: {', '.join(missing)}")

    records: list[ContainerRecord] = []
    for row_index in range(1, sheet.nrows):
        box_status = _cell_to_text(sheet.cell_value(row_index, column_map["箱状态"]))
        box_type = _cell_to_text(sheet.cell_value(row_index, column_map["箱型"]))
        if box_status != BASE_STATUS or box_type != BASE_TYPE:
            continue

        ship_slot = _cell_to_text(sheet.cell_value(row_index, column_map["船箱位"]))
        if not ship_slot:
            continue

        records.append(
            ContainerRecord(
                box_no=_cell_to_text(sheet.cell_value(row_index, column_map["箱号"])),
                ship_slot=ship_slot,
                bay=derive_bay(ship_slot),
                deck=derive_deck(ship_slot),
                holder=_cell_to_text(sheet.cell_value(row_index, column_map["持箱人"])) or "未知",
                size=_cell_to_text(sheet.cell_value(row_index, column_map["尺寸"])) or "未知",
                height=_cell_to_text(sheet.cell_value(row_index, column_map["箱高"])) or "未知",
            )
        )

    return records


def _load_bay_warnings(sheet: xlrd.sheet.Sheet) -> dict[str, BayWarning]:
    headers = [_cell_to_text(sheet.cell_value(0, column)) for column in range(sheet.ncols)]
    column_map = {header: index for index, header in enumerate(headers)}

    if "船箱位" not in column_map:
        return {}

    warnings_by_bay: dict[str, dict[str, int]] = defaultdict(
        lambda: {"fr": 0, "oversize": 0, "track_in": 0}
    )

    box_type_index = column_map.get("箱型")
    oversize_index = column_map.get("超限代码")
    un_number_index = column_map.get("危品UN编号")

    for row_index in range(1, sheet.nrows):
        ship_slot = _cell_to_text(sheet.cell_value(row_index, column_map["船箱位"]))
        bay = derive_bay(ship_slot)
        if not bay:
            continue

        if box_type_index is not None:
            box_type = _cell_to_text(sheet.cell_value(row_index, box_type_index))
            if box_type == "FR":
                warnings_by_bay[bay]["fr"] += 1

        if oversize_index is not None:
            oversize_code = _cell_to_text(sheet.cell_value(row_index, oversize_index))
            if oversize_code == "O":
                warnings_by_bay[bay]["oversize"] += 1

        if un_number_index is not None:
            un_number = _cell_to_text(sheet.cell_value(row_index, un_number_index))
            if un_number and un_number != "9/杂类危险物质":
                warnings_by_bay[bay]["track_in"] += 1

    return {
        bay: BayWarning(
            bay=bay,
            fr_count=counts["fr"],
            oversize_count=counts["oversize"],
            track_in_count=counts["track_in"],
        )
        for bay, counts in warnings_by_bay.items()
        if any(counts.values())
    }


def derive_bay(ship_slot: str) -> str:
    normalized = ship_slot.strip()
    return normalized[:2] if len(normalized) >= 2 else normalized


def derive_deck(ship_slot: str) -> str:
    normalized = ship_slot.strip()
    if len(normalized) < 2:
        return "未知"

    deck_marker = normalized[-2]
    if deck_marker in {"0", "1", "2"}:
        return "舱下"
    if deck_marker in {"7", "8", "9"}:
        return "舱上"
    return "未知"


def _build_columns(
    records: list[ContainerRecord],
    *,
    active_holders: bool,
    active_heights: bool,
) -> list[dict[str, str]]:
    column_keys = sorted(
        {
            (
                record.holder if active_holders else "全部持箱人",
                record.size,
                record.height if active_heights else "全部箱高",
            )
            for record in records
        },
        key=lambda item: (item[0], _natural_order(item[1]), item[2]),
    )
    return [
        {
            "key": _column_key(holder, size, height),
            "holder": holder,
            "size": size,
            "height": height,
        }
        for holder, size, height in column_keys
    ]


def _build_matrix(
    records: list[ContainerRecord],
    warnings: dict[str, BayWarning],
    columns: list[dict[str, str]],
    *,
    active_holders: bool,
    active_heights: bool,
) -> dict[str, Any]:
    counts_by_bay: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))
    totals_by_column: dict[str, int] = defaultdict(int)

    for record in records:
        key = _column_key(
            record.holder if active_holders else "全部持箱人",
            record.size,
            record.height if active_heights else "全部箱高",
        )
        counts_by_bay[record.bay][key] += 1
        totals_by_column[key] += 1

    rows = []
    for bay in sorted(counts_by_bay, key=_natural_order):
        values = {column["key"]: counts_by_bay[bay].get(column["key"], 0) for column in columns}
        bay_warning = warnings.get(bay)
        rows.append(
            {
                "bay": bay,
                "values": values,
                "total": sum(values.values()),
                "warnings": _format_warning_tags(bay_warning),
            }
        )

    totals = {column["key"]: totals_by_column.get(column["key"], 0) for column in columns}
    return {
        "columns": columns,
        "rows": rows,
        "totals": {"bay": "总计", "values": totals, "total": sum(totals.values())},
    }


def _build_summary(records: list[ContainerRecord]) -> dict[str, Any]:
    deck_counts = {"舱上": 0, "舱下": 0, "未知": 0}
    for record in records:
        deck_counts[record.deck] = deck_counts.get(record.deck, 0) + 1

    return {
        "containers": len(records),
        "bays": len({record.bay for record in records}),
        "holders": len({record.holder for record in records}),
        "deckCounts": deck_counts,
    }


def _cell_to_text(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    return str(value).strip()


def _natural_order(value: str) -> tuple[int, str]:
    return (int(value), value) if value.isdigit() else (10_000, value)


def _resolve_selected_values(
    available: list[str],
    active: bool,
    selected: set[str] | None,
) -> set[str]:
    if not active:
        return set()
    if selected is None:
        return set(available)
    return set(selected)


def _column_key(holder: str, size: str, height: str) -> str:
    return f"{holder}|{size}|{height}"


def _format_warning_tags(warning: BayWarning | None) -> list[dict[str, Any]]:
    if warning is None:
        return []

    tags = []
    if warning.fr_count:
        tags.append({"kind": "fr", "label": "FR", "count": warning.fr_count})
    if warning.oversize_count:
        tags.append({"kind": "oversize", "label": "超限", "count": warning.oversize_count})
    if warning.track_in_count:
        tags.append({"kind": "track_in", "label": "轨内", "count": warning.track_in_count})
    return tags


def parse_voyage_metadata(filename: str, manual_voyage_name: str | None = None) -> dict[str, str]:
    stem = Path(filename).stem.strip()
    ship_name = stem
    voyage_name = (manual_voyage_name or "").strip()

    if "_" in stem:
        ship_name, parsed_voyage = stem.rsplit("_", 1)
        voyage_name = voyage_name or parsed_voyage.strip()

    if not voyage_name:
        raise ValueError("文件名中未包含航次，请输入航次名称")

    return {
        "shipName": ship_name.strip() or stem,
        "voyageName": voyage_name,
        "displayName": f"{ship_name.strip() or stem} {voyage_name}".strip(),
    }


def export_split_ticket(path: Path, records: list[ContainerRecord], ship_name: str, holder_label: str) -> None:
    workbook = Workbook()
    worksheet = workbook.active
    worksheet.title = "箱号清单"
    worksheet.append(["箱号", "船箱位", "BAY", "仓上/仓下", "持箱人", "尺寸", "箱高"])

    for record in records:
        worksheet.append(
            [
                record.box_no,
                record.ship_slot,
                record.bay,
                record.deck,
                record.holder,
                record.size,
                record.height,
            ]
        )

    workbook.properties.title = f"拆仓单箱号清单_{holder_label}_{ship_name}"
    workbook.save(path)
