"""Excel persistence (hackathon prototype only — replace with a real DB for production).

All access goes through one process-wide lock; writes are atomic (temp file + replace)
so a crash mid-write cannot corrupt data/patients.xlsx. Supports patients, multi-specialty doctors, and queue routing.
"""
import csv
import io
import json
import logging
import os
import re
import tempfile
import threading
from datetime import datetime, timedelta, timezone
from pathlib import Path

from openpyxl import Workbook, load_workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter

log = logging.getLogger("carebridge.excel")

DATA_FILE = Path(os.getenv("PATIENTS_XLSX", Path(__file__).resolve().parent.parent / "data" / "patients.xlsx"))

COLUMNS = ["id", "token", "created_at", "name", "phone", "age", "gender", "language", "chief_complaint", "symptoms",
           "duration", "progression", "associated_symptoms", "negative_findings", "urgency",
           "urgency_indicators", "urgency_basis", "clinical_summary", "status", "called_at",
           "differential_diagnosis", "recommended_tests", "initial_treatment", "physical_therapy",
           "vitals", "medical_history", "assigned_doctor_id", "assigned_doctor_name", "queue_status",
           "soap_note", "triage_score", "visit_type", "previous_visit_id", "progression_comparison", "report"]

JSON_COLUMNS = {"symptoms", "duration", "associated_symptoms", "negative_findings", "urgency_indicators",
                "differential_diagnosis", "recommended_tests", "initial_treatment", "physical_therapy",
                "vitals", "medical_history", "soap_note", "triage_score", "progression_comparison", "report"}

DOCTOR_COLUMNS = ["id", "name", "email", "specialty", "passcode", "license_number", "created_at"]

URGENCY_RANK = {"HIGH": 3, "MODERATE": 2, "ROUTINE": 1}
_lock = threading.RLock()


class StorageError(Exception):
    pass


def _init_file():
    DATA_FILE.parent.mkdir(parents=True, exist_ok=True)
    if not DATA_FILE.exists():
        _save_full([], _default_doctors())
    else:
        try:
            wb = load_workbook(DATA_FILE)
            if "doctors" not in wb.sheetnames:
                ws = wb.create_sheet("doctors")
                ws.append(DOCTOR_COLUMNS)
                for d in _default_doctors():
                    ws.append([d.get(c) for c in DOCTOR_COLUMNS])
                fd, tmp = tempfile.mkstemp(suffix=".xlsx", dir=str(DATA_FILE.parent))
                os.close(fd)
                wb.save(tmp)
                os.replace(tmp, DATA_FILE)
            wb.close()
        except Exception:
            pass


def _default_doctors():
    now = datetime.now(timezone.utc).isoformat()
    return [
        {"id": 1, "name": "Dr. Sarah Rao", "email": "doctor@carebridge.ai", "specialty": "General Physician", "passcode": "carebridge2026", "license_number": "LIC-88492", "created_at": now},
        {"id": 2, "name": "Dr. Robert Chen", "email": "robert.chen@carebridge.ai", "specialty": "Orthopedics", "passcode": "ortho123", "license_number": "LIC-33214", "created_at": now},
        {"id": 3, "name": "Dr. Emily Vance", "email": "emily.vance@carebridge.ai", "specialty": "Dermatology", "passcode": "derm123", "license_number": "LIC-55419", "created_at": now},
        {"id": 4, "name": "Dr. Marcus Brody", "email": "marcus.brody@carebridge.ai", "specialty": "Neurology", "passcode": "neuro123", "license_number": "LIC-77182", "created_at": now},
        {"id": 5, "name": "Dr. Anita Sharma", "email": "anita.sharma@carebridge.ai", "specialty": "Pulmonology", "passcode": "pulm123", "license_number": "LIC-99234", "created_at": now},
    ]


