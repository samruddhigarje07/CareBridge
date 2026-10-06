"""Urgency engine: (A) deterministic red-flag rules -> (B) AI contextual assessment -> (C) deterministic mapping.

The queue only ever uses the final HIGH / MODERATE / ROUTINE label plus the stored indicators.
Nothing here diagnoses; indicators describe *reported* information that matters for routing.
"""
import re
import unicodedata

from models import UrgencyAIOut

# Each rule: label shown to the doctor, and regexes over normalised text (English + Hindi + Marathi).
RED_FLAGS: list[tuple[str, list[str]]] = [
    ("Breathing difficulty", [
        r"(can'?t|cannot|can not|unable to|couldn'?t|hard to|difficult to|struggl\w* to|trouble|difficulty|problem|problems|issue|issues)\s+(in\s+)?breath\w*",
        r"breath\w*\s+(difficulty|trouble|problem|problems|issue|issues)",
        r"short(ness)?\s+of\s+breath", r"out\s+of\s+breath", r"breathless\w*", r"gasping", r"wheez\w*", r"choking",
        r"(सांस|साँस|श्वास)\s*(लेने\s*में|घेण्यास|घेताना|लेते\s*समय)?\s*(तकलीफ|तकलीफ़|दिक्कत|परेशानी|कठिनाई|त्रास|अडचण|कष्ट)",
        r"(सांस|साँस)\s*(नहीं\s*आ|फूल|रुक|अटक)", r"दम\s*(घुट|फूल|लाग)", r"धाप\s*लाग", r"श्वास\s*(अडक|कोंड)",
        r"(सांस|साँस|श्वास)\s*(लेने|घेण्यात)\s*(में|मध्ये)?\s*(कठिन|अवघड|मुश्किल)",
    ]),
    ("Chest pain or discomfort", [
        r"chest\s*(pain|pains|tightness|pressure|discomfort|heaviness|burning)",
        r"(pain|pressure|tightness|discomfort|heaviness)\s+(in|on|around)\s+(my\s+|the\s+)?chest",
        r"heart\s*(pain|attack)", r"pain\s+in\s+(my\s+)?heart",
        r"(सीने|छाती|सीना)\s*(में|मे|च्या)?\s*(दर्द|जकड़न|भारीपन|दबाव|जलन|तकलीफ|तकलीफ़|दुख|दुखत|वेदना|जडपणा|दाब)",
        r"छातीत\s*(दुख|दुखत|वेदना|जडपणा|दाब|त्रास|जळजळ|धडधड)", r"दिल\s*(में)?\s*दर्द", r"हृदयात\s*(दुख|वेदना)",
    ]),
    ("Loss of consciousness", [
        r"unconscious\w*", r"passed\s*out", r"pass(ing)?\s*out", r"fainted", r"fainting", r"blacked\s*out", r"collapsed",
        r"lost\s+consciousness", r"not\s+responding", r"unresponsive",
        r"बेहोश\w*", r"बेसुध\w*", r"बेशुद्ध\w*", r"चक्कर\s*खाकर\s*गिर", r"गिर\s*पड", r"भोवळ", r"शुद्ध\s*हरपल",
    ]),
    ("Severe bleeding", [
        r"(heavy|severe|profuse|excessive|uncontrolled|a\s+lot\s+of|lots\s+of|too\s+much)\s+(bleeding|blood)",
        r"bleeding\s+(a\s+lot|heavily|badly|profusely|won'?t\s+stop|will\s+not\s+stop|not\s+stopping|is\s+not\s+stopping)",
        r"(won'?t|will\s+not|doesn'?t|does\s+not|not)\s+stop\s+bleeding",
        r"(coughing|vomiting|vomit|cough|throwing\s+up)\s+(up\s+)?blood", r"blood\s+in\s+(my\s+)?(vomit|stool|urine)",
        r"(बहुत|ज़्यादा|ज्यादा|काफी|काफ़ी)\s*(सारा\s*)?(खून|रक्त)", r"खून\s*(बह|नहीं\s*रुक|बंद\s*नहीं|रुक\s*नहीं)", r"खून\s*की\s*उल्टी",
        r"(खूप|जास्त|भरपूर)\s*(रक्तस्राव|रक्त|रक्तस्त्राव)", r"रक्तस्त?राव\s*(थांबत\s*नाही|थांबत\s*नसल)", r"रक्ताची\s*उलटी",
        r"रक्त\s*(थांबत\s*नाही|वाहत)",
    ]),
    ("Stroke-like symptoms", [
        r"slurred\s+speech", r"slurring", r"(face|facial)\s+(drooping|droop|drooped|numb)", r"drooping\s+face",
        r"(weakness|numbness)\s+(on|in)\s+(one|the\s+(left|right))\s+side", r"one[-\s]sided\s+(weakness|numbness)",
        r"(can'?t|cannot|unable to)\s+(speak|talk|move\s+(my\s+)?(arm|leg|hand))", r"sudden\s+(confusion|numbness|vision\s+loss|loss\s+of\s+vision)",
        r"stroke", r"face\s+(is\s+)?(crooked|twisted)",
        r"चेहरा\s*(टेढ़ा|टेढा|लटक|सुन्न)", r"जुबान\s*(लड़खड़|लड़खड)", r"बोलने\s*में\s*(दिक्कत|परेशानी|तकलीफ)", r"एक\s*तरफ\s*(से\s*)?(कमजोरी|कमज़ोरी|सुन्न|लकवा)",
        r"लकवा", r"पक्षाघात", r"चेहरा\s*वाकडा", r"बोलता\s*येत\s*नाही", r"बोलण्यात\s*(अडचण|त्रास)", r"एका\s*बाजूला\s*(अशक्तपणा|कमजोरी|बधिर|लकवा)", r"अर्धांगवायू",
    ]),
    ("Seizure", [
        r"seizure\w*", r"convuls\w*", r"\bfits?\b", r"epilep\w*",
        r"दौरा", r"दौरे", r"मिर्गी", r"झटके", r"फिट\s*(आ|आई|आया)", r"आकडी", r"फिट्स?\s*येत", r"फिट\s*आली", r"झटका",
    ]),
    ("Possible severe allergic reaction", [
        r"anaphyla\w*", r"throat\s+(swelling|swollen|closing|tight\w*)", r"(swollen|swelling\s+of)\s+(tongue|lips|face|throat)",
        r"(tongue|lips|face|throat)\s+(is\s+)?(swelling|swollen)", r"allergic\s+reaction.*(breath|swell)",
        r"गले\s*(में)?\s*सूजन", r"(जीभ|होंठ|चेहरे)\s*(पर|में)?\s*सूजन", r"गला\s*(बंद|सूज)", r"घसा\s*(सुजल|बंद|आवळ)", r"(जीभ|ओठ|चेहरा)\s*(सुजल|सूज)",
    ]),
    ("Possible poisoning or overdose", [
        r"poison\w*", r"overdos\w*", r"swallowed\s+(bleach|pesticide|kerosene|acid|insecticide|rat\s+poison|phenyl|too\s+many|a\s+lot\s+of)",
        r"drank\s+(bleach|pesticide|kerosene|acid|phenyl)", r"ate\s+(poison|rat\s+poison)", r"took\s+too\s+many\s+(pills|tablets)",
        r"ज़हर", r"जहर", r"विष", r"ओवरडोज़?", r"कीटनाशक", r"फिनायल", r"विषबाधा", r"जास्त\s*गोळ्या", r"ज्यादा\s*गोलियां?\s*खा",
    ]),
    ("Suicidal thoughts or self-harm", [
        r"suicid\w*", r"kill\s+(myself|me)", r"end\s+(my\s+)?(own\s+)?life", r"self[-\s]?harm\w*", r"hurt\s+myself", r"want\s+to\s+die", r"don'?t\s+want\s+to\s+live",
        r"आत्महत्या", r"खुद\s*को\s*(मार|खत्म|नुकसान)", r"जान\s*दे", r"मरना\s*चाह", r"जीना\s*नहीं\s*चाह", r"आत्मघात", r"स्वतःला\s*(संपव|मार|इजा)", r"जीव\s*द्यायचा", r"मरावंसं?\s*वाट", r"जगायचं\s*नाही",
    ]),
]
_COMPILED = [(label, [re.compile(p, re.I) for p in pats]) for label, pats in RED_FLAGS]

