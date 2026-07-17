#!/usr/bin/env python3
"""Isole la cause du 403 : tmpt reel (navigateur) vs tmpt genere, via le meme proxy."""

import requests

PROXY = "http://fBs9M6aL:6FbvX5bw-563069864@tickets-fr-s.reserve2.resi.unknownproxies.com:14018"
PROXIES = {"http": PROXY, "https": PROXY}
EVENT = (
    "https://www.ticketmaster.com/benson-bootyjtyjour-pittsburgh-pennsylvania-07-07-2026/"
    "event/1600647921872DC4"
)
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36"

# Cookies de la requete curl de reference (tmpt reel navigateur) fournie par l'utilisateur.
REF_TMPT = "1:CAESGOQonmbQJyEy-WD60amCyWJjP55Q426j7BiStZHSBiIvaER1rni-YiZqgPWv3Wkx_K48OsgPdGsEeqkTLklCxNP3inWBFBbddZaSIG_OECw"
REF_EPS_SID = "a5d7d064116e3fbd.1782864530.mwL5ec/72mPwOTNHG0w5UwDqdFb8zwvWXIfTUqlNbuk="

HEADERS = {
    "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
    "accept-language": "fr-FR,fr;q=0.5",
    "cache-control": "max-age=0",
    "user-agent": UA,
    "sec-ch-ua": '"Brave";v="149", "Chromium";v="149", "Not)A;Brand";v="24"',
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": '"Windows"',
    "referer": EVENT,
    "sec-fetch-dest": "document",
    "sec-fetch-mode": "navigate",
    "sec-fetch-site": "same-origin",
    "sec-gpc": "1",
    "upgrade-insecure-requests": "1",
}


def get_with(cookies: dict, label: str) -> None:
    s = requests.Session()
    s.proxies = PROXIES
    for k, v in cookies.items():
        s.cookies.set(k, v, domain="www.ticketmaster.com", path="/")
    g = s.get(EVENT, headers=HEADERS, timeout=60)
    tmbl = g.headers.get("tm-bl", "-")
    print(f"[{label}] status={g.status_code} tm-bl={tmbl} len={len(g.content)}")


print("=== A. Cookies curl de reference (tmpt reel navigateur) ===")
get_with({"tmpt": REF_TMPT, "eps_sid": REF_EPS_SID}, "ref-browser")

print("\n=== B. Sans cookies (baseline proxy/IP) ===")
get_with({}, "no-cookies")
