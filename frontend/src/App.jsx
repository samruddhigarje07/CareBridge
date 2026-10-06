import { useEffect, useState } from "react";
import { Logo } from "./components/Art";
import DemoMenu from "./components/DemoMenu";
import { DISCLAIMER } from "./i18n";
import { api, WS_URL } from "./services/api";
import Home from "./pages/Home";
import Patient from "./pages/Patient";
import Doctor from "./pages/Doctor";
import Queue from "./pages/Queue";

const VIEWS = ["home", "patient", "doctor", "queue", "login"];
const readHash = () => {
  const h = location.hash.slice(1);
  return VIEWS.includes(h) ? h : "home";
};

export default function App() {
  const [view, setView] = useState(readHash());
  const [health, setHealth] = useState(null);
  const [authed, setAuthed] = useState(false);
  const [authLoading, setAuthLoading] = useState(true);
  const [theme, setTheme] = useState(localStorage.getItem("cb_theme") || "dark");

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("cb_theme", theme);
  }, [theme]);

  const toggleTheme = () => setTheme(theme === "dark" ? "light" : "dark");

  useEffect(() => {
    const f = () => {
      const v = readHash();
      if (v === "doctor" && !authed) {
        location.hash = "login";
        setView("login");
      } else {
        setView(v);
      }
    };
    addEventListener("hashchange", f);
    return () => removeEventListener("hashchange", f);
  }, [authed]);

  // Check health & auth on mount
  useEffect(() => {
    let alive = true;
    const check = () => api.health().then((h) => alive && setHealth(h)).catch(() => alive && setHealth(false));
    check();
    const t = setInterval(check, 10000);

    api.me().then((res) => {
      if (alive && res?.authenticated) {
        setAuthed(true);
      }
    }).catch(() => {
      if (alive) setAuthed(false);
    }).finally(() => {
      if (alive) setAuthLoading(false);
    });

    return () => { alive = false; clearInterval(t); };
  }, []);

  // WebSocket real-time connection for live multi-device report syncing
  useEffect(() => {
    let ws = null;
    let timer = null;
    function connect() {
      try {
        ws = new WebSocket(WS_URL);
        ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            if (data.event === "new_patient" || data.event === "status_changed" || data.event === "patient_called" || data.event === "queue_reset") {
              dispatchEvent(new CustomEvent("cb:refresh"));
            }
          } catch { /* ignore */ }
        };
        ws.onclose = () => {
          timer = setTimeout(connect, 4000);
        };
      } catch {
        timer = setTimeout(connect, 4000);
      }
    }
    connect();
    return () => {
      if (ws) ws.close();
      if (timer) clearTimeout(timer);
    };
  }, []);

  const go = (v) => {
    if (v === "doctor" && !authed) {
      location.hash = "login";
      setView("login");
    } else {
      location.hash = v;
      setView(v);
    }
  };

  async function handleLogout() {
    try { await api.logout(); } catch { /* ignore */ }
    localStorage.removeItem("cb_token");
    localStorage.removeItem("cb_doctor");
    setAuthed(false);
    go("home");
  }

  const tab = (v, label) => <button key={v} className={view === v ? "on" : ""} onClick={() => go(v)} aria-current={view === v ? "page" : undefined}>{label}</button>;

  if (authLoading) {
    return <div className="shell center" style={{ display: "grid", placeItems: "center", minHeight: "100vh" }}>Loading CareBridge…</div>;
  }

  return (
    <div className="shell">
      <header className="bar">
        <button className="brand" onClick={() => go("home")} aria-label="CareBridge home"><Logo /><span><b>CareBridge</b><small>Secure Pre-Consultation &amp; Clinical Intelligence</small></span></button>
        <nav className="tabs" aria-label="Main">
          {tab("home", "Home")}
          {tab("patient", "Patient Portal")}
          {authed ? tab("doctor", "Doctor Dashboard") : <button onClick={() => go("login")} className={view === "login" ? "on" : ""}>Doctor Portal</button>}
          {tab("queue", "Live Queue")}
        </nav>
        <div className="flex-row gap-2 align-center">
          <button className="btn sm theme-toggle" onClick={toggleTheme} title="Toggle Dark/Light Mode">{theme === "dark" ? "☀️ Light" : "🌙 Dark"}</button>
          <DemoMenu />
        </div>
      </header>

      {health === false && <div className="banner err-b" role="alert">Can't reach the CareBridge backend. Start it with <code>uvicorn main:app --reload --host 0.0.0.0</code> in <code>backend/</code>.</div>}
      {health && !health.ai_configured && <div className="banner warn-b">AI is not configured: add <code>GEMINI_API_KEY</code> to <code>backend/.env</code> and restart. Doctor/Queue views and demo data still work.</div>}

      <main className="wrap">
        {view === "home" && <Home go={go} />}
        {view === "patient" && <Patient />}
        {view === "doctor" && (authed ? <Doctor onLogout={handleLogout} /> : <DoctorAuthScreen onLoginSuccess={() => { setAuthed(true); go("doctor"); }} go={go} />)}
        {view === "login" && <DoctorAuthScreen onLoginSuccess={() => { setAuthed(true); go("doctor"); }} go={go} />}
        {view === "queue" && <Queue />}
      </main>

      <footer className="foot">{DISCLAIMER}</footer>
    </div>
  );
}