def _save_full(patients: list[dict], doctors: list[dict]):
    wb = Workbook()
    ws_p = wb.active
    ws_p.title = "patients"
    ws_p.append(COLUMNS)
    for r in patients:
        row_vals = []
        for c in COLUMNS:
            if c in JSON_COLUMNS:
                val = r.get(c)
                if val is None:
                    val = [] if c in ("symptoms", "duration", "negative_findings", "differential_diagnosis", "recommended_tests", "initial_treatment", "physical_therapy", "medical_history", "urgency_indicators") else {}
                row_vals.append(json.dumps(val, ensure_ascii=False))
            else:
                row_vals.append(r.get(c))
        ws_p.append(row_vals)

    ws_d = wb.create_sheet("doctors")
    ws_d.append(DOCTOR_COLUMNS)
    for d in doctors:
        ws_d.append([d.get(c) for c in DOCTOR_COLUMNS])

    fd, tmp = tempfile.mkstemp(suffix=".xlsx", dir=str(DATA_FILE.parent))
    os.close(fd)
    try:
        wb.save(tmp)
        os.replace(tmp, DATA_FILE)
    finally:
        if os.path.exists(tmp):
            os.remove(tmp)


def _load_patients() -> list[dict]:
    _init_file()
    wb = load_workbook(DATA_FILE, read_only=True)
    ws = wb["patients"] if "patients" in wb.sheetnames else wb.active
    it = ws.iter_rows(values_only=True)
    header = next(it, None)
    if not header:
        wb.close()
        return []
    rows = []
    for vals in it:
        if not vals or vals[0] is None:
            continue
        row = dict(zip(header, vals))
        for c in JSON_COLUMNS:
            try:
                if row.get(c):
                    row[c] = json.loads(row[c])
                else:
                    row[c] = {} if c in ("vitals", "soap_note", "triage_score", "progression_comparison", "report") else []
            except (TypeError, ValueError):
                row[c] = {} if c in ("vitals", "soap_note", "triage_score", "progression_comparison", "report") else []
        if not row.get("phone"):
            row["phone"] = "9820012345"
        if not row.get("visit_type"):
            row["visit_type"] = "new"
        if not row.get("triage_score"):
            urg = row.get("urgency", "ROUTINE")
            sc = 85 if urg == "HIGH" else 55 if urg == "MODERATE" else 25
            row["triage_score"] = {"score": sc, "category": "Emergency - Red Flag" if urg == "HIGH" else "Moderate Risk" if urg == "MODERATE" else "Low Risk", "urgent_symptoms": row.get("urgency_indicators") or []}
        if not row.get("soap_note"):
            row["soap_note"] = {
                "subjective": row.get("clinical_summary", ""),
                "objective": f"Reported vitals: BP {row.get('vitals', {}).get('bp', 'N/A')}, HR {row.get('vitals', {}).get('heart_rate', 'N/A')}",
                "assessment": f"Clinical urgency: {row.get('urgency', 'ROUTINE')}",
                "plan": "Complete clinical examination and review."
            }
        if not row.get("progression_comparison"):
            row["progression_comparison"] = {
                "status": "N/A - New Issue",
                "summary": "First visit or new clinical issue.",
                "resolved_symptoms": [], "worsened_symptoms": [], "new_symptoms": []
            }
        if not row.get("report") or not isinstance(row.get("report"), dict):
            row["report"] = {
                "report_id": f"REP-{str(row.get('token', 'CB')).replace('-', '')}",
                "generated_at": row.get("created_at") or datetime.now(timezone.utc).isoformat(),
                "patient_name": row.get("name", "Unknown"),
                "age": row.get("age"),
                "gender": row.get("gender"),
                "language": row.get("language", "en"),
                "chief_complaint": row.get("chief_complaint", "Not reported"),
                "clinical_summary": row.get("clinical_summary", ""),
                "urgency": row.get("urgency", "ROUTINE"),
                "triage_score": row.get("triage_score", {}).get("score", 25) if isinstance(row.get("triage_score"), dict) else 25,
                "triage_category": row.get("triage_score", {}).get("category", row.get("urgency", "ROUTINE")) if isinstance(row.get("triage_score"), dict) else row.get("urgency", "ROUTINE"),
                "soap_note": row.get("soap_note", {}),
                "vitals": row.get("vitals", {}),
                "symptoms": row.get("symptoms", []),
                "duration": row.get("duration", []),
                "progression": row.get("progression", "Not reported"),
                "negative_findings": row.get("negative_findings", []),
                "differential_diagnosis": row.get("differential_diagnosis", []),
                "recommended_tests": row.get("recommended_tests", []),
                "initial_treatment": row.get("initial_treatment", []),
                "physical_therapy": row.get("physical_therapy", []),
                "medical_history": row.get("medical_history", [])
            }
        if "queue_status" not in row or not row["queue_status"]:
            row["queue_status"] = "assigned" if row.get("assigned_doctor_id") else "unassigned"
        rows.append(row)
    wb.close()
    return rows


