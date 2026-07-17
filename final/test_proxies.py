"""Teste une liste de proxies pour le MINT du tmpt.
Pour chaque proxy : mint le tmpt via le proxy, puis rejoue la page event EN DIRECT
(isole la qualité du token = réputation reCAPTCHA de l'IP de mint). 200 = proxy bon.
"""
import concurrent.futures as cf
import os
import requests

API = "http://127.0.0.1:3848/api/captcha/tmpt"
EID = os.environ.get("T_EVENT_ID", "020064BAD9B8236F")
EVENT = f"https://www.ticketmaster.com/event/{EID}"
SITEKEY = "6LcvL3UrAAAAAO_9u8Seiuf-I6F_tP_jSS-zndXV"
WORKERS = int(os.environ.get("T_WORKERS", "3"))

RAW = """
135.132.97.209:5464:7V0w1:1g7hArVI
135.132.97.210:5465:7V0w1:1g7hArVI
135.132.97.211:5466:7V0w1:1g7hArVI
135.132.97.212:5467:7V0w1:1g7hArVI
135.132.97.213:5468:7V0w1:1g7hArVI
135.132.97.214:5469:7V0w1:1g7hArVI
135.132.97.215:5470:7V0w1:1g7hArVI
135.132.97.216:5471:7V0w1:1g7hArVI
135.132.97.217:5472:7V0w1:1g7hArVI
135.132.97.218:5473:7V0w1:1g7hArVI
135.132.97.219:5474:7V0w1:1g7hArVI
135.132.97.220:5475:7V0w1:1g7hArVI
135.132.106.226:16446:7V0w1:1g7hArVI
135.132.106.227:16447:7V0w1:1g7hArVI
135.132.106.228:16448:7V0w1:1g7hArVI
135.132.106.229:16449:7V0w1:1g7hArVI
135.132.106.230:16450:7V0w1:1g7hArVI
135.132.106.231:16451:7V0w1:1g7hArVI
135.132.106.232:16452:7V0w1:1g7hArVI
135.132.106.233:16453:7V0w1:1g7hArVI
135.132.106.234:16454:7V0w1:1g7hArVI
"""


def to_url(line):
    h, p, u, pw = line.strip().split(":")
    return f"http://{u}:{pw}@{h}:{p}", f"{h}:{p}"


def test(line):
    url, label = to_url(line)
    try:
        resp = requests.post(API, json={
            "websiteUrl": EVENT, "recaptchaSitekey": SITEKEY,
            "action": "Event", "isEnterprise": True, "proxy": url,
        }, timeout=240)
        j = resp.json()
        if j.get("status") != "success":
            return label, "MINT_ERR", str(j.get("error", ""))[:55]
        d = j["data"]
        H = {
            "user-agent": d["user_agent"], "accept-language": d["accept_lang"],
            "sec-ch-ua": d["sec_ch_ua"], "sec-ch-ua-mobile": d["sec_ch_ua_mobile"],
            "sec-ch-ua-platform": d["sec_ch_ua_platform"], "cookie": "tmpt=" + d["tmpt"],
            "accept": "text/html,*/*;q=0.8", "sec-fetch-dest": "document",
            "sec-fetch-mode": "navigate", "sec-fetch-site": "none",
            "upgrade-insecure-requests": "1",
        }
        r = requests.get(EVENT, headers=H, timeout=60, allow_redirects=False)  # replay DIRECT
        return label, r.status_code, "200 OK" if r.status_code == 200 else ("BLOCKED" if r.status_code in (401, 403) else str(r.status_code))
    except Exception as e:
        return label, "EXC", str(e)[:55]


def main():
    lines = [l for l in RAW.strip().splitlines() if l.strip()]
    print(f"Test de {len(lines)} proxies (mint via proxy -> replay event DIRECT), {WORKERS} en parallele...\n")
    good = 0
    with cf.ThreadPoolExecutor(max_workers=WORKERS) as ex:
        for label, status, info in ex.map(test, lines):
            ok = status == 200
            good += ok
            tag = "PASS" if ok else "FAIL"
            print(f"  [{tag}] {label:24} status={status:8} {info}")
    print(f"\n{good}/{len(lines)} proxies donnent un tmpt VALIDE (event page 200).")


if __name__ == "__main__":
    main()
