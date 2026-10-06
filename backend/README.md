# CareBridge backend
FastAPI service. See the root README for setup. Quick start:
```
pip install -r requirements.txt && cp .env.example .env && uvicorn main:app --reload
python tests/test_e2e.py     # stubbed-AI end-to-end test
```
Layout: `main.py` (routes) · `models.py` (Pydantic) · `prompts.py` · `languages.py` · `services/{ai,conversation,urgency,excel}_service.py`.
