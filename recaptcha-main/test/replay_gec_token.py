"""Rejoue la curl utilisateur : POST /Event avec le TOKEN GEC + eps_sid utilisateur,
récupère le tmpt, puis GET event. Confirme que le token gec (≠ reCAPTCHA) est le bon.
"""
from curl_cffi import requests as cffi

PROXY = "http://fBs9M6aL:6FbvX5bw-563069864@tickets-fr-s.reserve2.resi.unknownproxies.com:14018"
SITEKEY = "6LcvL3UrAAAAAO_9u8Seiuf-I6F_tP_jSS-zndXV"
EVENT_URL = "https://www.ticketmaster.com/event/020064BAD9B8236F"
ORIGIN = "https://www.ticketmaster.com"
DOMAIN = "www.ticketmaster.com"
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36"
SEC_CH_UA = '"Not;A=Brand";v="8", "Chromium";v="150", "Google Chrome";v="150"'
EPS_SID = "0cb3f655ed88dfa6.1782867766./Lbj4OabCKc8dGNO0ZIlT80YtD4Ei3H/Un0fy75Ve0o="
TOKEN = "HFZmU0dRwVNRs1VXIBSE8QSQ9ZbTU-djFqKzEhGWRFDyRdATlCBwtrOjMpQiEXdzZLFBV0F1YQZGUrbR8JHxNjP0g6OWlwUlUyEwhsEARaOTliVkd2WnVnGRdEJmJQFWICXk0jZzQEaGk1bSkOJEYZPFYEYRNVDXosZ1MWdRsRIBs3AyFBZWUxHmhTbSM6cyVvISYrbHZAC0UKeDgvVCsETm4uZydBbX0UIF4ES30TbAFJC3lzHQZ0PVN3eR4yE3sGVW07dAJgUT00CmI1YGxxUgQRI0EqY14seHVhQz4-T0N2aX8RBFpZQlQJVEMyBigeTlwpP1tjZ0YyV3AEf0gnTmE-J1xnAnJoUEpAXRk4DGU-TUMGc30DUnskcmoJcVsZMQl-UExHfkw4Y20EDX5iSWo5BEtoUXMVXEBmTWl2MUoeTns1eUARcGYPeXAGSWJHS0BDSiQmOjsxcQ5FKhYOf3wYaVpSKiYSa1ctFh4yIh9UYCZFdx0xE2EKLlxVDUZqImRsTRIAY1syFGkWRCkqODkdBDgOT1Q6HwMFTlNMVn02VjkbaV0mbX48I3ovZn4iAVIId2xqSUohXFhYZ0w2ZBIUIkoicHMZTG4-VSkuUG8vUHFOZE0sRnQNQHMlJVcdenwoBWxlfBlKa0YQUHE6aV0IEURfDFAlZnBKfxYYcDwMbTsNfxIBQl4kCTo-fGNKE1NrY0IGaE4say0nH3gJUHN_IVpGUAx3b1cqDVV9dGYFZ3BVE04uYScSZFxDa3I3YlNOdWgfcEYteC8RY0BbJ0APPWMAA0sVRmgAF3g1XHhTBWQEcnFAY10fa2VbW05lVkF8eR8aWEkJVXsEWTo9YUAIByAuaGcyAAl3cHEwX00USQMxOhsOfGNrPGpVSGh1T10mAmdhaGY4TXdgX0sgRCYsc3UXEkVHXHM6VygPRD51ensIMks0UwRYQmAPGFE7NFZbPnt6W0gzXVI3SHwkVh8eZn9FbXUvYzpdRjImTShTXEY_XCIWMFNbQBxPVVwOB3cFVlAzSVEkcwgRD3AQf1w7JGg3TkMBVQ07VERzVV4VB0l2fzIVGGMlfV0SQHsDZ3d8JgUTQG8gUREoYxUnQmFSVEUrKSsCVVI3Emo5ZUZra1s-SRYWZE85MHx8AUoHV2RSbBogdlAqfXgKXXsiZmwvXzw8b1kSAFl2ckk4QFYdbSVzaVgmbGUac0g2QV8GXGA1UgFjLEcgc1FUZkdyYi4pY3MjY20_HlRXQz4Ba3U4LRcnJmoDVWcAWWwCM0cUM3kYGXEWexsxfiYTS3YfYlI9KHtCQXQEZnZOGWBBVCFdDndWX34oR0NfeRBBUkoROWUvfmcYUxAtSTAlFHArRyIIMVwxf0IiUAJzY05ram4-XF5lbmgXYRFQU0VYZhw2cWBsRDUIN08UVns4GHoTdRgkVWAFAFENcXhXFxwzXWJTW106SFwSCmAcOCR7XmMkJGV6eD9DakdXDUolcCE8OHcBRBg_U3QxH3Qyd0IyYBIufRIuN2IkWXM5MUYzRHFyYXQYA0IsbT8BWmlPe1kWfCcYexACEhMhakhvcRM0eUgLSh8LJhoESmQHZUQqeiw9XWw7MxA9X1NKQW0fbklNa2kJN2pdR3RqUWUuYD83DCIxbksfUBo0SUI8Q34Cf0BVZFkrZnYHVkocUwt1N2YYWFwnc3xUVQ0JWElrU1JJbH8GZ3ZsUCsURxkpclE6FmMQW3Q0IiwKQHVzWRkWMlIofHA5PgIVDCcIU1RWIlARXEFARV4Zc1MPX0w9AEljVnVtQmF1aAQnfSUNf0ExTHoocGklBSMuaSQrBmoyY3ZCEWUMUmg4JEZkblMYPlU6Q2wGc1gGAUNtenI6X1ZtHXUHZBgYZkosbUEBQF1IQAkgSEExNjwrFXMIcAJYYWNUCCsXNlcbB35gShxuVlFEFxEnUH0GPmJFQk8XYVV-ex9HDnwxanpSfX0XfSwaZGowXFs0CgQ2b34cE14Lax8IKlgedXwcGlpJUnkOVXQ1T2dITXMIfANvRDMNcgUAYmAMbUskY2M5QitQU290Zzo5aUwvZ1dYYGAuKm0rS1A3IEoWJmRuQ1o6S2w8QVAMHERWdzlvJFtdGR81bUkwXXs0ADgdcTgUfBUzQksdGGR-TH4-REo2agsxJGYJOVQ8fxRgV3wTUUNpYX1Vc2Y7e0t2UmwGZQIobFw0bFw6R387ZCQxakUAVwIqF3kPYUxeakYjHXE9OhATO016VWpsYl8jS3Q7XUgsNiV2YjZweHdUWxoXZjwhaFoXWHADeWg5AzhIXHYCMWV3d0U2TmM9TmoAb28CSGErAURXQwJ2X3kmB3pXTWwkUlJoGEIlayA-WFwXV3cAYF5BKmhXe1oIcwRNABoHVkATXQ4VACoCe3E2HXsgWEJyfFQicxwjSXNeCn08Xlo2QEdzS2AcFGMGTVAKRnkZSmMjaTc5ZlsUMUcNbXchbm8aXA5sNFE0Ql4oZkYzeFMKWkgyU3lTRn5mT3xWfGcTRh4jVkcFRU4ZYmNmd3A0RGErOAs_I1ZfI3hdaHUTc3YPNFEsBWgAIXNiByAQd2dDTxwOGlllBEMVWE0pGgE_bF5SckUKWDEkZjkJUgIuUGUBBGY1E2FQFRZeCx9zbgZhPzVgCB8yEApwEwgdW0N1cC5ifRYwGEM0TzgVMRZHAhY2DAg_chU1M28JTX4xKRpYdgYIeVIgJ3U7MGtSMn4Rak1AZW45SmoDRX4Eb15IeC54ITE8HRBXCyMpVnUOWSQvLTMqBX1IICFIfWcvSUAaUFdeC2wPChNjPyFiZRwnE3hlBAoJXFgvKC5jfBYwGn50Hn9EJhQ0V1QZTG1ocRYOdylzRn1OZw1YJBBZPB4sA0sXThhQEwxlIEVuWHJQFRQyQkkAMDkpBzAee3F2QjZXC1dVDD9JBWZ-JjFJAmMrZHUZJ1ljFWJAFBNVCmpkbAR0OlQ"

