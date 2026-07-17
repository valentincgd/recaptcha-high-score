"""Trouve sur quel champ porte le hash #5 du reload réel."""
import base64
import json
import sys


def read_varint(buf, i):
    shift = 0
    result = 0
    while True:
        b = buf[i]
        i += 1
        result |= (b & 0x7F) << shift
        if not (b & 0x80):
            break
        shift += 7
    return result, i


def parse_top(buf):
    fields = {}
    order = []
    i = 0
    n = len(buf)
    while i < n:
        tag, i = read_varint(buf, i)
        fn = tag >> 3
        wire = tag & 0x7
        if wire == 0:
            val, i = read_varint(buf, i)
            fields.setdefault(fn, []).append(("varint", val))
        elif wire == 2:
            ln, i = read_varint(buf, i)
            sub = buf[i : i + ln]
            i += ln
            fields.setdefault(fn, []).append(("bytes", sub))
        elif wire == 1:
            fields.setdefault(fn, []).append(("i64", buf[i : i + 8]))
            i += 8
        elif wire == 5:
            fields.setdefault(fn, []).append(("i32", buf[i : i + 4]))
            i += 4
        else:
            break
        order.append(fn)
    return fields, order


def hash_string(bs):
    num = 0
    for c in bs:
        num = (num * 31 + c) & 0xFFFFFFFF
    # int32
    return num - 0x100000000 if num >= 0x80000000 else num


def main():
    path = sys.argv[1] if len(sys.argv) > 1 else r"C:\Users\Valentin\Downloads\rc-reload-captures-1782867664300.json"
    caps = json.load(open(path, encoding="utf-8"))
    c = next(x for x in caps if x.get("kind") == "reload" and x.get("reqBodyB64"))
    raw = base64.b64decode(c["reqBodyB64"].split(":", 1)[1])
    fields, order = parse_top(raw)

    target = None
    for wire, val in fields.get(5, []):
        if wire == "bytes":
            target = int(val.decode())
    print(f"cible #5 = {target}\n")

    # Test hash sur chaque champ bytes individuel
    for fn in sorted(fields):
        for wire, val in fields[fn]:
            if wire == "bytes":
                h = hash_string(val)
                mark = "  <<< MATCH" if h == target else ""
                print(f"hash(#{fn}) = {h}  (len {len(val)}){mark}")

    # Test hash sur concat de champs plausibles (8+14+16 etc.)
    def getb(fn):
        for wire, val in fields.get(fn, []):
            if wire == "bytes":
                return val
        return b""

    combos = {
        "8+14+16": getb(8) + getb(14) + getb(16),
        "16": getb(16),
        "8+14": getb(8) + getb(14),
        "2": getb(2),
        "22": getb(22),
        "16+22": getb(16) + getb(22),
        "8+14+16(as f7 tail)": getb(8) + getb(14) + getb(16),
    }
    print()
    for name, bs in combos.items():
        h = hash_string(bs)
        mark = "  <<< MATCH" if h == target else ""
        print(f"hash({name}) = {h}{mark}")


if __name__ == "__main__":
    main()
