"""Compare la structure du token gec gagnant (HFZm) vs un token reCAPTCHA (03A/0cA)."""
import base64
import math
from collections import Counter

# Token anchor reCAPTCHA (field #2 de la 1re capture reload)
RECAP = "03AFcWeA5-Zy9sFFsyOZmLnXR8E_A3KBYgP7llAbgADgWve0tedu_itVi1hh_xQMMMzdaKJ4OHP7wkvYmwha2YDH9muwhuQ_CoW9DP5pBKkxOqZY_gtL_WpzdhzxOJUz9mKlLdCASJ_8tl3Io4OB1aBR9SQ2YJWE9Ue58gX81-sE3uZUXJQ2Y3nyc0eL1dlR4v_5d2IyeYlinip6Z2DNgMU8koprWLNjzOUn2KaM8Go1UejBDrlYOGuP5Xe9d-kcqlbyRFuv3RPOPCfysYw4gdlbWYoM_3mkBhZrk3SdDYBqIzoJb4b4EgFYmeF1DAGz58PfRN0bb-0h9mCjCvKaDop7Xq5a50oQhpR2f1wppSbytVPLd7u07yXK-G199xnflLN8iG-zk_AuFXKF0vOKhT3NOKQw8_oeuQqOGCvKI5QSnKt4u7CntLWgMvLmNNjFHfr4f5u_wNnyW1eCYj2pJhrJmLyfkbaxjKfIdrSMqV372zWiuBIc4wQtZreBt8jdkZc_-moyeTctYtF_j74gEt9GoA-pnnKq8Iple1-azlcCcSjpolKIosTLJwM5Vhy-oa6vtTuJ33IagXiIHAMHZCwMbSNzY0aCupSB61FrhLqD5a4Ubh9A3BkQAiP6dSzTbxomquIud1oA005RbCbxSvfiDMt7WiEnnBjk3GX13tIUf5zNThzxMRVFuhA0us3xljd_toALMSODDYr2_SGMDwurrhc4IcT30DPeIeLxTwa_HK3RgpNGKMPFCZQOeL_fkWdkkvYUPGokXxtwOQ6meODTl51qSJRgBq4uvz5K8JnOGAWwvv92L5nn2GKiD_rfUR2pHRKWLY6kATXfZMLD-nhLseMqAoSmyV470y0l7nkNrhJFxUVrAOFrufLGcpz41wbU4vzdQRmK3HPa9j-m7-0-ntNGsEIj8QZ-TZfhUMDtkKmztmu9WgmFFEZTQhl8nd8hIpH5_WzIuVpgsyjM7lDHQav5WzFH24UMBiW-ecMePcBewt1UxKlntYYCa1Vx_QZaB4K0EeleqVXJD1M1-ylD9iORNcFG_obXDmQQ0xAA5ovwoejJ1P0drqvSk5IQnbqe10LgG2QG4STeH-l1HbLkEpOM21fvmrEAgOImAK0GUOrLAl0hmxctk0xOZ3jojqwtJzEKaRowzAIVR3gmT9nQu7aUKx3xfYbYdSzCussTswzalvKaX1O0teLHoHldEXku5nlgxswyw5LR5Uw_LxOiVbi-vdeF6LKvukouKtasiBiY92BYX4kOgrJfOrucHkZKxr_7yr4rcsm6TcSPfFlzM7drdViXYND9pJiXlahdHL6IGAxVV3OiICKgJFpYVGKZnPJwSjibtmVfolto1ayw7l_ecGTaFdqWmL5yaFN5MLklB8JnNeU5t4qFmYhpcJE8h6Xo33Xks9qQg2lTliFfXqm-mb1Xkuxp56j4yhnaHOlxmyoLJaI0TyHkg_iZs5D_xYPYGij-6SoU2UBMkXFU3J1ozZ4pq7DWb9PSOzEo6v1WccaHxNjGd_JdhR2YEvmlYyStABOVb3xnab7F6FvoVFljug1Jmh4v_rFjdvWILg-jAskR1kPHoj_Ef7bRj6wo1VQ5wwf1so61GSTaYxUOFVe_Oq80T24773Clw3BOkc_-OUAUxmzJEWOJn5skSPCsJvlAqtuBGYxtmIMofrOolk_kME34oA332q-_S3ZV_MHn6jZHDjJLTDuSJapqLsHyWmiwQhYesNmyIGoSpIgWifevKE1QhiI6p7NHwTIcxDZV-spW2T-E8"

# Token gec gagnant
GEC = "HFZmU0dRwVNRs1VXIBSE8QSQ9ZbTU-djFqKzEhGWRFDyRdATlCBwtrOjMpQiEXdzZLFBV0F1YQZGUrbR8JHxNjP0g6OWlwUlUyEwhs"  # tronqué pour compare structure


def b64any(s):
    s = s.replace("-", "+").replace("_", "/")
    for pad in range(4):
        try:
            return base64.b64decode(s + "=" * pad)
        except Exception:
            continue
    return None


def ent(bs):
    if not bs:
        return 0
    c = Counter(bs)
    return -sum((n / len(bs)) * math.log2(n / len(bs)) for n in c.values())


for name, tok in [("reCAPTCHA 03A", RECAP), ("gec HFZm", GEC)]:
    print(f"\n=== {name} ===")
    print(f"len={len(tok)} prefix={tok[:12]!r}")
    for off in (0, 1, 2):
        raw = b64any(tok[off:])
        if raw:
            print(f"  offset {off}: {len(raw)}o entropie {ent(raw):.2f} hex[:24]={raw[:24].hex()}")
