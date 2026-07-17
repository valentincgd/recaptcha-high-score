"""Teste le solver de CE repo (avec/sans le fingerprint réel capturé) sur antcpt.com → vrai score v3."""
import base64, json, sys
import requests
from bypass import ReCaptchaV3Bypass
from tools.proto_decode import decode

SITE_KEY = "6LcR_okUAAAAAPYrPe-HK_0RULO1aZM15ENyM-Mf"
ACTION = "homepage"
ORIGIN = "https://antcpt.com"

# co = base64url de l'origine, padding reCAPTCHA ('=' -> '.', '+' -> '-', '/' -> '_')
co = base64.b64encode(f"{ORIGIN}:443".encode()).decode().replace("+", "-").replace("/", "_").replace("=", ".")

# v (version du script) = champ 1 du reload capturé
entries = decode(open("tests/fixtures/reload_1_req.bin", "rb").read())
v = next(val.decode() for f, w, val in entries if f == 1 and w == 2)
print(f"version v={v}  co={co}")

anchor_url = (
    f"https://www.google.com/recaptcha/api2/anchor?ar=1&k={SITE_KEY}"
    f"&co={co}&hl=fr&v={v}&size=invisible&cb=abcdefghijkl"
)

def post_score(token):
    r = requests.post("https://antcpt.com/score_detector/verify.php",
        headers={"content-type": "application/json", "origin": ORIGIN,
                 "referer": "https://antcpt.com/score_detector/",
                 "x-requested-with": "XMLHttpRequest",
                 "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36"},
        data=json.dumps({"g-recaptcha-response": token}), timeout=30)
    try: return r.json()
    except Exception: return {"raw": r.text[:200]}

for label, fp in [("SANS fingerprint (minimal)", None), ("AVEC fingerprint réel (HAR)", "fingerprint.json")]:
    print(f"\n=== {label} ===")
    tok = ReCaptchaV3Bypass(anchor_url, action=ACTION, fingerprint_path=fp).bypass()
    if not tok:
        print("  pas de token"); continue
    res = post_score(tok)
    print(f"  token {len(tok)} chars -> antcpt: score={res.get('score')} action={res.get('action')} host={res.get('hostname')} {('' if 'score' in res else res)}")
