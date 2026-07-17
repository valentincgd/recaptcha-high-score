"""Cherche la base du hash #5 en reconstruisant des messages protobuf candidats."""
import base64
import json

path = r"C:\Users\Valentin\Downloads\rc-reload-captures-1782867664300.json"
caps = json.load(open(path, encoding="utf-8"))
c = next(x for x in caps if x.get("kind") == "reload" and x.get("reqBodyB64"))
raw = base64.b64decode(c["reqBodyB64"].split(":", 1)[1])


def read_varint(buf, i):
    shift = res = 0
    while True:
        b = buf[i]; i += 1
        res |= (b & 0x7F) << shift
        if not (b & 0x80):
            break
        shift += 7
    return res, i


def parse_top(buf):
    fields = {}
    i, n = 0, len(buf)
    while i < n:
        tag, i = read_varint(buf, i)
        fn, wire = tag >> 3, tag & 7
        if wire == 0:
            v, i = read_varint(buf, i); fields.setdefault(fn, b"varint")
        elif wire == 2:
            ln, i = read_varint(buf, i); fields[fn] = buf[i:i+ln]; i += ln
        elif wire == 1:
            fields[fn] = buf[i:i+8]; i += 8
        elif wire == 5:
            fields[fn] = buf[i:i+4]; i += 4
        else:
            break
    return fields


f = parse_top(raw)
target = -1739137776


def hs(bs):
    num = 0
    for c in bs:
        num = (num * 31 + c) & 0xFFFFFFFF
    return num - 0x100000000 if num >= 0x80000000 else num


def uvarint(n):
    out = bytearray()
    while True:
        b = n & 0x7F
        n >>= 7
        if n:
            out.append(b | 0x80)
        else:
            out.append(b)
            return bytes(out)


def wstr(fn, bs):
    tag = (fn << 3) | 2
    return uvarint(tag) + uvarint(len(bs)) + bs


blob16 = f[16]
blob22 = f[22]
action = f[8]
sitekey = f[14]

candidates = {
    "pb(8,14,2088=blob16)": wstr(8, action) + wstr(14, sitekey) + wstr(2088, blob16),
    "pb(8,14,2088=blob22)": wstr(8, action) + wstr(14, sitekey) + wstr(2088, blob22),
    "pb(2088=blob16)": wstr(2088, blob16),
    "pb(2088=blob22)": wstr(2088, blob22),
    "pb(8,14,16=blob16)": wstr(8, action) + wstr(14, sitekey) + wstr(16, blob16),
    "blob16+blob22": blob16 + blob22,
    "action+sitekey+blob16": action + sitekey + blob16,
    "action+sitekey+blob22": action + sitekey + blob22,
    "pb(8,14,2088=blob22,...)": wstr(8, action) + wstr(14, sitekey) + wstr(2088, blob22) + wstr(2089, blob16),
}
print(f"cible #5 = {target}\n")
for name, bs in candidates.items():
    h = hs(bs)
    print(f"hash({name}) = {h}{'   <<< MATCH' if h == target else ''}")