proxies = {"http": PROXY, "https": PROXY}


def main():
    s = cffi.Session(impersonate="chrome", proxies=proxies, verify=False)
    s.cookies.set("eps_sid", EPS_SID, domain=".ticketmaster.com")

    r = s.post(
        f"{ORIGIN}/epsf/gec/v3/Event",
        headers={
            "accept": "*/*",
            "accept-language": "fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7",
            "content-type": "application/json",
            "origin": ORIGIN,
            "referer": EVENT_URL,
            "sec-ch-ua": SEC_CH_UA,
            "sec-ch-ua-mobile": "?0",
            "sec-ch-ua-platform": '"Windows"',
            "sec-fetch-dest": "empty",
            "sec-fetch-mode": "cors",
            "sec-fetch-site": "same-origin",
            "user-agent": UA,
        },
        json={"hostname": DOMAIN, "key": SITEKEY, "token": TOKEN},
        timeout=60,
    )
    tmpt = s.cookies.get("tmpt")
    print(f"[POST /Event] HTTP {r.status_code}  tmpt={'oui' if tmpt else 'non'}  body[:200]={r.text[:200]}")
    if tmpt:
        print(f"  tmpt: {tmpt[:60]}...")

    r2 = s.get(
        EVENT_URL,
        headers={
            "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
            "accept-language": "fr-FR,fr;q=0.9",
            "referer": EVENT_URL,
            "sec-ch-ua": SEC_CH_UA,
            "sec-ch-ua-mobile": "?0",
            "sec-ch-ua-platform": '"Windows"',
            "upgrade-insecure-requests": "1",
            "user-agent": UA,
        },
        timeout=60,
    )
    print(f"[GET event] HTTP {r2.status_code}  tm-bl={r2.headers.get('tm-bl')}  ({len(r2.content)} octets)")
    print("[OK] 2XX" if 200 <= r2.status_code < 300 else "[bloqué]")


if __name__ == "__main__":
    main()
