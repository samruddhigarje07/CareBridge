"""Centralised language config. To add a language: add an entry here, one in
frontend/src/i18n.js (LANGS + UI strings) — nothing else changes."""

LANGUAGES = {
    "en": {
        "name": "English", "speech": "en-IN",
        "greeting": "Hello. I'm CareBridge. I'll ask you a few short questions before your consultation.",
        "ask_name": "What is your name?",
        "ask_age": "Nice to meet you, {name}. How old are you?",
        "ask_gender": "What is your gender?",
        "ask_complaint": "Thank you. What is bothering you today? Please describe it in your own words.",
        "reask_name": "Sorry, I didn't catch your name. Could you say it again?",
        "reask_age": "Sorry, I didn't catch your age. Could you say it as a number?",
        "reask_gender": "Sorry, I didn't catch that. Are you male, female, or other?",
        "closing": "Thank you. I have enough information for your doctor.",
        "gender": {
            "female": ["female", "woman", "girl", "lady", "f"],
            "male": ["male", "man", "boy", "gentleman", "m"],
            "other": ["other", "nonbinary", "non-binary", "transgender", "trans"],
        },
        "name_prefixes": [r"my name is", r"this is", r"i am", r"i'm", r"im", r"it's", r"its", r"call me", r"name is", r"hello", r"hi"],
        "name_suffixes": [],
    },
    "hi": {
        "name": "Hindi", "speech": "hi-IN",
        "greeting": "नमस्ते। मैं केयरब्रिज हूँ। आपके परामर्श से पहले मैं आपसे कुछ छोटे सवाल पूछूँगा।",
        "ask_name": "आपका नाम क्या है?",
        "ask_age": "आपसे मिलकर अच्छा लगा, {name}। आपकी उम्र कितनी है?",
        "ask_gender": "आपका लिंग क्या है?",
        "ask_complaint": "धन्यवाद। आज आपको क्या तकलीफ़ है? कृपया अपने शब्दों में बताइए।",
        "reask_name": "माफ़ कीजिए, मैं आपका नाम सुन नहीं पाया। कृपया दोबारा बताइए।",
        "reask_age": "माफ़ कीजिए, मैं आपकी उम्र समझ नहीं पाया। कृपया संख्या में बताइए।",
        "reask_gender": "माफ़ कीजिए, मैं समझ नहीं पाया। आप पुरुष हैं, महिला हैं या अन्य?",
        "closing": "धन्यवाद। आपके डॉक्टर के लिए मेरे पास पर्याप्त जानकारी है।",
        "gender": {
            "female": ["महिला", "औरत", "स्त्री", "लड़की", "फीमेल", "female"],
            "male": ["पुरुष", "आदमी", "मर्द", "लड़का", "मेल", "male"],
            "other": ["अन्य", "दूसरा", "ट्रांसजेंडर", "other"],
        },
        "name_prefixes": [r"मेरा नाम", r"मेरा नाम है", r"मैं", r"नाम", r"नमस्ते"],
        "name_suffixes": [r"है", r"हूँ", r"हूं", r"कहते हैं", r"बोलते हैं"],
    },
    "mr": {
        "name": "Marathi", "speech": "mr-IN",
        "greeting": "नमस्कार. मी केअरब्रिज आहे. तुमच्या तपासणीपूर्वी मी तुम्हाला काही छोटे प्रश्न विचारेन.",
        "ask_name": "तुमचे नाव काय आहे?",
        "ask_age": "तुम्हाला भेटून आनंद झाला, {name}. तुमचे वय किती आहे?",
        "ask_gender": "तुमचे लिंग काय आहे?",
        "ask_complaint": "धन्यवाद. आज तुम्हाला काय त्रास होत आहे? कृपया तुमच्या शब्दांत सांगा.",
        "reask_name": "माफ करा, मला तुमचे नाव ऐकू आले नाही. कृपया पुन्हा सांगा.",
        "reask_age": "माफ करा, मला तुमचे वय समजले नाही. कृपया आकड्यात सांगा.",
        "reask_gender": "माफ करा, मला समजले नाही. तुम्ही पुरुष, स्त्री की इतर?",
        "closing": "धन्यवाद. तुमच्या डॉक्टरांसाठी माझ्याकडे पुरेशी माहिती आहे.",
        "gender": {
            "female": ["स्त्री", "महिला", "मुलगी", "बाई", "फीमेल", "female"],
            "male": ["पुरुष", "मुलगा", "माणूस", "मेल", "male"],
            "other": ["इतर", "अन्य", "ट्रान्सजेंडर", "other"],
        },
        "name_prefixes": [r"माझे नाव", r"माझं नाव", r"माझ नाव", r"नाव", r"मी", r"नमस्कार"],
        "name_suffixes": [r"आहे", r"आहे\s*मी", r"म्हणतात"],
    },
}
DEFAULT_LANG = "en"


def lang_cfg(code: str) -> dict:
    return LANGUAGES.get(code) or LANGUAGES[DEFAULT_LANG]
