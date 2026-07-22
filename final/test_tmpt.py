#!/usr/bin/env python3
"""Parallel tmpt tester.

For every job it mints a fresh tmpt from the local API, then replays a real
Ticketmaster request with it (same proxy + same fingerprint headers).
A tmpt is GOOD unless the endpoint answers 403 (anti-bot block).

Targets, each run N times, everything in parallel:
  - quickpicks : offeradapter inventory API   (action=Event)
  - event-page : the public event HTML page    (action=Event)
  - auth-login : the OAuth authorize page       (action=LoginPage)

    pip install requests
    python test_tmpt.py
"""

import concurrent.futures as cf
import os
import sys
import threading

import requests

# ============================= CONFIG =========================================
API    = "http://127.0.0.1:3848/api/captcha/tmpt"
PROXY  = os.environ.get("T_PROXY", "http://kyzenpro:0637fd1ce4a6b5f3_country-France_session-4m67xOzg@proxy.packetstream.io:31112")     # vide = PROXYLESS (IP directe) ; sinon host:port ou URL ; T_PROXY="" pour proxyless
WARM   = os.environ.get("T_WARM", "1") == "3"   # pool de fenêtres chaudes à empreinte tournante
N      = int(os.environ.get("T_N", "1"))   # runs per target (T_N=1 pour éviter la contention jsdom)
FORCE_FLAT = os.environ.get("T_FLAT")           # "1" force flat, "0" force jsdom, None = défaut serveur (www→jsdom)
ONLY_TARGETS = [t.strip() for t in os.environ.get("T_TARGETS", "").split(",") if t.strip()]  # filtre les cibles

# --- reCAPTCHA config passée à l'API (Voie B) --------------------------------
# Domaine enregistré de la sitekey (l'origine reCAPTCHA), PAS forcément l'URL rejouée.
RECAPTCHA_ORIGIN  = "https://auth.ticketmaster.com"
RECAPTCHA_SITEKEY = "6LdoaXQrAAAAADQviABd-eByJu6kPL8awKDyc1zb"  # in TM = api2 (pas enterprise)
IS_ENTERPRISE     = False
TITLE             = "Let's Get Your Identity Verified"
EVENT_ID   = "1E0064620FE4DD7A"
EVENT_PAGE = ("https://www.ticketmaster.com/"
              "charley-crockett-age-of-the-ram-casper-wyoming-07-08-2026/event/" + EVENT_ID)
EXTRA_COOKIES = ""               # e.g. "BID=...; SID=..." if an endpoint needs them
# ==============================================================================

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
AUTH_URL = (
    "https://auth.ticketmaster.com/as/authorization.oauth2"
    "?client_id=8bf7204a7e97.web.ticketmaster.us&response_type=code"
    "&scope=openid%20profile%20phone%20email%20tm"
    "&redirect_uri=https%3A%2F%2Fidentity.ticketmaster.com%2Fexchange"
    "&visualPresets=tm&lang=en-us&placementId=mytmlogin&hideLeftPanel=false"
    "&integratorId=prd1741.iccp&intSiteToken=tm-us&disableAutoOptIn=false"
)

# --- login réel (POST /json/sign-in) : teste le captcha sur la connexion -------
# Le tmpt est minté host-matché sur auth (6Ldo/LoginPage) ; notre token reCAPTCHA
# part dans le corps (recaptchaToken) et le login exige les cookies tmpt + eps_sid.
LOGIN_URL      = "https://auth.ticketmaster.com/json/sign-in"
LOGIN_REFERER  = AUTH_URL
LOGIN_EMAIL    = "valentincgdpro@gmail.com"
LOGIN_PASSWORD = os.environ.get("T_PW", "Valou12345!!!!!!")
# Cookies de SESSION capturés (hors captcha). Le login a besoin de tmpt + eps_sid EN PLUS
# de ceux-ci ; mets-les à jour si la session expire (sinon échec pour raison non-captcha).
LOGIN_SESSION_COOKIES = (
    "BID=IL3vCtvF2fqdns4mMwsSgQ_vgr1lQmC716nPG246Jk0bTfZznvnkRK4vwnbRUBczuD1PSdtzm4pdBhvm; "
    "ma.LANGUAGE=en-us"
)

