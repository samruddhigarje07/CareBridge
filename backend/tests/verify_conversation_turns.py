import os, sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services import conversation_service, ai_service
from models import FollowupOut, Extracted

# Stub AI followup
def mock_followup(lang_name, patient, extracted, history, asked, mn, mx, mode):
    # Simulate Gemini asking follow-ups
    ext = Extracted(
        chief_complaint="Chest pain and severe breathlessness",
        symptoms=["chest pain", "breathlessness"],
        duration=[{"symptom": "chest pain", "duration": "2 hours"}],
        negative_findings=[]
    )
    if asked >= mn:
        return FollowupOut(reply="Thank you, I have enough details.", extracted=ext, next_action="complete")
    return FollowupOut(reply=f"Followup question #{asked+1}: Does the pain radiate to your arm?", extracted=ext, next_action="ask_followup")

ai_service.followup = mock_followup

# Start intake with urgent symptom
state = conversation_service.start("en", name="Karan", phone="9876543210", age=45, gender="Male")
intake_id = state["intake_id"]

# Message 1: Urgent symptom
res1 = conversation_service.handle_message(intake_id, "I have severe chest pain and breathlessness since 2 hours.")
print(f"Turn 1: done={res1['done']}, followups_asked={res1['followups_asked']}")
assert not res1["done"], "AI should NOT abruptly complete on turn 1 even with urgent symptom!"
assert res1["followups_asked"] == 1

# Message 2: Patient reply
res2 = conversation_service.handle_message(intake_id, "No, it does not radiate to my arm.")
print(f"Turn 2: done={res2['done']}, followups_asked={res2['followups_asked']}")
assert not res2["done"], "AI should ensure MIN_FOLLOWUPS (2) are asked before completing."
assert res2["followups_asked"] == 2

# Message 3: Patient reply -> should complete or wrap up
res3 = conversation_service.handle_message(intake_id, "No other symptoms.")
print(f"Turn 3: done={res3['done']}, followups_asked={res3['followups_asked']}")
assert res3["done"], "AI should complete now that MIN_FOLLOWUPS was reached."

print("CONVERSATION TURNS VERIFICATION: PASSED")
