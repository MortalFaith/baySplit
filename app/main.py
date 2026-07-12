from __future__ import annotations

from datetime import datetime
import os
from pathlib import Path
from uuid import uuid4

from fastapi import FastAPI, File, Form, HTTPException, Query, Request, UploadFile
from fastapi.responses import FileResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from app.excel_service import (
    analyze_workbook,
    build_dashboard_payload,
    export_split_ticket,
    filter_records,
    load_sample_workbook,
    parse_voyage_metadata,
)


BASE_DIR = Path(__file__).resolve().parent.parent
STATIC_DIR = BASE_DIR / "static"
SAMPLE_PATH = BASE_DIR / "example" / "第一致敬_新.XLS"
TICKETS_DIR = BASE_DIR / "generated_tickets"
TICKETS_DIR.mkdir(exist_ok=True)
INDEX_HTML = (STATIC_DIR / "index.html").read_text(encoding="utf-8")
ROOT_PATH = os.getenv("ROOT_PATH", "").rstrip("/")

app = FastAPI(title="Bay Split Dashboard", root_path=ROOT_PATH)
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

voyages: dict[str, dict] = {}


class TicketRequest(BaseModel):
    active_holders: bool = True
    active_decks: bool = True
    active_heights: bool = True
    active_sizes: bool = True
    active_statuses: bool = True
    selected_holders: list[str] = []
    selected_decks: list[str] = []
    selected_heights: list[str] = []
    selected_sizes: list[str] = []
    selected_statuses: list[str] = []
    selected_bays: list[str] = []


@app.get("/", response_class=HTMLResponse)
def index(request: Request) -> HTMLResponse:
    root_path = ROOT_PATH or request.scope.get("root_path", "").rstrip("/")
    html = INDEX_HTML.replace("__ROOT_PATH__", root_path)
    return HTMLResponse(html)


@app.get("/api/voyages")
def list_voyages() -> dict:
    _ensure_sample_voyage()
    return {"voyages": [_serialize_voyage_summary(voyage) for voyage in voyages.values()]}


@app.post("/api/voyages")
async def create_voyage(
    file: UploadFile = File(...),
    voyage_name: str | None = Form(default=None),
) -> dict:
    if not file.filename:
        raise HTTPException(status_code=400, detail="缺少文件名")

    try:
        voyage_id = _store_voyage(await file.read(), file.filename, manual_voyage_name=voyage_name)
    except Exception as exc:  # pragma: no cover - exercised by manual upload flow
        raise HTTPException(status_code=400, detail=f"文件解析失败: {exc}") from exc
    return {"voyageId": voyage_id}


@app.get("/api/voyages/{voyage_id}/dashboard")
def get_dashboard(
    voyage_id: str,
    active_holders: bool = Query(default=True),
    active_decks: bool = Query(default=True),
    active_heights: bool = Query(default=True),
    active_sizes: bool = Query(default=True),
    active_statuses: bool = Query(default=True),
    holders_specified: bool = Query(default=False),
    decks_specified: bool = Query(default=False),
    heights_specified: bool = Query(default=False),
    sizes_specified: bool = Query(default=False),
    statuses_specified: bool = Query(default=False),
    holders: list[str] | None = Query(default=None),
    decks: list[str] | None = Query(default=None),
    heights: list[str] | None = Query(default=None),
    sizes: list[str] | None = Query(default=None),
    statuses: list[str] | None = Query(default=None),
) -> dict:
    voyage = _get_voyage(voyage_id)

    payload = build_dashboard_payload(
        records=voyage["records"],
        warnings=voyage["warnings"],
        session_name=voyage["display_name"],
        source_sheet=voyage["source_sheet"],
        active_holders=active_holders,
        active_decks=active_decks,
        active_heights=active_heights,
        active_sizes=active_sizes,
        active_statuses=active_statuses,
        selected_holders=set(holders or []) if holders_specified else None,
        selected_decks=set(decks or []) if decks_specified else None,
        selected_heights=set(heights or []) if heights_specified else None,
        selected_sizes=set(sizes or []) if sizes_specified else None,
        selected_statuses=set(statuses or []) if statuses_specified else None,
    )
    payload["voyage"] = _serialize_voyage_summary(voyage)
    payload["tickets"] = [_serialize_ticket(ticket, voyage_id) for ticket in voyage["tickets"]]
    return payload


