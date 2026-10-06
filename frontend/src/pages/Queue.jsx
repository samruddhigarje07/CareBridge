import { useCallback, useEffect, useState } from "react";
import { api } from "../services/api";
import { StatusBadge, UrgencyBadge } from "../components/Badges";

const time = (iso) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

export default function Queue() {
  const [q, setQ] = useState(null), [err, setErr] = useState("");
  const load = useCallback(() => api.queue().then((d) => { setQ(d); setErr(""); }).catch((e) => setErr(e.message)), []);
  useEffect(() => { load(); const i = setInterval(load, 2500); addEventListener("cb:refresh", load); return () => { clearInterval(i); removeEventListener("cb:refresh", load); }; }, [load]);

  return (
    <>
      <div className="pagehead"><div><h1 className="h2">Queue dashboard <span className="live"><i /> Live</span></h1>
        <p className="mut small"><b>AI-assisted consultation sequence.</b> Patients are ordered using urgency indicators and arrival time. Final clinical decisions remain with the doctor.</p></div></div>
      {err && <div className="errbox" role="alert"><span>{err}</span><button className="btn sm" onClick={load}>Retry</button></div>}
      {!q && !err && <div className="card center mut">Loading queue…</div>}
      {q && (
        <>
          <div className="stats">
            <div className="card stat"><b>{q.waiting}</b><span>Waiting</span></div>
            <div className="card stat"><b>{q.in_consultation}</b><span>In consultation</span></div>
            <div className="card stat hi"><b>{q.high}</b><span>High urgency</span></div>
          </div>
          <div className="card tablecard">
            {q.entries.length === 0 ? <p className="center mut">The queue is empty. Completed consultations appear here.</p> : (
              <table className="qt"><thead><tr><th>Position</th><th>Token</th><th>Urgency</th><th>Arrival</th><th>Status</th></tr></thead>
                <tbody>{q.entries.map((e) => (
                  <tr key={e.token} className={`${e.status === "in_consultation" ? "now" : ""} u-r-${e.urgency}`}>
                    <td className="pos">{e.position ?? "Now"}</td><td><b>{e.token}</b></td><td><UrgencyBadge level={e.urgency} /></td><td>{time(e.created_at)}</td><td><StatusBadge status={e.status} /></td>
                  </tr>))}</tbody></table>
            )}
          </div>
          <p className="mut small center">No names or medical details are shown on this screen.</p>
        </>
      )}
    </>
  );
}
