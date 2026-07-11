from pathlib import Path
import unittest
from uuid import uuid4

from openpyxl import load_workbook

from app.excel_service import (
    build_dashboard_payload,
    derive_bay,
    derive_deck,
    export_split_ticket,
    load_sample_workbook,
    parse_voyage_metadata,
)


SAMPLE_PATH = Path(__file__).resolve().parent.parent / "example" / "第一致敬_新.XLS"


class ExcelServiceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.sample = load_sample_workbook(SAMPLE_PATH)

    def test_derive_bay(self) -> None:
        self.assertEqual(derive_bay("351802"), "35")
        self.assertEqual(derive_bay("071678"), "07")

    def test_derive_deck(self) -> None:
        self.assertEqual(derive_deck("351802"), "舱下")
        self.assertEqual(derive_deck("071678"), "舱上")

    def test_sample_matches_reference_pivot_for_one_and_yml(self) -> None:
        payload = build_dashboard_payload(
            records=self.sample["records"],
            warnings=self.sample["warnings"],
            session_name=self.sample["session_name"],
            source_sheet=self.sample["source_sheet"],
            active_holders=True,
            active_decks=True,
            active_heights=True,
            active_sizes=True,
            selected_holders={"ONE", "YML"},
        )

        totals = payload["matrix"]["totals"]
        self.assertEqual(totals["total"], 2331)
        self.assertEqual(totals["values"]["ONE|20|PQ"], 101)
        self.assertEqual(totals["values"]["ONE|40|HQ"], 1126)
        self.assertEqual(totals["values"]["ONE|40|PQ"], 39)
        self.assertEqual(totals["values"]["YML|20|PQ"], 272)
        self.assertEqual(totals["values"]["YML|40|HQ"], 731)
        self.assertEqual(totals["values"]["YML|40|PQ"], 56)
        self.assertEqual(totals["values"]["YML|45|HQ"], 1)
        self.assertEqual(totals["values"]["YML|53|HQ"], 5)

    def test_zero_selected_holders_returns_empty_matrix(self) -> None:
        payload = build_dashboard_payload(
            records=self.sample["records"],
            warnings=self.sample["warnings"],
            session_name=self.sample["session_name"],
            source_sheet=self.sample["source_sheet"],
            active_holders=True,
            active_decks=True,
            active_heights=True,
            active_sizes=True,
            selected_holders=set(),
        )

        self.assertEqual(payload["rowCount"], 0)
        self.assertEqual(payload["matrix"]["columns"], [])
        self.assertEqual(payload["matrix"]["rows"], [])
        self.assertEqual(payload["matrix"]["totals"]["total"], 0)

    def test_inactive_holder_dimension_collapses_to_single_group(self) -> None:
        payload = build_dashboard_payload(
            records=self.sample["records"],
            warnings=self.sample["warnings"],
            session_name=self.sample["session_name"],
            source_sheet=self.sample["source_sheet"],
            active_holders=False,
            active_decks=True,
            active_heights=True,
            active_sizes=True,
        )

        holders = {column["holder"] for column in payload["matrix"]["columns"]}
        self.assertEqual(holders, {"全部持箱人"})

    def test_warning_tags_are_attached_to_bay_rows(self) -> None:
        payload = build_dashboard_payload(
            records=self.sample["records"],
            warnings=self.sample["warnings"],
            session_name=self.sample["session_name"],
            source_sheet=self.sample["source_sheet"],
            active_holders=True,
            active_decks=True,
            active_heights=True,
            active_sizes=True,
        )

        rows_by_bay = {row["bay"]: row for row in payload["matrix"]["rows"]}
        self.assertEqual(rows_by_bay["01"]["warnings"], [{"kind": "fr", "label": "FR", "count": 1}, {"kind": "oversize", "label": "超限", "count": 1}])
        self.assertEqual(rows_by_bay["18"]["warnings"], [{"kind": "track_in", "label": "轨内", "count": 10}])

    def test_size_filter_can_limit_to_20_foot(self) -> None:
        payload = build_dashboard_payload(
            records=self.sample["records"],
            warnings=self.sample["warnings"],
            session_name=self.sample["session_name"],
            source_sheet=self.sample["source_sheet"],
            active_holders=True,
            active_decks=True,
            active_heights=True,
            active_sizes=True,
            selected_sizes={"20"},
        )

        sizes = {column["size"] for column in payload["matrix"]["columns"]}
        self.assertEqual(sizes, {"20"})

    def test_parse_voyage_metadata_uses_manual_voyage_when_filename_has_no_underscore(self) -> None:
        metadata = parse_voyage_metadata("第一致敬.XLS", "031WJ")
        self.assertEqual(metadata["shipName"], "第一致敬")
        self.assertEqual(metadata["voyageName"], "031WJ")

    def test_export_split_ticket_writes_expected_headers(self) -> None:
        record = self.sample["records"][0]
        output = Path(__file__).resolve().parent / f"_ticket_test_{uuid4().hex}.xlsx"
        export_split_ticket(output, [record], "第一致敬", record.holder)
        workbook = load_workbook(output)
        sheet = workbook.active
        self.assertEqual(sheet["A1"].value, "箱号")
        self.assertEqual(sheet["A2"].value, record.box_no)
        self.assertEqual(sheet["C2"].value, record.bay)
        workbook.close()


if __name__ == "__main__":
    unittest.main()
