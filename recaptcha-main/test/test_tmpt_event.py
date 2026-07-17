#!/usr/bin/env python3
"""Test TMPT Event (www.ticketmaster.com) via API Go locale."""

import json
import sys
from pathlib import Path

import requests

PROXY = "http://fBs9M6aL:6FbvX5bw-563069864@tickets-fr-s.reserve2.resi.unknownproxies.com:14018"

TMPT_API_URL = "http://127.0.0.1:3848/api/captcha/tmpt"
VALOU_KEY = "dispurgendispurticketdispurcaptcha"

EVENT_URL = (
    "https://www.ticketmaster.com/benson-bootyjtyjour-pittsburgh-pennsylvania-07-07-2026/"
    "event/1600647921872DC4"
)
EVENT_DOMAIN = "www.ticketmaster.com"
EVENT_SITEKEY = "6LcvL3UrAAAAAO_9u8Seiuf-I6F_tP_jSS-zndXV"
EVENT_ACTION = "Event"

OUT_DIR = Path(__file__).resolve().parent


class TmptEventTest:
    """Flux Event : API tmpt -> GET page event avec tmpt + eps_sid."""

    def __init__(self, proxy: str = PROXY) -> None:
        self.proxy = proxy
        self.proxies = {"http": proxy, "https": proxy}

    def fetch_tmpt(self) -> dict:
        response = requests.post(
            TMPT_API_URL,
            headers={
                "Content-Type": "application/json",
                "X-Valou-Key": VALOU_KEY,
            },
            json={
                "url": EVENT_URL,
                "sitekey": EVENT_SITEKEY,
                "proxy": self.proxy,
                "action": EVENT_ACTION,
                "domain": EVENT_DOMAIN,
                "referer": EVENT_URL,
            },
            timeout=300,
        )
        response.raise_for_status()
        payload = response.json()
        print("Reponse API tmpt (Event):")
        print(json.dumps(payload, indent=2, ensure_ascii=False))

        if payload.get("status") == "error":
            raise RuntimeError(payload.get("error") or payload)

        data = payload.get("data")
        if not isinstance(data, dict) or not data.get("tmpt"):
            raise KeyError(f"tmpt absent: {payload}")
        if not data.get("eps_sid"):
            raise KeyError(f"eps_sid absent: {payload}")
        return data

    @staticmethod
    def _apply_fingerprint(headers: dict[str, str], tmpt_data: dict) -> dict[str, str]:
        out = headers.copy()
        mapping = {
            "user_agent": "user-agent",
            "accept_lang": "accept-language",
            "sec_ch_ua": "sec-ch-ua",
            "sec_ch_ua_mobile": "sec-ch-ua-mobile",
            "sec_ch_ua_platform": "sec-ch-ua-platform",
        }
        for api_key, header_key in mapping.items():
            if tmpt_data.get(api_key) is not None:
                out[header_key] = tmpt_data[api_key]
        return out

    @staticmethod
    def _cookies(tmpt_data: dict) -> dict[str, str]:
        cookies = {"tmpt": tmpt_data["tmpt"]}
        if eps_sid := tmpt_data.get("eps_sid"):
            cookies["eps_sid"] = eps_sid
        return cookies

    def post_event_gec(self, tmpt_data: dict, token: str | None = None) -> requests.Response:
        """POST /epsf/gec/v3/Event (equivalent curl 1) — optionnel si l'API a deja poste."""
        headers = self._apply_fingerprint(
            {
                "accept": "*/*",
                "content-type": "application/json",
                "origin": f"https://{EVENT_DOMAIN}",
                "priority": "u=1, i",
                "referer": EVENT_URL,
                "sec-fetch-dest": "empty",
                "sec-fetch-mode": "cors",
                "sec-fetch-site": "same-origin",
                "sec-gpc": "1",
            },
            tmpt_data,
        )
        body = {
            "hostname": EVENT_DOMAIN,
            "key": EVENT_SITEKEY,
            "token": token or tmpt_data.get("token", ""),
        }
        if not body["token"]:
            raise ValueError("token requis pour POST Event manuel")

        return requests.post(
            f"https://{EVENT_DOMAIN}/epsf/gec/v3/Event",
            headers=headers,
            cookies=self._cookies(tmpt_data),
            json=body,
            proxies=self.proxies,
            timeout=60,
        )

    def get_event_page(self, tmpt_data: dict, session: requests.Session | None = None) -> requests.Response:
        """GET page event (equivalent curl 2)."""
        headers = self._apply_fingerprint(
            {
                "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
                "accept-language": "fr-FR,fr;q=0.5",
                "cache-control": "max-age=0",
                "priority": "u=0, i",
                "referer": EVENT_URL,
                "sec-fetch-dest": "document",
                "sec-fetch-mode": "navigate",
                "sec-fetch-site": "same-origin",
                "sec-fetch-user": "?1",
                "sec-gpc": "1",
                "upgrade-insecure-requests": "1",
            },
            tmpt_data,
        )
        cookies = self._cookies(tmpt_data)
        client = session or requests.Session()
        if session is None:
            client.proxies = self.proxies
        for name, value in cookies.items():
            client.cookies.set(name, value, domain="www.ticketmaster.com", path="/")
        return client.get(
            EVENT_URL,
            headers=headers,
            timeout=60,
            allow_redirects=True,
        )

    def warmup_session(self) -> requests.Session:
        """Visite initiale pour collecter OptanonConsent / cookies TM."""
        session = requests.Session()
        session.proxies = self.proxies
        session.get(
            EVENT_URL,
            headers={
                "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
                "accept-language": "fr-FR,fr;q=0.5",
                "sec-fetch-dest": "document",
                "sec-fetch-mode": "navigate",
                "sec-fetch-site": "none",
                "sec-fetch-user": "?1",
                "sec-gpc": "1",
                "upgrade-insecure-requests": "1",
                "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36",
            },
            timeout=60,
        )
        return session

    def print_applied(self, tmpt_data: dict) -> None:
        print("Champs appliques a la requete event:")
        print(f"  cookie tmpt = {tmpt_data['tmpt'][:80]}...")
        print(f"  cookie eps_sid = {tmpt_data.get('eps_sid', '')[:80]}...")

    def run(self) -> int:
        try:
            tmpt_data = self.fetch_tmpt()
            self.print_applied(tmpt_data)
            print()

            page_status = tmpt_data.get("page_status")
            if page_status:
                code = int(page_status)
                print(f"Event page status (session Go): {code}")
                out_file = OUT_DIR / "ticketmaster_event_response.html"
                if 200 <= code < 300:
                    print(f"\n[OK] Event page 2XX (verification Go)")
                    return 0
                print(f"\n[FAIL] Event status {code} via session Go (attendu 2XX)", file=sys.stderr)
                return 1

            response = self.get_event_page(tmpt_data)
            print(f"Event page status: {response.status_code}")
            print(f"URL finale: {response.url}")
            print(f"Content-Type: {response.headers.get('Content-Type', 'N/A')}")
            print(f"Taille reponse: {len(response.content)} octets")

            if response.history:
                print("\nRedirections:")
                for i, r in enumerate(response.history, 1):
                    print(f"  {i}. {r.status_code} -> {r.headers.get('Location', 'N/A')}")

            out_file = OUT_DIR / "ticketmaster_event_response.html"
            out_file.write_text(response.text, encoding="utf-8")
            print(f"\nReponse sauvegardee dans {out_file}")

            if 200 <= response.status_code < 300:
                print("\n[OK] Event page 2XX")
                return 0
            print(f"\n[FAIL] Event status {response.status_code} (attendu 2XX)", file=sys.stderr)
            return 1

        except requests.HTTPError as e:
            print(f"Erreur HTTP: {e}", file=sys.stderr)
            if e.response is not None:
                print(e.response.text, file=sys.stderr)
            return 1
        except Exception as e:
            print(f"Erreur: {e}", file=sys.stderr)
            return 1


def main() -> int:
    return TmptEventTest().run()


if __name__ == "__main__":
    raise SystemExit(main())
