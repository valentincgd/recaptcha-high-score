import time

import requests
import urllib3
from loguru import logger

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

# --- Credentials (fill before run) ---

TM_EMAIL = ""
TM_PASSWORD = ""
PROXY = "user:pass@host:port"

# --- DisPurCaptcha ---

DISPURCAPTCHA_API_KEY = ""
DISPURCAPTCHA_API_URL = "https://api.dispurcaptcha.com/api/v1/recaptcha"
CAPTCHA_TIMEOUT_SEC = 120
CAPTCHA_MAX_RETRIES = 4
CAPTCHA_RETRY_STATUSES = (429, 500, 503)

# --- Ticketmaster auth ---

AUTH_ORIGIN = "https://auth.ticketmaster.com"
AUTH_WEBSITE_URL = AUTH_ORIGIN
OAUTH2_URL = (
    "https://auth.ticketmaster.com/as/authorization.oauth2?"
    "client_id=8bf7204a7e97.web.ticketmaster.us&response_type=code"
    "&scope=openid%20profile%20phone%20email%20tm"
    "&redirect_uri=https%3A%2F%2Fidentity.ticketmaster.com%2Fexchange"
    "&visualPresets=tm&lang=en-us&placementId=mytmlogin&hideLeftPanel=false"
    "&integratorId=prd1741.iccp&intSiteToken=tm-us&disableAutoOptIn=false"
)
EPS_MGR_URL = f"{AUTH_ORIGIN}/eps-mgr"
TMPT_URL = f"{AUTH_ORIGIN}/epsf/gec/v3/LoginPage"
SIGN_IN_URL = f"{AUTH_ORIGIN}/json/sign-in"

LOGIN_PAGE_SITE_KEY = "6LcvL3UrAAAAAO_9u8Seiuf-I6F_tP_jSS-zndXV"
SIGN_IN_SITE_KEY = "6LdoaXQrAAAAADQviABd-eByJu6kPL8awKDyc1zb"

TM_CLIENT_ID = "8bf7204a7e97.web.ticketmaster.us"
TM_INTEGRATOR_ID = "prd1741.iccp"
TM_PLACEMENT_ID = "mytmlogin"
TM_SITE_TOKEN = "tm-us"

CAPTCHA_ACTION_LOGIN_PAGE = "LoginPage"
CAPTCHA_ACTION_SIGN_IN = "login"

# --- HTTP ---

NO_SYSTEM_PROXY = {"http": None, "https": None}
REQUEST_PROXIES = {
    "http": f"http://{PROXY}",
    "https": f"http://{PROXY}",
}
SOLVER_PROXY = REQUEST_PROXIES["http"]

# DisPurCaptcha must not use the Ticketmaster proxy from the environment
_solver_http = requests.Session()
_solver_http.trust_env = False
_solver_http.proxies.update(NO_SYSTEM_PROXY)


def _mask_secret(value: str, visible: int = 8) -> str:
    if len(value) <= visible + 4:
        return "***"
    return f"{value[:visible]}...{value[-4:]}"


def _mask_proxy(proxy: str) -> str:
    if "@" in proxy:
        return f"***@{proxy.split('@', 1)[1]}"
    return proxy


def _fingerprint_from_header(header: dict) -> tuple[str, dict]:
    """Map DisPurCaptcha response header to Ticketmaster request headers."""
    return header["userAgent"], {
        "sec_ch_ua": header["secChUa"],
        "sec_ch_ua_platform": header["secChUaPlatform"],
        "sec_ch_ua_mobile": header["secChUaMobile"],
        "accept_lang": header["acceptLang"],
    }


