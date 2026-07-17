#!/usr/bin/env python3
"""Recupere la page www event (via tmpt reel) et extrait sitekey + action reCAPTCHA."""

import re
import requests

PROXY = "http://fBs9M6aL:6FbvX5bw-563069864@tickets-fr-s.reserve2.resi.unknownproxies.com:14018"
PROXIES = {"http": PROXY, "https": PROXY}
EVENT = (
    "https://www.ticketmaster.com/benson-bootyjtyjour-pittsburgh-pennsylvania-07-07-2026/"
    "event/1600647921872DC4"
)
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36"
REF_TMPT = "1:CAESGOQonmbQJyEy-WD60amCyWJjP55Q426j7BiStZHSBiIvaER1rni-YiZqgPWv3Wkx_K48OsgPdGsEeqkTLklCxNP3inWBFBbddZaSIG_OECw"
REF_EPS_SID = "a5d7d064116e3fbd.1782864530.mwL5ec/72mPwOTNHG0w5UwDqdFb8zwvWXIfTUqlNbuk="

s = requests.Session()
s.proxies = PROXIES
for k, v in {"tmpt": REF_TMPT, "eps_sid": REF_EPS_SID}.items():
    s.cookies.set(k, v, domain="www.ticketmaster.com", path="/")

g = s.get(
    EVENT,
    headers={
        "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
        "accept-language": "fr-FR,fr;q=0.5",
        "user-agent": UA,
        "referer": EVENT,
        "sec-fetch-dest": "document",
        "sec-fetch-mode": "navigate",
        "sec-fetch-site": "same-origin",
        "upgrade-insecure-requests": "1",
    },
    timeout=60,
)
print("GET status:", g.status_code, "len:", len(g.text))
html = g.text
open("test/www_event_page.html", "w", encoding="utf-8").write(html)

# sitekeys reCAPTCHA (6L...)
keys = sorted(set(re.findall(r"6L[0-9A-Za-z_-]{38}", html)))
print("\nSitekeys trouves:", keys)

# api.js vs enterprise.js
for m in re.findall(r"(recaptcha/(?:api|enterprise)\.js[^\"'<> ]*)", html):
    print("  script:", m[:120])

# render= et action
for m in set(re.findall(r"render=([0-9A-Za-z_-]{20,})", html)):
    print("  render:", m)
for m in set(re.findall(r"action['\"]?\s*[:=]\s*['\"]([A-Za-z0-9_]+)['\"]", html)):
    print("  action:", m)

# grecaptcha.execute(...)
for m in re.findall(r"grecaptcha[.\w]*\.execute\([^)]{0,120}\)", html):
    print("  execute:", m[:140])

# eps / epsf endpoints references
for m in set(re.findall(r"/epsf/gec/v3/\w+", html)):
    print("  gec:", m)
