import { useEffect, useRef, useState } from "react";
import { api } from "../services/api";
import { LANGS as APP_LANGS } from "../i18n";
import { listenOnce, srSupported } from "../services/speech";
import { say as speakText, ttsOK, stopTts } from "../services/tts";
import "./voiceConsult.css";

const LABELS = [{ k: "en", n: "English" }, { k: "hi", n: "हिन्दी" }, { k: "mr", n: "मराठी" }];
const TX = {
  en: { sub: "Our AI will talk with you in your language", start: "Start voice consultation", speak: "Speak", type: "Type your answer", send: "Send", back: "← Back", cancel: "Cancel", retry: "Try again",
    speaking: "AI is speaking…", listening: "Listening… speak now", thinking: "Thinking…", preparing: "Preparing your report…",
    noVoice: "Speech recognition is not available in this browser. Please use Chrome or type.", noTts: "This browser cannot speak aloud. Please use Chrome.",
    mic: "Microphone is blocked. Allow it in the browser address bar (Mac: System Settings > Privacy & Security > Microphone). You can also type.",
    netErr: "Speech service unreachable. Brave and Safari often block it. Use Chrome, or type.", heard: "I did not hear you. Tap Speak or type.",
    hello: "Hello, one moment please.", replay: "🔊 Replay", silent: "No sound could be played. Check your Mac volume and sound output, then tap Replay.",
    noTtsVoice: "No voice is installed for this language on this device. Read the text on screen, or add a voice in System Settings > Accessibility > Spoken Content." },
  hi: { sub: "हमारा AI आपकी भाषा में बात करेगा", start: "आवाज़ से परामर्श शुरू करें", speak: "बोलें", type: "अपना उत्तर लिखें", send: "भेजें", back: "← वापस", cancel: "रद्द करें", retry: "फिर कोशिश करें",
    speaking: "AI बोल रहा है…", listening: "सुन रहा हूँ… बोलिए", thinking: "सोच रहा हूँ…", preparing: "रिपोर्ट तैयार हो रही है…",
    noVoice: "इस ब्राउज़र में आवाज़ पहचान उपलब्ध नहीं है। Chrome इस्तेमाल करें या लिखें।", noTts: "यह ब्राउज़र बोल नहीं सकता। कृपया Chrome इस्तेमाल करें।",
    mic: "माइक्रोफ़ोन बंद है। ब्राउज़र में अनुमति दें, या लिखकर जवाब दें।", netErr: "आवाज़ सेवा नहीं मिल रही। Chrome इस्तेमाल करें या लिखें।", heard: "मैंने सुना नहीं। बोलें दबाएँ या लिखें。",
    hello: "नमस्ते, कृपया एक पल रुकें।", replay: "🔊 फिर सुनें", silent: "आवाज़ नहीं चल सकी। अपने Mac की वॉल्यूम और साउंड आउटपुट जाँचें, फिर फिर सुनें दबाएँ।",
    noTtsVoice: "इस डिवाइस पर इस भाषा की आवाज़ इंस्टॉल नहीं है। स्क्रीन पर पढ़ें।" },
  mr: { sub: "आमचा AI तुमच्या भाषेत बोलेल", start: "आवाजाने सल्ला सुरू करा", speak: "बोला", type: "तुमचे उत्तर लिहा", send: "पाठवा", back: "← मागे", cancel: "रद्द करा", retry: "पुन्हा प्रयत्न करा",
    speaking: "AI बोलत आहे…", listening: "ऐकत आहे… बोला", thinking: "विचार करत आहे…", preparing: "रिपोर्ट तयार होत आहे…",
    noVoice: "या ब्राउझरमध्ये आवाज ओळख उपलब्ध नाही. Chrome वापरा किंवा लिहा.", noTts: "हा ब्राउझर बोलू शकत नाही. कृपया Chrome वापरा.",
    mic: "मायक्रोफोन बंद आहे. ब्राउज़रमध्ये परवानगी द्या, किंवा लिहून उत्तर द्या.", netErr: "आवाज सेवा मिळत नाही. Chrome वापरा किंवा लिहा.", heard: "मला ऐकू आले नाही. बोला दाबा किंवा लिहा.",
    hello: "नमस्कार, कृपया क्षणभर थांबा.", replay: "🔊 पुन्हा ऐका", silent: "आवाज वाजू शकला नाही. तुमच्या Mac चा आवाज आणि साउंड आउटपुट तपासा, मग पुन्हा ऐका दाबा.",
    noTtsVoice: "या डिव्हाइसवर या भाषेचा आवाज उपलब्ध नाही. स्क्रीनवरील मजकूर वाचा." },
};

