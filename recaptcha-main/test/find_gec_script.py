"""Récupère la vraie page event (via token gec) et localise les scripts epsf/gec."""
import re

from curl_cffi import requests as cffi

import replay_gec_token as R


def main():
    s = cffi.Session(impersonate="chrome", proxies=R.proxies, verify=False)
    s.cookies.set("eps_sid", R.EPS_SID, domain=".ticketmaster.com")
    hdr = {
        "accept": "*/*",
        "content-type": "application/json",
        "origin": R.ORIGIN,
        "referer": R.EVENT_URL,
        "sec-ch-ua": R.SEC_CH_UA,
        "sec-ch-ua-mobile": "?0",
        "sec-ch-ua-platform": '"Windows"',
        "user-agent": R.UA,
    }
    r = s.post(
        f"{R.ORIGIN}/epsf/gec/v3/Event",
        headers=hdr,
        json={"hostname": R.DOMAIN, "key": R.SITEKEY, "token": R.TOKEN},
        timeout=60,
    )
    print("POST", r.status_code, "tmpt", bool(s.cookies.get("tmpt")))
    r2 = s.get(
        R.EVENT_URL,
        headers={
            "accept": "text/html,application/xhtml+xml,*/*;q=0.8",
            "accept-language": "fr-FR,fr;q=0.9",
            "referer": R.EVENT_URL,
            "sec-ch-ua": R.SEC_CH_UA,
            "sec-ch-ua-mobile": "?0",
            "sec-ch-ua-platform": '"Windows"',
            "upgrade-insecure-requests": "1",
            "user-agent": R.UA,
        },
        timeout=60,
    )
    print("GET", r2.status_code, len(r2.content))
    html = r2.text
    with open("event_page.html", "w", encoding="utf-8") as f:
        f.write(html)

    print("\n--- références epsf/gec/eps ---")
    refs = set(re.findall(r"""['"]([^'"]*(?:epsf|/gec|eps-mgr)[^'"]*)['"]""", html))
    for m in sorted(refs)[:40]:
        print("ref:", m)

    print("\n--- <script src> ---")
    for m in sorted(set(re.findall(r"""<script[^>]+src=['"]([^'"]+)['"]""", html)))[:80]:
        print("src:", m)


if __name__ == "__main__":
    main()
