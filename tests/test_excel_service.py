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
        totals_by_holder_size_height = {}
        for key, value in totals["values"].items():
            holder, _, size, height = key.split("|")
            totals_by_holder_size_height[(holder, size, height)] = (
                totals_by_holder_size_height.get((holder, size, height), 0) + value
            )
        self.assertEqual(totals["total"], 2331)
        self.assertEqual(totals_by_holder_size_height[("ONE", "20", "PQ")], 101)
        self.assertEqual(totals_by_holder_size_height[("ONE", "40", "HQ")], 1126)
        self.assertEqual(totals_by_holder_size_height[("ONE", "40", "PQ")], 39)
        self.assertEqual(totals_by_holder_size_height[("YML", "20", "PQ")], 272)
        self.assertEqual(totals_by_holder_size_height[("YML", "40", "HQ")], 731)
        self.assertEqual(totals_by_holder_size_height[("YML", "40", "PQ")], 56)
        self.assertEqual(totals_by_holder_size_height[("YML", "45", "HQ")], 1)
        self.assertEqual(totals_by_holder_size_height[("YML", "53", "HQ")], 5)

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

    def test_active_deck_dimension_is_exposed_in_columns(self) -> None:
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

        decks = {column["deck"] for column in payload["matrix"]["columns"]}
        self.assertIn("舱上", decks)
        self.assertIn("舱下", decks)

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

    def test_status_filter_defaults_to_ie_but_exposes_other_statuses(self) -> None:
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

        self.assertEqual(payload["filters"]["selected"]["statuses"], ["IE"])
        self.assertEqual(payload["filters"]["defaults"]["statuses"], ["IE"])
        self.assertIn("TE", payload["filters"]["available"]["statuses"])

    def test_status_filter_can_switch_to_te(self) -> None:
        payload = build_dashboard_payload(
            records=self.sample["records"],
            warnings=self.sample["warnings"],
            session_name=self.sample["session_name"],
            source_sheet=self.sample["source_sheet"],
            active_holders=True,
            active_decks=True,
            active_heights=True,
            active_sizes=True,
            selected_statuses={"TE"},
        )

        self.assertEqual(payload["rowCount"], 409)
        self.assertEqual(payload["summary"]["containers"], 409)

    def test_payload_exposes_filtered_records_for_frontend_views(self) -> None:
        payload = build_dashboard_payload(
            records=self.sample["records"],
            warnings=self.sample["warnings"],
            session_name=self.sample["session_name"],
            source_sheet=self.sample["source_sheet"],
            active_holders=True,
            active_decks=True,
            active_heights=True,
            active_sizes=True,
            selected_holders={"ONE"},
        )

        self.assertEqual(payload["rowCount"], len(payload["records"]))
        self.assertTrue(payload["records"])
        sample_record = payload["records"][0]
        self.assertIn("bay", sample_record)
        self.assertIn("deck", sample_record)
        self.assertIn("holder", sample_record)
        self.assertIn("loadPort", sample_record)

    def test_parse_voyage_metadata_uses_manual_voyage_when_filename_has_no_underscore(self) -> None:
        metadata = parse_voyage_metadata("第一致敬.XLS", "031WJ")
        self.assertEqual(metadata["shipName"], "第一致敬")
        self.assertEqual(metadata["voyageName"], "031WJ")

    def test_export_split_ticket_writes_expected_headers(self) -> None:
        record = self.sample["records"][0]
        output = Path(__file__).resolve().parent / f"_ticket_test_{uuid4().hex}.xlsx"
        export_split_ticket(output, [record], "第一致敬 031WJ", record.holder)
        workbook = load_workbook(output)
        sheet = workbook.active
        self.assertEqual(sheet["A1"].value, "箱号")
        self.assertEqual(sheet["B1"].value, "贝位")
        self.assertEqual(sheet["C1"].value, "仓上/仓下")
        self.assertEqual(sheet["F1"].value, "箱型")
        self.assertEqual(sheet["L1"].value, "卸货港")
        self.assertEqual(sheet["A2"].value, record.box_no)
        self.assertEqual(sheet["B2"].value, record.bay)
        self.assertEqual(sheet["C2"].value, record.deck)
        self.assertEqual(sheet["D2"].value, record.ship_slot)
        self.assertEqual(sheet["E2"].value, record.size)
        self.assertEqual(sheet["F2"].value, record.box_type)
        self.assertEqual(sheet["G2"].value, record.height)
        self.assertEqual(sheet["H2"].value, record.weight)
        self.assertEqual(sheet["I2"].value, record.status)
        self.assertEqual(sheet["J2"].value, record.holder)
        self.assertEqual(sheet["K2"].value, record.load_port)
        self.assertEqual(sheet["L2"].value, record.discharge_port)
        self.assertEqual(workbook.properties.title, f"拆仓单箱号清单_{record.holder}_第一致敬 031WJ")
        workbook.close()


if __name__ == "__main__":
    unittest.main()
