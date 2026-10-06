"""End-to-end API test with a stubbed Gemini layer (run: python tests/test_e2e.py from backend/)."""
import os, sys, tempfile
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ["PATIENTS_XLSX"] = os.path.join(tempfile.mkdtemp(), "patients.xlsx")
from fastapi.testclient import TestClient
from models import FollowupOut, BriefOut, UrgencyAIOut, Extracted, DifferentialItem, TestItem, TreatmentItem, PhysicalTherapyItem, Vitals
from services import ai_service
import main

state = {"n": 0, "fail": False}
def fake_followup(lang_name, patient, extracted, history, asked, mn, mx, mode):
    if state["fail"]:
        raise ai_service.AIError("busy")
    state["n"] += 1
    ext = Extracted(chief_complaint="Fever", symptoms=["fever", "breathing difficulty"] if "breath" in history[-1]["content"] or "सांस" in history[-1]["content"] else ["fever"],
                    duration=[{"symptom": "fever", "duration": "3 days"}], negative_findings=["no chest pain"] if "no" in history[-1]["content"].lower() else [])
    if mode == "wrap_up" or (asked >= 2 and mode != "must_ask"):
        return FollowupOut(reply="Thank you. I have enough information for your doctor.", extracted=ext, next_action="complete")
    return FollowupOut(reply="Any chest pain?", extracted=ext, next_action="ask_followup")
ai_service.followup = fake_followup
ai_service.clinical_brief = lambda p, e, h, pv=None: BriefOut(
    patient_name="Riya", chief_complaint="Fever for 3 days", symptoms=e["symptoms"], duration=e["duration"],
    clinical_summary="Patient reports fever for 3 days.",
    differential_diagnosis=[DifferentialItem(condition="Viral Fever", confidence="High", severity="Routine", rationale="Fever for 3 days")],
    recommended_tests=[TestItem(test_name="CBC", priority="Routine", purpose="Check WBC")],
    initial_treatment=[TreatmentItem(guideline="Hydration and rest", notes="Monitor temp")],
    physical_therapy=[PhysicalTherapyItem(exercise="Rest", instructions="Lie down", frequency="As needed", precautions="None")],
    vitals=Vitals(bp="120/80", heart_rate="75", temperature="99", spo2="98"),
    medical_history=["None"]
)
ai_service.urgency_assessment = lambda p, e, h: UrgencyAIOut(urgency="MODERATE", indicators=["Persistent fever"])
ai_service.extract_basic = lambda f, t, l: None

c = TestClient(main.app)
AUTH = {"Authorization": "Bearer dev-test-token-2026"}

def run(lang, complaint):
    d = c.post("/api/intake/start", json={"language": lang}).json()["data"]; iid = d["intake_id"]
    for t in ["My name is Riya", "20", "female", complaint, "no", "no"]:
        r = c.post(f"/api/intake/{iid}/message", json={"text": t}).json()
        assert r["success"], r
        if r["data"]["done"]: break
    assert r["data"]["done"], r
    return iid, r["data"]

assert c.get("/health").json()["success"]
assert c.get("/api/queue").json()["data"]["entries"] == []

# Test Doctor Management & Registration
reg_res = c.post("/api/doctors/register", json={
    "name": "Dr. House", "email": "house@princeton.edu", "specialty": "Diagnostics", "passcode": "vicodin1", "license_number": "LIC-9999"
}).json()
assert reg_res["success"], reg_res

doc_list = c.get("/api/doctors").json()
assert doc_list["success"] and len(doc_list["data"]) >= 2

doc_login = c.post("/api/auth/doctor-login", json={"email": "house@princeton.edu", "passcode": "vicodin1"}).json()
assert doc_login["success"], doc_login

# Test Auth Login (Default Admin)
login_res = c.post("/api/auth/login", json={"username": "doctor@carebridge.ai", "password": "carebridge2026"}).json()
assert login_res["success"], login_res
token = login_res["data"]["token"]
auth_headers = {"Authorization": f"Bearer {token}"}
assert c.get("/api/auth/me", headers=auth_headers).json()["success"]

# 1. routine/moderate patient
iid, d = run("en", "I have fever for three days")
assert d["patient"]["name"] == "Riya" and d["patient"]["age"] == 20 and d["patient"]["gender"] == "Female", d["patient"]
res = c.post(f"/api/intake/{iid}/complete").json(); assert res["success"], res
assert res["data"]["token"] == "CB101" and res["data"]["urgency"] == "MODERATE" and res["data"]["position"] == 1, res
assert c.post(f"/api/intake/{iid}/complete").json()["data"]["token"] == "CB101"  # idempotent