def _save_patients(patients: list[dict]):
    doctors = list_doctors()
    _save_full(patients, doctors)


def list_doctors() -> list[dict]:
    _init_file()
    wb = load_workbook(DATA_FILE, read_only=True)
    if "doctors" not in wb.sheetnames:
        wb.close()
        return _default_doctors()
    ws = wb["doctors"]
    it = ws.iter_rows(values_only=True)
    header = next(it, None)
    if not header:
        wb.close()
        return _default_doctors()
    doctors = []
    for vals in it:
        if not vals or vals[0] is None:
            continue
        doctors.append(dict(zip(header, vals)))
    wb.close()
    if not doctors:
        doctors = _default_doctors()
    return doctors


def add_doctor(record: dict) -> dict:
    with _lock:
        doctors = list_doctors()
        if any(d["email"].lower() == record["email"].lower() for d in doctors):
            raise StorageError("A doctor with this email is already registered.")
        next_id = max([int(d["id"]) for d in doctors if str(d["id"]).isdigit()], default=0) + 1
        new_doc = {
            "id": next_id,
            "name": record["name"],
            "email": record["email"].lower().strip(),
            "specialty": record.get("specialty", "General Physician"),
            "passcode": record["passcode"],
            "license_number": record["license_number"],
            "created_at": record.get("created_at") or datetime.now(timezone.utc).isoformat()
        }
        doctors.append(new_doc)
        patients = _load_patients()
        _save_full(patients, doctors)
        return new_doc


def get_doctor_by_email(email: str) -> dict | None:
    email = email.lower().strip()
    for d in list_doctors():
        if d["email"].lower().strip() == email:
            return d
    return None


def get_doctor_by_id(doc_id: int) -> dict | None:
    for d in list_doctors():
        if int(d["id"]) == int(doc_id):
            return d
    return None


def _guard(fn):
    def wrapper(*a, **kw):
        with _lock:
            try:
                return fn(*a, **kw)
            except StorageError:
                raise
            except Exception as e:
                log.exception("Excel storage failure")
                raise StorageError("Patient data storage is unavailable. Close patients.xlsx if it is open and retry.") from e
    return wrapper


@_guard
def list_patients() -> list[dict]:
    return _load_patients()


@_guard
def get_patient(patient_id: int) -> dict | None:
    return next((r for r in _load_patients() if int(r["id"]) == int(patient_id)), None)


@_guard
def get_by_token(token: str) -> dict | None:
    return next((r for r in _load_patients() if r["token"] == token), None)


@_guard
def lookup_patient(name: str, phone: str) -> list[dict]:
    clean_p = re.sub(r"[^\d]", "", phone or "")
    if len(clean_p) == 12 and clean_p.startswith("91"):
        clean_p = clean_p[2:]
    clean_n = (name or "").strip().lower()

    rows = _load_patients()
    matches = []
    for r in rows:
        row_p = re.sub(r"[^\d]", "", str(r.get("phone") or ""))
        if len(row_p) == 12 and row_p.startswith("91"):
            row_p = row_p[2:]
        row_n = str(r.get("name") or "").strip().lower()
        phone_match = bool(clean_p and row_p and (clean_p == row_p))
        name_match = bool(clean_n and row_n and (clean_n in row_n or row_n in clean_n))
        if phone_match and name_match:
            matches.append(r)
        elif phone_match and not clean_n:
            matches.append(r)

    matches.sort(key=lambda x: str(x.get("created_at") or ""), reverse=True)
    return matches


