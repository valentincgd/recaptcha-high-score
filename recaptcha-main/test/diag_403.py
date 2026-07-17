#!/usr/bin/env python3
"""Diagnostic 403 Event : reponse POST gec + headers GET page."""

import json
import requests

PROXY = "http://fBs9M6aL:6FbvX5bw-563069864@tickets-fr-s.reserve2.resi.unknownproxies.com:14018"
PROXIES = {"http": PROXY, "https": PROXY}
API = "http://127.0.0.1:3848/api/captcha/tmpt"
KEY = "dispurgendispurticketdispurcaptcha"
EVENT = (
    "https://www.ticketmaster.com/benson-bootyjtyjour-pittsburgh-pennsylvania-07-07-2026/"
    "event/1600647921872DC4"
)

print("=== 1. Appel API tmpt (Event) ===")
r = requests.post(
    API,
    headers={"Content-Type": "application/json", "X-Valou-Key": KEY},
    json={
        "proxy": PROXY,
        "domain": "www.ticketmaster.com",
        "url": EVENT,
        "referer": EVENT,
        "action": "Event",
        "sitekey": "6LcvL3UrAAAAAO_9u8Seiuf-I6F_tP_jSS-zndXV",
    },
    timeout=300,
)
data = r.json()
d = data.get("data", {})
print("post_status:", d.get("post_status"))
print("post_body  :", d.get("post_body"))
print("page_status:", d.get("page_status"))
print("tmpt       :", (d.get("tmpt") or "")[:60])
print("eps_sid    :", d.get("eps_sid"))

if not d.get("tmpt"):
    raise SystemExit("pas de tmpt")

print("\n=== 2. GET page event (cookies tmpt+eps_sid) ===")
s = requests.Session()
s.proxies = PROXIES
for k in ("tmpt", "eps_sid"):
    s.cookies.set(k, d[k], domain="www.ticketmaster.com", path="/")
g = s.get(
    EVENT,
    headers={
        "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
        "accept-language": d.get("accept_lang", "fr-FR,fr;q=0.5"),
        "user-agent": d["user_agent"],
        "sec-ch-ua": d.get("sec_ch_ua", ""),
        "sec-ch-ua-mobile": d.get("sec_ch_ua_mobile", "?0"),
        "sec-ch-ua-platform": d.get("sec_ch_ua_platform", '"Windows"'),
        "referer": EVENT,
        "sec-fetch-dest": "document",
        "sec-fetch-mode": "navigate",
        "sec-fetch-site": "same-origin",
        "sec-gpc": "1",
        "upgrade-insecure-requests": "1",
    },
    timeout=60,
)
print("GET status:", g.status_code)
print("--- response headers ---")
for k, v in g.headers.items():
    print(f"  {k}: {v}")
print("--- set-cookie recu ---")
print("  ", [c.name for c in g.cookies])
print("--- body (premiers 600) ---")
print(g.text[:600])
