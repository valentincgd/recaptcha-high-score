"""Rejoue un body reload reCAPTCHA capturé (extension) tel quel vers Google,
via le proxy, et affiche la réponse (token ou erreur).

But : savoir si le body réel du navigateur, rejoué côté serveur, produit encore
un token — ou si reCAPTCHA le rejette (body lié à la session/IP navigateur).
"""
import base64
import json
import sys

import requests

PROXY = "http://fBs9M6aL:6FbvX5bw-563069864@tickets-fr-s.reserve2.resi.unknownproxies.com:14018"
SITEKEY = "6LcvL3UrAAAAAO_9u8Seiuf-I6F_tP_jSS-zndXV"
CAP = r"C:\Users\Valentin\Downloads\rc-reload-captures-1782867664300.json"
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36"


def main():
    caps = json.load(open(CAP, encoding="utf-8"))
    c = next(x for x in caps if x.get("kind") == "reload" and x.get("reqBodyB64"))
    prefix, _, data = c["reqBodyB64"].partition(":")
    raw = base64.b64decode(data)
    print(f"body: {prefix}, {len(raw)} octets")
    print(f"frame(referer): {c.get('frame')}\n")

    url = f"https://www.google.com/recaptcha/enterprise/reload?k={SITEKEY}"
    headers = {
        "accept": "*/*",
        "accept-language": "fr-FR,fr;q=0.9",
        "content-type": "application/x-protobuffer",
        "origin": "https://www.google.com",
        "referer": c.get("frame") or "https://www.google.com/recaptcha/enterprise/anchor",
        "sec-fetch-dest": "empty",
        "sec-fetch-mode": "cors",
        "sec-fetch-site": "same-origin",
        "user-agent": UA,
    }
    proxies = {"http": PROXY, "https": PROXY}
    try:
        r = requests.post(url, data=raw, headers=headers, proxies=proxies, timeout=60)
    except Exception as e:
        print(f"ERREUR requête: {e}")
        return 1
    print(f"HTTP {r.status_code}  ({len(r.content)} octets)")
    body = r.text
    print("réponse (500 premiers car):")
    print(body[:500])
    # reCAPTCHA renvoie )]}'\n["rresp","<token>",...]
    cleaned = body.lstrip(")]}'\n")
    try:
        arr = json.loads(cleaned)
        if isinstance(arr, list) and len(arr) > 1 and isinstance(arr[1], str):
            print(f"\nTOKEN extrait ({len(arr[1])} car): {arr[1][:60]}...")
    except Exception:
        print("\n(pas de token JSON parsable)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