def _solve_captcha(site_key: str, action: str, *, enterprise: bool) -> tuple[str, str, dict]:
    """Request a reCAPTCHA token from DisPurCaptcha; returns token, UA, and fingerprint."""
    payload = {
        "websiteUrl": AUTH_WEBSITE_URL,
        "recaptchaSitekey": site_key,
        "proxy": SOLVER_PROXY,
        "action": action,
        "isEnterprise": enterprise,
    }
    headers = {
        "Content-Type": "application/json",
        "X-API-Key": DISPURCAPTCHA_API_KEY,
    }

    last_error = None
    for attempt in range(CAPTCHA_MAX_RETRIES):
        response = _solver_http.post(
            DISPURCAPTCHA_API_URL,
            json=payload,
            headers=headers,
            verify=False,
            timeout=CAPTCHA_TIMEOUT_SEC,
        )
        if response.status_code in CAPTCHA_RETRY_STATUSES:
            last_error = f"HTTP {response.status_code}"
            if attempt < CAPTCHA_MAX_RETRIES - 1:
                time.sleep(2**attempt)
                continue
            response.raise_for_status()

        response.raise_for_status()
        body = response.json()
        if body.get("status") != "success":
            raise RuntimeError(f"DisPurCaptcha error: {body}")

        data = body["data"]
        ua, fp = _fingerprint_from_header(data["header"])
        logger.debug(f"captcha solved action={action} method={body.get('solveMethod')}")
        return data["gResponseToken"], ua, fp

    raise RuntimeError(f"DisPurCaptcha retries exhausted ({last_error})")


def _browser_headers(
    ua: str,
    fp: dict,
    *,
    referer: str | None = None,
    fetch_dest: str = "document",
    fetch_mode: str = "navigate",
) -> dict:
    headers = {
        "user-agent": ua,
        "accept": (
            "text/html,application/xhtml+xml,application/xml;q=0.9,"
            "image/avif,image/webp,image/apng,*/*;q=0.8"
        ),
        "accept-language": fp["accept_lang"],
        "sec-ch-ua": fp["sec_ch_ua"],
        "sec-ch-ua-mobile": fp["sec_ch_ua_mobile"],
        "sec-ch-ua-platform": fp["sec_ch_ua_platform"],
        "sec-fetch-dest": fetch_dest,
        "sec-fetch-mode": fetch_mode,
        "sec-fetch-site": "same-origin" if referer else "none",
        "sec-gpc": "1",
        "upgrade-insecure-requests": "1",
    }
    if referer:
        headers["referer"] = referer
    return headers


def _api_headers(ua: str, fp: dict, *, referer: str = OAUTH2_URL) -> dict:
    return {
        "user-agent": ua,
        "accept": "*/*",
        "accept-language": fp["accept_lang"],
        "content-type": "application/json",
        "origin": AUTH_ORIGIN,
        "referer": referer,
        "sec-ch-ua": fp["sec_ch_ua"],
        "sec-ch-ua-mobile": fp["sec_ch_ua_mobile"],
        "sec-ch-ua-platform": fp["sec_ch_ua_platform"],
        "sec-fetch-dest": "empty",
        "sec-fetch-mode": "cors",
        "sec-fetch-site": "same-origin",
        "sec-gpc": "1",
        "priority": "u=1, i",
        "tm-client-id": TM_CLIENT_ID,
        "tm-integrator-id": TM_INTEGRATOR_ID,
        "tm-oauth-type": "tm-auth",
        "tm-placement-id": TM_PLACEMENT_ID,
        "tm-site-token": TM_SITE_TOKEN,
    }


def _tm_session() -> requests.Session:
    session = requests.Session()
    session.verify = False
    return session


def _require_cookie(response: requests.Response, name: str) -> None:
    if not response.cookies.get_dict().get(name):
        raise RuntimeError(f"missing cookie: {name}")


def log_startup() -> None:
    logger.info("=== Ticketmaster login ===")
    logger.info(f"email: {TM_EMAIL}")
    logger.info(f"proxy: {_mask_proxy(PROXY)}")
    logger.info(f"dispurcaptcha: {_mask_secret(DISPURCAPTCHA_API_KEY)}")
    logger.info(f"website: {AUTH_WEBSITE_URL}")
    logger.info("starting login flow...")


def solve_login_page_captcha() -> tuple[str, str, dict]:
    token, ua, fp = _solve_captcha(
        LOGIN_PAGE_SITE_KEY,
        CAPTCHA_ACTION_LOGIN_PAGE,
        enterprise=True,
    )
    logger.info(f"LoginPage captcha ok — {token[:60]}...")
    return token, ua, fp


