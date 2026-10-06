// Robust self-conditioned text-to-speech for macOS and Chrome/Safari
const keep = [];
const wait = ms => new Promise(r => setTimeout(r, ms));
export const ttsOK = () => typeof speechSynthesis !== "undefined" && typeof SpeechSynthesisUtterance !== "undefined";
export const stopTts = () => { try { speechSynthesis.cancel(); if (speechSynthesis.resume) speechSynthesis.resume(); } catch {} };

function loadVoices() {
  return new Promise(res => {
    const v = speechSynthesis.getVoices(); if (v && v.length) return res(v);
    const t = setTimeout(() => res(speechSynthesis.getVoices() || []), 1500);
    speechSynthesis.onvoiceschanged = () => { clearTimeout(t); res(speechSynthesis.getVoices() || []); };
  });
}

export function scoreVoice(v, code) {
  const norm = (v.lang || "").replace("_", "-").toLowerCase();
  const name = (v.name || "").toLowerCase();
  const langBase = (code || "en").slice(0, 2).toLowerCase();
  let sc = 0;

  if (norm === (code || "").toLowerCase()) sc += 50;
  else if (norm.startsWith(langBase)) sc += 30;

  // Regional accents and natural quality
  if (langBase === "en") {
    if (norm === "en-in" || /india/i.test(name)) sc += 45;
    if (/neerja/i.test(name)) sc += 50; // High-quality Indian English
    if (/prabhat/i.test(name)) sc += 45;
    if (/swara|heera|kalpana/i.test(name)) sc += 40;
    if (/google.*(?:india|en-in)/i.test(name)) sc += 45;
    if (/natural|online|neural/i.test(name)) sc += 25;
    if (/female|aria|jenny|samantha/i.test(name)) sc += 15;
    if (/david|mark|george|robotic/i.test(name)) sc -= 60; // Penalize harsh robotic voices
  }

  if (langBase === "hi") {
    if (norm === "hi-in" || norm.startsWith("hi")) sc += 40;
    if (/swara/i.test(name)) sc += 55; // Natural Hindi
    if (/madhur/i.test(name)) sc += 50;
    if (/google.*(?:hindi|hi)/i.test(name)) sc += 50;
    if (/natural|online|neural/i.test(name)) sc += 25;
    if (/female|kalpana|heera/i.test(name)) sc += 20;
  }

  if (langBase === "mr") {
    if (norm === "mr-in" || norm.startsWith("mr")) sc += 65;
    if (/aarohi/i.test(name)) sc += 60; // Natural Marathi
    if (/google.*(?:marathi|mr)/i.test(name)) sc += 50;
    // Marathi fallback to Hindi neural voices for high-quality Devanagari pronunciation
    if (norm.startsWith("hi") || /swara|madhur|google.*hindi/i.test(name)) sc += 35;
    if (/natural|online|neural/i.test(name)) sc += 20;
  }

  return sc;
}

export function pickVoice(vs, code) {
  if (!vs || !vs.length) return null;
  const langBase = (code || "en").slice(0, 2).toLowerCase();

  const candidates = vs.filter(v => {
    const norm = (v.lang || "").replace("_", "-").toLowerCase();
    if (norm.startsWith(langBase)) return true;
    if (langBase === "mr" && norm.startsWith("hi")) return true;
    if (langBase === "en" && (norm.startsWith("en") || /india/i.test(v.name))) return true;
    return false;
  });

  if (candidates.length > 0) {
    candidates.sort((a, b) => scoreVoice(b, code) - scoreVoice(a, code));
    return candidates[0];
  }

  // If English, fall back to best English or vs[0]
  if (langBase === "en") {
    const enVoices = vs.filter(v => (v.lang || "").toLowerCase().startsWith("en"));
    if (enVoices.length) {
      enVoices.sort((a, b) => scoreVoice(b, code) - scoreVoice(a, code));
      return enVoices[0];
    }
    return vs[0] || null;
  }

  return null;
}

export async function say(text, code) {
  if (!ttsOK() || !text) return { ok: false, why: "unsupported" };
  const vs = await loadVoices();
  const v = pickVoice(vs, code);
  const langBase = (code || "en").slice(0, 2).toLowerCase();
  if (!v && langBase !== "en") return { ok: false, why: "novoice" };

  try {
    speechSynthesis.cancel();
    if (speechSynthesis.resume) speechSynthesis.resume();
  } catch {}

  await wait(150);

  return new Promise(resolve => {
    const u = new SpeechSynthesisUtterance(text);
    if (v) u.voice = v;
    u.lang = v ? v.lang : (code || "en-IN");
    u.rate = 0.92; // Slightly measured, warm clinical delivery
    u.pitch = 1.0;
    u.volume = 1.0;

    let started = false, finished = false;
    keep.push(u);

    const done = () => {
      if (finished) return;
      finished = true;
      clearTimeout(w1);
      clearTimeout(w2);
      const i = keep.indexOf(u);
      if (i >= 0) keep.splice(i, 1);
      resolve({ ok: started, why: started ? "" : "silent" });
    };

    u.onstart = () => { started = true; };
    u.onend = done;
    u.onerror = (e) => {
      console.warn("TTS error:", e);
      done();
    };

    const w1 = setTimeout(() => {
      if (!started) {
        try { speechSynthesis.resume(); } catch {}
        // if still not started after 2s, force done
        setTimeout(() => { if (!started) { stopTts(); done(); } }, 2000);
      }
    }, 3000);

    const w2 = setTimeout(done, Math.max(10000, text.length * 150));

    try {
      if (speechSynthesis.paused && speechSynthesis.resume) {
        speechSynthesis.resume();
      }
      speechSynthesis.speak(u);
    } catch (e) {
      console.warn("TTS speak exception:", e);
      done();
    }
  });
}