# IMPORTANT : on mint le tmpt contre le MÊME host que la cible rejouée (host-matché),
# avec la sitekey attendue par ce host (cf. /eps-mgr map d_f : www→[g], auth→[n,g]).
# www.ticketmaster.com = reCAPTCHA ENTERPRISE (6Lcv…) ; auth.ticketmaster.com = api2 (6Ldo…, +nds).
TM_ENTERPRISE = "6LcvL3UrAAAAAO_9u8Seiuf-I6F_tP_jSS-zndXV"
TM_AUTH_KEY   = "6LdoaXQrAAAAADQviABd-eByJu6kPL8awKDyc1zb"
TARGETS = [
    {"name": "quickpicks", "action": "Event",     "gen": EVENT_PAGE, "kind": "api",
     "site": "same-site",   "sitekey": TM_ENTERPRISE, "enterprise": False,
     "url": QUICKPICKS, "referer": "https://www.ticketmaster.com/"},
    {"name": "event-page", "action": "Event",     "gen": EVENT_PAGE, "kind": "page",
     "site": "same-origin", "sitekey": TM_ENTERPRISE, "enterprise": False,
     "url": EVENT_PAGE, "referer": "https://www.ticketmaster.com/"},
    {"name": "auth-login", "action": "LoginPage", "gen": AUTH_URL,   "kind": "page",
     "site": "none",        "sitekey": TM_AUTH_KEY,   "enterprise": False,
     "url": AUTH_URL,   "referer": None},
    # login RÉEL : DEUX captchas distincts.
    #  - tmpt cookie  : action "LoginPage" (chemin /epsf/gec/v3/LoginPage ; "login" y est refusé)
    #  - recaptchaToken (corps) : action "login" + key 6Ldo (2e exécution, comme le vrai navigateur)
    {"name": "login",      "action": "LoginPage", "gen": AUTH_URL,   "kind": "login",
     "site": "same-origin", "sitekey": TM_AUTH_KEY, "enterprise": False,
     "captcha_action": "login", "captcha_enterprise": True,  # le token du sign-in = ENTERPRISE
     "url": LOGIN_URL,  "referer": LOGIN_REFERER},
]

TOKEN_API = "http://127.0.0.1:3848/api/captcha/token"

# ----- colors -----------------------------------------------------------------
if os.name == "nt":
    os.system("")  # enable ANSI escapes on Windows 10+ terminals
R, G, RED, YEL, CY, DIM, B = (
    "\033[0m", "\033[32m", "\033[31m", "\033[33m", "\033[36m", "\033[2m", "\033[1m",
)
PRINT_LOCK = threading.Lock()


def normalize_proxy(raw):
    """Accepte '', 'http://user:pass@host:port', 'host:port', 'host:port:user:pass'."""
    raw = (raw or "").strip()
    if not raw:
        return ""
    if "://" in raw:
        return raw
    p = raw.split(":")
    if len(p) == 4:
        return f"http://{p[2]}:{p[3]}@{p[0]}:{p[1]}"
    if len(p) == 2:
        return f"http://{p[0]}:{p[1]}"
    return raw


PROXY_URL = normalize_proxy(PROXY)


def proxies():
    return {"http": PROXY_URL, "https": PROXY_URL} if PROXY_URL else None


