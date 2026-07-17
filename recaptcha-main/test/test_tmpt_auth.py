#!/usr/bin/env python3
"""Test TMPT local (API Go) puis appel auth Ticketmaster OAuth."""

import json
import sys
from pathlib import Path

import requests

# --- Configuration ---
PROXY = "http://fBs9M6aL:6FbvX5bw-563069864@tickets-fr-s.reserve2.resi.unknownproxies.com:14018"

TMPT_API_URL = "http://127.0.0.1:3848/api/captcha/tmpt"
VALOU_KEY = "dispurgendispurticketdispurcaptcha"
TMPT_URL = "https://auth.ticketmaster.com/"
TMPT_DOMAIN = "auth.ticketmaster.com"
TMPT_SITEKEY = "6LcvL3UrAAAAAO_9u8Seiuf-I6F_tP_jSS-zndXV"
TMPT_ACTION = "pageView"

AUTH_URL = (
    "https://auth.ticketmaster.com/as/authorization.oauth2"
    "?client_id=8bf7204a7e97.web.ticketmaster.us"
    "&response_type=code"
    "&scope=openid%20profile%20phone%20email%20tm"
    "&redirect_uri=https%3A%2F%2Fidentity.ticketmaster.com%2Fexchange"
    "&visualPresets=tm"
    "&lang=en-us"
    "&placementId=mytmlogin"
    "&hideLeftPanel=false"
    "&integratorId=prd1741.iccp"
    "&intSiteToken=tm-us"
    "&disableAutoOptIn=false"
)

BASE_HEADERS = {
    "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
    "accept-language": "fr-FR,fr;q=0.6",
    "priority": "u=0, i",
    "sec-fetch-dest": "document",
    "sec-fetch-mode": "navigate",
    "sec-fetch-site": "none",
    "sec-fetch-user": "?1",
    "sec-gpc": "1",
    "upgrade-insecure-requests": "1",
}

OUT_DIR = Path(__file__).resolve().parent


def fetch_tmpt() -> dict:
    """Appelle l'API Go locale pour obtenir tmpt + eps_sid + fingerprint."""
    response = requests.post(
        TMPT_API_URL,
        headers={
            "Content-Type": "application/json",
            "X-Valou-Key": VALOU_KEY,
        },
        json={
            "url": TMPT_URL,
            "sitekey": TMPT_SITEKEY,
            "proxy": PROXY,
            "action": TMPT_ACTION,
            "domain": TMPT_DOMAIN,
            "referer": AUTH_URL,
        },
        timeout=300,
    )
    response.raise_for_status()
    payload = response.json()
    print("Réponse API tmpt:")
    print(json.dumps(payload, indent=2, ensure_ascii=False))

    if payload.get("status") == "error":
        raise RuntimeError(payload.get("message") or payload.get("error") or payload)

    data = payload.get("data")
    if not isinstance(data, dict) or "tmpt" not in data:
        raise KeyError(f"Impossible de trouver tmpt dans la réponse: {payload}")

    if not data.get("eps_sid"):
        raise KeyError(f"eps_sid absent dans la réponse: {payload}")

    return data


def build_auth_headers(tmpt_data: dict) -> dict[str, str]:
    headers = BASE_HEADERS.copy()
    mapping = {
        "user_agent": "user-agent",
        "accept_lang": "accept-language",
        "sec_ch_ua": "sec-ch-ua",
        "sec_ch_ua_mobile": "sec-ch-ua-mobile",
        "sec_ch_ua_platform": "sec-ch-ua-platform",
    }
    for api_key, header_key in mapping.items():
        if tmpt_data.get(api_key) is not None:
            headers[header_key] = tmpt_data[api_key]
    return headers


def build_auth_cookies(tmpt_data: dict) -> dict[str, str]:
    cookies = {"tmpt": tmpt_data["tmpt"]}
    if eps_sid := tmpt_data.get("eps_sid"):
        cookies["eps_sid"] = eps_sid
    return cookies


def print_applied_tmpt_data(tmpt_data: dict) -> None:
    print("Champs API appliqués à la requête auth:")
    print(f"  cookie tmpt = {tmpt_data['tmpt'][:80]}…")
    print(f"  cookie eps_sid = {tmpt_data.get('eps_sid', '(absent)')[:80]}…")
    for api_key, header_key in [
        ("user_agent", "user-agent"),
        ("accept_lang", "accept-language"),
        ("sec_ch_ua", "sec-ch-ua"),
        ("sec_ch_ua_mobile", "sec-ch-ua-mobile"),
        ("sec_ch_ua_platform", "sec-ch-ua-platform"),
    ]:
        print(f"  {header_key} = {tmpt_data.get(api_key, '(absent)')}")


def call_auth(tmpt_data: dict) -> requests.Response:
    return requests.get(
        AUTH_URL,
        headers=build_auth_headers(tmpt_data),
        cookies=build_auth_cookies(tmpt_data),
        proxies={"http": PROXY, "https": PROXY},
        timeout=60,
        allow_redirects=True,
    )


def main() -> int:
    try:
        tmpt_data = fetch_tmpt()
        print_applied_tmpt_data(tmpt_data)
        print()

        response = call_auth(tmpt_data)
        print(f"Auth status: {response.status_code}")
        print(f"URL finale: {response.url}")
        print(f"Content-Type: {response.headers.get('Content-Type', 'N/A')}")
        print(f"Taille réponse: {len(response.content)} octets")

        if response.history:
            print("\nRedirections:")
            for i, r in enumerate(response.history, 1):
                print(f"  {i}. {r.status_code} -> {r.headers.get('Location', 'N/A')}")

        out_file = OUT_DIR / "ticketmaster_response.html"
        out_file.write_text(response.text, encoding="utf-8")
        print(f"\nRéponse sauvegardée dans {out_file}")

        if 200 <= response.status_code < 300:
            print("\n[OK] OAuth 2XX")
            return 0
        print(f"\n[FAIL] OAuth status {response.status_code} (attendu 2XX)", file=sys.stderr)
        return 1

    except requests.HTTPError as e:
        print(f"Erreur HTTP: {e}", file=sys.stderr)
        if e.response is not None:
            print(e.response.text, file=sys.stderr)
        return 1
    except Exception as e:
        print(f"Erreur: {e}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