@_guard
def add_patient(record: dict) -> dict:
    rows = _load_patients()
    next_id = max([int(r["id"]) for r in rows], default=0) + 1
    next_num = max([int(r["token"][2:]) for r in rows if r["token"].startswith("CB")], default=100) + 1
    
    doc_id = record.get("assigned_doctor_id")
    doc_name = record.get("assigned_doctor_name")
    q_status = record.get("queue_status") or ("assigned" if doc_id else "unassigned")

    record = {
        **record,
        "id": next_id,
        "token": f"CB{next_num}",
        "phone": record.get("phone") or "9820012345",
        "status": record.get("status", "waiting"),
        "created_at": record.get("created_at") or datetime.now(timezone.utc).isoformat(),
        "differential_diagnosis": record.get("differential_diagnosis", []),
        "recommended_tests": record.get("recommended_tests", []),
        "initial_treatment": record.get("initial_treatment", []),
        "physical_therapy": record.get("physical_therapy", []),
        "vitals": record.get("vitals", {"bp": "120/80 mmHg", "heart_rate": "78 bpm", "temperature": "98.6 °F", "spo2": "98%"}),
        "medical_history": record.get("medical_history", ["None reported"]),
        "assigned_doctor_id": doc_id,
        "assigned_doctor_name": doc_name,
        "queue_status": q_status,
        "soap_note": record.get("soap_note", {}),
        "triage_score": record.get("triage_score", {}),
        "visit_type": record.get("visit_type", "new"),
        "previous_visit_id": record.get("previous_visit_id"),
        "progression_comparison": record.get("progression_comparison", {})
    }
    rows.append(record)
    _save_patients(rows)
    return record


@_guard
def update_status(patient_id: int, status: str) -> dict | None:
    rows = _load_patients()
    for r in rows:
        if int(r["id"]) == int(patient_id):
            r["status"] = status
            if status == "completed":
                r["queue_status"] = "completed"
            _save_patients(rows)
            return r
    return None


@_guard
def assign_doctor(patient_id: int, doctor_id: int, doctor_name: str) -> dict | None:
    rows = _load_patients()
    for r in rows:
        if int(r["id"]) == int(patient_id):
            r["assigned_doctor_id"] = doctor_id
            r["assigned_doctor_name"] = doctor_name
            r["queue_status"] = "assigned"
            _save_patients(rows)
            return r
    return None


@_guard
def mark_called(patient_id: int) -> dict | None:
    rows = _load_patients()
    for r in rows:
        if int(r["id"]) == int(patient_id):
            r["called_at"] = datetime.now(timezone.utc).isoformat()
            _save_patients(rows)
            return r
    return None


MASTER_EXPORT_HEADERS = [
    "Token", "Visit Date/Time", "Patient Name", "Contact Mobile", "Age", "Gender", "Language",
    "Clinical Urgency", "Triage Score", "Triage Risk Category", "Chief Complaint", "Reported Symptoms",
    "Duration", "Progression", "Vitals", "Medical History", "Assigned Doctor", "Status", "Visit Type",
    "Clinical Summary", "Differential Diagnoses", "Recommended Tests", "Initial Treatment", "Physical Therapy",
    "SOAP - Subjective", "SOAP - Objective", "SOAP - Assessment", "SOAP - Plan"
]


