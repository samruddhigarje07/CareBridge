// Browser voice helpers, hardened for macOS (Chrome and Safari)
export const SR = typeof window !== "undefined" && (window.SpeechRecognition || window.webkitSpeechRecognition);
try { speechSynthesis.getVoices(); speechSynthesis.onvoiceschanged = () => speechSynthesis.getVoices(); } catch {}
// Safari only allows speech after a user tap: call this inside the Start button click
export function unlockSpeech() { try { const u = new SpeechSynthesisUtterance(" "); u.volume = 0; speechSynthesis.speak(u); } catch {} }
function pickVoice(code) {
  const vs = speechSynthesis.getVoices(), base = code.slice(0, 2), norm = v => v.lang.replace("_", "-");
  return vs.find(v => norm(v) === code) || vs.find(v => norm(v).toLowerCase().startsWith(base)) || (base === "mr" ? vs.find(v => norm(v).toLowerCase().startsWith("hi")) : null);
}
const wait = ms => new Promise(r => setTimeout(r, ms));
export async function speak(text, code) {
  try {
    const v = pickVoice(code);
    if (!v && !code.startsWith("en")) return; // no voice installed: the text stays on screen
    if (speechSynthesis.speaking || speechSynthesis.pending) { speechSynthesis.cancel(); await wait(120); } // cancel() right before speak() can drop the speech on Chrome
    await new Promise(res => {
      const u = new SpeechSynthesisUtterance(text); u.lang = code; if (v) u.voice = v;
      u.onend = u.onerror = () => res(); speechSynthesis.speak(u);
      setTimeout(res, Math.max(6000, text.length * 130)); // Safari sometimes never fires onend
    });
  } catch {}
}
let rec = null;
export function stopAll() { try { speechSynthesis.cancel(); rec && rec.abort(); } catch {} }
export function listen(code, { onText, onState, onError }) {
  if (!SR) return;
  try { rec && rec.abort(); rec = new SR(); rec.lang = code; rec.interimResults = false; rec.maxAlternatives = 1;
    rec.onstart = () => onState(true); rec.onend = () => onState(false); rec.onerror = e => onError(e.error);
    rec.onresult = e => onText(e.results[0][0].transcript); rec.start(); } catch { onState(false); }
}
