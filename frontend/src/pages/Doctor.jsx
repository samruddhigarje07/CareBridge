import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../services/api";
import { LANGS, callMessage } from "../i18n";
import { StatusBadge, UrgencyBadge, Disclaimer } from "../components/Badges";
import { speak } from "../services/speech";

const rank = { HIGH: 3, MODERATE: 2, ROUTINE: 1 };
const order = (rows) => [...rows].sort((a, b) =>
  (b.status === "in_consultation") - (a.status === "in_consultation") || rank[b.urgency] - rank[a.urgency] || a.created_at.localeCompare(b.created_at));
const langName = (c) => LANGS[c]?.name || c;
const ago = (iso) => { const m = Math.max(0, Math.round((Date.now() - new Date(iso)) / 60000)); return m < 1 ? "just now" : m < 60 ? `${m} min ago` : `${Math.floor(m / 60)}h ${m % 60}m ago`; };
const nr = (v) => !v || /^not reported$/i.test(v);

export default function Doctor({ onLogout }) {
  const [queueData, setQueueData] = useState(null), [rows, setRows] = useState(null), [doctors, setDoctors] = useState([]);
  const [sel, setSel] = useState(null), [err, setErr] = useState(""), [alert, setAlert] = useState(null), [toast, setToast] = useState("");
  const [showDone, setShowDone] = useState(false), [busy, setBusy] = useState(false);
  const [activeTab, setActiveTab] = useState("my"); // "my" | "general"
  const [exporting, setExporting] = useState(false);
  const [reportModalPatient, setReportModalPatient] = useState(null);
  const seen = useRef(null);

  const doctorInfo = (() => {
    try { return JSON.parse(localStorage.getItem("cb_doctor") || "{}"); } catch { return { id: 1, name: "Dr. Sarah Rao", specialty: "General Physician" }; }
  })();

  const load = useCallback(async () => {
    try {
      const docId = doctorInfo.id || 1;
      const [qData, patData, docData] = await Promise.all([
        api.queue(docId).catch(() => null),
        api.patients().catch(() => []),
        api.listDoctors().catch(() => [])
      ]);
      setErr("");
      setQueueData(qData);
      setRows(patData);
      setDoctors(docData);

      if (seen.current) {
        const fresh = patData.find((p) => !seen.current.has(p.id) && p.urgency === "HIGH" && p.status === "waiting");
        if (fresh && (int(fresh.assigned_doctor_id) === int(docId) || !fresh.assigned_doctor_id)) {
          setAlert(fresh);
        }
      }
      seen.current = new Set(patData.map((p) => p.id));
    } catch (e) {
      if (e.status === 401) {
        onLogout();
      } else {
        setErr(e.message);
      }
    }
  }, [doctorInfo.id, onLogout]);

  useEffect(() => {
    load();
    const i = setInterval(load, 3000);
    addEventListener("cb:refresh", load);
    return () => { clearInterval(i); removeEventListener("cb:refresh", load); };
  }, [load]);

  const allActive = order((rows || []).filter((r) => r.status !== "completed"));
  const done = (rows || []).filter((r) => r.status === "completed");
  
  const myPatients = allActive.filter(p => !p.assigned_doctor_id || int(p.assigned_doctor_id) === int(doctorInfo.id || 1));
  const generalPatients = allActive.filter(p => !p.assigned_doctor_id || p.queue_status === "unassigned");

  const displayedList = activeTab === "my" ? myPatients : generalPatients;
  const current = (rows || []).find((r) => r.id === sel) || displayedList[0] || allActive[0] || null;

  async function setStatus(p, status) {
    setBusy(true);
    try { await api.setStatus(p.id, status); await load(); } catch (e) { setErr(e.message); }
    setBusy(false);
  }

  async function claimPatient(p) {
    setBusy(true);
    try {
      await api.assignPatient(p.id, { doctor_id: doctorInfo.id || 1, doctor_name: doctorInfo.name || "Dr. Sarah Rao" });
      await load();
      setToast(`Claimed patient ${p.token} successfully.`); setTimeout(() => setToast(""), 4000);
    } catch (e) { setErr(e.message); }
    setBusy(false);
  }

  async function reassignPatient(p, newDocId, newDocName) {
    setBusy(true);
    try {
      await api.assignPatient(p.id, { doctor_id: parseInt(newDocId), doctor_name: newDocName });
      await load();
      setToast(`Reassigned patient ${p.token} to ${newDocName}.`); setTimeout(() => setToast(""), 4000);
    } catch (e) { setErr(e.message); }
    setBusy(false);
  }

  async function call(p) {
    try { await api.callPatient(p.id); } catch (e) { setErr(e.message); return; }
    setToast(`Announced ${p.token} (${langName(p.language)}) in waiting room…`); setTimeout(() => setToast(""), 5000);
    const lang = LANGS[p.language] ? p.language : "en";
    speak(callMessage(lang, p.token), LANGS[lang].code);
  }

  async function handleExportExcel() {
    setExporting(true);
    try {
      await api.downloadMasterExcel();
      setToast("Master Excel sheet downloaded successfully.");
      setTimeout(() => setToast(""), 4500);
    } catch (e) {
      setErr(e.message || "Failed to download Excel sheet.");
    } finally {
      setExporting(false);
    }
  }

  async function handleExportCsv() {
    setExporting(true);
    try {
      await api.downloadMasterCsv();
      setToast("Master CSV sheet downloaded successfully.");
      setTimeout(() => setToast(""), 4500);
    } catch (e) {
      setErr(e.message || "Failed to download CSV sheet.");
    } finally {
      setExporting(false);
    }
  }

  return (
    <>
      <div className="pagehead flex-between">
        <div>
          <h1 className="h2">Welcome, {doctorInfo.name || "Dr. Sarah Rao"}</h1>
          <p className="mut small">Specialty: <b>{doctorInfo.specialty || "General Physician"}</b> • Dual-queue isolation &amp; clinical AI intelligence.</p>
        </div>
        <div className="flex-row gap-2 align-center" style={{ flexWrap: "wrap" }}>
          <button
            className="btn sm"
            onClick={handleExportExcel}
            disabled={exporting}
            title="Download complete Master Patient List Excel spreadsheet (.xlsx)"
          >
            {exporting ? "Generating..." : "📊 Export Master (.xlsx)"}
          </button>
          <button
            className="btn sm"
            onClick={handleExportCsv}
            disabled={exporting}
            title="Download complete Master Patient List CSV spreadsheet (.csv)"
          >
            {exporting ? "Generating..." : "📥 Export (.csv)"}
          </button>
          <button className="btn sm" onClick={onLogout}>🔒 Doctor Logout</button>
        </div>
      </div>

      {alert && <div className="alertbar" role="alert"><b>🚨 Direct Assignment Alert ({alert.token})</b><span>{alert.chief_complaint}</span><button className="btn sm" onClick={() => { setSel(alert.id); setAlert(null); }}>View Brief</button><button className="btn sm" onClick={() => setAlert(null)}>Dismiss</button></div>}
      {toast && <div className="toast" role="status">📢 {toast}</div>}
      {err && <div className="errbox" role="alert"><span>{err}</span><button className="btn sm" onClick={load}>Retry</button></div>}
      
      <div className="mt-3" style={{ display: "flex", gap: "10px" }}>
        <button className={`btn sm ${activeTab === "my" ? "pri" : ""}`} onClick={() => setActiveTab("my")}>
          🧑‍⚕️ My Allotted Patients ({myPatients.length})
        </button>
        <button className={`btn sm ${activeTab === "general" ? "pri" : ""}`} onClick={() => setActiveTab("general")}>
          🏥 General Clinic Queue ({generalPatients.length})
        </button>
      </div>

      {rows === null && !err && <div className="card center mut">Loading clinical queue…</div>}
      {rows && rows.length === 0 && <div className="card center"><h2>No patients in queue</h2><p className="mut">Pre-consultation reports appear here instantly.</p></div>}
      {rows && rows.length > 0 && (
        <div className="docgrid mt-2">
          <aside className="plist" aria-label="Consultation sequence">
            <div className="mut small lbl">{activeTab === "my" ? "My Allotted Queue" : "General Clinic Pool"} ({displayedList.length})</div>
            {displayedList.length === 0 && <div className="mut small mt-2">No patients in this view.</div>}
            {displayedList.map((p) => {
              const isUrgent = p.triage_score?.category === "Emergency - Red Flag" || p.urgency === "HIGH";
              const isFollowup = p.visit_type === "followup";
              return (
                <button key={p.id} className={`pitem u-b-${p.urgency} ${current?.id === p.id ? "sel" : ""}`} onClick={() => setSel(p.id)}>
                  <div className="top">
                    <b>{p.token}</b>
                    <UrgencyBadge level={p.urgency} />
                  </div>
                  <div className="pn">
                    {p.name} <span className="mut">· {p.age} · {p.gender?.[0]}</span>
                  </div>
                  <div className="mut small clip">{p.chief_complaint}</div>
                  
                  <div className="top small mt-1">
                    <StatusBadge status={p.status} />
                    <span className="mut">{ago(p.created_at)}</span>
                  </div>

                  <div className="row mt-1 flex-between" style={{ gap: "4px", flexWrap: "wrap", width: "100%", margin: "4px 0 0" }}>
                    <div className="row" style={{ gap: "4px", flexWrap: "wrap", margin: 0 }}>
                      {isUrgent && (
                        <span className="tag" style={{ background: "rgba(255, 92, 92, 0.2)", color: "var(--urg-high)", border: "1px solid var(--urg-high)", fontSize: "11px", padding: "2px 6px" }}>
                          🚨 Triage: {p.triage_score?.score || 85}/100
                        </span>
                      )}
                      {isFollowup && (
                        <span className="tag" style={{ background: "rgba(79, 227, 193, 0.15)", color: "var(--ac)", border: "1px solid var(--ac)", fontSize: "11px", padding: "2px 6px" }}>
                          🔁 Follow-Up
                        </span>
                      )}
                      {p.phone && (
                        <span className="mut small" style={{ fontSize: "11px" }}>📱 {p.phone}</span>
                      )}
                    </div>
                    <button
                      type="button"
                      className="btn sm"
                      style={{ padding: "2px 8px", fontSize: "11px", height: "auto" }}
                      onClick={(e) => {
                        e.stopPropagation();
                        setReportModalPatient(p);
                      }}
                      title="View Complete Patient Report"
                    >
                      📄 Report
                    </button>
                  </div>

                  {p.assigned_doctor_name && <div className="small mut mt-1" style={{ color: "var(--ac)" }}>Assigned: {p.assigned_doctor_name}</div>}
                </button>
              );
            })}
            {done.length > 0 && <button className="link" onClick={() => setShowDone(!showDone)}>{showDone ? "Hide" : "Show"} completed ({done.length})</button>}
            {showDone && done.map((p) => (
              <div
                key={p.id}
                className={`pitem dim ${current?.id === p.id ? "sel" : ""}`}
                onClick={() => setSel(p.id)}
                style={{ cursor: "pointer" }}
              >
                <div className="top">
                  <b>{p.token}</b>
                  <StatusBadge status="completed" />
                </div>
                <div className="flex-between mt-1">
                  <div className="mut small">{p.name} · {p.age}y</div>
                  <button
                    type="button"
                    className="btn sm"
                    style={{ padding: "2px 8px", fontSize: "11px" }}
                    onClick={(e) => {
                      e.stopPropagation();
                      setReportModalPatient(p);
                    }}
                    title="View Patient Report"
                  >
                    📄 Report
                  </button>
                </div>
              </div>
            ))}
          </aside>
          {current ? (
            <Brief
              p={current}
              busy={busy}
              doctors={doctors}
              allPatients={rows || []}
              currentDoctorId={doctorInfo.id || 1}
              onStatus={setStatus}
              onCall={call}
              onClaim={claimPatient}
              onReassign={reassignPatient}
              onOpenReport={(p) => setReportModalPatient(p)}
            />
          ) : (
            <div className="card center mut">Select a patient.</div>
          )}
        </div>
      )}
      {reportModalPatient && (
        <PatientReportModal
          patient={reportModalPatient}
          onClose={() => setReportModalPatient(null)}
        />
      )}
    </>
  );
}

