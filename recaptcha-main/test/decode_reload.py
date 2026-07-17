"""Décode le corps protobuf d'un reload reCAPTCHA capturé par l'extension.

Usage: python decode_reload.py <rc-reload-captures.json>
Affiche la structure champ par champ (numéro, wire type, valeur/aperçu).
"""
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


def is_printable(bs):
    try:
        s = bs.decode("utf-8")
    except UnicodeDecodeError:
        return None
    printable = sum(1 for c in s if 32 <= ord(c) < 127 or c in "\n\r\t")
    if len(s) and printable / len(s) > 0.85:
        return s
    return None


def try_parse(buf, depth=0, max_depth=4):
    """Retourne une liste de champs (field_no, wire, value) ou None si invalide."""
    fields = []
    i = 0
    n = len(buf)
    while i < n:
        try:
            tag, i = read_varint(buf, i)
        except IndexError:
            return None
        field_no = tag >> 3
        wire = tag & 0x7
        if field_no == 0:
            return None
        if wire == 0:  # varint
            val, i = read_varint(buf, i)
            fields.append((field_no, "varint", val))
        elif wire == 1:  # 64-bit
            if i + 8 > n:
                return None
            fields.append((field_no, "i64", buf[i : i + 8].hex()))
            i += 8
        elif wire == 2:  # length-delimited
            ln, i = read_varint(buf, i)
            if i + ln > n:
                return None
            sub = buf[i : i + ln]
            i += ln
            txt = is_printable(sub)
            if txt is not None:
                fields.append((field_no, f"len={ln} str", txt))
            else:
                nested = try_parse(sub, depth + 1, max_depth) if depth < max_depth else None
                if nested:
                    fields.append((field_no, f"len={ln} msg", nested))
                else:
                    fields.append((field_no, f"len={ln} bytes", sub[:40].hex() + ("..." if ln > 40 else "")))
        elif wire == 5:  # 32-bit
            if i + 4 > n:
                return None
            fields.append((field_no, "i32", buf[i : i + 4].hex()))
            i += 4
        else:
            return None
    return fields


def show(fields, indent=0):
    pad = "  " * indent
    for fn, wire, val in fields:
        if isinstance(val, list):
            print(f"{pad}#{fn} [{wire}]:")
            show(val, indent + 1)
        else:
            s = str(val)
            if len(s) > 160:
                s = s[:160] + f"... (+{len(str(val)) - 160})"
            print(f"{pad}#{fn} [{wire}] = {s}")


def main():
    path = sys.argv[1] if len(sys.argv) > 1 else r"C:\Users\Valentin\Downloads\rc-reload-captures-1782867664300.json"
    with open(path, encoding="utf-8") as f:
        caps = json.load(f)
    reloads = [c for c in caps if c.get("kind") == "reload" and c.get("reqBodyB64")]
    print(f"{len(reloads)} reload(s) avec body\n")
    for idx, c in enumerate(reloads):
        b64 = c["reqBodyB64"]
        prefix, _, data = b64.partition(":")
        raw = base64.b64decode(data)
        print(f"=== reload #{idx} ({prefix}, {len(raw)} octets) url={c['url']} ===")
        fields = try_parse(raw)
        if fields is None:
            print("  <parse protobuf échoué>")
        else:
            show(fields)
        print()


if __name__ == "__main__":
    main()