function DoctorAuthScreen({ onLoginSuccess, go }) {
  const [tab, setTab] = useState("login"); // "login" | "register"
  const [doctors, setDoctors] = useState([]);
  const [loginForm, setLoginForm] = useState({ email: "doctor@carebridge.ai", passcode: "carebridge2026" });
  const [regForm, setRegForm] = useState({ name: "", email: "", specialty: "General Physician", passcode: "", license_number: "" });
  const [err, setErr] = useState("");
  const [toast, setToast] = useState("");

  useEffect(() => {
    api.listDoctors().then(setDoctors).catch(() => {});
  }, []);

  async function handleLogin(e) {
    e.preventDefault();
    setErr("");
    try {
      const res = await api.doctorLogin(loginForm.email, loginForm.passcode);
      if (res?.token) {
        localStorage.setItem("cb_token", res.token);
        localStorage.setItem("cb_doctor", JSON.stringify(res.user));
        onLoginSuccess();
      }
    } catch (e) {
      setErr(e.message || "Login failed");
    }
  }

  async function handleRegister(e) {
    e.preventDefault();
    setErr("");
    setToast("");
    try {
      await api.registerDoctor(regForm);
      setToast("Doctor registered successfully! Please log in.");
      setRegForm({ name: "", email: "", specialty: "General Physician", passcode: "", license_number: "" });
      const updated = await api.listDoctors();
      setDoctors(updated);
      setTimeout(() => setTab("login"), 1500);
    } catch (e) {
      setErr(e.message || "Registration failed");
    }
  }

  return (
    <div className="card narrow mt-6" style={{ padding: "28px" }}>
      <div className="flex-between mb-4">
        <div>
          <h2>Doctor Portal &amp; Management</h2>
          <p className="mut small mt-1">Secure authentication &amp; physician onboarding system.</p>
        </div>
        <div className="tabs" style={{ margin: 0 }}>
          <button type="button" className={tab === "login" ? "on" : ""} onClick={() => setTab("login")}>Login</button>
          <button type="button" className={tab === "register" ? "on" : ""} onClick={() => setTab("register")}>Onboard New Doctor</button>
        </div>
      </div>

      {err && <div className="errbox mt-2"><span>{err}</span></div>}
      {toast && <div className="toast mt-2" role="status">✅ {toast}</div>}

      {tab === "login" ? (
        <form onSubmit={handleLogin} className="mt-4" style={{ display: "flex", flexDirection: "column", gap: "14px", textAlign: "left" }}>
          {doctors.length > 0 && (
            <div>
              <label className="lbl">Select Registered Doctor</label>
              <select className="mt-1" onChange={(e) => {
                const doc = doctors.find(d => d.email === e.target.value);
                if (doc) setLoginForm({ ...loginForm, email: doc.email });
              }} value={loginForm.email}>
                {doctors.map(d => <option key={d.email} value={d.email}>{d.name} ({d.specialty}) - {d.email}</option>)}
              </select>
            </div>
          )}
          <div>
            <label className="lbl">Doctor Email</label>
            <input className="mt-1" type="email" value={loginForm.email} onChange={(e) => setLoginForm({ ...loginForm, email: e.target.value })} required />
          </div>
          <div>
            <label className="lbl">Passcode / PIN</label>
            <input className="mt-1" type="password" value={loginForm.passcode} onChange={(e) => setLoginForm({ ...loginForm, passcode: e.target.value })} required />
          </div>
          <button type="submit" className="btn pri lg mt-2" style={{ width: "100%", justifyContent: "center" }}>🔐 Login to Doctor Dashboard</button>
          <div className="mut small center mt-2">Default Admin Doctor: <code>doctor@carebridge.ai</code> / <code>carebridge2026</code></div>
        </form>
      ) : (
        <form onSubmit={handleRegister} className="mt-4" style={{ display: "flex", flexDirection: "column", gap: "14px", textAlign: "left" }}>
          <div>
            <label className="lbl">Full Name (e.g. Dr. Sarah Jenkins)</label>
            <input className="mt-1" type="text" value={regForm.name} onChange={(e) => setRegForm({ ...regForm, name: e.target.value })} placeholder="Dr. Jane Doe" required />
          </div>
          <div>
            <label className="lbl">Email Address</label>
            <input className="mt-1" type="email" value={regForm.email} onChange={(e) => setRegForm({ ...regForm, email: e.target.value })} placeholder="doctor@hospital.org" required />
          </div>
          <div>
            <label className="lbl">Specialty / Department</label>
            <select className="mt-1" value={regForm.specialty} onChange={(e) => setRegForm({ ...regForm, specialty: e.target.value })}>
              <option value="General Physician">General Physician</option>
              <option value="Cardiology">Cardiology</option>
              <option value="Orthopedics">Orthopedics</option>
              <option value="Pediatrics">Pediatrics</option>
              <option value="Neurology">Neurology</option>
              <option value="Emergency Medicine">Emergency Medicine</option>
            </select>
          </div>
          <div>
            <label className="lbl">Medical License ID</label>
            <input className="mt-1" type="text" value={regForm.license_number} onChange={(e) => setRegForm({ ...regForm, license_number: e.target.value })} placeholder="LIC-99382" required />
          </div>
          <div>
            <label className="lbl">Secure Passcode (Min 4 chars)</label>
            <input className="mt-1" type="password" value={regForm.passcode} onChange={(e) => setRegForm({ ...regForm, passcode: e.target.value })} placeholder="••••" required minLength={4} />
          </div>
          <button type="submit" className="btn pri lg mt-2" style={{ width: "100%", justifyContent: "center" }}>✨ Register New Doctor</button>
        </form>
      )}

      <button className="link mt-4 center" onClick={() => go("home")} style={{ display: "block", width: "100%" }}>← Back to Home</button>
    </div>
  );
}