def _format_patient_master_row(r: dict) -> list:
    created = r.get("created_at") or ""
    if created:
        try:
            dt = datetime.fromisoformat(str(created).replace("Z", "+00:00"))
            created_str = dt.strftime("%Y-%m-%d %H:%M")
        except Exception:
            created_str = str(created)[:16]
    else:
        created_str = "N/A"

    syms = r.get("symptoms") or []
    syms_str = ", ".join(syms) if isinstance(syms, list) else str(syms)

    durs = r.get("duration") or []
    if isinstance(durs, list):
        dur_parts = []
        for d in durs:
            if isinstance(d, dict) and d.get("symptom"):
                dur_parts.append(f"{d.get('symptom')}: {d.get('duration', 'N/A')}")
            elif isinstance(d, str):
                dur_parts.append(d)
        dur_str = "; ".join(dur_parts) if dur_parts else "Not reported"
    else:
        dur_str = str(durs)

    v = r.get("vitals") or {}
    if isinstance(v, dict) and any(v.values()):
        vitals_str = f"BP: {v.get('bp', 'N/R')}, HR: {v.get('heart_rate', 'N/R')}, Temp: {v.get('temperature', 'N/R')}, SpO2: {v.get('spo2', 'N/R')}"
    else:
        vitals_str = "Not reported"

    hist = r.get("medical_history") or []
    hist_str = ", ".join(hist) if isinstance(hist, list) else str(hist)

    diffs = r.get("differential_diagnosis") or []
    if isinstance(diffs, list):
        diff_str = "; ".join([f"{d.get('condition')} ({d.get('confidence', '')})" for d in diffs if isinstance(d, dict)])
    else:
        diff_str = str(diffs)

    tests = r.get("recommended_tests") or []
    if isinstance(tests, list):
        test_str = "; ".join([f"{t.get('test_name')} [{t.get('priority', '')}]" for t in tests if isinstance(t, dict)])
    else:
        test_str = str(tests)

    treats = r.get("initial_treatment") or []
    if isinstance(treats, list):
        treat_str = "; ".join([t.get('guideline', '') for t in treats if isinstance(t, dict)])
    else:
        treat_str = str(treats)

    pts = r.get("physical_therapy") or []
    if isinstance(pts, list):
        pt_str = "; ".join([p.get('exercise', '') for p in pts if isinstance(p, dict)])
    else:
        pt_str = str(pts)

    triage = r.get("triage_score") or {}
    triage_score_val = triage.get("score") if isinstance(triage, dict) else ""
    triage_cat_val = triage.get("category") if isinstance(triage, dict) else ""

    soap = r.get("soap_note") or {}
    soap_s = soap.get("subjective", "") if isinstance(soap, dict) else ""
    soap_o = soap.get("objective", "") if isinstance(soap, dict) else ""
    soap_a = soap.get("assessment", "") if isinstance(soap, dict) else ""
    soap_p = soap.get("plan", "") if isinstance(soap, dict) else ""

    return [
        r.get("token") or "",
        created_str,
        r.get("name") or "",
        r.get("phone") or "",
        r.get("age") or "",
        r.get("gender") or "",
        (r.get("language") or "en").upper(),
        r.get("urgency") or "ROUTINE",
        f"{triage_score_val}/100" if triage_score_val else "",
        triage_cat_val,
        r.get("chief_complaint") or "",
        syms_str,
        dur_str,
        r.get("progression") or "Not reported",
        vitals_str,
        hist_str,
        r.get("assigned_doctor_name") or "Unassigned",
        (r.get("status") or "").replace("_", " ").title(),
        (r.get("visit_type") or "new").title(),
        r.get("clinical_summary") or "",
        diff_str,
        test_str,
        treat_str,
        pt_str,
        soap_s,
        soap_o,
        soap_a,
        soap_p
    ]


@_guard
def export_master_excel() -> bytes:
    _init_file()
    rows = sorted(_load_patients(), key=sort_key)
    wb = Workbook()
    ws = wb.active
    ws.title = "Master Patient List"

    header_font = Font(name="Calibri", size=11, bold=True, color="FFFFFF")
    header_fill = PatternFill(start_color="0F766E", end_color="0F766E", fill_type="solid")
    header_align = Alignment(horizontal="center", vertical="center", wrap_text=True)

    ws.append(MASTER_EXPORT_HEADERS)
    ws.row_dimensions[1].height = 28

    for col_idx in range(1, len(MASTER_EXPORT_HEADERS) + 1):
        cell = ws.cell(row=1, column=col_idx)
        cell.font = header_font
        cell.fill = header_fill
        cell.alignment = header_align

    thin_border = Border(left=Side(style="thin", color="E5E7EB"),
                         right=Side(style="thin", color="E5E7EB"),
                         top=Side(style="thin", color="E5E7EB"),
                         bottom=Side(style="thin", color="E5E7EB"))

    for r_idx, r in enumerate(rows, start=2):
        row_vals = _format_patient_master_row(r)
        ws.append(row_vals)
        ws.row_dimensions[r_idx].height = 22
        for c_idx in range(1, len(row_vals) + 1):
            c = ws.cell(row=r_idx, column=c_idx)
            c.border = thin_border
            c.alignment = Alignment(vertical="center")

    for col in ws.columns:
        max_len = max(len(str(cell.value or '')) for cell in col)
        col_letter = get_column_letter(col[0].column)
        ws.column_dimensions[col_letter].width = min(max(max_len + 3, 12), 48)

    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


