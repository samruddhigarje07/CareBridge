import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../services/api";
import { cancelSpeech, listenOnce, speak, srSupported, ttsSupported } from "../services/speech";
import { LANGS, UI, callMessage } from "../i18n";
import { Mic, Shield } from "../components/Art";
import { StatusBadge, UrgencyBadge, Disclaimer } from "../components/Badges";
import VoiceConsult from "../components/VoiceConsult";

const PHONE_REGEX = /^[6-9]\d{9}$/;

export default function Patient() {
  const [lang, setLang] = useState("en");
  const t = UI[lang] || UI.en;
  const [step, setStep] = useState("details"); // "details" | "returning_prompt" | "symptoms" | "live_voice"
  const [form, setForm] = useState({
    name: "",
    phone: "",
    age: "28",
    gender: "Female",
  });
  const [phoneTouched, setPhoneTouched] = useState(false);
  const [priorVisits, setPriorVisits] = useState([]);
  const [isFollowup, setIsFollowup] = useState(false);
  const [prevVisitId, setPrevVisitId] = useState(null);

  // Symptom input states
  const [symptomText, setSymptomText] = useState("");
  const [durationText, setDurationText] = useState("3 days");
  const [vitalsBp, setVitalsBp] = useState("120/80");
  const [isListening, setIsListening] = useState(false);
  const [interimText, setInterimText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [showSummary, setShowSummary] = useState(false);

  // Result & Queue Polling
  const [result, setResult] = useState(null);
  const [err, setErr] = useState("");
  const micListener = useRef(null);
  const lastCall = useRef(null);

  const cleanPhone = form.phone.replace(/\D/g, "");
  const isPhoneValid = PHONE_REGEX.test(cleanPhone);

  const stopAudio = useCallback(() => {
    micListener.current?.abort();
    micListener.current = null;
    cancelSpeech();
  }, []);

  useEffect(() => {
    return () => stopAudio();
  }, [stopAudio]);

  // Voice announcement when patient token is called
  const calledAt = result?.called_at;
  useEffect(() => {
    if (!calledAt || calledAt === lastCall.current) return;
    lastCall.current = calledAt;
    const l = LANGS[result.language] ? result.language : lang;
    speak(callMessage(l, result.token), LANGS[l].code);
  }, [calledAt]); // eslint-disable-line react-hooks/exhaustive-deps

  // Live queue polling for active token
  useEffect(() => {
    if (!result?.token) return;
    const id = setInterval(() => {
      api.tokenStatus(result.token).then(setResult).catch(() => {});
    }, 3500);
    return () => clearInterval(id);
  }, [result?.token]);

  // Handle Basic Details Submission & Identity Verification
  async function handleVerifyDetails(e) {
    e.preventDefault();
    setPhoneTouched(true);
    setErr("");

    if (!isPhoneValid) {
      setErr("Please provide a valid 10-digit mobile number (e.g. 9820012345).");
      return;
    }
    if (!form.name.trim()) {
      setErr("Please enter your full name.");
      return;
    }

    try {
      setSubmitting(true);
      const res = await api.lookupPatient(form.name.trim(), cleanPhone);
      if (res.is_returning && res.prior_visits?.length > 0) {
        setPriorVisits(res.prior_visits);
        setStep("returning_prompt");
      } else {
        setIsFollowup(false);
        setPrevVisitId(null);
        setStep("symptoms");
      }
    } catch (e) {
      // If lookup fails, seamlessly proceed to intake
      setIsFollowup(false);
      setPrevVisitId(null);
      setStep("symptoms");
    } finally {
      setSubmitting(false);
    }
  }

  // Handle Returning Patient Choice
  function handleReturningChoice(isSameIssue) {
    if (isSameIssue && priorVisits.length > 0) {
      setIsFollowup(true);
      setPrevVisitId(priorVisits[0].id);
      // Pre-fill context if desired
      setSymptomText(`Follow-up on previous issue (${priorVisits[0].chief_complaint}): `);
    } else {
      setIsFollowup(false);
      setPrevVisitId(null);
      setSymptomText("");
    }
    setStep("symptoms");
  }

  // Interactive Voice-to-Text Microphone Dictation (Web Speech API)
  async function toggleDictation() {
    setErr("");
    if (isListening) {
      micListener.current?.stop();
      setIsListening(false);
      return;
    }
    if (!srSupported()) {
      setErr("Voice dictation is not supported in this browser. Please use Chrome/Edge or type below.");
      return;
    }

    setIsListening(true);
    setInterimText("");
    const l = listenOnce(LANGS[lang].code, {
      onInterim: (txt) => setInterimText(txt)
    });
    micListener.current = l;

    try {
      const finalSaid = await l.promise;
      setSymptomText((prev) => (prev ? `${prev.trim()} ${finalSaid.trim()}` : finalSaid.trim()));
    } catch (e) {
      if (e.code === "not-allowed") {
        setErr("Microphone permission denied. Please allow microphone access in your browser settings.");
      } else if (e.code !== "aborted" && e.code !== "no-speech") {
        setErr("Could not capture speech. Please try speaking again or type your symptoms.");
      }
    } finally {
      setIsListening(false);
      setInterimText("");
    }
  }

  // Submit Symptom Intake & Generate Token
  async function handleSymptomSubmit(e) {
    e.preventDefault();
    if (!symptomText.trim()) {
      setErr("Please describe your symptoms or tap the microphone to speak.");
      return;
    }

    setSubmitting(true);
    setErr("");
    try {
      const intakeInit = await api.startIntake({
        language: lang,
        name: form.name.trim(),
        phone: cleanPhone,
        age: parseInt(form.age, 10) || 28,
        gender: form.gender,
        is_followup: isFollowup,
        previous_visit_id: prevVisitId
      });

      const messageText = `${symptomText.trim()}. Duration: ${durationText}. Vitals BP: ${vitalsBp}.`;
      await api.sendMessage(intakeInit.intake_id, messageText);
      const res = await api.completeIntake(intakeInit.intake_id);
      setResult(res);
    } catch (e) {
      setErr(e.message || "Failed to process consultation intake. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  function reset() {
    stopAudio();
    lastCall.current = null;
    setResult(null);
    setErr("");
    setSymptomText("");
    setIsListening(false);
    setInterimText("");
    setPriorVisits([]);
    setIsFollowup(false);
    setPrevVisitId(null);
    setShowSummary(false);
    setStep("details");
  }

  // 1. RESULT TOKEN SCREEN
  if (result) {
    const isCalled = Boolean(result.called_at);
    return (
      <div className="card narrow center mt-4" style={{ padding: "32px" }}>
        <span className="tok">{t.yourToken}</span>
        <div className="token">{result.token}</div>

        {isCalled && (
          <div className="alertbar mt-2" role="alert" style={{ background: "rgba(255, 180, 84, 0.2)", borderColor: "var(--urg-mod)" }}>
            📢 <b>{t.doctorCallingAlert}</b>
          </div>
        )}

        <div className="facts mt-3">
          <div><dt>{t.status}</dt><dd><StatusBadge status={result.status} /></dd></div>
          <div><dt>{t.clinicalPriority}</dt><dd><UrgencyBadge level={result.urgency} /></dd></div>
          <div><dt>{t.queuePos}</dt><dd><b className="posn">{result.position ?? "—"}</b></dd></div>
        </div>

        <p className="mut small mt-3">
          {t.keepScreenOpen}
        </p>

        <div className="row center mt-4" style={{ gap: "10px", flexWrap: "wrap" }}>
          <button className="btn" onClick={() => setShowSummary(true)}>
            {t.viewMyReport}
          </button>
          <button className="btn pri" onClick={reset}>
            {t.regNewConsult}
          </button>
        </div>

        {showSummary && (
          <div className="modal-backdrop" style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", display: "grid", placeItems: "center", zIndex: 1000, padding: "20px" }}>
            <div className="card" style={{ maxWidth: "560px", width: "100%", maxHeight: "85vh", overflowY: "auto", textAlign: "left", padding: "24px", position: "relative" }}>
              <div className="flex-between">
                <div>
                  <div className="lbl" style={{ color: "var(--ac)" }}>CAREBRIDGE CONSULTATION SUMMARY</div>
                  <h3 className="mt-1">{form.name} ({form.age}y, {form.gender})</h3>
                </div>
                <button className="btn sm" onClick={() => setShowSummary(false)}>✕</button>
              </div>
              <div className="mt-3" style={{ display: "grid", gap: "10px" }}>
                <div><b>Token:</b> <span className="tok" style={{ fontSize: "14px" }}>{result.token}</span></div>
                <div><b>Status:</b> <StatusBadge status={result.status} /> &nbsp; <b>Priority:</b> <UrgencyBadge level={result.urgency} /></div>
                <div><b>Symptom Summary:</b> <p className="mut small mt-1">{symptomText || "Symptoms gathered during pre-consultation."}</p></div>
                <div><b>Duration:</b> <span className="small">{durationText || "Not specified"}</span></div>
                <div><b>Vitals:</b> <span className="small">{vitalsBp || "Not specified"}</span></div>
              </div>
              <div className="mt-4 center">
                <button className="btn pri sm" onClick={() => setShowSummary(false)}>Close Summary</button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // 2. LIVE CONVERSATIONAL AI MODE
  if (step === "live_voice") {
    return (
      <VoiceConsult
        onBack={() => setStep("symptoms")}
        onDone={setResult}
        initialLang={lang}
        initialPatient={{
          name: form.name.trim(),
          phone: cleanPhone,
          age: parseInt(form.age, 10) || 28,
          gender: form.gender,
          language: lang,
          is_followup: isFollowup,
          previous_visit_id: prevVisitId
        }}
      />
    );
  }

  // 3. RETURNING PATIENT DIALOGUE PROMPT
  if (step === "returning_prompt") {
    const lastVisit = priorVisits[0];
    return (
      <div className="card narrow mt-4" style={{ padding: "32px" }}>
        <div className="lbl" style={{ color: "var(--ac)" }}>{t.returningBadge}</div>
        <h2 className="mt-1">{t.welcomeBack}, {form.name}!</h2>
        <p className="mut small mt-1">
          <b>{priorVisits.length} {t.recordsFound}</b>: <b>{cleanPhone}</b>.
        </p>

        {lastVisit && (
          <div className="card mt-3" style={{ background: "rgba(124, 140, 255, 0.08)", borderColor: "var(--line)", padding: "16px" }}>
            <div className="flex-between">
              <b>{t.recentConsult} ({lastVisit.token})</b>
              <UrgencyBadge level={lastVisit.urgency} />
            </div>
            <div className="mut small mt-1">{t.date}: {new Date(lastVisit.created_at).toLocaleDateString()}</div>
            <div className="small mt-2"><b>{t.previousComplaint}:</b> {lastVisit.chief_complaint}</div>
            {lastVisit.symptoms?.length > 0 && (
              <div className="small mut mt-1"><b>{t.symptoms}:</b> {lastVisit.symptoms.join(", ")}</div>
            )}
          </div>
        )}

        <div className="mt-4">
          <label className="lbl" style={{ fontSize: "14px", display: "block", marginBottom: "12px" }}>
            {t.returningChoiceTitle}
          </label>
          <div style={{ display: "grid", gap: "12px" }}>
            <button
              className="card tile left"
              style={{ padding: "18px", margin: 0, cursor: "pointer", borderColor: "var(--ac)", background: "rgba(79, 227, 193, 0.06)" }}
              onClick={() => handleReturningChoice(true)}
            >
              <div style={{ fontWeight: 600, fontSize: "16px", color: "var(--ac)" }}>
                {t.followupChoice}
              </div>
              <div className="mut small mt-1">
                {t.followupChoiceSub}
              </div>
            </button>

            <button
              className="card tile left"
              style={{ padding: "18px", margin: 0, cursor: "pointer" }}
              onClick={() => handleReturningChoice(false)}
            >
              <div style={{ fontWeight: 600, fontSize: "16px" }}>
                {t.newIssueChoice}
              </div>
              <div className="mut small mt-1">
                {t.newIssueChoiceSub}
              </div>
            </button>
          </div>
        </div>

        <div className="mt-4 center">
          <button className="link" onClick={() => setStep("details")}>{t.editContactDetails}</button>
        </div>
      </div>
    );
  }

  // 4. STEP 2: SYMPTOM INTAKE & VOICE-TO-TEXT DICTATION
  if (step === "symptoms") {
    return (
      <div className="card narrow mt-4" style={{ padding: "32px" }}>
        <div className="flex-between">
          <div>
            <div className="lbl" style={{ color: "var(--ac)" }}>
              {isFollowup ? t.step2BadgeFollowup : t.step2Badge}
            </div>
            <h2>{t.symptomsTitle}</h2>
          </div>
          <button className="btn sm" onClick={() => setStep("details")}>{t.back}</button>
        </div>

        <p className="mut small mt-1">
          {isFollowup ? t.symptomsSubFollowup : t.symptomsSub}
        </p>

        {err && <div className="errbox mt-2"><span>{err}</span></div>}

        <form onSubmit={handleSymptomSubmit} className="mt-3" style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          <div>
            <div className="flex-between">
              <label className="lbl">{t.symptomLabel}</label>
              <button
                type="button"
                className={`btn sm ${isListening ? "pri animate-pulse" : ""}`}
                onClick={toggleDictation}
                title="Tap to speak your symptoms"
                style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}
              >
                <Mic />
                {isListening ? t.listeningTapStop : t.dictateVoice}
              </button>
            </div>

            <textarea
              rows={4}
              className="mt-1"
              value={symptomText}
              onChange={(e) => setSymptomText(e.target.value)}
              placeholder={t.symptomPh}
              required
              style={{
                width: "100%",
                padding: "14px",
                borderRadius: "12px",
                background: "rgba(120, 120, 120, 0.08)",
                color: "var(--tx)",
                border: isListening ? "1px solid var(--ac)" : "1px solid var(--line)",
                lineHeight: "1.5"
              }}
            />

            {isListening && (
              <div className="mut small mt-1" style={{ color: "var(--ac)" }}>
                <span className="vc-orb live" style={{ display: "inline-block", marginRight: "6px" }} />
                Listening in <b>{LANGS[lang]?.name}</b>… <i>{interimText ? `“${interimText}”` : "Speak clearly into your microphone..."}</i>
              </div>
            )}
          </div>

          <div className="two">
            <div>
              <label className="lbl">{t.durationLabel}</label>
              <input
                type="text"
                className="mt-1"
                value={durationText}
                onChange={(e) => setDurationText(e.target.value)}
                placeholder={t.durationPh}
                required
              />
            </div>
            <div>
              <label className="lbl">{t.vitalsLabel}</label>
              <input
                type="text"
                className="mt-1"
                value={vitalsBp}
                onChange={(e) => setVitalsBp(e.target.value)}
                placeholder={t.vitalsPh}
              />
            </div>
          </div>

          <div className="row flex-between align-center mt-3">
            <button
              type="button"
              className="btn"
              onClick={() => setStep("live_voice")}
              title="Engage in a live interactive spoken interview with CareBridge AI"
            >
              {t.voiceDialogueBtn}
            </button>

            <button
              type="submit"
              className="btn pri lg"
              disabled={submitting || !symptomText.trim()}
            >
              {submitting ? t.analyzingBtn : t.submitGetToken}
            </button>
          </div>
        </form>
      </div>
    );
  }

  // 5. STEP 1: BASIC DETAILS & STRICT 10-DIGIT PHONE VALIDATION
  return (
    <div className="card narrow mt-4" style={{ padding: "32px" }}>
      <div className="lbl" style={{ color: "var(--ac)" }}>{t.intakeBadge}</div>
      <h2 className="mt-1">{t.patientDetailsTitle}</h2>
      <p className="mut small mt-1">
        {t.patientDetailsSub}
      </p>

      {err && <div className="errbox mt-2"><span>{err}</span></div>}

      <form onSubmit={handleVerifyDetails} className="mt-4" style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
        <div>
          <label className="lbl">{t.prefLang}</label>
          <div className="vc-langs mt-1">
            {Object.entries(LANGS).map(([k, cfg]) => (
              <button
                key={k}
                type="button"
                className={"vc-lang " + (k === lang ? "on" : "")}
                onClick={() => setLang(k)}
              >
                {cfg.label} ({cfg.name})
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="lbl">{t.fullName}</label>
          <input
            type="text"
            className="mt-1"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder={t.fullNamePh}
            required
            autoFocus
          />
        </div>

        <div>
          <div className="flex-between">
            <label className="lbl">{t.phoneLabel}</label>
            {phoneTouched && (
              <span className={`small ${isPhoneValid ? "tag pri-routine" : "warn"}`}>
                {isPhoneValid ? t.phoneValidTag : t.phoneInvalidTag}
              </span>
            )}
          </div>
          <input
            type="tel"
            className="mt-1"
            value={form.phone}
            onBlur={() => setPhoneTouched(true)}
            onChange={(e) => {
              const val = e.target.value.replace(/\D/g, "").slice(0, 10);
              setForm({ ...form, phone: val });
              if (val.length === 10) setPhoneTouched(true);
            }}
            placeholder="e.g. 9820012345"
            maxLength={10}
            required
            style={{
              borderColor: phoneTouched && !isPhoneValid ? "var(--urg-high)" : undefined
            }}
          />
          <span className="mut small mt-1" style={{ display: "block" }}>
            {t.phoneHelp}
          </span>
        </div>

        <div className="two">
          <div>
            <label className="lbl">{t.ageLabel}</label>
            <input
              type="number"
              className="mt-1"
              value={form.age}
              min={1}
              max={120}
              placeholder={t.agePh}
              onChange={(e) => setForm({ ...form, age: e.target.value })}
              required
            />
          </div>

          <div>
            <label className="lbl">{t.genderLabel}</label>
            <select
              className="mt-1"
              value={form.gender}
              onChange={(e) => setForm({ ...form, gender: e.target.value })}
            >
              <option value="Female">{t.genderFemale}</option>
              <option value="Male">{t.genderMale}</option>
              <option value="Other">{t.genderOther}</option>
            </select>
          </div>
        </div>

        <div className="row flex-between align-center mt-3">
          <div className="mut small">
            <Shield /> {t.secureBadge}
          </div>
          <button
            type="submit"
            className="btn pri lg"
            disabled={submitting || (phoneTouched && !isPhoneValid)}
          >
            {submitting ? t.verifyingBtn : t.continueBtn}
          </button>
        </div>
      </form>
    </div>
  );
}
