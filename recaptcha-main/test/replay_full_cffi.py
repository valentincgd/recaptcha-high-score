"""Rejeu complet avec usurpation TLS/HTTP2 de Chrome (curl_cffi).

Test décisif TLS vs IP : on rejoue le body réel -> token, puis on pousse le
token dans TM (eps-mgr + POST + GET) MAIS avec un client qui imite le JA3/JA4 +
HTTP2 de Chrome. Si le GET passe (2XX) -> le blocage tm-bl était l'empreinte TLS.
"""
import base64
import json

import requests
from curl_cffi import requests as cffi

PROXY = "http://fBs9M6aL:6FbvX5bw-563069864@tickets-fr-s.reserve2.resi.unknownproxies.com:14018"
SITEKEY = "6LcvL3UrAAAAAO_9u8Seiuf-I6F_tP_jSS-zndXV"
CAP = r"C:\Users\Valentin\Downloads\rc-reload-captures-1782867664300.json"
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36"
SEC_CH_UA = '"Brave";v="149", "Chromium";v="149", "Not)A;Brand";v="24"'
EVENT_URL = "https://www.ticketmaster.com/event/020064BAD9B8236F"
DOMAIN = "www.ticketmaster.com"
ORIGIN = "https://www.ticketmaster.com"
IMPERSONATE = "chrome"

proxies = {"http": PROXY, "https": PROXY}


def get_token():
    caps = json.load(open(CAP, encoding="utf-8"))
    c = next(x for x in caps if x.get("kind") == "reload" and x.get("reqBodyB64"))
    raw = base64.b64decode(c["reqBodyB64"].split(":", 1)[1])
    url = f"https://www.google.com/recaptcha/enterprise/reload?k={SITEKEY}"
    headers = {
        "accept": "*/*",
        "content-type": "application/x-protobuffer",
        "origin": "https://www.google.com",
        "referer": c.get("frame"),
        "user-agent": UA,
    }
    # curl_cffi pour être cohérent (Chrome JA3) même côté Google
    r = cffi.post(url, data=raw, headers=headers, proxies=proxies, impersonate=IMPERSONATE, timeout=60, verify=False)
    arr = json.loads(r.text.lstrip(")]}'\n"))
    print(f"[reload cffi] HTTP {r.status_code} token {len(arr[1])} car")
    return arr[1]


def tm_flow(token):
    s = cffi.Session(impersonate=IMPERSONATE, proxies=proxies, verify=False)

    s.get(
        EVENT_URL,
        headers={
            "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
            "accept-language": "fr-FR,fr;q=0.5",
            "sec-ch-ua": SEC_CH_UA,
            "sec-ch-ua-mobile": "?0",
            "sec-ch-ua-platform": '"Windows"',
            "upgrade-insecure-requests": "1",
            "user-agent": UA,
        },
        timeout=60,
    )
    print(f"[prefetch] cookies: {list(s.cookies.keys())}")

    s.get(
        f"{ORIGIN}/eps-mgr",
        headers={
            "accept": "*/*",
            "referer": EVENT_URL,
            "sec-ch-ua": SEC_CH_UA,
            "sec-ch-ua-mobile": "?0",
            "sec-ch-ua-platform": '"Windows"',
            "user-agent": UA,
        },
        timeout=60,
    )
    print(f"[eps-mgr] eps_sid: {s.cookies.get('eps_sid')}")

    r = s.post(
        f"{ORIGIN}/epsf/gec/v3/Event",
        headers={
            "accept": "*/*",
            "content-type": "application/json",
            "origin": ORIGIN,
            "referer": EVENT_URL,
            "sec-ch-ua": SEC_CH_UA,
            "sec-ch-ua-mobile": "?0",
            "sec-ch-ua-platform": '"Windows"',
            "user-agent": UA,
        },
        json={"hostname": DOMAIN, "key": SITEKEY, "token": token},
        timeout=60,
    )
    print(f"[POST Event] HTTP {r.status_code}  tmpt: {(s.cookies.get('tmpt') or '')[:40]}...")

    r2 = s.get(
        EVENT_URL,
        headers={
            "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
            "accept-language": "fr-FR,fr;q=0.5",
            "referer": EVENT_URL,
            "sec-ch-ua": SEC_CH_UA,
            "sec-ch-ua-mobile": "?0",
            "sec-ch-ua-platform": '"Windows"',
            "upgrade-insecure-requests": "1",
            "user-agent": UA,
        },
        timeout=60,
    )
    print(f"\n[GET event] HTTP {r2.status_code}  tm-bl: {r2.headers.get('tm-bl')}  ({len(r2.content)} octets)")
    if 200 <= r2.status_code < 300:
        print("\n[OK] 2XX avec TLS Chrome -> le blocage venait de l'empreinte TLS.")
        return 0
    print(f"\n[FAIL] {r2.status_code} meme avec TLS Chrome -> IP/proxy ou autre.")
    return 1


if __name__ == "__main__":
    raise SystemExit(tm_flow(get_token()))