@app.post("/api/voyages/{voyage_id}/tickets")
def create_ticket(voyage_id: str, request: TicketRequest) -> dict:
    voyage = _get_voyage(voyage_id)
    selected_bays = {bay for bay in request.selected_bays if bay}
    if not selected_bays:
        raise HTTPException(status_code=400, detail="请至少勾选一个贝位")

    filtered = filter_records(
        records=voyage["records"],
        active_holders=request.active_holders,
        active_decks=request.active_decks,
        active_heights=request.active_heights,
        active_sizes=request.active_sizes,
        active_statuses=request.active_statuses,
        selected_holders=set(request.selected_holders),
        selected_decks=set(request.selected_decks),
        selected_heights=set(request.selected_heights),
        selected_sizes=set(request.selected_sizes),
        selected_statuses=set(request.selected_statuses),
    )
    selected_records = [record for record in filtered if record.bay in selected_bays]
    if not selected_records:
        raise HTTPException(status_code=400, detail="当前筛选条件下，所选贝位没有匹配箱子")

    holders = sorted({record.holder for record in selected_records})
    holder_label = holders[0] if len(holders) == 1 else "多持箱人"
    ticket_stem = f"拆仓单箱号清单_{holder_label}_{voyage['ship_name']}"
    voyage_ticket_dir = TICKETS_DIR / voyage_id
    voyage_ticket_dir.mkdir(exist_ok=True)
    ticket_path = _next_ticket_path(voyage_ticket_dir, ticket_stem)

    export_split_ticket(ticket_path, selected_records, voyage["ship_name"], holder_label)

    ticket = {
        "id": uuid4().hex,
        "fileName": ticket_path.name,
        "displayName": ticket_path.stem,
        "holderLabel": holder_label,
        "boxCount": len(selected_records),
        "bayCount": len(selected_bays),
        "bays": sorted(selected_bays),
        "path": str(ticket_path),
        "createdAt": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
    }
    voyage["tickets"].append(ticket)
    return {"ticket": _serialize_ticket(ticket, voyage_id)}


@app.get("/api/voyages/{voyage_id}/tickets/{ticket_id}/download")
def download_ticket(voyage_id: str, ticket_id: str) -> FileResponse:
    voyage = _get_voyage(voyage_id)
    ticket = next((item for item in voyage["tickets"] if item["id"] == ticket_id), None)
    if ticket is None:
        raise HTTPException(status_code=404, detail="未找到分票文件")

    path = Path(ticket["path"])
    if not path.exists():
        raise HTTPException(status_code=404, detail="分票文件不存在")
    return FileResponse(path, filename=ticket["fileName"])


def _store_voyage(file_bytes: bytes, filename: str, manual_voyage_name: str | None = None) -> str:
    voyage_data = analyze_workbook(file_bytes, filename)
    voyage_meta = parse_voyage_metadata(filename, manual_voyage_name)
    voyage_id = uuid4().hex
    voyages[voyage_id] = {
        "id": voyage_id,
        "session_name": voyage_data["session_name"],
        "source_sheet": voyage_data["source_sheet"],
        "records": voyage_data["records"],
        "warnings": voyage_data["warnings"],
        "ship_name": voyage_meta["shipName"],
        "voyage_name": voyage_meta["voyageName"],
        "display_name": voyage_meta["displayName"],
        "filename": filename,
        "tickets": [],
    }
    return voyage_id


def _ensure_sample_voyage() -> None:
    if any(voyage["filename"] == SAMPLE_PATH.name for voyage in voyages.values()):
        return

    voyage_data = load_sample_workbook(SAMPLE_PATH)
    voyage_meta = parse_voyage_metadata(SAMPLE_PATH.name)
    voyage_id = uuid4().hex
    voyages[voyage_id] = {
        "id": voyage_id,
        "session_name": voyage_data["session_name"],
        "source_sheet": voyage_data["source_sheet"],
        "records": voyage_data["records"],
        "warnings": voyage_data["warnings"],
        "ship_name": voyage_meta["shipName"],
        "voyage_name": voyage_meta["voyageName"],
        "display_name": voyage_meta["displayName"],
        "filename": SAMPLE_PATH.name,
        "tickets": [],
    }


def _get_voyage(voyage_id: str) -> dict:
    _ensure_sample_voyage()
    voyage = voyages.get(voyage_id)
    if voyage is None:
        raise HTTPException(status_code=404, detail="未找到对应航次")
    return voyage


def _serialize_voyage_summary(voyage: dict) -> dict:
    return {
        "id": voyage["id"],
        "shipName": voyage["ship_name"],
        "voyageName": voyage["voyage_name"],
        "displayName": voyage["display_name"],
        "boxCount": len(voyage["records"]),
        "bayCount": len({record.bay for record in voyage["records"]}),
        "ticketCount": len(voyage["tickets"]),
    }


def _serialize_ticket(ticket: dict, voyage_id: str) -> dict:
    return {
        "id": ticket["id"],
        "displayName": ticket["displayName"],
        "fileName": ticket["fileName"],
        "holderLabel": ticket["holderLabel"],
        "boxCount": ticket["boxCount"],
        "bayCount": ticket["bayCount"],
        "bays": ticket["bays"],
        "createdAt": ticket["createdAt"],
        "downloadUrl": f"/api/voyages/{voyage_id}/tickets/{ticket['id']}/download",
    }


def _next_ticket_path(directory: Path, stem: str) -> Path:
    candidate = directory / f"{stem}.xlsx"
    if not candidate.exists():
        return candidate

    index = 2
    while True:
        candidate = directory / f"{stem}_{index}.xlsx"
        if not candidate.exists():
            return candidate
        index += 1
