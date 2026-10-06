// The frontend talks to the backend. Supports local network multi-device access and RBAC auth.
const defaultHost = typeof window !== 'undefined' ? `${window.location.protocol}//${window.location.hostname}:8000` : "http://localhost:8000";
export const API = import.meta.env.VITE_API_URL || defaultHost;
export const WS_URL = API.replace(/^http/, 'ws') + '/ws';

function getToken() {
  return localStorage.getItem("cb_token") || "";
}

async function call(path, { method = "GET", body, auth = false } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (auth) {
    const t = getToken();
    if (t) headers["Authorization"] = `Bearer ${t}`;
  }
  let res;
  try {
    res = await fetch(API + path, {
      method, headers,
      body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(45000),
    });
  } catch (e) {
    const timeout = e?.name === "TimeoutError";
    throw Object.assign(new Error(timeout ? "The server took too long to respond. Please try again."
      : "Can't reach the CareBridge server. Make sure the backend is running."), { code: "network" });
  }
  let json = null;
  try { json = await res.json(); } catch { /* non-JSON error page */ }
  if (!res.ok || !json?.success) {
    throw Object.assign(new Error(json?.error?.message || "Something went wrong. Please try again."), { code: json?.error?.code || "error", status: res.status });
  }
  return json.data;
}

export const api = {
  health: () => call("/health"),
  login: (username, password) => call("/api/auth/login", { method: "POST", body: { username, password } }),
  doctorLogin: (email, passcode) => call("/api/auth/doctor-login", { method: "POST", body: { email, passcode } }),
  listDoctors: () => call("/api/doctors"),
  registerDoctor: (data) => call("/api/doctors/register", { method: "POST", body: data }),
  me: () => call("/api/auth/me", { auth: true }),
  logout: () => call("/api/auth/logout", { method: "POST", auth: true }),

  lookupPatient: (name, phone) => call("/api/patients/lookup", { method: "POST", body: { name, phone } }),
  startIntake: (data) => call("/api/intake/start", { method: "POST", body: typeof data === "string" ? { language: data } : data }),
  sendMessage: (id, text) => call(`/api/intake/${id}/message`, { method: "POST", body: { text } }),
  completeIntake: (id) => call(`/api/intake/${id}/complete`, { method: "POST" }),

  patients: () => call("/api/patients", { auth: true }),
  patient: (id) => call(`/api/patients/${id}`, { auth: true }),
  setStatus: (id, status) => call(`/api/patients/${id}/status`, { method: "PATCH", body: { status }, auth: true }),
  assignPatient: (id, data) => call(`/api/patients/${id}/assign`, { method: "PATCH", body: data, auth: true }),
  callPatient: (id) => call(`/api/patients/${id}/call`, { method: "POST", auth: true }),
  exportPatients: () => {
    const t = getToken();
    return `${API}/api/export/patients.xlsx${t ? `?token=${encodeURIComponent(t)}` : ""}`;
  },
  downloadMasterExcel: async () => {
    const t = getToken();
    const res = await fetch(`${API}/api/export/patients.xlsx`, {
      headers: t ? { Authorization: `Bearer ${t}` } : {}
    });
    if (!res.ok) throw new Error("Failed to download Excel sheet.");
    const blob = await res.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `carebridge_patients_${new Date().toISOString().slice(0, 10)}.xlsx`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.URL.revokeObjectURL(url);
  },
  downloadMasterCsv: async () => {
    const t = getToken();
    const res = await fetch(`${API}/api/export/patients.csv`, {
      headers: t ? { Authorization: `Bearer ${t}` } : {}
    });
    if (!res.ok) throw new Error("Failed to download CSV sheet.");
    const blob = await res.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `carebridge_patients_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.URL.revokeObjectURL(url);
  },

  queue: () => call("/api/queue"),
  tokenStatus: (token) => call(`/api/queue/${token}`),

  demoReset: () => call("/api/demo/reset", { method: "POST", auth: true }),
  demoSeed: (mode = "all") => call("/api/demo/seed", { method: "POST", body: { mode }, auth: true }),
};