def mint(target):
    """Ask the local API for a fresh tmpt (+ matching fingerprint headers).

    Host-matché : on mint contre l'URL de génération de la cible (target['gen']),
    donc l'origin/hostname du tmpt == le host qu'on va rejouer.
    """
    payload = {
        "websiteUrl":       target["gen"],          # host-matché (www ou auth)
        "recaptchaSitekey": target["sitekey"],
        "action":           target["action"],
        "isEnterprise":     target["enterprise"],
        "warm":             WARM,
        "poolSize":         3,
    }
    if FORCE_FLAT is not None:
        payload["flat"] = (FORCE_FLAT == "1")
    if PROXY_URL:
        payload["proxy"] = PROXY_URL
    r = requests.post(API, json=payload, timeout=180)
    r.raise_for_status()
    body = r.json()
    if body.get("status") != "success":
        raise RuntimeError(body.get("error") or body)
    data = body["data"]

    # 2e exécution reCAPTCHA pour le corps (ex. login) : token d'une AUTRE action que le tmpt.
    if target.get("captcha_action"):
        tk = requests.post(TOKEN_API, json={
            "url":          target["gen"],
            "sitekey":      target["sitekey"],
            "action":       target["captcha_action"],
            # le token du sign-in est ENTERPRISE (cf. captcha_enterprise) ≠ le tmpt (standard)
            "isEnterprise": target.get("captcha_enterprise", target["enterprise"]),
            "proxy":        PROXY_URL or None,
        }, timeout=180)
        tk.raise_for_status()
        tb = tk.json()
        if tb.get("status") != "success":
            raise RuntimeError("token(" + target["captcha_action"] + "): " + str(tb.get("error") or tb))
        data["token"] = tb["data"]["token"]   # remplace par le token action=login

    return data


def headers_for(target, data):
    cookie = "tmpt=" + data["tmpt"]
    if EXTRA_COOKIES:
        cookie += "; " + EXTRA_COOKIES
    h = {
        "accept-language": data.get("accept_lang", "en-US,en;q=0.9"),
        "sec-ch-ua": data.get("sec_ch_ua", ""),
        "sec-ch-ua-mobile": data.get("sec_ch_ua_mobile", "?0"),
        "sec-ch-ua-platform": data.get("sec_ch_ua_platform", '"Windows"'),
        "user-agent": data.get("user_agent", ""),
        "cookie": cookie,
    }
    if target["kind"] == "api":
        h.update({
            "accept": "*/*",
            "origin": "https://www.ticketmaster.com",
            "referer": target["referer"],
            "sec-fetch-dest": "empty",
            "sec-fetch-mode": "cors",
            "sec-fetch-site": target["site"],
        })
    elif target["kind"] == "login":
        # POST /json/sign-in : cookies tmpt + eps_sid (requis) + session capturée.
        lc = "tmpt=" + data["tmpt"]
        if data.get("eps_sid"):
            lc += "; eps_sid=" + data["eps_sid"]
        if LOGIN_SESSION_COOKIES:
            lc += "; " + LOGIN_SESSION_COOKIES
        h["cookie"] = lc
        h.update({
            "accept": "*/*",
            "content-type": "application/json",
            "origin": "https://auth.ticketmaster.com",
            "referer": target["referer"],
            "sec-fetch-dest": "empty",
            "sec-fetch-mode": "cors",
            "sec-fetch-site": "same-origin",
            "tm-client-id": "8bf7204a7e97.web.ticketmaster.us",
            "tm-integrator-id": "prd1741.iccp",
            "tm-oauth-type": "tm-auth",
            "tm-placement-id": "mytmlogin",
            "tm-site-token": "tm-us",
        })
    else:  # page
        h.update({
            "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,"
                      "image/avif,image/webp,image/apng,*/*;q=0.8",
            "sec-fetch-dest": "document",
            "sec-fetch-mode": "navigate",
            "sec-fetch-site": target["site"],
            "sec-fetch-user": "?1",
            "upgrade-insecure-requests": "1",
        })
        if target["referer"]:
            h["referer"] = target["referer"]
    return h


def login_body(data):
    # Notre token reCAPTCHA (action=login) va dans recaptchaToken.
    return {
        "email": LOGIN_EMAIL,
        "password": LOGIN_PASSWORD,
        "recaptchaToken": data.get("token", ""),
        "externalUserToken": None,
    }


