"""Conversation state machine. The backend (not the model) owns stage, counters and completion.

Stages: name -> age -> gender -> complaint -> followup -> complete
Basic info is parsed locally (fast, no API call) with a Gemini fallback only when parsing fails.
Raw conversation lives only in memory for the duration of the intake and is never stored in Excel.
"""
import logging
import re
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone

from languages import lang_cfg, LANGUAGES, DEFAULT_LANG
from models import Extracted, NOT_REPORTED, UrgencyAIOut
from services import ai_service, excel_service, urgency_service
from services.ai_service import AIError

log = logging.getLogger("carebridge.conversation")

MIN_FOLLOWUPS = 2
MAX_FOLLOWUPS = 6
SESSION_TTL = 60 * 60
_sessions: dict[str, dict] = {}
_lock = threading.RLock()

EN_NUMS = {"zero": 0, "one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7, "eight": 8, "nine": 9, "ten": 10,
           "eleven": 11, "twelve": 12, "thirteen": 13, "fourteen": 14, "fifteen": 15, "sixteen": 16, "seventeen": 17, "eighteen": 18,
           "nineteen": 19, "twenty": 20, "thirty": 30, "forty": 40, "fifty": 50, "sixty": 60, "seventy": 70, "eighty": 80, "ninety": 90}


class ConversationError(Exception):
    def __init__(self, message: str, code: str, status: int = 400):
        super().__init__(message)
        self.code, self.status = code, status


# ---------- session helpers ----------
def _purge():
    now = time.time()
    for k in [k for k, s in _sessions.items() if now - s["touched"] > SESSION_TTL]:
        del _sessions[k]


def _get(intake_id: str) -> dict:
    with _lock:
        _purge()
        s = _sessions.get(intake_id)
    if not s:
        raise ConversationError("This consultation has expired. Please start again.", "intake_not_found", 404)
    s["touched"] = time.time()
    return s


def _view(s: dict, reply: str | None = None) -> dict:
    stage = s["stage"]
    step = 2 if stage in ("name", "age", "gender") else 3
    return {"intake_id": s["id"], "language": s["language"], "stage": stage, "step": step,
            "reply": reply, "done": s["stage"] == "complete", "patient": s["patient"],
            "extracted": s["extracted"].model_dump(), "followups_asked": s["followups"]}


# ---------- local parsers ----------
def _tokens(text: str) -> list[str]:
    return re.findall(r"[\u0900-\u097F]+|[a-zA-Z']+", urgency_service.normalize(text))


def parse_age(text: str) -> int | None:
    t = urgency_service.normalize(text)
    m = re.search(r"\d{1,3}", t)
    if m:
        n = int(m.group())
        return n if 0 < n < 121 else None
    toks = _tokens(t)
    total, found = 0, False
    for tok in toks:
        if tok in EN_NUMS:
            total += EN_NUMS[tok]
            found = True
    return total if found and 0 < total < 121 else None


def parse_gender(text: str, lang: str) -> str | None:
    toks = set(_tokens(text))
    cfg = lang_cfg(lang)["gender"]
    # check every language's words so mixed-language answers still work; female before male
    for key, label in (("female", "Female"), ("male", "Male"), ("other", "Other")):
        words = set(cfg[key])
        for other in LANGUAGES.values():
            words |= set(other["gender"][key])
        if toks & words:
            return label
    return None


def parse_name(text: str, lang: str) -> str | None:
    t = re.sub(r"[.!?,।]+", " ", text).strip()
    cfg = lang_cfg(lang)
    changed = True
    while changed:
        changed = False
        for p in cfg["name_prefixes"] + LANGUAGES["en"]["name_prefixes"]:
            n = re.sub(rf"^\s*{p}(?=\s|$)", "", t, flags=re.I).strip()
            if n != t:
                t, changed = n, True
        for p in cfg["name_suffixes"]:
            n = re.sub(rf"(?<=\s){p}\s*$", "", t, flags=re.I).strip()
            if n != t:
                t, changed = n, True
    if not t or re.search(r"\d", t) or len(t.split()) > 4 or len(t) > 60:
        return None
    return " ".join(w[:1].upper() + w[1:] if w.isascii() else w for w in t.split())