@_guard
def export_master_csv() -> bytes:
    _init_file()
    rows = sorted(_load_patients(), key=sort_key)
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(MASTER_EXPORT_HEADERS)
    for r in rows:
        writer.writerow(_format_patient_master_row(r))
    return buf.getvalue().encode("utf-8-sig")


@_guard
def export_bytes() -> bytes:
    return export_master_excel()


@_guard
def clear_all():
    with _lock:
        doctors = list_doctors()
        _save_full([], doctors)


def sort_key(r: dict):
    return (-URGENCY_RANK.get(r["urgency"], 1), r["created_at"])


def queue_view(doctor_id: int | None = None) -> dict:
    rows = [r for r in list_patients() if r["status"] != "completed"]
    
    general_rows = [r for r in rows if r["queue_status"] == "unassigned"]
    my_rows = [r for r in rows if doctor_id and int(r.get("assigned_doctor_id") or 0) == int(doctor_id)]
    
    now_rows = sorted([r for r in rows if r["status"] == "in_consultation"], key=sort_key)
    wait_rows = sorted([r for r in rows if r["status"] == "waiting"], key=sort_key)
    
    entries = []
    for r in now_rows:
        entries.append(_q(r, None, public=True))
    for i, r in enumerate(wait_rows, 1):
        entries.append(_q(r, i, public=True))

    return {
        "entries": entries,
        "waiting": len(wait_rows),
        "in_consultation": len(now_rows),
        "high": sum(1 for r in rows if r["urgency"] == "HIGH"),
        "general_queue": [_q(r, None, public=False) for r in sorted(general_rows, key=sort_key)],
        "my_queue": [_q(r, None, public=False) for r in sorted(my_rows, key=sort_key)]
    }


def _q(r, pos, public=True):
    base = {"position": pos, "token": r["token"], "urgency": r["urgency"], "created_at": r["created_at"], "status": r["status"]}
    if not public:
        base.update({
            "id": r["id"],
            "name": r["name"],
            "phone": r.get("phone", "9820012345"),
            "chief_complaint": r["chief_complaint"],
            "assigned_doctor_id": r.get("assigned_doctor_id"),
            "assigned_doctor_name": r.get("assigned_doctor_name"),
            "queue_status": r.get("queue_status", "unassigned"),
            "triage_score": r.get("triage_score", {}),
            "soap_note": r.get("soap_note", {}),
            "visit_type": r.get("visit_type", "new"),
            "previous_visit_id": r.get("previous_visit_id"),
            "progression_comparison": r.get("progression_comparison", {})
        })
    return base


def queue_position(token: str) -> int | None:
    for e in queue_view()["entries"]:
        if e["token"] == token:
            return e["position"]
    return None


