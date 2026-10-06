"""Gemini access (backend only). Every call returns Pydantic-validated data or raises AIError."""
import json
import logging
import os
import re
import time

from pydantic import BaseModel, ValidationError

import prompts
from models import BasicField, BriefOut, FollowupOut, UrgencyAIOut

log = logging.getLogger("carebridge.ai")


class AIError(Exception):
    """Raised for any AI failure; message is safe to show to users."""
    def __init__(self, message: str, code: str = "ai_unavailable"):
        super().__init__(message)
        self.code = code


_client = None


def model_name() -> str:
    return os.getenv("GEMINI_MODEL") or "gemini-3.1-flash-lite"


def is_configured() -> bool:
    return bool(os.getenv("GEMINI_API_KEY"))


def _get_client():
    global _client
    if not is_configured():
        raise AIError("The AI service is not configured. Add GEMINI_API_KEY to backend/.env and restart the backend.", "ai_not_configured")
    if _client is None:
        from google import genai
        from google.genai import types
        _client = genai.Client(api_key=os.environ["GEMINI_API_KEY"], http_options=types.HttpOptions(timeout=30000))
    return _client


def _extract_json(text: str) -> dict:
    text = (text or "").strip()
    if not text:
        raise ValueError("empty AI response")
    text = re.sub(r"^```(?:json)?\s*|\s*```$", "", text, flags=re.I)
    try:
        return json.loads(text)
    except ValueError:
        m = re.search(r"\{.*\}", text, re.S)
        if not m:
            raise
        return json.loads(m.group(0))


def _generate(system: str, user_content: str) -> str:
    from google.genai import types
    client = _get_client()
    cfg = types.GenerateContentConfig(system_instruction=system, response_mime_type="application/json", temperature=0.2)
    last = None
    for attempt in range(3):
        try:
            resp = client.models.generate_content(model=model_name(), contents=user_content, config=cfg)
            return resp.text or ""
        except Exception as e:
            last = e
            msg = str(e)
            log.warning("Gemini call failed (attempt %d): %s", attempt + 1, msg[:300])
            if any(k in msg for k in ("API key", "API_KEY", "PERMISSION_DENIED", "401", "403")):
                raise AIError("The AI service rejected the API key. Check GEMINI_API_KEY in backend/.env.", "ai_auth") from e
            if "404" in msg or "NOT_FOUND" in msg:
                raise AIError(f"The AI model '{model_name()}' is not available. Set GEMINI_MODEL in backend/.env to a model your key can use.", "ai_model") from e
            transient = any(k in msg for k in ("429", "503", "500", "RESOURCE_EXHAUSTED", "UNAVAILABLE", "timed out", "timeout", "Timeout", "Connection"))
            if not transient or attempt == 2:
                break
            time.sleep(1.5 * (attempt + 1))
    raise AIError("The AI service is busy or unreachable right now. Your answers are saved — please try again.") from last


def ask_json(system: str, user_content: str, schema: type[BaseModel]):
    reminder = ""
    for attempt in range(2):
        raw = _generate(system, user_content + reminder)
        try:
            return schema.model_validate(_extract_json(raw))
        except (ValueError, ValidationError) as e:
            log.warning("Invalid AI JSON for %s (attempt %d): %s | raw=%r", schema.__name__, attempt + 1, str(e)[:200], raw[:300])
            reminder = "\n\nYour previous output was not valid. Return ONLY one JSON object exactly matching the requested shape."
    raise AIError("The AI returned an unexpected response. Please try again.", "ai_invalid_output")


def followup(lang_name, patient, extracted, history, followups_asked, min_f, max_f, mode) -> FollowupOut:
    system = prompts.followup_system(lang_name, patient, extracted, followups_asked, min_f, max_f, mode)
    convo = "\n".join(f"{'Patient' if h['role'] == 'user' else 'Assistant'}: {h['content']}" for h in history)
    return ask_json(system, "Conversation so far:\n" + convo + "\n\nRespond now with the JSON object.", FollowupOut)


def clinical_brief(patient, extracted, history, prior_visit: dict | None = None) -> BriefOut:
    convo = "\n".join(f"{'Patient' if h['role'] == 'user' else 'Assistant'}: {h['content']}" for h in history)
    prior_text = f"\nPrior Visit Record for Comparison (patient is returning for follow-up on same issue):\n{json.dumps(prior_visit, ensure_ascii=False)}\n" if prior_visit else ""
    content = (f"Patient: {json.dumps(patient, ensure_ascii=False)}\nExtracted so far: {json.dumps(extracted, ensure_ascii=False)}\n"
               f"{prior_text}Conversation:\n{convo}\n\nWrite the brief JSON now.")
    return ask_json(prompts.brief_system(), content, BriefOut)


def urgency_assessment(patient, extracted, history) -> UrgencyAIOut:
    convo = "\n".join(f"{'Patient' if h['role'] == 'user' else 'Assistant'}: {h['content']}" for h in history)
    content = (f"Patient: {json.dumps(patient, ensure_ascii=False)}\nExtracted: {json.dumps(extracted, ensure_ascii=False)}\n"
               f"Conversation:\n{convo}\n\nReturn the urgency JSON now.")
    return ask_json(prompts.urgency_system(), content, UrgencyAIOut)


def extract_basic(field: str, text: str, lang_name: str) -> str | None:
    out = ask_json(prompts.basic_field_system(field, lang_name), f"Patient said: {text}", BasicField)
    return (out.value or "").strip() or None


SPECIALTY_RULES = {
    "Orthopedics": ["joint", "bone", "pain", "sprain", "fracture", "muscle", "knee", "shoulder", "back", "ankle", "limb", "stiff", "walk", "swelling", "injury"],
    "Dermatology": ["skin", "rash", "burn", "lesion", "itching", "hive", "acne", "wound", "blister", "redness"],
    "Pulmonology": ["cough", "breath", "wheez", "chest", "respiratory", "shortness", "asthma", "oxygen", "throat", "fever"],
    "Neurology": ["dizz", "numb", "migraine", "headache", "seizure", "tingling", "weakness", "stroke", "vision", "faint"],
    "General Physician": ["fever", "fatigue", "cold", "flu", "stomach", "nausea", "diarrhea", "general", "body ache", "weak", "pain", "abdominal"]
}


def recommend_specialist(category: str, description: str, symptoms: list[str]) -> str:
    text = (category + " " + description + " " + " ".join(symptoms)).lower()
    scores = {spec: 0 for spec in SPECIALTY_RULES}
    for spec, keywords in SPECIALTY_RULES.items():
        for kw in keywords:
            if kw in text:
                scores[spec] += 1
    best = max(scores, key=scores.get)
    if scores[best] == 0:
        return "General Physician"
    return best