# ---------- public API ----------
def start(language: str, name: str | None = None, phone: str | None = None, age: int | None = None,
          gender: str | None = None, is_followup: bool = False, previous_visit_id: int | None = None) -> dict:
    language = language if language in LANGUAGES else DEFAULT_LANG
    cfg = lang_cfg(language)
    
    prior_visit = None
    if is_followup and previous_visit_id:
        prior_visit = excel_service.get_patient(previous_visit_id)

    has_profile = bool(name and age and gender)
    stage = "complaint" if has_profile else "name"
    
    patient_info = {
        "name": name,
        "phone": phone or "9820012345",
        "age": age,
        "gender": gender
    }
    
    s = {"id": uuid.uuid4().hex[:12], "language": language, "stage": stage,
         "patient": patient_info, "is_followup": is_followup,
         "previous_visit_id": previous_visit_id, "prior_visit": prior_visit,
         "history": [], "extracted": Extracted(), "followups": 0, "touched": time.time(), "result": None,
         "created_at": datetime.now(timezone.utc).isoformat(), "urgent_hint": False}
    with _lock:
        _purge()
        _sessions[s["id"]] = s
        
    if has_profile:
        greeting = f"{cfg['greeting']} Welcome {name}. {cfg['ask_complaint']}"
    else:
        greeting = f"{cfg['greeting']} {cfg['ask_name']}"
        
    return _view(s, greeting)


def handle_message(intake_id: str, text: str) -> dict:
    s = _get(intake_id)
    text = text.strip()
    if not text:
        raise ConversationError("I didn't hear anything. Please try again.", "empty_message")
    cfg, lang = lang_cfg(s["language"]), s["language"]
    lang_name = cfg["name"]
    stage = s["stage"]

    if stage == "complete":
        raise ConversationError("This consultation is already finished.", "already_complete", 409)

    if stage == "name":
        name = parse_name(text, lang) or (ai_service.extract_basic("name", text, lang_name) if len(text.split()) > 1 else None)
        if not name:
            return _view(s, cfg["reask_name"])
        s["patient"]["name"], s["stage"] = name, "age"
        return _view(s, cfg["ask_age"].format(name=name))

    if stage == "age":
        age = parse_age(text)
        if age is None:
            v = ai_service.extract_basic("age", text, lang_name)
            age = parse_age(v) if v else None
        if age is None:
            return _view(s, cfg["reask_age"])
        s["patient"]["age"], s["stage"] = age, "gender"
        return _view(s, cfg["ask_gender"])

    if stage == "gender":
        gender = parse_gender(text, lang)
        if not gender:
            v = ai_service.extract_basic("gender", text, lang_name)
            gender = v.capitalize() if v and v.capitalize() in ("Female", "Male", "Other") else None
        if not gender:
            return _view(s, cfg["reask_gender"])
        s["patient"]["gender"], s["stage"] = gender, "complaint"
        return _view(s, cfg["ask_complaint"])

    # ---- complaint / follow-up: adaptive Gemini turn ----
    history = s["history"] + [{"role": "user", "content": text}]
    if urgency_service.detect_red_flags([text]):
        s["urgent_hint"] = True
    asked = s["followups"]

    # Enforce minimum follow-ups so the AI listens to the full story and does not cut off early
    if asked >= MAX_FOLLOWUPS or (s["urgent_hint"] and asked >= 2):
        mode = "wrap_up"
    elif asked < MIN_FOLLOWUPS:
        mode = "must_ask"
    else:
        mode = "normal"

    patient = {k: v for k, v in s["patient"].items()}
    out = ai_service.followup(lang_name, patient, s["extracted"].model_dump(), history, asked, MIN_FOLLOWUPS, MAX_FOLLOWUPS, mode)
    if (mode == "must_ask" or asked < MIN_FOLLOWUPS) and out.next_action == "complete":  # model tried to finish too early
        out = ai_service.followup(lang_name, patient, s["extracted"].model_dump(), history, asked, MIN_FOLLOWUPS, MAX_FOLLOWUPS, "must_ask")

    # state changes only after the model call succeeded (nothing is lost on failure)
    s["extracted"] = _merge(s["extracted"], out.extracted)
    
    # Do not complete before MIN_FOLLOWUPS is reached unless forced wrap_up
    finish = (out.next_action == "complete" and asked >= MIN_FOLLOWUPS) or mode == "wrap_up"
    reply = out.reply
    if finish:
        s["stage"] = "complete"
        if out.next_action != "complete":  # model ignored wrap-up instruction
            reply = cfg["closing"]
    else:
        s["stage"] = "followup"
        s["followups"] += 1
    s["history"] = history + [{"role": "assistant", "content": reply}]
    return _view(s, reply)