# ---------- demo data ----------
def _demo(name, age, gender, lang, cc, symptoms, dur, prog, assoc, neg, urg, ind, basis, summary, mins_ago, phone="9820012345", diff=None, tests=None, treat=None, pt=None, vitals=None, hist=None, doc_id=None, doc_name=None, q_stat="assigned", soap=None, triage=None, visit_type="new", prev_id=None, comparison=None):
    return dict(
        name=name, phone=phone, age=age, gender=gender, language=lang, chief_complaint=cc, symptoms=symptoms,
        duration=[{"symptom": s, "duration": d} for s, d in dur], progression=prog, associated_symptoms=assoc,
        negative_findings=neg, urgency=urg, urgency_indicators=ind, urgency_basis=basis, clinical_summary=summary,
        created_at=(datetime.now(timezone.utc) - timedelta(minutes=mins_ago)).isoformat(), status="waiting",
        differential_diagnosis=diff or [{"condition": "Viral Upper Respiratory Infection", "confidence": "Moderate", "severity": "Routine", "rationale": "Fever and mild symptoms"}],
        recommended_tests=tests or [{"test_name": "Complete Blood Count (CBC)", "priority": "Routine", "purpose": "Assess for infection"}],
        initial_treatment=treat or [{"guideline": "Rest, adequate hydration", "notes": "Monitor temperature"}],
        physical_therapy=pt or [{"exercise": "Breathing exercises", "instructions": "Deep breathing", "frequency": "3x daily", "precautions": "Stop if dizzy"}],
        vitals=vitals or {"bp": "120/80 mmHg", "heart_rate": "78 bpm", "temperature": "99.2 °F", "spo2": "98%"},
        medical_history=hist or ["None reported"],
        assigned_doctor_id=doc_id,
        assigned_doctor_name=doc_name,
        queue_status=q_stat,
        soap_note=soap or {
            "subjective": summary,
            "objective": "Vitals stable, clear breath sounds, alert and oriented.",
            "assessment": f"Clinical Urgency: {urg}. Routine symptom evaluation.",
            "plan": "Hydration, supportive care, follow-up if symptoms persist."
        },
        triage_score=triage or {
            "score": 85 if urg == "HIGH" else 55 if urg == "MODERATE" else 25,
            "category": "Emergency - Red Flag" if urg == "HIGH" else "Moderate Risk" if urg == "MODERATE" else "Low Risk",
            "urgent_symptoms": ind or [],
            "rationale": f"Calculated score for {urg} urgency."
        },
        visit_type=visit_type,
        previous_visit_id=prev_id,
        progression_comparison=comparison or {
            "status": "N/A - New Issue",
            "summary": "Initial evaluation.",
            "resolved_symptoms": [], "worsened_symptoms": [], "new_symptoms": []
        }
    )


