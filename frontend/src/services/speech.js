// Thin wrappers over the browser Web Speech APIs (input: SpeechRecognition, output: speechSynthesis).
const SR = typeof window !== "undefined" && (window.SpeechRecognition || window.webkitSpeechRecognition);
export const srSupported = () => !!SR;
export const ttsSupported = () => typeof window !== "undefined" && "speechSynthesis" in window;

/** Start listening once with intelligent silence debounce (VAD).
 *  Continuous recognition keeps the stream open while the patient pauses to breathe.
 *  Returns { promise, stop, abort }. promise rejects with Error(code):
 *  not-allowed | no-speech | network | aborted | unsupported */
export function listenOnce(lang, { onInterim, silenceTimeoutMs = 2800, maxWaitMs = 25000 } = {}) {
  if (!SR) return { promise: Promise.reject(Object.assign(new Error("unsupported"), { code: "unsupported" })), stop() {}, abort() {} };
  const rec = new SR();
  rec.lang = lang;
  rec.interimResults = true;
  rec.continuous = true; // Stay active across brief pauses
  rec.maxAlternatives = 1;

  let finalText = "", interim = "", settled = false, aborted = false;
  let silenceTimer = null, safetyTimer = null;

  const promise = new Promise((resolve, reject) => {
    const done = (fn, v) => {
      if (!settled) {
        settled = true;
        clearTimeout(silenceTimer);
        clearTimeout(safetyTimer);
        fn(v);
      }
    };
    const err = (code) => done(reject, Object.assign(new Error(code), { code }));

    // Reset silence debounce every time speech is recognized
    const kickSilenceTimer = () => {
      clearTimeout(silenceTimer);
      silenceTimer = setTimeout(() => {
        try { rec.stop(); } catch { /* ignore */ }
      }, silenceTimeoutMs);
    };

    rec.onresult = (e) => {
      interim = "";
      finalText = "";
      for (let i = 0; i < e.results.length; i++) {
        if (e.results[i].isFinal) {
          finalText += e.results[i][0].transcript + " ";
        } else {
          interim += e.results[i][0].transcript;
        }
      }
      const combined = (finalText + interim).trim();
      onInterim?.(combined);

      // If user has said something, trigger silence countdown
      if (combined.length > 0) {
        kickSilenceTimer();
      }
    };

    rec.onerror = (e) => {
      clearTimeout(silenceTimer);
      if (e.error === "no-speech") {
        // Continuous mode may report no-speech if initially quiet
        return;
      }
      err(e.error === "service-not-allowed" ? "not-allowed" : e.error || "network");
    };

    rec.onend = () => {
      clearTimeout(silenceTimer);
      clearTimeout(safetyTimer);
      const text = (finalText + interim).trim();
      if (aborted) return err("aborted");
      text ? done(resolve, text) : err("no-speech");
    };

    // Overall safety limit if user never speaks anything
    safetyTimer = setTimeout(() => {
      try { rec.stop(); } catch { /* ignore */ }
    }, maxWaitMs);

    try { rec.start(); } catch { err("network"); }
  });

  return {
    promise,
    stop: () => {
      clearTimeout(silenceTimer);
      try { rec.stop(); } catch { /* ignore */ }
    },
    abort: () => {
      aborted = true;
      clearTimeout(silenceTimer);
      clearTimeout(safetyTimer);
      try { rec.abort(); } catch { /* ignore */ }
    }
  };
}

let voices = [];
const listeners = new Set();
if (ttsSupported()) {
  const load = () => { voices = speechSynthesis.getVoices(); listeners.forEach((f) => f()); };
  load(); speechSynthesis.addEventListener?.("voiceschanged", load);
}
export const onVoicesChanged = (f) => { listeners.add(f); return () => listeners.delete(f); };

const base = (l) => l.replace("_", "-").split("-")[0].toLowerCase();
const prefKey = (lang) => `cb_voice_${base(lang)}`;
export const getVoicePref = (lang) => { try { return localStorage.getItem(prefKey(lang)) || ""; } catch { return ""; } };
export const setVoicePref = (lang, uri) => { try { uri ? localStorage.setItem(prefKey(lang), uri) : localStorage.removeItem(prefKey(lang)); } catch { /* ignore */ } };

// Friendly default: prefer natural / female-sounding Indian voices; avoid names that are typically male.
const GOOD = /neerja|heera|swara|kalpana|lekha|veena|aria|jenny|zira|samantha|karen|tessa|female|natural|online|google/i;
const MALE = /\bmale\b|ravi|hemant|prabhat|madhur|rishi|david|mark|james|george|daniel|alex|fred|guy|\bman\b/i;
function score(v, lang) {
  let sc = 0;
  if (v.lang.replace("_", "-") === lang) sc += 50;
  else if (base(v.lang) === base(lang)) sc += 20;
  if (lang.startsWith("en") && /-IN$/i.test(v.lang.replace("_", "-"))) sc += 15;
  if (GOOD.test(v.name)) sc += 10;
  if (/natural|online/i.test(v.name)) sc += 8;
  if (/female/i.test(v.name)) sc += 12;
  if (MALE.test(v.name) && !/female/i.test(v.name)) sc -= 40;
  return sc;
}
/** All installed voices for a language family, best first. */
export function voicesFor(lang) {
  const fam = voices.filter((v) => base(v.lang) === base(lang));
  const extra = base(lang) === "mr" && fam.length === 0 ? voices.filter((v) => base(v.lang) === "hi") : []; // Marathi voices are rare
  return [...fam, ...extra].sort((a, b) => score(b, lang) - score(a, lang));
}
function pickVoice(lang) {
  const saved = getVoicePref(lang);
  return (saved && voices.find((v) => v.voiceURI === saved)) || voicesFor(lang)[0] || null;
}

export function speak(text, lang) {
  return new Promise((resolve) => {
    if (!ttsSupported() || !text) return resolve(false);
    try {
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      const v = pickVoice(lang);
      if (!v && base(lang) !== "en") return resolve(false);
      u.lang = v?.lang || lang; if (v) u.voice = v;
      u.rate = 0.95; u.pitch = 1;
      const safety = setTimeout(() => resolve(false), Math.max(5000, text.length * 120)); // onend sometimes never fires
      u.onend = () => { clearTimeout(safety); resolve(true); };
      u.onerror = () => { clearTimeout(safety); resolve(false); };
      speechSynthesis.speak(u);
    } catch { resolve(false); }
  });
}
export const cancelSpeech = () => { try { ttsSupported() && speechSynthesis.cancel(); } catch { /* ignore */ } };
