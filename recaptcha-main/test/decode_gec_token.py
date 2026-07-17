"""Analyse le token 'gagnant' posté à /epsf/gec/v3/Event quand le reload est bloqué."""
import base64

TOKEN = "HFZmU0dRwVNRs1VXIBSE8QSQ9ZbTU-djFqKzEhGWRFDyRdATlCBwtrOjMpQiEXdzZLFBV0F1YQZGUrbR8JHxNjP0g6OWlwUlUyEwhsEARaOTliVkd2WnVnGRdEJmJQFWICXk0jZzQEaGk1bSkOJEYZPFYEYRNVDXosZ1MWdRsRIBs3AyFBZWUxHmhTbSM6cyVvISYrbHZAC0UKeDgvVCsETm4uZydBbX0UIF4ES30TbAFJC3lzHQZ0PVN3eR4yE3sGVW07dAJgUT00CmI1YGxxUgQRI0EqY14seHVhQz4-T0N2aX8RBFpZQlQJVEMyBigeTlwpP1tjZ0YyV3AEf0gnTmE-J1xnAnJoUEpAXRk4DGU-TUMGc30DUnskcmoJcVsZMQl-UExHfkw4Y20EDX5iSWo5BEtoUXMVXEBmTWl2MUoeTns1eUARcGYPeXAGSWJHS0BDSiQmOjsxcQ5FKhYOf3wYaVpSKiYSa1ctFh4yIh9UYCZFdx0xE2EKLlxVDUZqImRsTRIAY1syFGkWRCkqODkdBDgOT1Q6HwMFTlNMVn02VjkbaV0mbX48I3ovZn4iAVIId2xqSUohXFhYZ0w2ZBIUIkoicHMZTG4-VSkuUG8vUHFOZE0sRnQNQHMlJVcdenwoBWxlfBlKa0YQUHE6aV0IEURfDFAlZnBKfxYYcDwMbTsNfxIBQl4kCTo-fGNKE1NrY0IGaE4say0nH3gJUHN_IVpGUAx3b1cqDVV9dGYFZ3BVE04uYScSZFxDa3I3YlNOdWgfcEYteC8RY0BbJ0APPWMAA0sVRmgAF3g1XHhTBWQEcnFAY10fa2VbW05lVkF8eR8aWEkJVXsEWTo9YUAIByAuaGcyAAl3cHEwX00USQMxOhsOfGNrPGpVSGh1T10mAmdhaGY4TXdgX0sgRCYsc3UXEkVHXHM6VygPRD51ensIMks0UwRYQmAPGFE7NFZbPnt6W0gzXVI3SHwkVh8eZn9FbXUvYzpdRjImTShTXEY_XCIWMFNbQBxPVVwOB3cFVlAzSVEkcwgRD3AQf1w7JGg3TkMBVQ07VERzVV4VB0l2fzIVGGMlfV0SQHsDZ3d8JgUTQG8gUREoYxUnQmFSVEUrKSsCVVI3Emo5ZUZra1s-SRYWZE85MHx8AUoHV2RSbBogdlAqfXgKXXsiZmwvXzw8b1kSAFl2ckk4QFYdbSVzaVgmbGUac0g2QV8GXGA1UgFjLEcgc1FUZkdyYi4pY3MjY20_HlRXQz4Ba3U4LRcnJmoDVWcAWWwCM0cUM3kYGXEWexsxfiYTS3YfYlI9KHtCQXQEZnZOGWBBVCFdDndWX34oR0NfeRBBUkoROWUvfmcYUxAtSTAlFHArRyIIMVwxf0IiUAJzY05ram4-XF5lbmgXYRFQU0VYZhw2cWBsRDUIN08UVns4GHoTdRgkVWAFAFENcXhXFxwzXWJTW106SFwSCmAcOCR7XmMkJGV6eD9DakdXDUolcCE8OHcBRBg_U3QxH3Qyd0IyYBIufRIuN2IkWXM5MUYzRHFyYXQYA0IsbT8BWmlPe1kWfCcYexACEhMhakhvcRM0eUgLSh8LJhoESmQHZUQqeiw9XWw7MxA9X1NKQW0fbklNa2kJN2pdR3RqUWUuYD83DCIxbksfUBo0SUI8Q34Cf0BVZFkrZnYHVkocUwt1N2YYWFwnc3xUVQ0JWElrU1JJbH8GZ3ZsUCsURxkpclE6FmMQW3Q0IiwKQHVzWRkWMlIofHA5PgIVDCcIU1RWIlARXEFARV4Zc1MPX0w9AEljVnVtQmF1aAQnfSUNf0ExTHoocGklBSMuaSQrBmoyY3ZCEWUMUmg4JEZkblMYPlU6Q2wGc1gGAUNtenI6X1ZtHXUHZBgYZkosbUEBQF1IQAkgSEExNjwrFXMIcAJYYWNUCCsXNlcbB35gShxuVlFEFxEnUH0GPmJFQk8XYVV-ex9HDnwxanpSfX0XfSwaZGowXFs0CgQ2b34cE14Lax8IKlgedXwcGlpJUnkOVXQ1T2dITXMIfANvRDMNcgUAYmAMbUskY2M5QitQU290Zzo5aUwvZ1dYYGAuKm0rS1A3IEoWJmRuQ1o6S2w8QVAMHERWdzlvJFtdGR81bUkwXXs0ADgdcTgUfBUzQksdGGR-TH4-REo2agsxJGYJOVQ8fxRgV3wTUUNpYX1Vc2Y7e0t2UmwGZQIobFw0bFw6R387ZCQxakUAVwIqF3kPYUxeakYjHXE9OhATO016VWpsYl8jS3Q7XUgsNiV2YjZweHdUWxoXZjwhaFoXWHADeWg5AzhIXHYCMWV3d0U2TmM9TmoAb28CSGErAURXQwJ2X3kmB3pXTWwkUlJoGEIlayA-WFwXV3cAYF5BKmhXe1oIcwRNABoHVkATXQ4VACoCe3E2HXsgWEJyfFQicxwjSXNeCn08Xlo2QEdzS2AcFGMGTVAKRnkZSmMjaTc5ZlsUMUcNbXchbm8aXA5sNFE0Ql4oZkYzeFMKWkgyU3lTRn5mT3xWfGcTRh4jVkcFRU4ZYmNmd3A0RGErOAs_I1ZfI3hdaHUTc3YPNFEsBWgAIXNiByAQd2dDTxwOGlllBEMVWE0pGgE_bF5SckUKWDEkZjkJUgIuUGUBBGY1E2FQFRZeCx9zbgZhPzVgCB8yEApwEwgdW0N1cC5ifRYwGEM0TzgVMRZHAhY2DAg_chU1M28JTX4xKRpYdgYIeVIgJ3U7MGtSMn4Rak1AZW45SmoDRX4Eb15IeC54ITE8HRBXCyMpVnUOWSQvLTMqBX1IICFIfWcvSUAaUFdeC2wPChNjPyFiZRwnE3hlBAoJXFgvKC5jfBYwGn50Hn9EJhQ0V1QZTG1ocRYOdylzRn1OZw1YJBBZPB4sA0sXThhQEwxlIEVuWHJQFRQyQkkAMDkpBzAee3F2QjZXC1dVDD9JBWZ-JjFJAmMrZHUZJ1ljFWJAFBNVCmpkbAR0OlQ"