DEMO_PATIENTS = [
    _demo("Demo Patient A", 28, "Female", "hi", "Fever for 3 days", ["Fever", "Headache", "Body ache"],
          [("Fever", "3 days")], "Persistent", ["Headache", "Body ache"], ["No breathing difficulty reported"], "ROUTINE", [],
          "ai_assessment", "Patient reports fever for about 3 days with headache and body ache.", 42,
          phone="9820111111", doc_id=1, doc_name="Dr. Sarah Rao", q_stat="assigned"),
    _demo("Demo Patient B", 34, "Male", "en", "Severe knee sprain after running", ["Knee pain", "Swelling", "Difficulty walking"],
          [("Knee pain", "1 day")], "Worsening", ["Swelling"], ["No bone deformity reported"], "MODERATE",
          ["Acute joint pain", "Swelling"], "ai_assessment",
          "Patient reports severe knee pain and swelling after running 1 day ago.", 35,
          phone="9820222222",
          diff=[{"condition": "Acute Knee Ligament Sprain", "confidence": "High", "severity": "Moderate", "rationale": "Knee injury with swelling and mobility limitation"}],
          tests=[{"test_name": "Knee MRI & X-Ray", "priority": "Routine", "purpose": "Evaluate meniscus and ligaments"}],
          treat=[{"guideline": "RICE protocol (Rest, Ice, Compression, Elevation)", "notes": "Avoid weight bearing"}],
          pt=[{"exercise": "Quad sets and heel slides", "instructions": "Gentle knee flexion and extension", "frequency": "2 times daily", "precautions": "Stop if sharp pain occurs"}],
          vitals={"bp": "125/82 mmHg", "heart_rate": "82 bpm", "temperature": "98.6 °F", "spo2": "99%"}, hist=["None"],
          doc_id=2, doc_name="Dr. Robert Chen", q_stat="assigned"),
    _demo("Demo Patient C", 52, "Male", "mr", "Persistent cough with wheezing", ["Cough", "Wheezing"],
          [("Cough", "3 days")], "Worsening", ["Shortness of breath"], ["No chest pain reported"], "HIGH",
          ["Wheezing", "Shortness of breath"], "red_flag_rule",
          "Patient reports persistent cough and wheezing for 3 days.", 28,
          phone="9820333333", doc_id=5, doc_name="Dr. Anita Sharma", q_stat="assigned",
          triage={"score": 88, "category": "Emergency - Red Flag", "urgent_symptoms": ["Wheezing", "Shortness of breath"], "rationale": "Significant respiratory distress reported"}),
    _demo("Demo Patient D", 19, "Female", "en", "Itchy red skin rash on arm", ["Skin rash", "Redness", "Itching"],
          [("Rash", "2 days")], "Stable", ["Itching"], ["No fever reported"], "ROUTINE", [],
          "ai_assessment", "Patient reports an itchy red skin rash on the left arm.", 21,
          phone="9820444444", doc_id=3, doc_name="Dr. Emily Vance", q_stat="assigned"),
    _demo("Demo Patient E", 45, "Male", "en", "Dizziness and localized numbness", ["Dizziness", "Numbness"],
          [("Dizziness", "1 day")], "Intermittent", ["Numbness in fingers"], [], "MODERATE",
          ["Dizziness", "Numbness"], "ai_assessment",
          "Patient reports intermittent dizziness and finger numbness for 1 day.", 12,
          phone="9820555555", doc_id=4, doc_name="Dr. Marcus Brody", q_stat="assigned"),
    _demo("Demo Patient F", 30, "Female", "en", "Unassigned walk-in patient", ["Abdominal pain", "Fever"],
          [("Pain", "5 hours")], "Sudden", ["Nausea"], [], "MODERATE",
          ["Acute abdominal pain"], "ai_assessment",
          "Unassigned walk-in patient reporting sudden abdominal pain and fever.", 5,
          phone="9820666666", doc_id=None, doc_name=None, q_stat="unassigned"),
    _demo("Demo Patient A", 28, "Female", "hi", "Follow-up: Persistent fever with new cough", ["Fever", "Productive cough", "Fatigue"],
          [("Fever", "5 days"), ("Cough", "2 days")], "Worsening", ["Productive cough"], ["No breathing difficulty reported"], "MODERATE",
          ["Prolonged fever", "Productive cough"], "ai_assessment",
          "Patient returns for follow-up regarding previous fever which has now lasted 5 days and worsened with new productive cough.", 2,
          phone="9820111111", doc_id=1, doc_name="Dr. Sarah Rao", q_stat="assigned",
          visit_type="followup", prev_id=1,
          triage={"score": 65, "category": "Moderate Risk", "urgent_symptoms": ["Prolonged fever (5 days)", "Productive cough"], "rationale": "Progression of upper respiratory symptoms"},
          comparison={
              "status": "Worsening",
              "summary": "Patient returns 2 days after initial intake. Headache has resolved, but fever has persisted for 5 days and progressed to productive cough.",
              "resolved_symptoms": ["Headache"],
              "worsened_symptoms": ["Fever"],
              "new_symptoms": ["Productive cough", "Fatigue"]
          })
]


def seed_demo() -> int:
    for p in DEMO_PATIENTS:
        p = {**p, "created_at": (datetime.now(timezone.utc) - timedelta(minutes=_age_min(p))).isoformat()}
        add_patient(p)
    return len(DEMO_PATIENTS)


def _age_min(p):
    return max(0, int((datetime.now(timezone.utc) - datetime.fromisoformat(p["created_at"])).total_seconds() // 60))


def add_demo_high() -> dict:
    return add_patient({
        "name": "Demo Urgent Patient Z", "phone": "9820999999", "age": 55, "gender": "Male", "language": "en",
        "chief_complaint": "Severe chest tightness and shortness of breath",
        "symptoms": ["Chest tightness", "Shortness of breath"],
        "duration": [{"symptom": "Chest tightness", "duration": "30 minutes"}],
        "progression": "Sudden", "associated_symptoms": ["Sweating"], "negative_findings": [],
        "urgency": "HIGH", "urgency_indicators": ["Chest tightness", "Shortness of breath"], "urgency_basis": "red_flag_rule",
        "clinical_summary": "Patient reports sudden severe chest tightness and shortness of breath.",
        "assigned_doctor_id": 1, "assigned_doctor_name": "Dr. Sarah Rao", "queue_status": "assigned",
        "triage_score": {"score": 95, "category": "Emergency - Red Flag", "urgent_symptoms": ["Chest tightness", "Shortness of breath"], "rationale": "Acute chest pain & dyspnea red flag matched"}
    })
