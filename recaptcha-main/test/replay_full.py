"""Rejeu complet : body reload réel capturé -> token Google -> flux TM -> GET event.

Étape 3 du plan : on rejoue le body réel, on récupère le token, et on le pousse
dans TM (eps-mgr + POST /epsf/gec/v3/Event) pour voir si la page event passe (2XX).
Compare directement avec notre Go (même proxy, même endpoint) : isole le PAYLOAD.
"""
import base64
import json
import sys

import requests

PROXY = "http://fBs9M6aL:6FbvX5bw-563069864@tickets-fr-s.reserve2.resi.unknownproxies.com:14018"
SITEKEY = "6LcvL3UrAAAAAO_9u8Seiuf-I6F_tP_jSS-zndXV"
CAP = r"C:\Users\Valentin\Downloads\rc-reload-captures-1782867664300.json"
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36"
SEC_CH_UA = '"Brave";v="149", "Chromium";v="149", "Not)A;Brand";v="24"'
EVENT_URL = "https://www.ticketmaster.com/event/020064BAD9B8236F"
DOMAIN = "www.ticketmaster.com"
ORIGIN = "https://www.ticketmaster.com"

proxies = {"http": PROXY, "https": PROXY}


def replay_reload_get_token():
    caps = json.load(open(CAP, encoding="utf-8"))
    c = next(x for x in caps if x.get("kind") == "reload" and x.get("reqBodyB64"))
    raw = base64.b64decode(c["reqBodyB64"].split(":", 1)[1])
    url = f"https://www.google.com/recaptcha/enterprise/reload?k={SITEKEY}"
    headers = {
        "accept": "*/*",
        "accept-language": "fr-FR,fr;q=0.9",
        "content-type": "application/x-protobuffer",
        "origin": "https://www.google.com",
        "referer": c.get("frame"),
        "sec-fetch-dest": "empty",
        "sec-fetch-mode": "cors",
        "sec-fetch-site": "same-origin",
        "user-agent": UA,
    }
    r = requests.post(url, data=raw, headers=headers, proxies=proxies, timeout=60)
    arr = json.loads(r.text.lstrip(")]}'\n"))
    token = arr[1]
    print(f"[reload] HTTP {r.status_code} token {len(token)} car: {token[:40]}...")
    return token


def tm_flow(token):
    s = requests.Session()
    s.proxies = proxies

    # 1) prefetch page event (cookies consent)
    s.get(
        EVENT_URL,
        headers={
            "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
            "accept-language": "fr-FR,fr;q=0.5",
            "sec-ch-ua": SEC_CH_UA,
            "sec-ch-ua-mobile": "?0",
            "sec-ch-ua-platform": '"Windows"',
            "sec-fetch-dest": "document",
            "sec-fetch-mode": "navigate",
            "sec-fetch-site": "none",
            "sec-fetch-user": "?1",
            "upgrade-insecure-requests": "1",
            "user-agent": UA,
        },
        timeout=60,
    )
    print(f"[prefetch] cookies: {list(s.cookies.keys())}")

    # 2) eps-mgr -> eps_sid
    s.get(
        f"{ORIGIN}/eps-mgr",
        headers={
            "accept": "*/*",
            "accept-language": "fr-FR,fr;q=0.9",
            "referer": EVENT_URL,
            "sec-ch-ua": SEC_CH_UA,
            "sec-ch-ua-mobile": "?0",
            "sec-ch-ua-platform": '"Windows"',
            "sec-fetch-dest": "script",
            "sec-fetch-mode": "no-cors",
            "sec-fetch-site": "same-origin",
            "user-agent": UA,
        },
        timeout=60,
    )
    eps_sid = s.cookies.get("eps_sid")
    print(f"[eps-mgr] eps_sid: {eps_sid}")

    # 3) POST /epsf/gec/v3/Event {hostname,key,token} -> tmpt
    r = s.post(
        f"{ORIGIN}/epsf/gec/v3/Event",
        headers={
            "accept": "*/*",
            "accept-language": "fr-FR,fr;q=0.9",
            "content-type": "application/json",
            "origin": ORIGIN,
            "referer": EVENT_URL,
            "sec-ch-ua": SEC_CH_UA,
            "sec-ch-ua-mobile": "?0",
            "sec-ch-ua-platform": '"Windows"',
            "sec-fetch-dest": "empty",
            "sec-fetch-mode": "cors",
            "sec-fetch-site": "same-origin",
            "user-agent": UA,
        },
        json={"hostname": DOMAIN, "key": SITEKEY, "token": token},
        timeout=60,
    )
    tmpt = s.cookies.get("tmpt")
    print(f"[POST Event] HTTP {r.status_code}  tmpt: {(tmpt or '')[:50]}...  body: {r.text[:150]}")

    # 4) GET event page avec la session (tmpt + eps_sid dans le jar)
    r2 = s.get(
        EVENT_URL,
        headers={
            "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
            "accept-language": "fr-FR,fr;q=0.5",
            "cache-control": "max-age=0",
            "referer": EVENT_URL,
            "sec-ch-ua": SEC_CH_UA,
            "sec-ch-ua-mobile": "?0",
            "sec-ch-ua-platform": '"Windows"',
            "sec-fetch-dest": "document",
            "sec-fetch-mode": "navigate",
            "sec-fetch-site": "same-origin",
            "sec-fetch-user": "?1",
            "upgrade-insecure-requests": "1",
            "user-agent": UA,
        },
        timeout=60,
    )
    print(f"\n[GET event] HTTP {r2.status_code}  tm-bl: {r2.headers.get('tm-bl')}  ({len(r2.content)} octets)")
    if 200 <= r2.status_code < 300:
        print("\n[OK] 2XX — le token du body réel rejoué PASSE.")
        return 0
    print(f"\n[FAIL] {r2.status_code} — même le body réel rejoué est bloqué.")
    return 1


def main():
    token = replay_reload_get_token()
    return tm_flow(token)


if __name__ == "__main__":
    raise SystemExit(main())
