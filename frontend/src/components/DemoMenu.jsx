import { useState } from "react";
import { api, API } from "../services/api";

export default function DemoMenu() {
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false), [msg, setMsg] = useState("");
  async function run(label, fn) {
    setBusy(true); setMsg("");
    try { await fn(); setMsg(label); window.dispatchEvent(new Event("cb:refresh")); setTimeout(() => setOpen(false), 1200); }
    catch (e) { setMsg(e.message); }
    setBusy(false);
  }
  return (
    <div className="demo">
      <button className="btn sm" onClick={() => setOpen(!open)} aria-expanded={open}>Demo ▾</button>
      {open && (
        <div className="menu" role="menu">
          <button disabled={busy} onClick={() => run("Demo patients loaded", async () => { await api.demoReset(); await api.demoSeed("all"); })}>Reset &amp; load demo patients</button>
          <button disabled={busy} onClick={() => run("High-urgency patient added", () => api.demoSeed("add_high"))}>Add synthetic HIGH patient</button>
          <button className="menuitem" onClick={() => api.downloadMasterExcel().catch(e => setMsg(e.message))}>📊 Download Master (.xlsx)</button>
          <button className="menuitem" onClick={() => api.downloadMasterCsv().catch(e => setMsg(e.message))}>📥 Download Master (.csv)</button>
          <button disabled={busy} onClick={() => { if (confirm("Delete all patient records?")) run("All data cleared", api.demoReset); }}>Clear all data</button>
          {msg && <div className="mut small">{msg}</div>}
        </div>
      )}
    </div>
  );
}