def _merge(old: Extracted, new: Extracted) -> Extracted:
    """Union-merge so a sloppy model turn can never erase earlier facts."""
    def uni(a, b):
        seen, res = set(), []
        for x in [*a, *b]:
            if x.lower() not in seen:
                seen.add(x.lower())
                res.append(x)
        return res
    dur = {d.symptom.lower(): d for d in old.duration}
    for d in new.duration:
        dur[d.symptom.lower()] = d
    return Extracted(chief_complaint=new.chief_complaint or old.chief_complaint,
                     symptoms=uni(old.symptoms, new.symptoms), duration=list(dur.values()),
                     progression=new.progression or old.progression,
                     associated_symptoms=uni(old.associated_symptoms, new.associated_symptoms),
                     negative_findings=uni(old.negative_findings, new.negative_findings))


def complete(intake_id: str) -> dict:
    """Generate brief + urgency, store in Excel, return the patient-safe result. Idempotent."""
    s = _get(intake_id)
    with _lock:
        if s["result"]:
            return _result_view(s["result"]["token"])
        if s["stage"] != "complete":
            raise ConversationError("The consultation is not finished yet.", "not_finished", 409)
        patient = {k: v for k, v in s["patient"].items()}
        extracted = s["extracted"].model_dump()
        history = s["history"]
        prior_visit = s.get("prior_visit")
        with ThreadPoolExecutor(max_workers=2) as ex:
            f_brief = ex.submit(ai_service.clinical_brief, patient, extracted, history, prior_visit)
            f_urg = ex.submit(ai_service.urgency_assessment, patient, extracted, history)
            brief, ai_urg = f_brief.result(), f_urg.result()

        patient_texts = [h["content"] for h in history if h["role"] == "user"]
        positive = [*brief.symptoms, *brief.associated_symptoms, brief.chief_complaint, *s["extracted"].symptoms]
        flags = urgency_service.detect_red_flags(patient_texts + positive)
        urgency, indicators, basis = urgency_service.final_urgency(flags, ai_urg)

        # fall back to extracted data for anything the brief left empty — never invent
        symptoms = brief.symptoms or s["extracted"].symptoms
        vitals_dict = brief.vitals.model_dump() if brief.vitals else s["extracted"].vitals.model_dump()
        triage_score_calc = urgency_service.compute_triage_score(urgency, flags, vitals=vitals_dict, symptoms=symptoms)
        
        # Merge AI triage score with deterministic score
        if brief.triage_score and brief.triage_score.urgent_symptoms:
            for us in brief.triage_score.urgent_symptoms:
                if us not in triage_score_calc["urgent_symptoms"]:
                    triage_score_calc["urgent_symptoms"].append(us)
        if brief.triage_score and brief.triage_score.rationale:
            triage_score_calc["rationale"] = brief.triage_score.rationale

        # Build clean SOAP note if missing
        soap_dict = brief.soap_note.model_dump() if brief.soap_note else {}
        if not soap_dict.get("subjective"):
            soap_dict = {
                "subjective": f"Chief complaint: {brief.chief_complaint}. Patient reports: {brief.clinical_summary}",
                "objective": f"Reported vitals: BP {vitals_dict.get('bp', 'Not reported')}, HR {vitals_dict.get('heart_rate', 'Not reported')}, Temp {vitals_dict.get('temperature', 'Not reported')}, SpO2 {vitals_dict.get('spo2', 'Not reported')}. Negative findings: {', '.join(brief.negative_findings) or 'None'}",
                "assessment": f"Differential diagnoses: {', '.join([d.condition for d in brief.differential_diagnosis]) or 'Under evaluation'}. Clinical Urgency: {urgency}. Triage Risk: {triage_score_calc['category']}.",
                "plan": f"Initial treatment: {', '.join([t.guideline for t in brief.initial_treatment]) or 'Supportive care'}. Recommended tests: {', '.join([t.test_name for t in brief.recommended_tests]) or 'Clinical evaluation'}."
            }

        comparison_dict = brief.progression_comparison.model_dump() if brief.progression_comparison else {}
        if s.get("is_followup") and prior_visit and not comparison_dict.get("summary"):
            comparison_dict = {
                "status": "Persistent / Stable",
                "summary": f"Follow-up visit regarding previous complaint: {prior_visit.get('chief_complaint')}.",
                "resolved_symptoms": [],
                "worsened_symptoms": [],
                "new_symptoms": symptoms
            }

        now_iso = datetime.now(timezone.utc).isoformat()
        report_data = {
            "report_id": f"REP-{s['id'].upper()}",
            "generated_at": now_iso,
            "patient_name": brief.patient_name.strip() or s["patient"]["name"],
            "age": s["patient"]["age"],
            "gender": s["patient"]["gender"],
            "language": s["language"],
            "chief_complaint": brief.chief_complaint,
            "clinical_summary": brief.clinical_summary,
            "urgency": urgency,
            "triage_score": triage_score_calc.get("score", 25),
            "triage_category": triage_score_calc.get("category", urgency),
            "soap_note": soap_dict,
            "vitals": vitals_dict,
            "symptoms": symptoms,
            "duration": [d.model_dump() for d in (brief.duration or s["extracted"].duration)],
            "progression": brief.progression,
            "negative_findings": brief.negative_findings or s["extracted"].negative_findings,
            "differential_diagnosis": [d.model_dump() for d in brief.differential_diagnosis],
            "recommended_tests": [t.model_dump() for t in brief.recommended_tests],
            "initial_treatment": [tr.model_dump() for tr in brief.initial_treatment],
            "physical_therapy": [pt.model_dump() for pt in brief.physical_therapy],
            "medical_history": brief.medical_history or s["extracted"].medical_history
        }

        record = {
            "name": brief.patient_name.strip() or s["patient"]["name"],
            "phone": s["patient"].get("phone") or "9820012345",
            "age": s["patient"]["age"],
            "gender": s["patient"]["gender"],
            "language": s["language"],
            "chief_complaint": brief.chief_complaint,
            "symptoms": symptoms,
            "duration": [d.model_dump() for d in (brief.duration or s["extracted"].duration)],
            "progression": brief.progression,
            "associated_symptoms": brief.associated_symptoms or s["extracted"].associated_symptoms,
            "negative_findings": brief.negative_findings or s["extracted"].negative_findings,
            "urgency": urgency,
            "urgency_indicators": indicators,
            "urgency_basis": basis,
            "clinical_summary": brief.clinical_summary,
            "differential_diagnosis": [d.model_dump() for d in brief.differential_diagnosis],
            "recommended_tests": [t.model_dump() for t in brief.recommended_tests],
            "initial_treatment": [tr.model_dump() for tr in brief.initial_treatment],
            "physical_therapy": [pt.model_dump() for pt in brief.physical_therapy],
            "vitals": vitals_dict,
            "medical_history": brief.medical_history or s["extracted"].medical_history,
            "status": "waiting",
            "soap_note": soap_dict,
            "triage_score": triage_score_calc,
            "visit_type": "followup" if s.get("is_followup") else "new",
            "previous_visit_id": s.get("previous_visit_id"),
            "progression_comparison": comparison_dict,
            "report": report_data
        }
        saved = excel_service.add_patient(record)
        s["result"] = {"token": saved["token"], "patient_id": saved["id"]}
        s["history"] = []  # raw conversation is discarded once the structured record exists
        return _result_view(saved["token"])


def _result_view(token: str) -> dict:
    return token_status(token)


def token_status(token: str) -> dict | None:
    """What the PATIENT may see: their own token/status/urgency/position only."""
    r = excel_service.get_by_token(token)
    if not r:
        return None
    pos = excel_service.queue_position(token) if r["status"] == "waiting" else None
    return {"token": r["token"], "status": r["status"], "urgency": r["urgency"], "position": pos, "language": r["language"], "called_at": r.get("called_at")}
