"""Récupère le JS du framework epsf/gec de TM (eps-mgr) pour reverse."""
from curl_cffi import requests as cffi

PROXY = "http://fBs9M6aL:6FbvX5bw-563069864@tickets-fr-s.reserve2.resi.unknownproxies.com:14018"
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36"
EVENT_URL = "https://www.ticketmaster.com/event/020064BAD9B8236F"
proxies = {"http": PROXY, "https": PROXY}

URLS = [
    "https://epsf.ticketmaster.com/eps-mgr?id=edp",
    "https://www.ticketmaster.com/eps-mgr",
]


def main():
    s = cffi.Session(impersonate="chrome", proxies=proxies, verify=False)
    for url in URLS:
        try:
            r = s.get(
                url,
                headers={
                    "accept": "*/*",
                    "accept-language": "fr-FR,fr;q=0.9",
                    "referer": EVENT_URL,
                    "sec-ch-ua": '"Not;A=Brand";v="8", "Chromium";v="150", "Google Chrome";v="150"',
                    "sec-ch-ua-mobile": "?0",
                    "sec-ch-ua-platform": '"Windows"',
                    "sec-fetch-dest": "script",
                    "sec-fetch-mode": "no-cors",
                    "sec-fetch-site": "same-site",
                    "user-agent": UA,
                },
                timeout=60,
            )
            body = r.text
            print(f"\n=== {url}")
            print(f"HTTP {r.status_code}  content-type={r.headers.get('content-type')}  len={len(body)}")
            print(f"set-cookie eps_sid? {'eps_sid' in r.headers.get('set-cookie','')}")
            print("début:", body[:300].replace("\n", " "))
            fname = "eps_mgr_" + ("epsf" if "epsf" in url else "www") + ".js"
            with open(fname, "w", encoding="utf-8") as f:
                f.write(body)
            print(f"-> sauvé {fname}")
        except Exception as e:
            print(f"{url}: ERREUR {e}")


if __name__ == "__main__":
    main()