def validate(target, data):
    if target["kind"] == "login":
        r = requests.post(target["url"], headers=headers_for(target, data),
                          json=login_body(data), proxies=proxies(),
                          timeout=90, allow_redirects=False)
        try:
            j = r.json()
        except ValueError:
            j = {}
        msg = str(j.get("message") or "").strip()
        # Captcha REJETÉ = HTTP 403, dont le message est "Operation Not Allowed".
        # Captcha ACCEPTÉ = HTTP 200 (le body peut dire "account is locked", creds, etc. = OK captcha).
        captcha_bad = (r.status_code == 403) or (msg.lower() == "operation not allowed")
        ok = not captcha_bad
        tag = "CAPTCHA-BLOCK " if captcha_bad else "CAPTCHA-OK "
        return ok, r.status_code, tag + (msg or r.text[:100].replace("\n", " "))
    if target["kind"] == "api":
        # Les API ISMDS (offeradapter) exigent les cookies BID/SID posés en visitant D'ABORD la page
        # event ; avec juste tmpt → tm-bl:1 {"response":"block"}. On chaîne comme un vrai navigateur :
        # GET page event (accumule BID/SID) PUIS l'API, avec le jar complet.
        s = requests.Session()
        s.proxies = proxies()
        s.cookies.set("tmpt", data["tmpt"], domain=".ticketmaster.com")
        if data.get("eps_sid"):
            s.cookies.set("eps_sid", data["eps_sid"], domain=".ticketmaster.com")
        ph = headers_for({**target, "kind": "page"}, data); ph.pop("cookie", None)
        s.get(target["gen"], headers=ph, timeout=90, allow_redirects=True)
        ah = headers_for(target, data); ah.pop("cookie", None)  # laisse le jar de session gérer les cookies
        r = s.get(target["url"], headers=ah, timeout=90, allow_redirects=False)
    else:
        r = requests.get(target["url"], headers=headers_for(target, data),
                         proxies=proxies(), timeout=90, allow_redirects=False)
    ok = r.status_code != 403                    # rule: only 403 = blocked
    if r.status_code == 403:
        info = "BLOCKED " + r.text[:60].replace("\n", " ")
    elif r.status_code == 200:
        info = "200 OK (%d bytes)" % len(r.content)
    else:
        info = "accepted (HTTP %d)" % r.status_code
    return ok, r.status_code, info


def run(target, idx):
    try:
        data = mint(target)
        ok, status, info = validate(target, data)
        return target["name"], idx, ok, status, data["tmpt"][:22], info
    except Exception as e:  # noqa: BLE001
        return target["name"], idx, None, 0, "-", "ERROR " + str(e)[:80]


def fmt(name, idx, ok, status, tmpt, info):
    tag = YEL + "ERROR" + R if ok is None else (G + "PASS " + R if ok else RED + "FAIL " + R)
    return ("%s[%s%-11s%s #%d]%s %s %sHTTP %-3s%s  %stmpt=%s...%s  %s"
            % (DIM, CY, name, DIM, idx, R, tag, DIM, status, R, DIM, tmpt, R, info))


def main():
    targets = [t for t in TARGETS if not ONLY_TARGETS or t["name"] in ONLY_TARGETS]
    jobs = [(t, i) for t in targets for i in range(1, N + 1)]
    print("%sRunning %d targets x %d = %d jobs in parallel...%s\n"
          % (B, len(TARGETS), N, len(jobs), R))

    results = []
    with cf.ThreadPoolExecutor(max_workers=len(jobs)) as ex:
        futs = [ex.submit(run, t, i) for t, i in jobs]
        for f in cf.as_completed(futs):
            res = f.result()
            results.append(res)
            with PRINT_LOCK:
                print(fmt(*res))

    print("\n" + B + "Summary" + R)
    all_ok = True
    for t in targets:
        good = sum(1 for r in results if r[0] == t["name"] and r[2])
        all_ok &= good == N
        col = G if good == N else RED
        print("  %s%-11s %s%d/%d%s" % (CY, t["name"], col, good, N, R))

    total = sum(1 for r in results if r[2])
    col = G if all_ok else RED
    print("\n%s%s  %d/%d tmpt accepted%s"
          % (col, "OK" if all_ok else "FAIL", total, len(jobs), R))
    sys.exit(0 if all_ok else 1)


if __name__ == "__main__":
    main()