# 2. red-flag patient jumps ahead even though he arrives later
iid2, _ = run("hi", "मुझे बुखार है और सांस लेने में तकलीफ है")
res2 = c.post(f"/api/intake/{iid2}/complete").json()["data"]
assert res2["urgency"] == "HIGH" and res2["position"] == 1, res2
q = c.get("/api/queue").json()["data"]["entries"]
assert [e["token"] for e in q] == ["CB102", "CB101"], q
assert all(set(e) == {"position", "token", "urgency", "created_at", "status"} for e in q)  # no PII

p = c.get("/api/patients", headers=auth_headers).json()["data"]
assert p[0]["urgency"] == "HIGH" and "Breathing difficulty" in p[0]["urgency_indicators"] and p[0]["urgency_basis"] == "red_flag_rule"
assert "history" not in p[0] and "transcript" not in p[0]
assert len(p[0]["differential_diagnosis"]) > 0

# 3. status changes
assert c.patch(f"/api/patients/{p[0]['id']}/status", json={"status": "in_consultation"}, headers=auth_headers).json()["data"]["status"] == "in_consultation"
q = c.get("/api/queue").json()["data"]; assert q["entries"][0]["token"] == "CB102" and q["entries"][0]["position"] is None and q["waiting"] == 1
c.patch(f"/api/patients/{p[0]['id']}/status", json={"status": "completed"}, headers=auth_headers)
assert [e["token"] for e in c.get("/api/queue").json()["data"]["entries"]] == ["CB101"]

# 3b. call patient -> patient-visible token status carries called_at, in their language
assert c.get("/api/queue/CB101").json()["data"]["called_at"] is None
r = c.post(f"/api/patients/{p[1]['id']}/call", headers=auth_headers).json(); assert r["success"] and r["data"]["called_at"]
st = c.get("/api/queue/CB101").json()["data"]; assert st["called_at"] and st["language"] == "en"
assert c.post("/api/patients/999/call", headers=auth_headers).status_code == 404
x = c.get("/api/export/patients.xlsx", headers=auth_headers); assert x.status_code == 200 and x.content[:2] == b"PK"

# 4. AI outage keeps state and allows retry
d = c.post("/api/intake/start", json={"language": "en"}).json()["data"]; i3 = d["intake_id"]
for t in ["Sam", "40", "male"]: c.post(f"/api/intake/{i3}/message", json={"text": t})
state["fail"] = True
r = c.post(f"/api/intake/{i3}/message", json={"text": "cough"}); assert r.status_code == 503 and not r.json()["success"]
state["fail"] = False
r = c.post(f"/api/intake/{i3}/message", json={"text": "cough"}).json(); assert r["success"] and r["data"]["patient"]["name"] == "Sam"

# 5. validation + unknown + demo
assert c.post("/api/intake/nope/message", json={"text": "hi"}).status_code == 404
assert c.post("/api/intake/start", json={"language": "en"}).status_code == 200
assert c.post(f"/api/intake/{i3}/complete").status_code == 409

# Test Patient Lookup & Phone Validation
lookup_fail = c.post("/api/patients/lookup", json={"name": "Riya", "phone": "123"})
assert lookup_fail.status_code == 422  # invalid 10-digit phone format

lookup_ok = c.post("/api/patients/lookup", json={"name": "Riya", "phone": "9820012345"}).json()
assert lookup_ok["success"]
assert lookup_ok["data"]["is_returning"] is True
assert len(lookup_ok["data"]["prior_visits"]) >= 1

# Test Follow-up Intake Flow with Pre-filled Profile
followup_init = c.post("/api/intake/start", json={
    "language": "en",
    "name": "Riya",
    "phone": "9820012345",
    "age": 20,
    "gender": "Female",
    "is_followup": True,
    "previous_visit_id": lookup_ok["data"]["prior_visits"][0]["id"]
}).json()
assert followup_init["success"]
assert followup_init["data"]["stage"] == "complaint"

c.post("/api/demo/reset", headers=auth_headers)
seed_res = c.post("/api/demo/seed", headers=auth_headers).json()
assert seed_res["data"]["added"] == 7
assert c.post("/api/demo/seed", json={"mode": "add_high"}, headers=auth_headers).json()["success"]
print("ALL E2E CHECKS PASSED")