# A match is ignored when it is negated nearby ("no chest pain", "सीने में दर्द नहीं").
NEG_BEFORE = re.compile(r"(\bno\b|\bnot\b|\bnever\b|\bwithout\b|\bdeny\w*|\bdenies\b|\bdon'?t\b|\bdoesn'?t\b|\bdidn'?t\b|\bnone\b|\bnahi\b|\bnahin\b|\bhasn'?t\b|\bhaven'?t\b|बिना|नहीं|नाही|नसल|नसे|नाहीत|कोई\s*नहीं|\bnegative\b)[^.;,]{0,30}$", re.I)
NEG_AFTER = re.compile(r"^\s*(है\s*)?(नहीं|नही|नाही|नसल|नसे|नाहीत|नाहि)", re.I)
CLAUSE_BREAK = re.compile(r"(\bbut\b|\bhowever\b|\balthough\b|\bthough\b|\bexcept\b|\bexcept for\b|लेकिन|मगर|परंतु|परन्तु|पर\s|पण\s|परंतू|तथापि)", re.I)

_DEV_DIGITS = str.maketrans("०१२३४५६७८९", "0123456789")


def normalize(text: str) -> str:
    """Unicode-normalise, lowercase, map Devanagari digits, unify quotes and whitespace."""
    t = unicodedata.normalize("NFKC", text or "").translate(_DEV_DIGITS).lower()
    t = t.replace("’", "'").replace("‘", "'").replace("`", "'")
    return re.sub(r"\s+", " ", t).strip()