function Tags({ items, empty }) {
  return items?.length ? (
    <div className="tags">
      {items.map((s) => (
        <span key={typeof s === 'string' ? s : s.condition || s.test_name || s.exercise} className="tag">
          {typeof s === 'string' ? s : s.condition || s.test_name || s.exercise}
        </span>
      ))}
    </div>
  ) : (
    <span className="mut">{empty}</span>
  );
}

function Brief({ p, busy, doctors, allPatients, currentDoctorId, onStatus, onCall, onClaim, onReassign, onOpenReport }) {
  const [activeBriefTab, setActiveBriefTab] = useState("soap"); // "soap" | "diagnostics" | "history" | "all"
  const [timelineExpanded, setTimelineExpanded] = useState(false);
  const [copiedSOAP, setCopiedSOAP] = useState(false);

  const dur = (p.duration || []).filter((d) => d.symptom);
  const vitals = p.vitals || {};
  const diffs = p.differential_diagnosis || [];
  const tests = p.recommended_tests || [];
  const treats = p.initial_treatment || [];
  const pts = p.physical_therapy || [];
  const history = p.medical_history || [];
  const triage = p.triage_score || { score: 25, category: "Low Risk", urgent_symptoms: [] };
  const soap = p.soap_note || {};
  const comp = p.progression_comparison || {};

  const isAssignedToMe = !p.assigned_doctor_id || int(p.assigned_doctor_id) === int(currentDoctorId);

  // Retrieve visit history for Visual Health Timeline
  const patientVisits = allPatients
    .filter((r) => r.phone && p.phone && r.phone.replace(/\D/g, "") === p.phone.replace(/\D/g, ""))
    .sort((a, b) => a.created_at.localeCompare(b.created_at));

  // Determine prior visit if follow-up
  const priorVisit = allPatients.find((r) => String(r.id) === String(p.previous_visit_id)) || (patientVisits.length > 1 ? patientVisits[patientVisits.length - 2] : null);

  const isEmergency = triage.category?.toLowerCase().includes("emergency") || p.urgency === "HIGH";

  const copySoapToClipboard = () => {
    const text = `CAREBRIDGE CLINICAL SUMMARY & SOAP NOTE
Patient: ${p.name} (${p.age}y, ${p.gender}) | Token: ${p.token} | Contact: ${p.phone || "N/A"}
Triage Score: ${triage.score}/100 (${triage.category}) | Urgency: ${p.urgency}
Attending Specialist: ${p.assigned_doctor_name || "General Clinic"}

[SUBJECTIVE]
${soap.subjective || `Chief Complaint: ${p.chief_complaint}. ${p.clinical_summary}`}

[OBJECTIVE]
Vitals: BP: ${vitals.bp || "N/R"}, Heart Rate: ${vitals.heart_rate || "N/R"}, Temp: ${vitals.temperature || "N/R"}, SpO2: ${vitals.spo2 || "N/R"}
Negative Findings: ${p.negative_findings?.join(", ") || "None denied"}

[ASSESSMENT]
${soap.assessment || `Differential Diagnosis: ${diffs.map(d => d.condition).join(", ") || "Clinical evaluation ongoing"}`}

[PLAN]
${soap.plan || `Recommended Tests: ${tests.map(t => t.test_name).join(", ") || "Routine"}. Initial Rx: ${treats.map(t => t.guideline).join(", ") || "Supportive care"}`}`;

    navigator.clipboard.writeText(text);
    setCopiedSOAP(true);
    setTimeout(() => setCopiedSOAP(false), 2500);
  };

  return (
    <article className={`card brief u-b-${p.urgency}`} id="printable-brief">
      {/* Header */}
      <header className="ident">
        <div>
          <span className="tok">{p.token}</span>
          <h2>{p.name}</h2>
          <div className="mut">
            {p.age} yrs • {p.gender} • Language: {langName(p.language)} • Contact: <b>{p.phone || "Not recorded"}</b>
          </div>
          {p.assigned_doctor_name ? (
            <div className="small mt-1" style={{ color: "var(--ac)" }}>Assigned Specialist: <b>{p.assigned_doctor_name}</b></div>
          ) : (
            <div className="small mt-1 warn">Unassigned General Queue</div>
          )}
        </div>
        <div className="flex-row gap-2 align-center">
          <StatusBadge status={p.status} />
          <button
            className="btn sm pri hide-print"
            onClick={() => onOpenReport && onOpenReport(p)}
            title="Open comprehensive consultation report modal"
          >
            📄 View Full Report
          </button>
          <button
            className="btn sm hide-print"
            onClick={copySoapToClipboard}
            title="Copy formatted SOAP note to clipboard for EHR paste"
            style={{ background: copiedSOAP ? "rgba(79, 227, 193, 0.2)" : undefined, borderColor: copiedSOAP ? "var(--ac)" : undefined }}
          >
            {copiedSOAP ? "✓ Copied to EHR!" : "📋 Copy SOAP to EHR"}
          </button>
          <button className="btn sm hide-print" onClick={() => window.print()} title="Print or save as PDF">
            🖨️ Export / Print SOAP Note
          </button>
        </div>
      </header>

      {/* Functional Calling & Communication Suite */}
      <section className="clinical-section hide-print flex-between" style={{ background: "rgba(79, 227, 193, 0.08)", borderColor: "var(--ac)" }}>
        <div>
          <div className="lbl" style={{ color: "var(--ac)" }}>Telephony &amp; Patient Paging Suite</div>
          <div className="small mut mt-1">Directly dial patient contact number or broadcast spoken token in waiting room.</div>
        </div>
        <div className="flex-row gap-2 align-center">
          {p.phone && (
            <a
              href={`tel:${p.phone}`}
              className="btn pri sm"
              style={{ textDecoration: "none", display: "inline-flex", alignItems: "center", gap: "6px" }}
              title="Launch system telephone dialer / softphone"
            >
              📞 Call Phone ({p.phone})
            </a>
          )}
          <button className="btn sm" onClick={() => onCall(p)} title="Broadcast audio announcement in waiting room">
            📢 Page Waiting Room
          </button>
        </div>
      </section>

      {/* Specialist Assignment Controls */}
      <section className="clinical-section hide-print flex-between" style={{ background: "rgba(124,140,255,.08)" }}>
        <div>
          <div className="lbl">Specialist Routing &amp; Reassignment</div>
          <div className="small mut mt-1">Route or claim this patient record to an attending specialist.</div>
        </div>
        <div className="flex-row gap-2">
          {!isAssignedToMe && (
            <button className="btn sm pri" disabled={busy} onClick={() => onClaim(p)}>Claim / Assign to Me</button>
          )}
          <select
            className="sm"
            onChange={(e) => {
              const doc = doctors.find(d => String(d.id) === e.target.value);
              if (doc) onReassign(p, doc.id, doc.name);
            }}
            defaultValue=""
            style={{ padding: "6px 10px", fontSize: "13px" }}
          >
            <option value="" disabled>Reassign to doctor...</option>
            {doctors.map(d => <option key={d.id} value={d.id}>{d.name} ({d.specialty})</option>)}
          </select>
        </div>
      </section>

      {/* AI Clinical Severity / Triage Score Gauge */}
      <section className="urgbox" style={{ borderColor: isEmergency ? "var(--urg-high)" : undefined }}>
        <div className="flex-between">
          <div>
            <div className="lbl">AI Clinical Severity / Triage Score</div>
            <div style={{ display: "flex", alignItems: "baseline", gap: "8px", marginTop: "4px" }}>
              <span style={{ fontSize: "32px", fontWeight: 800, color: isEmergency ? "var(--urg-high)" : triage.score >= 40 ? "var(--urg-mod)" : "var(--ac)" }}>
                {triage.score ?? (p.urgency === "HIGH" ? 85 : p.urgency === "MODERATE" ? 55 : 25)}
              </span>
              <span className="mut">/ 100</span>
              <span className={`urg ${isEmergency ? "u-HIGH" : triage.score >= 40 ? "u-MODERATE" : "u-ROUTINE"} big`} style={{ marginLeft: "8px" }}>
                {triage.category || (p.urgency === "HIGH" ? "Emergency - Red Flag" : p.urgency === "MODERATE" ? "Moderate Risk" : "Low Risk")}
              </span>
            </div>
          </div>
          <UrgencyBadge level={p.urgency} big />
        </div>

        {/* Urgent Symptom Pulsing Alerts */}
        {triage.urgent_symptoms?.length > 0 && (
          <div className="mt-2">
            <div className="lbl" style={{ color: "var(--urg-high)" }}>High-Risk Clinical Symptoms</div>
            <div className="tags mt-1">
              {triage.urgent_symptoms.map((s, idx) => (
                <span key={idx} className="tag" style={{ background: "rgba(255, 92, 92, 0.2)", color: "var(--urg-high)", border: "1px solid var(--urg-high)", fontWeight: 600 }}>
                  🚨 {s}
                </span>
              ))}
            </div>
          </div>
        )}

        <div className="lbl mt">Urgency Indicators &amp; Rationale</div>
        {p.urgency_indicators?.length ? (
          <ul className="ind">
            {p.urgency_indicators.map((i) => <li key={i}>{i}</li>)}
          </ul>
        ) : (
          <p className="mut">No specific red flags flagged</p>
        )}
        <p className="small mut">{triage.rationale || `Basis: ${p.urgency_basis === "red_flag_rule" ? "Deterministic safety rule matched" : "AI contextual assessment"}`}</p>
        <Disclaimer>AI-generated clinical score — healthcare professional verification required.</Disclaimer>
      </section>

      {/* Clinical Subtabs Navigation */}
      <nav className="subtabs hide-print mt-2">
        <button
          className={activeBriefTab === "soap" ? "on" : ""}
          onClick={() => setActiveBriefTab("soap")}
        >
          📋 SOAP &amp; Intake
        </button>
        <button
          className={activeBriefTab === "diagnostics" ? "on" : ""}
          onClick={() => setActiveBriefTab("diagnostics")}
        >
          🔬 Diagnostics &amp; Plan ({diffs.length + tests.length})
        </button>
        {(patientVisits.length > 1 || p.visit_type === "followup" || comp.status !== "N/A - New Issue") && (
          <button
            className={activeBriefTab === "history" ? "on" : ""}
            onClick={() => setActiveBriefTab("history")}
          >
            🕒 History &amp; Timeline
            <span className="tag" style={{ marginLeft: "4px", padding: "1px 6px", fontSize: "11px", background: "rgba(79,227,193,0.3)" }}>
              {patientVisits.length} visits
            </span>
          </button>
        )}
        <button
          className={activeBriefTab === "all" ? "on" : ""}
          onClick={() => setActiveBriefTab("all")}
        >
          📑 Complete Chart
        </button>
      </nav>

      {/* PANE 1: SOAP & INTAKE */}
      <div className={activeBriefTab === "soap" || activeBriefTab === "all" ? "" : "tab-hidden"}>
        {/* Returning Patient Compact Banner */}
        {(patientVisits.length > 1 || p.visit_type === "followup" || comp.status !== "N/A - New Issue") && (
          <div className="flex-between hide-print mb-2" style={{ padding: "10px 14px", background: "rgba(79, 227, 193, 0.08)", border: "1px solid var(--ac)", borderRadius: "12px", fontSize: "13px", marginTop: "12px" }}>
            <span>
              🔄 <b>Returning Patient ({patientVisits.length} Consultations Recorded)</b> — Prior Visit: <b>{priorVisit ? priorVisit.token : "Recorded"}</b> ({priorVisit?.urgency || "Initial evaluation"})
            </span>
            <button className="btn sm" onClick={() => setActiveBriefTab("history")} style={{ padding: "4px 10px", fontSize: "12px" }}>
              View Differential Progression &amp; Timeline ➔
            </button>
          </div>
        )}

        {/* Standardized Clinical Note (SOAP Format) */}
        <section className="clinical-section soap-box mt-2" style={{ background: "var(--glass)", borderRadius: "14px", padding: "20px", border: "1px solid var(--line)" }}>
          <div className="flex-between">
            <div>
              <div className="lbl" style={{ color: "var(--sec)" }}>Standardized Clinical Note</div>
              <h3>SOAP Medical Summary</h3>
            </div>
            <span className="tag">Hospital EHR Compatible</span>
          </div>

          <div className="soap-grid mt-3" style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
            <div className="soap-item" style={{ borderLeft: "4px solid #4fe3c1", paddingLeft: "14px" }}>
              <h4 style={{ color: "#4fe3c1", margin: 0, fontSize: "15px" }}>S — Subjective</h4>
              <p className="small mt-1" style={{ lineHeight: "1.5" }}>
                {soap.subjective || `Patient reports ${p.chief_complaint}. ${p.clinical_summary}`}
              </p>
            </div>

            <div className="soap-item" style={{ borderLeft: "4px solid #7c8cff", paddingLeft: "14px" }}>
              <h4 style={{ color: "#7c8cff", margin: 0, fontSize: "15px" }}>O — Objective</h4>
              <div className="vitals-grid mt-1">
                <div><b>BP:</b> {vitals.bp || "Not reported"}</div>
                <div><b>Heart Rate:</b> {vitals.heart_rate || "Not reported"}</div>
                <div><b>Temperature:</b> {vitals.temperature || "Not reported"}</div>
                <div><b>SpO2:</b> {vitals.spo2 || "Not reported"}</div>
              </div>
              <p className="small mt-1 mut">
                {soap.objective || `Reported negative findings: ${p.negative_findings?.join(", ") || "None denied"}.`}
              </p>
            </div>

            <div className="soap-item" style={{ borderLeft: "4px solid #ffb454", paddingLeft: "14px" }}>
              <h4 style={{ color: "#ffb454", margin: 0, fontSize: "15px" }}>A — Assessment</h4>
              <p className="small mt-1" style={{ lineHeight: "1.5" }}>
                {soap.assessment || `Clinical urgency classified as ${p.urgency} (Triage Score: ${triage.score}/100). Differential considerations: ${diffs.map(d => d.condition).join(", ") || "General presentation"}.`}
              </p>
            </div>

            <div className="soap-item" style={{ borderLeft: "4px solid #4fe3c1", paddingLeft: "14px" }}>
              <h4 style={{ color: "#4fe3c1", margin: 0, fontSize: "15px" }}>P — Plan</h4>
              <p className="small mt-1" style={{ lineHeight: "1.5" }}>
                {soap.plan || `Initial supportive care and evaluation. Recommended diagnostic tests: ${tests.map(t => t.test_name).join(", ") || "Routine clinical examination"}.`}
              </p>
            </div>
          </div>
        </section>

        {/* Vitals & Medical History */}
        <section className="two mt-2">
          <div>
            <div className="lbl">Patient Vitals</div>
            <div className="vitals-grid">
              <div><b>BP:</b> {vitals.bp || "Not reported"}</div>
              <div><b>Heart Rate:</b> {vitals.heart_rate || "Not reported"}</div>
              <div><b>Temperature:</b> {vitals.temperature || "Not reported"}</div>
              <div><b>SpO2:</b> {vitals.spo2 || "Not reported"}</div>
            </div>
          </div>
          <div>
            <div className="lbl">Medical History &amp; Allergies</div>
            <Tags items={history} empty="No chronic conditions reported" />
          </div>
        </section>

        {/* Chief complaint & symptoms */}
        <section className="two mt-2">
          <div><div className="lbl">Chief complaint</div><p className="cc">{p.chief_complaint}</p></div>
          <div><div className="lbl">Reported Symptoms</div><Tags items={p.symptoms} empty="Not reported" /></div>
        </section>

        {/* Duration / progression */}
        <section className="two mt-2">
          <div><div className="lbl">Duration</div>{dur.length ? <table className="mini"><tbody>{dur.map((d) => <tr key={d.symptom}><td>{d.symptom}</td><td className={nr(d.duration) ? "mut" : ""}>{d.duration}</td></tr>)}</tbody></table> : <span className="mut">Not reported</span>}</div>
          <div><div className="lbl">Progression</div><p className={nr(p.progression) ? "mut" : ""}>{p.progression || "Not reported"}</p></div>
        </section>

        {/* Associated info */}
        <section className="two mt-2">
          <div><div className="lbl">Associated symptoms</div><Tags items={p.associated_symptoms} empty="None reported" /></div>
          <div><div className="lbl">Negative findings</div>{p.negative_findings?.length ? <ul className="neg">{p.negative_findings.map((n) => <li key={n}>{n}</li>)}</ul> : <span className="mut">None reported</span>}</div>
        </section>
      </div>

      {/* PANE 2: DIAGNOSTICS & PLAN */}
      <div className={activeBriefTab === "diagnostics" || activeBriefTab === "all" ? "" : "tab-hidden"}>
        {/* Differential Diagnosis */}
        <section className="clinical-section mt-2">
          <div className="lbl">1. Differential Diagnosis &amp; Conditions</div>
          {diffs.length ? (
            <div className="diagnostic-cards">
              {diffs.map((d, i) => (
                <div key={i} className="diag-card">
                  <div className="top"><b>{d.condition}</b><span className={`badge-conf conf-${d.confidence?.toLowerCase()}`}>{d.confidence} confidence</span></div>
                  <p className="mut small mt-1">{d.rationale}</p>
                </div>
              ))}
            </div>
          ) : <p className="mut small">No differential diagnosis generated.</p>}
        </section>

        {/* Recommended Tests */}
        <section className="clinical-section mt-2">
          <div className="lbl">2. Recommended Pre-Diagnostic Tests &amp; Procedures</div>
          {tests.length ? (
            <table className="mini full">
              <thead><tr><th>Test / Procedure</th><th>Priority</th><th>Purpose</th></tr></thead>
              <tbody>
                {tests.map((t, i) => (
                  <tr key={i}>
                    <td><b>{t.test_name}</b></td>
                    <td><span className={`tag pri-${t.priority?.toLowerCase()}`}>{t.priority}</span></td>
                    <td>{t.purpose}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <p className="mut small">None recommended.</p>}
        </section>

        {/* Initial Treatment Plans */}
        <section className="clinical-section mt-2">
          <div className="lbl">3. Initial Treatment Guidelines &amp; Supportive Care</div>
          {treats.length ? (
            <ul className="ind">
              {treats.map((tr, i) => (
                <li key={i}><b>{tr.guideline}</b> {tr.notes ? <span className="mut">({tr.notes})</span> : null}</li>
              ))}
            </ul>
          ) : <p className="mut small">None listed.</p>}
        </section>

        {/* Physical Therapy */}
        <section className="clinical-section mt-2">
          <div className="lbl">4. Prescribed Physical Therapy &amp; Exercise Routines</div>
          {pts.length ? (
            <div className="diagnostic-cards">
              {pts.map((pt, i) => (
                <div key={i} className="diag-card">
                  <div className="top"><b>{pt.exercise}</b><span className="tag">{pt.frequency}</span></div>
                  <p className="small mt-1">{pt.instructions}</p>
                  {pt.precautions && <p className="mut small"><b>Precautions:</b> {pt.precautions}</p>}
                </div>
              ))}
            </div>
          ) : <p className="mut small">None prescribed.</p>}
        </section>

        {/* AI Brief Summary */}
        <section className="aibrief mt-2">
          <div className="lbl">AI clinical summary</div>
          <p>{p.clinical_summary}</p>
          <Disclaimer>AI-generated pre-consultation brief. Verify information with the patient.</Disclaimer>
        </section>
      </div>

      {/* PANE 3: HISTORY & TIMELINE */}
      <div className={activeBriefTab === "history" || activeBriefTab === "all" ? "" : "tab-hidden"}>
        {/* Side-by-Side Returning Patient Progression Comparison */}
        {(p.visit_type === "followup" || comp.status !== "N/A - New Issue") && (
          <section className="clinical-section mt-2" style={{ background: "rgba(79, 227, 193, 0.05)", border: "1px solid var(--ac)", borderRadius: "14px", padding: "18px" }}>
            <div className="flex-between">
              <div>
                <div className="lbl" style={{ color: "var(--ac)" }}>Side-by-Side Visit Comparison &amp; Progression</div>
                <h3 style={{ margin: "2px 0 0" }}>Returning Patient Differential Analysis</h3>
              </div>
              <span className="tag" style={{ background: "var(--ac)", color: "#06141a", fontWeight: 700 }}>
                Status: {comp.status || "Follow-Up Comparison"}
              </span>
            </div>

            <p className="small mt-2" style={{ lineHeight: "1.5" }}>
              <b>Clinical Progression Summary:</b> {comp.summary || "Patient has returned for evaluation of ongoing and evolving symptoms."}
            </p>

            <div className="two mt-3" style={{ gap: "16px" }}>
              <div className="card" style={{ background: "rgba(120,120,120,0.06)", margin: 0, padding: "14px" }}>
                <div className="lbl">Previous Consultation {priorVisit ? `(${priorVisit.token})` : ""}</div>
                <div className="small mt-1"><b>Complaint:</b> {priorVisit?.chief_complaint || "Earlier episode"}</div>
                <div className="small mt-1"><b>Symptoms:</b> {priorVisit?.symptoms?.join(", ") || "Recorded symptoms"}</div>
                <div className="small mt-1"><b>Urgency:</b> {priorVisit?.urgency || "Initial evaluation"}</div>
              </div>

              <div className="card" style={{ background: "rgba(79,227,193,0.08)", borderColor: "var(--ac)", margin: 0, padding: "14px" }}>
                <div className="lbl" style={{ color: "var(--ac)" }}>Current Consultation ({p.token})</div>
                <div className="small mt-1"><b>Current Complaint:</b> {p.chief_complaint}</div>
                <div className="small mt-1"><b>Current Symptoms:</b> {p.symptoms?.join(", ")}</div>
                <div className="small mt-1"><b>Current Urgency:</b> {p.urgency}</div>
              </div>
            </div>

            {/* Symptom Delta Tags */}
            <div className="row mt-3" style={{ gap: "16px", flexWrap: "wrap" }}>
              {comp.resolved_symptoms?.length > 0 && (
                <div>
                  <span className="small mut" style={{ display: "block" }}>Resolved Symptoms:</span>
                  <div className="tags mt-1">
                    {comp.resolved_symptoms.map((s, idx) => (
                      <span key={idx} className="tag" style={{ background: "rgba(79, 227, 193, 0.2)", color: "var(--ac)" }}>✓ {s}</span>
                    ))}
                  </div>
                </div>
              )}
              {comp.worsened_symptoms?.length > 0 && (
                <div>
                  <span className="small mut" style={{ display: "block" }}>Worsened Symptoms:</span>
                  <div className="tags mt-1">
                    {comp.worsened_symptoms.map((s, idx) => (
                      <span key={idx} className="tag" style={{ background: "rgba(255, 92, 92, 0.2)", color: "var(--urg-high)" }}>⚠ {s}</span>
                    ))}
                  </div>
                </div>
              )}
              {comp.new_symptoms?.length > 0 && (
                <div>
                  <span className="small mut" style={{ display: "block" }}>Newly Developed:</span>
                  <div className="tags mt-1">
                    {comp.new_symptoms.map((s, idx) => (
                      <span key={idx} className="tag" style={{ background: "rgba(255, 180, 84, 0.2)", color: "var(--urg-mod)" }}>+ {s}</span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </section>
        )}

        {/* Visual Health Timeline (Compact & Collapsible) */}
        {patientVisits.length > 1 && (
          <section className="clinical-section mt-2" style={{ background: "rgba(124, 140, 255, 0.05)", borderRadius: "14px", padding: "18px" }}>
            <div className="flex-between">
              <div>
                <div className="lbl" style={{ color: "var(--sec)" }}>Visual Health Timeline</div>
                <h3 style={{ margin: "2px 0 0" }}>Patient Consultation Trajectory ({patientVisits.length} Visits)</h3>
              </div>
              <button
                className="btn sm hide-print"
                onClick={() => setTimelineExpanded(!timelineExpanded)}
                style={{ padding: "5px 12px", fontSize: "12px" }}
              >
                {timelineExpanded ? "▲ Collapse Detailed Cards" : "▼ Expand Detailed Visit Cards"}
              </button>
            </div>

            {/* Compact Milestone Stepper Track */}
            <div className="timeline-stepper mt-2">
              {patientVisits.map((v, idx) => {
                const isCurrent = v.id === p.id;
                return (
                  <div key={v.id} style={{ display: "inline-flex", alignItems: "center", gap: "8px" }}>
                    <div
                      className={`timeline-chip ${isCurrent ? "active" : ""}`}
                      style={{ cursor: "pointer" }}
                      onClick={() => setTimelineExpanded(true)}
                      title={`Visit #${idx + 1} (${v.token}): ${v.chief_complaint}`}
                    >
                      <span style={{ fontWeight: 700 }}>#{idx + 1}</span>
                      <span>{v.token}</span>
                      <span className="mut">{new Date(v.created_at).toLocaleDateString([], { month: "short", day: "numeric" })}</span>
                      <UrgencyBadge level={v.urgency} />
                      {isCurrent && <span style={{ color: "var(--ac)", fontWeight: 700 }}>• Current</span>}
                    </div>
                    {idx < patientVisits.length - 1 && <span className="timeline-arrow">➔</span>}
                  </div>
                );
              })}
            </div>

            {/* Expandable Detailed Visit Cards */}
            {timelineExpanded && (
              <div className="timeline-track mt-3" style={{ display: "flex", gap: "12px", overflowX: "auto", paddingBottom: "10px" }}>
                {patientVisits.map((v, i) => (
                  <div
                    key={v.id}
                    className="timeline-node card"
                    style={{
                      minWidth: "220px",
                      margin: 0,
                      padding: "14px",
                      borderColor: v.id === p.id ? "var(--ac)" : "var(--line)",
                      background: v.id === p.id ? "rgba(79, 227, 193, 0.1)" : "var(--glass2)"
                    }}
                  >
                    <div className="flex-between">
                      <span className="tok" style={{ fontSize: "11px" }}>Visit #{i + 1}</span>
                      <UrgencyBadge level={v.urgency} />
                    </div>
                    <div style={{ fontWeight: 600, fontSize: "14px", marginTop: "6px" }}>{v.token}</div>
                    <div className="mut small">{new Date(v.created_at).toLocaleDateString()}</div>
                    <div className="small clip mt-1" title={v.chief_complaint}><b>CC:</b> {v.chief_complaint}</div>
                    <div className="small mut mt-1">Status: <StatusBadge status={v.status} /></div>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}
      </div>

      <details className="hide-print mt-2"><summary className="mut small">Record details</summary>
        <table className="mini"><tbody><tr><td>Arrived</td><td>{new Date(p.created_at).toLocaleString()}</td></tr><tr><td>Language</td><td>{langName(p.language)}</td></tr><tr><td>Record ID</td><td>{p.id}</td></tr><tr><td>Phone</td><td>{p.phone || "Not recorded"}</td></tr></tbody></table>
      </details>

      {/* Actions */}
      <footer className="actions hide-print mt-3">
        {p.phone && (
          <a href={`tel:${p.phone}`} className="btn pri" style={{ textDecoration: "none", display: "inline-flex", alignItems: "center", gap: "6px" }}>
            📞 Direct Call ({p.phone})
          </a>
        )}
        <button className="btn" onClick={() => onCall(p)}>📢 Page Waiting Room</button>
        <button className="btn pri" disabled={busy || p.status === "in_consultation"} onClick={() => onStatus(p, "in_consultation")}>Mark In Consultation</button>
        <button className="btn" disabled={busy || p.status === "completed"} onClick={() => onStatus(p, "completed")}>Mark Completed</button>
      </footer>
    </article>
  );
}

function int(v) {
  return parseInt(v) || 0;
}

function PatientReportModal({ patient, onClose }) {
  const [copied, setCopied] = useState(false);
  const p = patient;
  const rep = p.report || {};
  const reportId = rep.report_id || `RPT-${p.token}`;
  const genDate = rep.generated_at ? new Date(rep.generated_at).toLocaleString() : new Date(p.created_at).toLocaleString();
  const vitals = rep.vitals || p.vitals || {};
  const triage = rep.triage || p.triage_score || { score: 25, category: "Routine Clinical Evaluation", urgent_symptoms: [] };
  const soap = rep.soap_note || p.soap_note || {};
  const diffs = rep.differential_diagnosis || p.differential_diagnosis || [];
  const tests = rep.recommended_tests || p.recommended_tests || [];
  const treats = rep.initial_treatment || p.initial_treatment || [];
  const pts = rep.physical_therapy || p.physical_therapy || [];
  const negs = rep.negative_findings || p.negative_findings || [];
  const durations = rep.duration || p.duration || [];
  const chief = rep.chief_complaint || p.chief_complaint || "Routine Clinical Evaluation";
  const summary = rep.clinical_summary || p.clinical_summary || "";

  const fullReportText = `======================================================================
CAREBRIDGE COMPREHENSIVE CLINICAL PRE-CONSULTATION REPORT
Report ID: ${reportId}
Generated At: ${genDate}
======================================================================

1. PATIENT DEMOGRAPHICS & RECORD IDENTIFICATION
- Full Name: ${p.name}
- Consultation Token: ${p.token}
- Age: ${p.age} years | Gender: ${p.gender}
- Contact / Telephone: ${p.phone || "Not recorded"}
- Spoken Language: ${langName(p.language)}
- Consultation Category: ${p.visit_type === "followup" ? "Follow-Up Consultation" : "Initial Consultation"}
- Assigned Attending Doctor: ${p.assigned_doctor_name || "General Clinic"}
- Current Status: ${p.status}

2. CLINICAL TRIAGE & ACUITY
- Urgency Level: ${p.urgency}
- Triage Acuity Score: ${triage.score ?? "N/A"}/100
- Triage Category: ${triage.category || "Standard Evaluation"}
- Urgent Red Flags: ${(triage.urgent_symptoms || []).join(", ") || "None flagged"}

3. VITALS & OBJECTIVE FINDINGS
- Blood Pressure (BP): ${vitals.bp || "Not recorded"}
- Heart Rate: ${vitals.heart_rate || "Not recorded"}
- Body Temperature: ${vitals.temperature || "Not recorded"}
- SpO2 (Oxygen Saturation): ${vitals.spo2 || "Not recorded"}
- Pertinent Negatives (Reported Absent): ${negs.length ? negs.join(", ") : "None reported"}

4. CHIEF COMPLAINT & SYMPTOM PROFILE
- Chief Complaint: ${chief}
- Symptom Durations: ${durations.map(d => `${d.symptom}: ${d.duration}`).join("; ") || "Recorded in clinical summary"}
- Clinical Summary Narrative: ${summary}

5. STANDARDIZED SOAP CLINICAL NOTE
[SUBJECTIVE (S)]
${soap.subjective || summary || `Patient presents with ${chief}.`}

[OBJECTIVE (O)]
Vitals: BP: ${vitals.bp || "N/R"}, Heart Rate: ${vitals.heart_rate || "N/R"}, Temp: ${vitals.temperature || "N/R"}, SpO2: ${vitals.spo2 || "N/R"}.
Pertinent Negatives: ${negs.join(", ") || "None denied"}.

[ASSESSMENT (A)]
${soap.assessment || `Differential Diagnoses: ${diffs.map(d => `${d.condition} (${d.probability || "Suspected"})`).join("; ")}`}

[PLAN (P)]
${soap.plan || "Clinical evaluation by attending physician."}

6. DIFFERENTIAL DIAGNOSES
${diffs.map((d, i) => `${i + 1}. ${d.condition} [Probability: ${d.probability || "Moderate"}] - ${d.rationale || ""}`).join("\n") || "Clinical evaluation ongoing."}

7. RECOMMENDED DIAGNOSTIC TESTS & ORDERS
${tests.map((t, i) => `${i + 1}. ${t.test_name} [Priority: ${t.priority || "Routine"}] - ${t.indication || ""}`).join("\n") || "No immediate lab orders required."}

8. INITIAL CLINICAL MANAGEMENT & OTC GUIDELINES
${treats.map((t, i) => `${i + 1}. [${t.type || "Guideline"}] ${t.guideline}`).join("\n") || "Supportive clinical care."}

9. PHYSICAL THERAPY & ERGONOMIC PRECAUTIONS
${pts.map((pt, i) => `${i + 1}. ${pt.exercise} (${pt.frequency || "Daily"}) - ${pt.precaution || ""}`).join("\n") || "Standard ambulatory precautions."}

======================================================================
DISCLAIMER: This comprehensive pre-consultation report is AI-generated for licensed medical practitioners. It serves as an assistive clinical intake tool and not a standalone final diagnosis.
======================================================================`;

  const handleCopy = () => {
    navigator.clipboard.writeText(fullReportText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  const handleDownloadTxt = () => {
    const blob = new Blob([fullReportText], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${reportId}_${p.name.replace(/\s+/g, "_")}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div
      className="modal-backdrop"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(11, 31, 42, 0.85)",
        backdropFilter: "blur(8px)",
        WebkitBackdropFilter: "blur(8px)",
        display: "grid",
        placeItems: "center",
        zIndex: 2000,
        padding: "16px",
        overflowY: "auto"
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="card"
        style={{
          maxWidth: "880px",
          width: "100%",
          maxHeight: "92vh",
          overflowY: "auto",
          padding: "28px",
          background: "var(--bg1)",
          border: "1px solid var(--line)",
          boxShadow: "0 24px 60px rgba(0,0,0,0.55)",
          borderRadius: "18px",
          position: "relative"
        }}
      >
        {/* Modal Header & Quick Actions */}
        <div className="flex-between pb-2" style={{ borderBottom: "1px solid var(--line)", paddingBottom: "14px" }}>
          <div>
            <div className="lbl" style={{ color: "var(--ac)" }}>
              CAREBRIDGE CLINICAL DOCUMENTATION • OFFICIAL PATIENT REPORT
            </div>
            <h2 style={{ fontSize: "22px", marginTop: "4px" }}>
              Comprehensive Pre-Consultation Report
            </h2>
            <div className="mut small mt-1">
              Report ID: <b style={{ color: "var(--tx)" }}>{reportId}</b> • Generated: {genDate}
            </div>
          </div>
          <div className="flex-row gap-2 align-center">
            <button
              className="btn sm"
              onClick={handleCopy}
              title="Copy text formatted report for EHR"
              style={{ background: copied ? "rgba(79, 227, 193, 0.2)" : undefined, borderColor: copied ? "var(--ac)" : undefined }}
            >
              {copied ? "✓ Copied!" : "📋 Copy"}
            </button>
            <button
              className="btn sm"
              onClick={handleDownloadTxt}
              title="Download text report file"
            >
              💾 Save .txt
            </button>
            <button
              className="btn sm pri"
              onClick={() => window.print()}
              title="Print official report or save as PDF"
            >
              🖨️ Print / PDF
            </button>
            <button
              className="btn sm"
              onClick={onClose}
              style={{ fontSize: "16px", fontWeight: "bold", padding: "4px 10px" }}
              title="Close Report Modal"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Demographics Card */}
        <div className="mt-3 p-3" style={{ background: "var(--glass2)", borderRadius: "14px", border: "1px solid var(--line)", padding: "16px" }}>
          <div className="flex-between">
            <div>
              <span className="tok" style={{ fontSize: "14px" }}>{p.token}</span>
              <h3 style={{ fontSize: "20px", margin: "2px 0 0" }}>{p.name}</h3>
              <div className="mut small mt-1">
                {p.age} yrs • {p.gender} • Language: <b>{langName(p.language)}</b> • Phone: <b>{p.phone || "Not recorded"}</b>
              </div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div className="flex-row gap-2 justify-end">
                <StatusBadge status={p.status} />
                <UrgencyBadge level={p.urgency} />
              </div>
              <div className="small mut mt-1">
                Type: <b>{p.visit_type === "followup" ? "🔁 Follow-Up" : "🆕 Initial Visit"}</b>
              </div>
              {p.assigned_doctor_name && (
                <div className="small mt-1" style={{ color: "var(--ac)" }}>
                  Doctor: <b>{p.assigned_doctor_name}</b>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Triage & Clinical Acuity */}
        <div className="mt-3" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
          <div className="clinical-section" style={{ background: triage.score >= 80 ? "rgba(255, 92, 92, 0.1)" : "var(--glass)", borderColor: triage.score >= 80 ? "var(--urg-high)" : "var(--line)" }}>
            <div className="lbl" style={{ color: triage.score >= 80 ? "var(--urg-high)" : "var(--ac)" }}>Clinical Acuity &amp; Triage</div>
            <div style={{ display: "flex", alignItems: "baseline", gap: "8px", marginTop: "6px" }}>
              <span style={{ fontSize: "28px", fontWeight: 700, color: triage.score >= 80 ? "var(--urg-high)" : "var(--tx)" }}>
                {triage.score ?? 25}
              </span>
              <span className="mut">/100 Acuity Score</span>
            </div>
            <div className="small mt-1" style={{ fontWeight: 600 }}>{triage.category || "Routine Clinical Intake"}</div>
            {triage.urgent_symptoms?.length > 0 && (
              <div className="mt-2">
                <div className="lbl" style={{ color: "var(--urg-high)", fontSize: "10px" }}>Red Flags / Immediate Flags</div>
                <Tags items={triage.urgent_symptoms} />
              </div>
            )}
          </div>

          <div className="clinical-section">
            <div className="lbl" style={{ color: "var(--ac2)" }}>Recorded Vitals &amp; Baseline</div>
            <div className="vitals-grid mt-2">
              <div><span className="mut small">BP:</span> <b>{vitals.bp || "Not recorded"}</b></div>
              <div><span className="mut small">Heart Rate:</span> <b>{vitals.heart_rate || "Not recorded"}</b></div>
              <div><span className="mut small">Temp:</span> <b>{vitals.temperature || "Not recorded"}</b></div>
              <div><span className="mut small">SpO2:</span> <b>{vitals.spo2 || "Not recorded"}</b></div>
            </div>
            {negs.length > 0 && (
              <div className="mt-2">
                <span className="mut small">Pertinent Negatives: </span>
                <span className="small">{negs.join(", ")}</span>
              </div>
            )}
          </div>
        </div>

        {/* Chief Complaint & Symptoms */}
        <div className="clinical-section mt-3">
          <div className="lbl">Chief Complaint &amp; Symptom Chronology</div>
          <div style={{ fontSize: "17px", fontWeight: 600, marginTop: "4px" }}>{chief}</div>
          {durations.length > 0 && (
            <div className="mt-2">
              <span className="mut small">Chronology / Duration:</span>
              <div className="row mt-1" style={{ gap: "8px", margin: "4px 0 0" }}>
                {durations.map((d, i) => (
                  <span key={i} className="tag" style={{ fontSize: "12px" }}>
                    <b>{d.symptom}</b>: {d.duration}
                  </span>
                ))}
              </div>
            </div>
          )}
          {summary && (
            <p className="small mut mt-2" style={{ lineHeight: 1.6, background: "var(--glass2)", padding: "10px 12px", borderRadius: "10px" }}>
              {summary}
            </p>
          )}
        </div>

        {/* Standardized SOAP Note */}
        <div className="clinical-section mt-3" style={{ background: "rgba(124, 140, 255, 0.05)" }}>
          <div className="lbl" style={{ color: "var(--sec)" }}>Standardized Clinical SOAP Formulation</div>
          
          <div className="mt-2" style={{ display: "grid", gap: "10px" }}>
            <div style={{ background: "var(--glass)", padding: "10px 14px", borderRadius: "10px", border: "1px solid var(--line)" }}>
              <b style={{ color: "var(--ac)" }}>[S] SUBJECTIVE</b>
              <p className="small mt-1" style={{ lineHeight: 1.5 }}>
                {soap.subjective || summary || `Patient presents with ${chief}.`}
              </p>
            </div>

            <div style={{ background: "var(--glass)", padding: "10px 14px", borderRadius: "10px", border: "1px solid var(--line)" }}>
              <b style={{ color: "var(--ac)" }}>[O] OBJECTIVE</b>
              <p className="small mt-1" style={{ lineHeight: 1.5 }}>
                {soap.objective || `Vitals: BP: ${vitals.bp || "N/R"}, HR: ${vitals.heart_rate || "N/R"}, Temp: ${vitals.temperature || "N/R"}, SpO2: ${vitals.spo2 || "N/R"}. Pertinent Negatives: ${negs.join(", ") || "None denied"}.`}
              </p>
            </div>

            <div style={{ background: "var(--glass)", padding: "10px 14px", borderRadius: "10px", border: "1px solid var(--line)" }}>
              <b style={{ color: "var(--ac)" }}>[A] ASSESSMENT</b>
              <p className="small mt-1" style={{ lineHeight: 1.5 }}>
                {soap.assessment || `Differential Diagnoses: ${diffs.map(d => `${d.condition} (${d.probability || "Suspected"})`).join("; ") || "Clinical evaluation ongoing"}`}
              </p>
            </div>

            <div style={{ background: "var(--glass)", padding: "10px 14px", borderRadius: "10px", border: "1px solid var(--line)" }}>
              <b style={{ color: "var(--ac)" }}>[P] PLAN</b>
              <p className="small mt-1" style={{ lineHeight: 1.5 }}>
                {soap.plan || `Recommended diagnostic orders and treatment plan pending in-person clinical examination.`}
              </p>
            </div>
          </div>
        </div>

        {/* Differential Diagnoses & Recommended Tests */}
        <div className="mt-3" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
          <div className="clinical-section">
            <div className="lbl" style={{ color: "var(--ac)" }}>Differential Diagnoses</div>
            {diffs.length > 0 ? (
              <div className="mt-2" style={{ display: "grid", gap: "8px" }}>
                {diffs.map((d, i) => (
                  <div key={i} className="diag-card" style={{ padding: "10px" }}>
                    <div className="flex-between">
                      <b style={{ fontSize: "14px" }}>{d.condition}</b>
                      <span className={`badge-conf conf-${(d.probability || "moderate").toLowerCase()}`}>
                        {d.probability || "Moderate"}
                      </span>
                    </div>
                    {d.rationale && <p className="mut small mt-1">{d.rationale}</p>}
                  </div>
                ))}
              </div>
            ) : (
              <span className="mut small mt-1">Evaluated during consultation.</span>
            )}
          </div>

          <div className="clinical-section">
            <div className="lbl" style={{ color: "var(--ac2)" }}>Diagnostic Orders &amp; Tests</div>
            {tests.length > 0 ? (
              <div className="mt-2" style={{ display: "grid", gap: "8px" }}>
                {tests.map((t, i) => (
                  <div key={i} className="diag-card" style={{ padding: "10px" }}>
                    <div className="flex-between">
                      <b style={{ fontSize: "14px" }}>{t.test_name}</b>
                      <span className="tag sm" style={{ fontSize: "11px", padding: "2px 6px" }}>{t.priority || "Routine"}</span>
                    </div>
                    {t.indication && <p className="mut small mt-1">{t.indication}</p>}
                  </div>
                ))}
              </div>
            ) : (
              <span className="mut small mt-1">No immediate lab orders indicated.</span>
            )}
          </div>
        </div>

        {/* Initial Management & Physical Therapy */}
        {(treats.length > 0 || pts.length > 0) && (
          <div className="mt-3" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
            {treats.length > 0 && (
              <div className="clinical-section">
                <div className="lbl">Initial Clinical Management</div>
                <ul className="tips mt-2" style={{ margin: "4px 0 0", paddingLeft: "18px" }}>
                  {treats.map((t, i) => (
                    <li key={i} className="small mt-1">
                      <b>[{t.type || "Rx"}]</b> {t.guideline}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {pts.length > 0 && (
              <div className="clinical-section">
                <div className="lbl">Physical Therapy &amp; Ergonomics</div>
                <ul className="tips mt-2" style={{ margin: "4px 0 0", paddingLeft: "18px" }}>
                  {pts.map((pt, i) => (
                    <li key={i} className="small mt-1">
                      <b>{pt.exercise}</b> ({pt.frequency || "Daily"}) - {pt.precaution}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {/* Modal Footer */}
        <div className="mt-4 pt-3 flex-between" style={{ borderTop: "1px solid var(--line)" }}>
          <span className="disc" style={{ margin: 0, fontSize: "11px" }}>
            CareBridge Clinical AI Assistant • Assistive medical intake documentation for licensed physicians.
          </span>
          <button className="btn pri sm" onClick={onClose}>
            Close Report
          </button>
        </div>
      </div>
    </div>
  );
}

