# CareBridge — Bridging Patient Stories and Clinical Decisions

A multilingual (English / Hindi / Marathi), voice-first **AI pre-consultation assistant**. The patient speaks once; the doctor gets a structured brief and a transparent urgency indicator *before* the consultation starts.

> **Prototype for demonstration. Use synthetic data only. AI-generated information must be verified by a healthcare professional.**
> The AI is **not a doctor**: it does not diagnose, prescribe or recommend treatment. It collects, organises and summarises information. Final clinical decisions remain with the doctor.

## Problem
Patients repeat the same story to reception, nursing and the doctor. Doctors start consultations cold, and clinics have no structured way to see who may need attention first.

## Solution
Patient → voice conversation (basic info → free-form complaint → AI-chosen follow-ups) → structured English brief → explainable urgency (HIGH / MODERATE / ROUTINE) → token + consultation sequence → doctor dashboard + anonymous queue dashboard.

## Architecture
```
 React + Vite (frontend)  ──REST──▶  FastAPI (backend)  ──▶  Gemini API
   Patient | Doctor | Queue            conversation logic        (backend only)
                                       clinical extraction
                                       urgency engine
                                       queue ordering          ──▶  data/patients.xlsx
```
* **Frontend** only knows `VITE_API_URL`. No keys, no medical rules, no Excel, no Gemini.
* **Backend** owns AI calls, extraction, urgency, storage, queue order and status changes.
* No authentication in this MVP (controlled demo). Routes are cleanly separated so auth can be added later.

## Tech stack
React 18 + Vite · Python + FastAPI + Pydantic · Google Gemini (`google-genai`) · openpyxl · Browser Web Speech API (`SpeechRecognition` / `speechSynthesis`).

## Local setup
Requirements: Node 18+, Python 3.10+, Chrome or Edge (best voice support).

**Backend**
```bash
cd backend
python -m venv .venv && source .venv/bin/activate     # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env                                   # then put your Gemini key in .env
uvicorn main:app --reload --port 8000
```
**Frontend**
```bash
cd frontend
npm install
cp .env.example .env
npm run dev                                            # http://localhost:5173
```

### Environment variables
| File | Variable | Purpose |
|---|---|---|
| `backend/.env` | `GEMINI_API_KEY` | Gemini key (backend only) |
| `backend/.env` | `GEMINI_MODEL` | Model name, default `gemini-3.1-flash-lite`. Use any model your key can access (e.g. `gemini-3.5-flash`). Gemini 2.5 models are scheduled for shutdown on 16 Oct 2026. |
| `backend/.env` | `ALLOWED_ORIGINS` | CORS origins, default `http://localhost:5173` |
| `frontend/.env` | `VITE_API_URL` | Backend URL, default `http://localhost:8000` |

### Get a Gemini API key
Open <https://aistudio.google.com/apikey>, sign in, click **Create API key**, paste it in `backend/.env`. The app still loads without a key (Doctor/Queue/demo data work); the patient conversation shows a clear "AI not configured" message.

## Voice features
* **Voice picker** (language screen and conversation screen): choose any voice installed in your browser, e.g. switch English away from a male voice. Default prefers natural / female-sounding Indian voices. Choice is remembered per language. On Windows, Edge has the best free voices ("Microsoft Neerja Online (Natural) - English (India)").
* **🔁 Replay question**: the patient can re-hear the current question any time; the mic resumes afterwards.
* **Call Patient** (Doctor view): announces the token in the **patient's selected language** and also pops a banner + spoken announcement on the patient's own token screen, in their language.

## Excel setup
Nothing to install or create: `backend/data/patients.xlsx` is generated on first run. To look at it without locking the live file, use **Demo ▾ → Download patients.xlsx** (a copy). If you open the live file in Excel on Windows, close it before the app writes again. To reset, use **Demo ▾ → Clear all data** (or delete the file while the backend is stopped).

## Demo in 60 seconds
1. Open the app → **Demo ▾ → Reset & load demo patients** (5 synthetic patients, CB101–CB105).
2. **Patient** → pick a language → *Start voice consultation* → answer name, age, gender → describe symptoms → answer follow-ups → get your token.
3. **Doctor** → structured brief, urgency indicators, actions. **Queue** → anonymous live sequence.
4. **Demo ▾ → Add synthetic HIGH patient** → watch the queue reorder. Mark a patient *In Consultation* then *Completed*.

Try saying: *"I've had fever for three days and since yesterday I'm having trouble breathing."* (or the Hindi/Marathi equivalent) → HIGH via the red-flag rule.

## How the urgency engine works
1. **Deterministic red-flag rules** (`backend/services/urgency_service.py`): breathing difficulty, chest pain, loss of consciousness, severe bleeding, stroke-like symptoms, seizure, severe allergic reaction, poisoning/overdose, self-harm. Text is Unicode-normalised, matched with English/Hindi/Marathi patterns, and **negation-aware** ("no chest pain", "सीने में दर्द नहीं"). Rules run on the patient's own words *and* the English symptoms Gemini extracted.
2. **AI contextual assessment**: Gemini returns `urgency` + short `indicators` (never a diagnosis).
3. **Deterministic final mapping**: any red flag ⇒ `HIGH`; otherwise the AI level. The label, indicators and basis (`red_flag_rule` / `ai_assessment`) are stored and shown to the doctor.

**Queue** = urgency (HIGH=3 > MODERATE=2 > ROUTINE=1), then earlier arrival first. No hidden score. Patients currently in consultation are pinned on top; waiting patients get positions 1..n.

## How Excel storage works
`backend/data/patients.xlsx` (auto-created) has one row per completed consultation: id, token, created_at, name, age, gender, language, chief_complaint, symptoms, duration, progression, associated_symptoms, negative_findings, urgency, urgency_indicators, urgency_basis, clinical_summary, status. List fields are JSON strings. A process-wide lock serialises access and writes are atomic (temp file + replace). The raw conversation is kept in backend memory only during the intake and discarded after the brief is stored. **Close the file in Excel while the app runs** (Windows locks it).

## API (all responses `{"success": true, "data": …}` or `{"success": false, "error": {code, message}}`)
`GET /health` · `POST /api/intake/start` · `POST /api/intake/{id}/message` · `POST /api/intake/{id}/complete` · `GET /api/patients` · `GET /api/patients/{id}` · `PATCH /api/patients/{id}/status` · `GET /api/queue` · `GET /api/queue/{token}` · `POST /api/demo/reset` · `POST /api/demo/seed` (`{"mode":"all"|"add_high"}`)

## Tests
`cd backend && python tests/test_e2e.py` runs the whole patient → brief → Excel → queue → status flow against a stubbed Gemini layer (no key needed).

## Adding a language
Add an entry in `backend/languages.py` (scripted questions, gender words) and in `frontend/src/i18n.js` (`LANGS` + UI strings). Prompts take the language name automatically.

## Future production architecture
Excel is **only** the hackathon persistence layer — replace it with PostgreSQL (or similar) behind the same service interface. Add authentication/roles, audit logging, consent and data-retention policy, encryption, EHR/HL7-FHIR integration, server-side or Indic-optimised speech-to-text (browser recognition quality varies), clinical validation of the red-flag rules with clinicians, WebSocket/SSE instead of polling, and proper regulatory review before any real patient use.
