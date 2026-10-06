import os, sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import main
from fastapi.testclient import TestClient

c = TestClient(main.app)
login_res = c.post('/api/auth/login', json={'username': 'doctor@carebridge.ai', 'password': 'carebridge2026'}).json()
token = login_res['data']['token']
headers = {'Authorization': f'Bearer {token}'}

# Test Excel export endpoint
res_xlsx = c.get('/api/export/patients.xlsx', headers=headers)
assert res_xlsx.status_code == 200, res_xlsx.status_code
assert res_xlsx.headers['content-type'] == 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
assert res_xlsx.content[:2] == b'PK'
print('Excel export endpoint check: PASSED (size:', len(res_xlsx.content), 'bytes)')

# Test CSV export endpoint
res_csv = c.get('/api/export/patients.csv', headers=headers)
assert res_csv.status_code == 200, res_csv.status_code
assert 'text/csv' in res_csv.headers['content-type']
assert res_csv.content.startswith(b'\xef\xbb\xbf')
print('CSV export endpoint check: PASSED (size:', len(res_csv.content), 'bytes)')

# Check patient reports
pats = c.get('/api/patients', headers=headers).json()['data']
assert len(pats) > 0
for p in pats:
    tok = p.get('token', 'N/A')
    assert 'report' in p, f'Patient {tok} missing report'
    rep = p['report']
    assert rep.get('report_id') or rep.get('patient_name'), f'Invalid report in {tok}'
print('Individual Patient Reports check: PASSED (checked', len(pats), 'patients)')
