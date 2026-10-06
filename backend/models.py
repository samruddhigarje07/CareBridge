import re
from typing import Literal, Optional
from pydantic import BaseModel, Field, field_validator


def validate_phone_number(v: str) -> str:
    cleaned = re.sub(r"[^\d]", "", str(v or ""))
    if len(cleaned) == 12 and cleaned.startswith("91"):
        cleaned = cleaned[2:]
    if not (len(cleaned) == 10 and cleaned[0] in "6789"):
        raise ValueError("Phone number must be a valid 10-digit mobile number starting with 6, 7, 8, or 9.")
    return cleaned

Urgency = Literal["HIGH", "MODERATE", "ROUTINE"]
Status = Literal["waiting", "in_consultation", "completed"]
NOT_REPORTED = "Not reported"


def _coerce_duration(v):
    if v is None:
        return []
    if isinstance(v, dict):
        return [{"symptom": k, "duration": str(d)} for k, d in v.items()]
    return v


def _clean_list(v):
    if v is None:
        return []
    if isinstance(v, str):
        v = [v]
    return [str(x).strip() for x in v if x is not None and str(x).strip()]


class DurationItem(BaseModel):
    symptom: str
    duration: str = NOT_REPORTED


class DifferentialItem(BaseModel):
    condition: str
    confidence: str = "Moderate"
    severity: str = "Routine"
    rationale: str = ""


class TestItem(BaseModel):
    test_name: str
    priority: str = "Routine"
    purpose: str = ""


class TreatmentItem(BaseModel):
    guideline: str
    notes: str = ""


class PhysicalTherapyItem(BaseModel):
    exercise: str
    instructions: str = ""
    frequency: str = ""
    precautions: str = ""


class Vitals(BaseModel):
    bp: Optional[str] = "Not reported"
    heart_rate: Optional[str] = "Not reported"
    temperature: Optional[str] = "Not reported"
    spo2: Optional[str] = "Not reported"


class Extracted(BaseModel):
    """Clinical facts reported by the patient so far (cumulative)."""
    chief_complaint: Optional[str] = None
    symptoms: list[str] = []
    duration: list[DurationItem] = []
    progression: Optional[str] = None
    associated_symptoms: list[str] = []
    negative_findings: list[str] = []
    medical_history: list[str] = []
    vitals: Vitals = Vitals()

    _lists = field_validator("symptoms", "associated_symptoms", "negative_findings", "medical_history", mode="before")(_clean_list)
    _dur = field_validator("duration", mode="before")(_coerce_duration)


class FollowupOut(BaseModel):
    """Validated output of the conversational prompt."""
    reply: str = Field(min_length=1)
    extracted: Extracted = Extracted()
    next_action: Literal["ask_followup", "complete"] = "ask_followup"

    @field_validator("reply")
    @classmethod
    def _strip(cls, v):
        v = v.strip()
        if not v:
            raise ValueError("empty reply")
        return v


class SOAPNote(BaseModel):
    subjective: str = ""
    objective: str = ""
    assessment: str = ""
    plan: str = ""


class TriageScore(BaseModel):
    score: int = Field(default=25, ge=0, le=100)
    category: str = "Low Risk"
    urgent_symptoms: list[str] = []
    rationale: str = ""

    _lists = field_validator("urgent_symptoms", mode="before")(_clean_list)


class ProgressionComparison(BaseModel):
    status: str = "N/A - New Issue"
    summary: str = ""
    resolved_symptoms: list[str] = []
    worsened_symptoms: list[str] = []
    new_symptoms: list[str] = []

    _lists = field_validator("resolved_symptoms", "worsened_symptoms", "new_symptoms", mode="before")(_clean_list)


class BriefOut(BaseModel):
    """Validated output of the clinical-brief prompt."""
    patient_name: str = ""
    chief_complaint: str = NOT_REPORTED
    symptoms: list[str] = []
    duration: list[DurationItem] = []
    progression: str = NOT_REPORTED
    associated_symptoms: list[str] = []
    negative_findings: list[str] = []
    clinical_summary: str = Field(min_length=1)
    differential_diagnosis: list[DifferentialItem] = []
    recommended_tests: list[TestItem] = []
    initial_treatment: list[TreatmentItem] = []
    physical_therapy: list[PhysicalTherapyItem] = []
    vitals: Vitals = Vitals()
    medical_history: list[str] = []
    soap_note: SOAPNote = SOAPNote()
    triage_score: TriageScore = TriageScore()
    progression_comparison: ProgressionComparison = ProgressionComparison()

    _lists = field_validator("symptoms", "associated_symptoms", "negative_findings", "medical_history", mode="before")(_clean_list)

    @field_validator("chief_complaint", "progression", mode="before")
    @classmethod
    def _nr(cls, v):
        v = (str(v).strip() if v is not None else "")
        return v or NOT_REPORTED

    _dur = field_validator("duration", mode="before")(_coerce_duration)


class UrgencyAIOut(BaseModel):
    """Validated output of the contextual urgency prompt."""
    urgency: Urgency
    indicators: list[str] = []

    _lists = field_validator("indicators", mode="before")(_clean_list)

    @field_validator("urgency", mode="before")
    @classmethod
    def _up(cls, v):
        return str(v).strip().upper()


class BasicField(BaseModel):
    value: Optional[str] = None


# ---------- API requests ----------
class PatientLookupRequest(BaseModel):
    name: str = Field(min_length=2)
    phone: str

    _val_phone = field_validator("phone")(validate_phone_number)


class StartRequest(BaseModel):
    language: str = "en"
    name: Optional[str] = None
    phone: Optional[str] = None
    age: Optional[int] = None
    gender: Optional[str] = None
    is_followup: bool = False
    previous_visit_id: Optional[int] = None


class MessageRequest(BaseModel):
    text: str = Field(min_length=1, max_length=2000)


class StatusRequest(BaseModel):
    status: Status


class SeedRequest(BaseModel):
    mode: Literal["all", "add_high"] = "all"


class LoginRequest(BaseModel):
    username: Optional[str] = None
    password: Optional[str] = None


class DoctorRegisterRequest(BaseModel):
    name: str = Field(min_length=2)
    email: str = Field(min_length=5)
    specialty: str = "General Physician"
    passcode: str = Field(min_length=4)
    license_number: str = Field(min_length=3)


class DoctorLoginRequest(BaseModel):
    email: str
    passcode: str


class AssignPatientRequest(BaseModel):
    doctor_id: int
    doctor_name: str