def try_b64(s):
    s2 = s.replace("-", "+").replace("_", "/")
    s2 += "=" * (-len(s2) % 4)
    return base64.b64decode(s2)


def analyze(raw, label):
    from collections import Counter
    import math
    cnt = Counter(raw)
    ent = -sum((n / len(raw)) * math.log2(n / len(raw)) for n in cnt.values())
    printable = sum(1 for b in raw if 32 <= b < 127) / len(raw)
    print(f"  [{label}] {len(raw)} octets, entropie {ent:.2f} bits/o, distincts {len(cnt)}/256, imprimable {printable:.2f}")
    print(f"    hex[:48]: {raw[:48].hex()}")


def main():
    print(f"len token: {len(TOKEN)}  (mod4={len(TOKEN)%4})")
    charset = sorted(set(TOKEN))
    print(f"chars uniques: {len(charset)}  '-':{'-' in charset} '_':{'_' in charset}")
    print(f"alphabet: {''.join(charset)}")

    for off in (0, 1):
        s = TOKEN[off:]
        s2 = s.replace("-", "+").replace("_", "/")
        s2 += "=" * (-len(s2) % 4)
        try:
            raw = base64.b64decode(s2)
            analyze(raw, f"offset {off}")
        except Exception as e:
            print(f"  offset {off}: erreur {e}")

    print("\naperçu texte début token:", TOKEN[:80])
    print("aperçu texte fin token:", TOKEN[-80:])


if __name__ == "__main__":
    main()
