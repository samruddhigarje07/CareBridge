import { useEffect, useState } from "react";
import { getVoicePref, onVoicesChanged, setVoicePref, speak, ttsSupported, voicesFor } from "../services/speech";
import { LANGS, UI } from "../i18n";

const SAMPLE = { en: "Hello, I am CareBridge. I will ask you a few short questions.", hi: "नमस्ते, मैं केयरब्रिज हूँ। मैं आपसे कुछ छोटे सवाल पूछूँगा।", mr: "नमस्कार, मी केअरब्रिज आहे. मी तुम्हाला काही छोटे प्रश्न विचारेन." };

/** Lets the user pick which installed browser voice speaks (e.g. switch away from a male English voice). */
export default function VoicePicker({ lang }) {
  const code = LANGS[lang].code, t = UI[lang];
  const [, bump] = useState(0);
  const [value, setValue] = useState(getVoicePref(code));
  useEffect(() => onVoicesChanged(() => bump((n) => n + 1)), []);
  useEffect(() => setValue(getVoicePref(code)), [code]);
  if (!ttsSupported()) return null;
  const list = voicesFor(code);
  if (list.length === 0) return null;
  const change = (uri) => { setVoicePref(code, uri); setValue(uri); speak(SAMPLE[lang] || SAMPLE.en, code); };
  return (
    <label className="vpick">
      <span className="mut small">🔊 {t.voiceLabel}</span>
      <select value={value} onChange={(e) => change(e.target.value)} aria-label={t.voiceLabel}>
        <option value="">{t.autoVoice}</option>
        {list.map((v) => <option key={v.voiceURI} value={v.voiceURI}>{v.name} ({v.lang})</option>)}
      </select>
      <button type="button" className="btn sm" onClick={() => speak(SAMPLE[lang] || SAMPLE.en, code)}>{t.testVoice}</button>
    </label>
  );
}
