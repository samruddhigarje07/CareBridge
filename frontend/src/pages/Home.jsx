import { Pulse, Mic, Doc, Queue, Shield } from "../components/Art";

export default function Home({ go }) {
  const cards = [
    ["patient", <Mic />, "Patient", "Speak once, in your language. The AI listens and asks only what matters."],
    ["doctor", <Doc />, "Doctor", "A structured brief and urgency indicators — before the consultation starts."],
    ["queue", <Queue />, "Queue", "A live, anonymous consultation sequence by urgency and arrival time."],
  ];
  return (
    <>
      <section className="card hero">
        <Pulse />
        <h1>Tell your story once.</h1>
        <p className="lead">CareBridge is a multilingual, voice-first AI pre-consultation assistant. Patients speak naturally in English, Hindi or Marathi; doctors receive a concise clinical brief and a transparent urgency indicator.</p>
        <div className="row center"><button className="btn pri lg" onClick={() => go("patient")}><Mic /> Start a consultation</button></div>
      </section>
      <section className="grid3">
        {cards.map(([v, icon, t, d]) => (
          <button key={v} className="card tile" onClick={() => go(v)}><div>{icon}</div><h2>{t}</h2><p className="mut">{d}</p></button>
        ))}
      </section>
      <section className="card">
        <h2>How it works</h2>
        <ol className="flow">
          <li><b>Speak</b><span>Pick a language and talk to the assistant.</span></li>
          <li><b>Understand</b><span>AI extracts symptoms and asks relevant follow-ups.</span></li>
          <li><b>Brief</b><span>A structured English brief + urgency indicators.</span></li>
          <li><b>Sequence</b><span>AI-assisted consultation sequence; doctor decides.</span></li>
        </ol>
        <p className="safety"><Shield /> The AI is not a doctor. It does not diagnose or recommend treatment — it only collects, organises and summarises information. Final clinical decisions remain with the doctor.</p>
      </section>
    </>
  );
}