def solve_sign_in_captcha() -> tuple[str, str, dict]:
    token, ua, fp = _solve_captcha(
        SIGN_IN_SITE_KEY,
        CAPTCHA_ACTION_SIGN_IN,
        enterprise=False,
    )
    logger.info(f"sign-in captcha ok — {token[:60]}...")
    return token, ua, fp


def fetch_oauth2(session: requests.Session, ua: str, fp: dict, *, bootstrap: bool = False) -> None:
    """Load the OAuth2 page; bootstrap mode tolerates 401 before tmpt is set."""
    if bootstrap:
        headers = _browser_headers(ua, fp)
        headers["sec-fetch-user"] = "?1"
    else:
        headers = _browser_headers(ua, fp, referer=OAUTH2_URL)
        headers["cache-control"] = "max-age=0"

    response = session.get(OAUTH2_URL, headers=headers, proxies=REQUEST_PROXIES, verify=False)
    logger.info(f"oauth2 status={response.status_code}")

    if bootstrap:
        return
    if response.status_code in (401, 403):
        raise RuntimeError(f"LoginPage token rejected (oauth2 {response.status_code})")


def fetch_eps_sid(session: requests.Session, ua: str, fp: dict) -> None:
    headers = _browser_headers(
        ua,
        fp,
        referer=OAUTH2_URL,
        fetch_dest="script",
        fetch_mode="no-cors",
    )
    headers["accept"] = "*/*"
    response = session.get(EPS_MGR_URL, headers=headers, proxies=REQUEST_PROXIES, verify=False)
    _require_cookie(response, "eps_sid")
    logger.info("eps_sid cookie ok")


def post_tmpt(session: requests.Session, login_page_token: str, ua: str, fp: dict) -> None:
    headers = _browser_headers(
        ua,
        fp,
        referer=OAUTH2_URL,
        fetch_dest="empty",
        fetch_mode="cors",
    )
    headers["accept"] = "*/*"
    headers["content-type"] = "application/json"
    headers["origin"] = AUTH_ORIGIN
    response = session.post(
        TMPT_URL,
        headers=headers,
        json={
            "hostname": "auth.ticketmaster.com",
            "key": LOGIN_PAGE_SITE_KEY,
            "token": login_page_token,
        },
        proxies=REQUEST_PROXIES,
        verify=False,
    )
    _require_cookie(response, "tmpt")
    logger.info("tmpt cookie ok")


def post_sign_in(session: requests.Session, recaptcha_token: str, ua: str, fp: dict) -> str:
    """Returns outcome: success, fail, or error."""
    response = session.post(
        SIGN_IN_URL,
        headers=_api_headers(ua, fp),
        json={
            "email": TM_EMAIL,
            "password": TM_PASSWORD,
            "recaptchaToken": recaptcha_token,
            "externalUserToken": None,
        },
        proxies=REQUEST_PROXIES,
        verify=False,
    )
    text = response.text
    if "The account is locked" in text:
        logger.error(f"account locked: {text}")
        return "error"
    if response.status_code in (401, 403):
        logger.error(f"sign-in failed ({response.status_code}): {text}")
        return "fail"
    if response.status_code == 200:
        logger.success(f"sign-in ok: {text}")
        return "success"
    logger.error(f"unexpected response ({response.status_code}): {text}")
    return "error"


def run_login() -> str:
    session = _tm_session()

    login_page_token, ua, fp = solve_login_page_captcha()
    fetch_oauth2(session, ua, fp, bootstrap=True)
    fetch_eps_sid(session, ua, fp)
    post_tmpt(session, login_page_token, ua, fp)
    fetch_oauth2(session, ua, fp)

    sign_in_token, ua, fp = solve_sign_in_captcha()
    return post_sign_in(session, sign_in_token, ua, fp)


def main() -> None:
    log_startup()
    try:
        result = run_login()
        logger.info(f"=== done — result: {result} ===")
    except Exception as exc:
        logger.exception(f"=== done — error: {exc} ===")
        raise


if __name__ == "__main__":
    main()