def _negated(text: str, start: int, end: int) -> bool:
    before = text[max(0, start - 45):start]
    parts = CLAUSE_BREAK.split(before)
    before = parts[-1] if parts else before  # only look inside the current clause
    if NEG_BEFORE.search(before):
        return True
    after = re.sub(r"^\S*", "", text[end:end + 30])  # skip the rest of a partially matched word
    return bool(NEG_AFTER.match(after))


def detect_red_flags(texts: list[str]) -> list[str]:
    """Return de-duplicated red-flag labels found (non-negated) in any of the texts."""
    found: list[str] = []
    for raw in texts:
        t = normalize(raw)
        if not t:
            continue
        for label, pats in _COMPILED:
            if label in found:
                continue
            for p in pats:
                if any(not _negated(t, m.start(), m.end()) for m in p.finditer(t)):
                    found.append(label)
                    break
    return found


def final_urgency(red_flags: list[str], ai: UrgencyAIOut) -> tuple[str, list[str], str]:
    """(C) deterministic mapping. Strong red flag -> HIGH; otherwise the AI contextual level."""
    if red_flags:
        indicators = list(red_flags)
        for i in ai.indicators:
            if i.lower() not in [x.lower() for x in indicators]:
                indicators.append(i)
        return "HIGH", indicators, "red_flag_rule"
    return ai.urgency, ai.indicators, "ai_assessment"


def compute_triage_score(urgency: str, red_flags: list[str], vitals: dict | None = None, symptoms: list[str] | None = None) -> dict:
    """Computes an automated quantitative risk score (0-100) and priority category."""
    vitals = vitals or {}
    symptoms = symptoms or []
    urgent_symptoms = list(red_flags)
    
    # Base score by urgency
    if urgency == "HIGH" or red_flags:
        score = 80 + min(len(red_flags) * 4, 15)
    elif urgency == "MODERATE":
        score = 50 + min(len(symptoms) * 3, 15)
    else:
        score = 20 + min(len(symptoms) * 2, 10)

    # Vitals examination
    spo2_str = str(vitals.get("spo2") or "")
    m_spo2 = re.search(r"(\d{2,3})", spo2_str)
    if m_spo2 and int(m_spo2.group(1)) < 92:
        score += 15
        urgent_symptoms.append(f"Low oxygen saturation ({m_spo2.group(1)}%)")

    hr_str = str(vitals.get("heart_rate") or "")
    m_hr = re.search(r"(\d{2,3})", hr_str)
    if m_hr and (int(m_hr.group(1)) > 115 or int(m_hr.group(1)) < 50):
        score += 10
        urgent_symptoms.append(f"Tachycardia/Bradycardia ({m_hr.group(1)} bpm)")

    bp_str = str(vitals.get("bp") or "")
    m_bp = re.search(r"(\d{2,3})", bp_str)
    if m_bp and (int(m_bp.group(1)) > 165 or int(m_bp.group(1)) < 90):
        score += 10
        urgent_symptoms.append(f"Abnormal blood pressure ({bp_str})")

    # Clamping
    score = max(5, min(99, score))
    
    if score >= 75:
        category = "Emergency - Red Flag"
    elif score >= 40:
        category = "Moderate Risk"
    else:
        category = "Low Risk"

    return {
        "score": score,
        "category": category,
        "urgent_symptoms": list(dict.fromkeys(urgent_symptoms)),
        "rationale": f"Clinical triage calculated from {urgency} classification with {len(urgent_symptoms)} priority indicators."
    }
