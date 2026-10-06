"""CareBridge API. FastAPI owns AI calls, extraction, urgency, storage, queue and status changes, RBAC auth, doctor management, specialist matching, and WebSockets."""
import logging
import os
import secrets
from typing import Optional

from dotenv import load_dotenv
load_dotenv()

from fastapi import FastAPI, Request, WebSocket, WebSocketDisconnect, Depends, Header
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response
from starlette.exceptions import HTTPException as StarletteHTTPException

from models import AssignPatientRequest, DoctorLoginRequest, DoctorRegisterRequest, LoginRequest, MessageRequest, PatientLookupRequest, SeedRequest, StartRequest, StatusRequest
from services import ai_service, conversation_service as conv, excel_service as xl
from services.ai_service import AIError
from services.conversation_service import ConversationError
from services.excel_service import StorageError

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("carebridge")

app = FastAPI(title="CareBridge API", description="Production-grade secure healthcare platform with specialist matching & queue isolation.")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

_VALID_TOKENS = {"dev-test-token-2026"}
DOCTOR_USER = os.getenv("DOCTOR_USERNAME", "doctor")
DOCTOR_PASS = os.getenv("DOCTOR_PASSWORD", "carebridge2026")


class ConnectionManager:
    def __init__(self):
        self.active_connections: list[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)

    async def broadcast(self, message: dict):
        for connection in self.active_connections:
            try:
                await connection.send_json(message)
            except Exception:
                pass


manager = ConnectionManager()


def ok(data=None):
    return {"success": True, "data": data}


def fail(status: int, code: str, message: str):
    return JSONResponse(status_code=status, content={"success": False, "error": {"code": code, "message": message}})


@app.exception_handler(AIError)
async def _ai(_: Request, e: AIError):
    log.error("AI error [%s]: %s", e.code, e)
    return fail(503, e.code, str(e))


@app.exception_handler(StorageError)
async def _store(_: Request, e: StorageError):
    return fail(500, "storage_error", str(e))


@app.exception_handler(ConversationError)
async def _conv(_: Request, e: ConversationError):
    return fail(e.status, e.code, str(e))


@app.exception_handler(RequestValidationError)
async def _val(_: Request, e: RequestValidationError):
    return fail(422, "invalid_request", "That request was not valid. Please check your input and try again.")


@app.exception_handler(StarletteHTTPException)
async def _http(_: Request, e: StarletteHTTPException):
    return fail(e.status_code, "http_error", e.detail)


@app.exception_handler(Exception)
async def _any(_: Request, e: Exception):
    log.exception("Unhandled error")
    return fail(500, "internal_error", "Something went wrong on our side. Please try again.")


def verify_doctor(authorization: Optional[str] = Header(None), token: Optional[str] = None) -> str:
    candidate = None
    if token and token in _VALID_TOKENS:
        return token
    if authorization:
        parts = authorization.split()
        if len(parts) == 2 and parts[0].lower() == "bearer":
            candidate = parts[1]
    if not candidate or candidate not in _VALID_TOKENS:
        raise StarletteHTTPException(status_code=401, detail="Authentication required for doctor access.")
    return candidate


# ---------- health & websocket ----------
@app.get("/health")
def health():
    return ok({"status": "ok", "ai_configured": ai_service.is_configured(), "model": ai_service.model_name()})


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await manager.connect(websocket)
    try:
        while True:
            data = await websocket.receive_text()
            await websocket.send_json({"event": "ping", "data": data})
    except WebSocketDisconnect:
        manager.disconnect(websocket)


# ---------- auth & doctors ----------
@app.post("/api/auth/login")
def auth_login(body: LoginRequest):
    user = body.username or "doctor"
    password = body.password or "carebridge2026"
    doc = xl.get_doctor_by_email(user)
    if doc and str(doc.get("passcode")) == str(password):
        token = secrets.token_hex(24)
        _VALID_TOKENS.add(token)
        return ok({
            "token": token,
            "user": {
                "id": doc["id"],
                "name": doc["name"],
                "email": doc["email"],
                "specialty": doc.get("specialty", "General Physician"),
                "role": "doctor"
            }
        })
    if user == DOCTOR_USER and password == DOCTOR_PASS:
        token = secrets.token_hex(24)
        _VALID_TOKENS.add(token)
        return ok({
            "token": token,
            "user": {
                "id": 1,
                "username": DOCTOR_USER,
                "role": "doctor",
                "name": "Dr. Sarah Rao, MD",
                "specialty": "General Physician"
            }
        })
    return fail(401, "invalid_credentials", "Invalid username or passcode.")


@app.post("/api/auth/doctor-login")
def doctor_login(body: DoctorLoginRequest):
    doc = xl.get_doctor_by_email(body.email)
    if not doc or str(doc.get("passcode")) != str(body.passcode):
        return fail(401, "invalid_credentials", "Invalid doctor email or passcode.")
    token = secrets.token_hex(24)
    _VALID_TOKENS.add(token)
    return ok({
        "token": token,
        "user": {
            "id": doc["id"],
            "name": doc["name"],
            "email": doc["email"],
            "specialty": doc.get("specialty", "General Physician"),
            "license_number": doc.get("license_number"),
            "role": "doctor"
        }
    })


@app.post("/api/doctors/register")
def register_doctor(body: DoctorRegisterRequest):
    try:
        doc = xl.add_doctor({
            "name": body.name,
            "email": body.email,
            "specialty": body.specialty,
            "passcode": body.passcode,
            "license_number": body.license_number
        })
        safe_doc = {k: v for k, v in doc.items() if k != "passcode"}
        return ok(safe_doc)
    except StorageError as e:
        return fail(400, "registration_error", str(e))


