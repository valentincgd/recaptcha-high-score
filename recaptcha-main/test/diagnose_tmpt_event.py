#!/usr/bin/env python3
"""Diagnostique POST Event + reponse TM pour comprendre tmpt invalide."""

import json
import requests

PROXY = "http://fBs9M6aL:6FbvX5bw-563069864@tickets-fr-s.reserve2.resi.unknownproxies.com:14018"
API = "http://127.0.0.1:3848/api/captcha/tmpt"
KEY = "dispurgendispurticketdispurcaptcha"

EVENT_URL = (
    "https://www.ticketmaster.com/benson-bootyjtyjour-pittsburgh-pennsylvania-07-07-2026/"
    "event/1600647921872DC4"
)

payload = {
    "proxy": PROXY,
    "domain": "www.ticketmaster.com",
    "url": EVENT_URL,
    "sitekey": "6LcvL3UrAAAAAO_9u8Seiuf-I6F_tP_jSS-zndXV",
    "action": "Event",
    "referer": EVENT_URL,
}

r = requests.post(API, headers={"Content-Type": "application/json", "X-Valou-Key": KEY}, json=payload, timeout=300)
print("API status:", r.status_code)
data = r.json()
print(json.dumps(data, indent=2))

if data.get("status") != "success":
    raise SystemExit(1)

d = data["data"]
session = requests.Session()
session.proxies = {"http": PROXY, "https": PROXY}
for name in ("tmpt", "eps_sid"):
    session.cookies.set(name, d[name], domain="www.ticketmaster.com", path="/")

headers = {
    "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
    "accept-language": d.get("accept_lang", "fr-FR,fr;q=0.5"),
    "user-agent": d["user_agent"],
    "sec-ch-ua": d.get("sec_ch_ua", ""),
    "sec-ch-ua-mobile": d.get("sec_ch_ua_mobile", "?0"),
    "sec-ch-ua-platform": d.get("sec_ch_ua_platform", '"Windows"'),
    "referer": EVENT_URL,
    "sec-fetch-dest": "document",
    "sec-fetch-mode": "navigate",
    "sec-fetch-site": "same-origin",
    "sec-gpc": "1",
    "upgrade-insecure-requests": "1",
}

# Test 1: GET avec tmpt seulement
r1 = session.get(EVENT_URL, headers=headers, timeout=60)
print("\nGET tmpt+eps_sid only:", r1.status_code, len(r1.content))

# Test 2: POST Event manuel si on avait le token (skip - pas expose)

# Test 3: LoginPage flow compare
payload_login = {
    "proxy": PROXY,
    "domain": "auth.ticketmaster.com",
    "action": "LoginPage",
    "referer": (
        "https://auth.ticketmaster.com/as/authorization.oauth2"
        "?client_id=8bf7204a7e97.web.ticketmaster.us&response_type=code"
        "&scope=openid%20profile%20phone%20email%20tm"
        "&redirect_uri=https%3A%2F%2Fidentity.ticketmaster.com%2Fexchange"
        "&visualPresets=tm&lang=en-us&placementId=mytmlogin"
        "&hideLeftPanel=false&integratorId=prd1741.iccp&intSiteToken=tm-us&disableAutoOptIn=false"
    ),
}
r2 = requests.post(API, headers={"Content-Type": "application/json", "X-Valou-Key": KEY}, json=payload_login, timeout=300)
login = r2.json()
print("\nLoginPage API:", login.get("status"), "tmpt len:", len(login.get("data", {}).get("tmpt", "")))

AUTH_URL = payload_login["referer"]
s2 = requests.Session()
s2.proxies = session.proxies
ld = login["data"]
for name in ("tmpt", "eps_sid"):
    s2.cookies.set(name, ld[name], domain=".ticketmaster.com", path="/")
r3 = s2.get(AUTH_URL, headers={
    "user-agent": ld["user_agent"],
    "accept-language": ld.get("accept_lang", "en-US"),
    "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "sec-gpc": "1",
    "upgrade-insecure-requests": "1",
}, timeout=60)
print("LoginPage OAuth GET:", r3.status_code, len(r3.content))
