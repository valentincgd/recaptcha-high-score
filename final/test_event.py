#!/usr/bin/env python3
"""Test event endpoint replay with Chrome TLS (curl_cffi) — compare jsdom vs flat tmpt.

Mints a tmpt from the local API (forcing jsdom or flat), then replays the real
TM event-page + quickpicks with curl_cffi Chrome impersonation (genuine TLS),
so a 403 means the TOKEN/tmpt is bad, not the client TLS.
"""
import os, sys, json
import requests
from curl_cffi import requests as creq

API = "http://127.0.0.1:3848/api/captcha/tmpt"
PROXY = os.environ.get("T_PROXY", "")
IMP = os.environ.get("T_IMP", "chrome")

TM_ENTERPRISE = "6LcvL3UrAAAAAO_9u8Seiuf-I6F_tP_jSS-zndXV"
EVENT_ID = "1E0064620FE4DD7A"
EVENT_PAGE = ("https://www.ticketmaster.com/"
              "charley-crockett-age-of-the-ram-casper-wyoming-07-08-2026/event/" + EVENT_ID)
QUICKPICKS = (
    "https://offeradapter.ticketmaster.com/api/ismds/event/" + EVENT_ID + "/quickpicks"
    "?show=places+maxQuantity+sections&mode=primary:ppsectionrow+resale:ga_areas+platinum:all"
    "&qty=2&q=not(%27accessible%27)&includeStandard=true&includeResale=true"
    "&includePlatinumInventoryType=false"
    "&ticketTypes=061200000009%2C000000000001%2C0016000E0009"
    "&embed=area&embed=offer&embed=description"
    "&apikey=b462oi7fic6pehcdkzony5bxhe&apisecret=pquzpfrfz7zd2ylvtz3w5dtyse"
    "&resaleChannelId=internal.ecommerce.consumer.desktop.web.browser.ticketmaster.us"
    "&limit=40&offset=0&sort=noTaxTotalprice&promoted=primary"
    "&numberOfTopPicksForPrimaryCheck=5&minNumberOfPrimaryOnTop=5&maxNumberOfPromotions=3"
)

def proxies():
    return {"http": PROXY, "https": PROXY} if PROXY else None

def mint(flat):
    payload = {"websiteUrl": EVENT_PAGE, "recaptchaSitekey": TM_ENTERPRISE,
               "action": "Event", "isEnterprise": False, "warm": False,
               "poolSize": 3, "flat": flat}
    if PROXY:
        payload["proxy"] = PROXY
    r = requests.post(API, json=payload, timeout=180)
    r.raise_for_status()
    b = r.json()
    if b.get("status") != "success":
        raise RuntimeError(b.get("error") or b)
    return b["data"]

def base_headers(d):
    return {
        "accept-language": d.get("accept_lang", "en-US,en;q=0.9"),
        "sec-ch-ua": d.get("sec_ch_ua", ""),
        "sec-ch-ua-mobile": d.get("sec_ch_ua_mobile", "?0"),
        "sec-ch-ua-platform": d.get("sec_ch_ua_platform", '"Windows"'),
        "user-agent": d.get("user_agent", ""),
    }

def test_eventpage(d):
    h = base_headers(d)
    h.update({
        "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
        "sec-fetch-dest": "document", "sec-fetch-mode": "navigate",
        "sec-fetch-site": "same-origin", "sec-fetch-user": "?1",
        "upgrade-insecure-requests": "1", "referer": "https://www.ticketmaster.com/",
        "cookie": "tmpt=" + d["tmpt"],
    })
    r = creq.get(EVENT_PAGE, headers=h, impersonate=IMP, proxies=proxies(),
                 timeout=90, allow_redirects=False)
    return r.status_code, len(r.content)

def test_quickpicks(d):
    s = creq.Session(impersonate=IMP)
    if PROXY:
        s.proxies = proxies()
    s.cookies.set("tmpt", d["tmpt"], domain=".ticketmaster.com")
    if d.get("eps_sid"):
        s.cookies.set("eps_sid", d["eps_sid"], domain=".ticketmaster.com")
    ph = base_headers(d)
    ph.update({"accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
               "sec-fetch-dest": "document", "sec-fetch-mode": "navigate",
               "sec-fetch-site": "same-origin", "sec-fetch-user": "?1",
               "upgrade-insecure-requests": "1", "referer": "https://www.ticketmaster.com/"})
    s.get(EVENT_PAGE, headers=ph, timeout=90, allow_redirects=True)
    ah = base_headers(d)
    ah.update({"accept": "*/*", "origin": "https://www.ticketmaster.com",
               "referer": "https://www.ticketmaster.com/", "sec-fetch-dest": "empty",
               "sec-fetch-mode": "cors", "sec-fetch-site": "same-site"})
    r = s.get(QUICKPICKS, headers=ah, timeout=90, allow_redirects=False)
    return r.status_code, len(r.content)

def run(label, flat):
    try:
        tf = os.environ.get("T_TMPT_FILE")
        if tf and flat:
            d = json.load(open(tf))
        else:
            d = mint(flat)
        ep_s, ep_n = test_eventpage(d)
        qp_s, qp_n = test_quickpicks(d)
        def verdict(s): return "PASS" if s != 403 else "FAIL"
        print(f"[{label:6}] tmpt={d['tmpt'][:20]}...  "
              f"event-page: HTTP {ep_s} {verdict(ep_s)} ({ep_n}o)  |  "
              f"quickpicks: HTTP {qp_s} {verdict(qp_s)} ({qp_n}o)")
        return ep_s != 403 and qp_s != 403
    except Exception as e:
        print(f"[{label:6}] ERROR {e}")
        return False

if __name__ == "__main__":
    which = sys.argv[1] if len(sys.argv) > 1 else "both"
    print(f"proxy={'(proxyless)' if not PROXY else PROXY[:40]}  impersonate={IMP}\n")
    if which in ("jsdom", "both"):
        run("JSDOM", False)
    if which in ("flat", "both"):
        run("FLAT", True)