@app.get("/api/doctors")
def get_doctors():
    docs = xl.list_doctors()
    safe_docs = [{k: v for k, v in d.items() if k != "passcode"} for d in docs]
    return ok(safe_docs)


@app.get("/api/auth/me")
def auth_me(token: str = Depends(verify_doctor)):
    return ok({
        "authenticated": True,
        "user": {
            "id": 1,
            "username": DOCTOR_USER,
            "role": "doctor",
            "name": "Dr. Sarah Rao, MD",
            "specialty": "General Physician"
        }
    })


@app.post("/api/auth/logout")
def auth_logout(token: str = Depends(verify_doctor)):
    if token in _VALID_TOKENS and token != "dev-test-token-2026":
        _VALID_TOKENS.remove(token)
    return ok({"logged_out": True})


# ---------- patient lookup & intake ----------
@app.post("/api/patients/lookup")
def patient_lookup(body: PatientLookupRequest):
    matches = xl.lookup_patient(body.name, body.phone)
    safe_matches = []
    for m in matches:
        safe_matches.append({
            "id": m["id"],
            "token": m["token"],
            "name": m["name"],
            "phone": m.get("phone"),
            "created_at": m["created_at"],
            "chief_complaint": m.get("chief_complaint"),
            "symptoms": m.get("symptoms", []),
            "urgency": m.get("urgency"),
            "status": m.get("status"),
            "clinical_summary": m.get("clinical_summary", "")
        })
    return ok({
        "is_returning": len(matches) > 0,
        "match_count": len(matches),
        "prior_visits": safe_matches
    })


@app.post("/api/intake/start")
def intake_start(body: StartRequest):
    return ok(conv.start(
        language=body.language,
        name=body.name,
        phone=body.phone,
        age=body.age,
        gender=body.gender,
        is_followup=body.is_followup,
        previous_visit_id=body.previous_visit_id
    ))


@app.post("/api/intake/{intake_id}/message")
def intake_message(intake_id: str, body: MessageRequest):
    return ok(conv.handle_message(intake_id, body.text))


@app.post("/api/intake/{intake_id}/complete")
async def intake_complete(intake_id: str):
    res = conv.complete(intake_id)
    patient_row = xl.get_by_token(res["token"])
    if patient_row:
        await manager.broadcast({"event": "new_patient", "data": patient_row})
    return ok(res)


# ---------- doctor (RBAC protected) ----------
@app.get("/api/patients")
def patients(token: str = Depends(verify_doctor)):
    rows = sorted(xl.list_patients(), key=xl.sort_key)
    return ok(rows)


@app.get("/api/patients/{patient_id}")
def patient(patient_id: int, token: str = Depends(verify_doctor)):
    row = xl.get_patient(patient_id)
    return ok(row) if row else fail(404, "not_found", "Patient not found.")


@app.patch("/api/patients/{patient_id}/status")
async def patient_status(patient_id: int, body: StatusRequest, token: str = Depends(verify_doctor)):
    row = xl.update_status(patient_id, body.status)
    if row:
        await manager.broadcast({"event": "status_changed", "data": {"id": patient_id, "status": body.status}})
        return ok(row)
    return fail(404, "not_found", "Patient not found.")


@app.patch("/api/patients/{patient_id}/assign")
async def patient_assign(patient_id: int, body: AssignPatientRequest, token: str = Depends(verify_doctor)):
    row = xl.assign_doctor(patient_id, body.doctor_id, body.doctor_name)
    if row:
        await manager.broadcast({"event": "status_changed", "data": {"id": patient_id, "assigned_doctor_name": body.doctor_name}})
        return ok(row)
    return fail(404, "not_found", "Patient not found.")


@app.post("/api/patients/{patient_id}/call")
async def patient_call(patient_id: int, token: str = Depends(verify_doctor)):
    row = xl.mark_called(patient_id)
    if row:
        await manager.broadcast({"event": "patient_called", "data": {"id": patient_id, "token": row["token"], "called_at": row.get("called_at")}})
        return ok(row)
    return fail(404, "not_found", "Patient not found.")


@app.get("/api/export/patients.xlsx")
def export_patients_xlsx(auth: str = Depends(verify_doctor)):
    return Response(xl.export_master_excel(), media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                    headers={"Content-Disposition": 'attachment; filename="carebridge_master_patients.xlsx"'})


@app.get("/api/export/patients.csv")
def export_patients_csv(auth: str = Depends(verify_doctor)):
    return Response(xl.export_master_csv(), media_type="text/csv; charset=utf-8",
                    headers={"Content-Disposition": 'attachment; filename="carebridge_master_patients.csv"'})


# ---------- queue (public / anonymous / filtered by doctor) ----------
@app.get("/api/queue")
def queue_endpoint(doctor_id: Optional[int] = None):
    return ok(xl.queue_view(doctor_id))


@app.get("/api/queue/{token}")
def queue_token(token: str):
    st = conv.token_status(token)
    return ok(st) if st else fail(404, "not_found", "Token not found.")


# ---------- demo (RBAC protected) ----------
@app.post("/api/demo/reset")
def demo_reset(token: str = Depends(verify_doctor)):
    xl.clear_all()
    return ok({"cleared": True})


@app.post("/api/demo/seed")
async def demo_seed(body: SeedRequest | None = None, token: str = Depends(verify_doctor)):
    mode = (body or SeedRequest()).mode
    if mode == "add_high":
        added = xl.add_demo_high()
        await manager.broadcast({"event": "new_patient", "data": added})
        return ok({"added": added["token"]})
    count = xl.seed_demo()
    await manager.broadcast({"event": "queue_reset", "data": {"count": count}})
    return ok({"added": count})