export default function VoiceConsult({ onDone, onBack, initialPatient = null, initialLang = "en" }) {
  const chosenLang = initialLang || initialPatient?.language || "en";
  const [lang, setLang] = useState(chosenLang), [started, setStarted] = useState(false), [msgs, setMsgs] = useState([]), [text, setText] = useState("");
  const [phase, setPhase] = useState("idle"), [err, setErr] = useState(null), [interim, setInterim] = useState(""), [voice, setVoice] = useState(true), [notice, setNotice] = useState("");
  const run = useRef(0), listener = useRef(null), idRef = useRef(null), langRef = useRef(chosenLang), voiceRef = useRef(true), misses = useRef(0), end = useRef(null), lastAi = useRef("");
  const t = TX[lang], codeOf = () => APP_LANGS[langRef.current]?.code || "en-IN", tt = () => TX[langRef.current] || TX.en;
  voiceRef.current = voice;
  langRef.current = lang;
  const stopAudio = () => { listener.current?.abort(); listener.current = null; stopTts(); };
  useEffect(() => () => { run.current++; stopAudio(); }, []);
  useEffect(() => { end.current?.scrollIntoView({ behavior: "smooth" }); }, [msgs]);
  const fail = (e, retry) => { setErr({ msg: e.message || String(e), retry }); setPhase("ready"); };

  // Mirrors the original working flow: speak the question, then listen automatically with VAD debounce
  async function listen() {
    const my = run.current;
    if (!srSupported()) { setErr({ msg: tt().noVoice }); setPhase("ready"); return; }
    setErr(null); setInterim(""); setPhase("listening");
    const l = listenOnce(codeOf(), { onInterim: setInterim, silenceTimeoutMs: 2800, maxWaitMs: 25000 });
    listener.current = l;
    try {
      const said = await l.promise;
      if (my !== run.current) return;
      submit(said);
    } catch (e) {
      if (my !== run.current || e.code === "aborted") return;
      if (e.code === "not-allowed") { setErr({ msg: tt().mic }); setPhase("ready"); return; }
      if (e.code === "network") { setErr({ msg: tt().netErr }); setPhase("ready"); return; }
      if (misses.current++ < 4) return listen(); // heard nothing: keep listening automatically
      setErr({ msg: tt().heard }); setPhase("ready");
    } finally { setInterim(""); }
  }
  async function speakOut(text) {
    const r = await speakText(text, codeOf());
    setNotice(r.ok ? "" : r.why === "novoice" ? tt().noTtsVoice : tt().silent);
    return r;
  }
  async function say(view) {
    const my = run.current;
    idRef.current = view.intake_id; lastAi.current = view.reply; setMsgs(m => [...m, { who: "ai", content: view.reply }]);
    if (voiceRef.current && ttsOK()) { setPhase("speaking"); await speakOut(view.reply); }
    if (my !== run.current) return;
    if (view.done) {
      setPhase("preparing");
      setTimeout(() => { if (my === run.current) finish(view.intake_id); }, 1000);
      return;
    }
    listen();
  }
  async function submit(said) {
    const clean = (said || "").trim();
    if (!clean || !idRef.current) return;
    stopAudio(); misses.current = 0; setText(""); setErr(null); setPhase("thinking");
    setMsgs(m => [...m, { who: "me", content: clean }]);
    const my = run.current;
    try { const view = await api.sendMessage(idRef.current, clean); if (my !== run.current) return; await say(view); }
    catch (e) { if (my === run.current) fail(e, () => { setMsgs(m => m.slice(0, -1)); submit(clean); }); }
  }
  async function finish(id) {
    const my = run.current; setPhase("preparing"); setErr(null);
    try { const r = await api.completeIntake(id); if (my === run.current) onDone(r); }
    catch (e) { if (my === run.current) fail(e, () => finish(id)); }
  }
  async function begin() {
    run.current++; langRef.current = lang; misses.current = 0; setStarted(true); setErr(null); setPhase("thinking");
    const hello = voiceRef.current && ttsOK() ? speakText(TX[lang].hello, APP_LANGS[lang].code) : null; // spoken inside the click: proves audio works
    try {
      const payload = initialPatient ? { language: lang, ...initialPatient } : lang;
      const view = await api.startIntake(payload);
      if (hello) await hello;
      await say(view);
    }
    catch (e) { setStarted(false); setErr({ msg: e.message || String(e) }); setPhase("idle"); }
  }
  const replay = async () => { if (!lastAi.current) return; stopAudio(); run.current++; setPhase("speaking"); await speakOut(lastAi.current); listen(); };
  const manualSpeak = () => { stopAudio(); run.current++; misses.current = 0; listen(); };

  if (!started) return (<div className="narrow">
    <button className="link" onClick={onBack}>{t.back}</button>
    <div className="card center mt-2"><div style={{ fontSize: 40 }}>🎙️</div><h2>CareBridge AI</h2><p className="mut">{t.sub}</p>
      <div className="vc-langs">{LABELS.map(l => <button key={l.k} className={"vc-lang " + (l.k === lang ? "on" : "")} onClick={() => setLang(l.k)}>{l.n}</button>)}</div>
      <div className="vc-row" style={{ justifyContent: "center" }}><button className="btn pri lg" onClick={begin}>{t.start}</button></div>
      {err && <div className="errbox mt-2" role="alert"><span>{err.msg}</span></div>}</div></div>);

  return (<div className="narrow"><div className="card mt-2">
    <div className="vc-top"><h2>CareBridge AI</h2><span><button className="btn sm" onClick={replay}>{t.replay}</button> <button className="btn sm" onClick={() => setVoice(!voice)} aria-label="Toggle voice">{voice ? "🔊" : "🔇"}</button></span></div>
    {!ttsOK() && <p className="mut small">{t.noTts}</p>}
    {notice && <div className="errbox" role="status"><span>{notice}</span></div>}
    {!srSupported() && <p className="mut small">{t.noVoice}</p>}
    <div className="vc-chat">{msgs.map((m, i) => <div key={i} className={"vc-bub " + m.who}>{m.content}</div>)}<div ref={end} /></div>
    <p className="mut small" style={{ minHeight: 20 }}><span className={"vc-orb " + (phase === "listening" ? "live" : "")} />{t[phase] || ""} {interim && <i>“{interim}”</i>}</p>
    <div className="vc-row"><input placeholder={t.type} value={text} onChange={e => setText(e.target.value)} onKeyDown={e => e.key === "Enter" && submit(text)} autoFocus disabled={phase === "thinking" || phase === "preparing"} />
      <button className="btn" onClick={manualSpeak} disabled={phase === "thinking" || phase === "preparing"}>{t.speak}</button>
      <button className="btn pri" onClick={() => submit(text)} disabled={phase === "thinking" || phase === "preparing" || !text.trim()}>{t.send}</button></div>
    {err && <div className="errbox mt-2" role="alert"><span>{err.msg}</span>{err.retry && <button className="btn sm" onClick={err.retry}>{t.retry}</button>}</div>}
    <div className="vc-row" style={{ justifyContent: "center" }}><button className="link" onClick={onBack}>{t.cancel}</button></div>
  </div></div>);
}
