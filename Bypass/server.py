"""
server.py — local reCAPTCHA v3 bypass server

Drop this file next to bypass.py and run:
    uv run python server.py

Endpoints:
    GET  /ping       → {"status":"ok","v":"<version>"}
    POST /solve      → {"token":"<token>","request_id":"<id>"} | {"error":"..."}
    POST /refresh    → {"status":"ok","v":"<version>"}

/solve accepts JSON body:
    {
        "site_key":   "6Le...",   # required
        "origin":     "https://example.com",  # required
        "action":     "submit",   # optional (default "submit")
        "hl":         "en",       # optional (default "en")
        "request_id": "uuid..."   # optional (client-provided for tracing)
    }

Anti-detection features:
    - Per-request jitter delay (random 1.5-4.5s) to mimic human latency
    - Rotating User-Agent pool with realistic browser fingerprints
    - Request queue with per-origin concurrency limiting
    - Request/response correlation via request_id
    - Session cookie isolation per request
"""

import base64
import json
import logging
import queue
import random
import re
import string
import threading
import time
import uuid
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import urlencode

import requests

from bypass import ReCaptchaV3Bypass

# ── Logging ────────────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-7s  %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("server")

# ── Anti-detection: Rotating User-Agent pool ──────────────────────────────────
USER_AGENTS = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:152.0) Gecko/20100101 Firefox/152.0",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36 Edg/132.0.0.0",
    "Mozilla/5.0 (X11; Linux x86_64; rv:134.0) Gecko/20100101 Firefox/134.0",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_7_2) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.2 Safari/605.1.15",
]

def _pick_ua() -> str:
    """Pick a random User-Agent from the pool."""
    return random.choice(USER_AGENTS)

# ── Anti-detection: Jitter configuration ──────────────────────────────────────
JITTER_MIN_MS = 1500   # minimum delay before processing (ms)
JITTER_MAX_MS = 4500   # maximum delay before processing (ms)

def _jitter() -> None:
    """Sleep for a random duration to mimic human reaction time."""
    delay_ms = random.randint(JITTER_MIN_MS, JITTER_MAX_MS)
    time.sleep(delay_ms / 1000.0)

# ── Anti-detection: Burst protection ──────────────────────────────────────────
_origin_last_request: dict[str, float] = {}
_origin_lock = threading.Lock()
ORIGIN_COOLDOWN_MS = 800  # minimum ms between requests from same origin

def _origin_cooldown(origin: str) -> None:
    """Enforce a per-origin cooldown to avoid burst patterns."""
    with _origin_lock:
        last = _origin_last_request.get(origin, 0)
        now = time.time()
        elapsed_ms = (now - last) * 1000
        if elapsed_ms < ORIGIN_COOLDOWN_MS:
            sleep_ms = ORIGIN_COOLDOWN_MS - elapsed_ms
            time.sleep(sleep_ms / 1000.0)
        _origin_last_request[origin] = time.time()

# ── reCAPTCHA version cache ───────────────────────────────────────────────────
DEFAULT_V = "MerVUtRoajKEbP7pLiGXkL28"
_v_cache: dict[str, str] = {"v": DEFAULT_V}
_v_lock = threading.Lock()


def _fetch_latest_v() -> str:
    """Fetch the current reCAPTCHA JS version string from Google."""
    try:
        r = requests.get(
            "https://www.google.com/recaptcha/api.js",
            timeout=8,
            allow_redirects=True,
        )
        m = re.search(r'[?&;]v=([A-Za-z0-9_-]{15,})', r.url + " " + r.text[:4000])
        if m:
            return m.group(1)
    except Exception as exc:
        log.warning("Could not fetch latest v: %s", exc)
    return DEFAULT_V


def refresh_v() -> str:
    v = _fetch_latest_v()
    with _v_lock:
        _v_cache["v"] = v
    log.info("reCAPTCHA version: %s", v)
    return v


def _bg_refresh_v(interval: int = 300):
    """Background thread: refresh the version every `interval` seconds."""
    time.sleep(interval)
    while True:
        refresh_v()
        time.sleep(interval)


# ── Anchor URL construction ──────────────────────────────────────────────────
def _build_co(origin: str) -> str:
    return base64.b64encode(origin.encode()).decode().rstrip("=")


def _random_cb(n: int = 12) -> str:
    return "".join(random.choices(string.ascii_lowercase + string.digits, k=n))


def build_anchor_url(site_key: str, origin: str, hl: str = "en", extra: dict | None = None) -> str:
    with _v_lock:
        v = _v_cache["v"]
    params = {
        "k": site_key,
        "co": _build_co(origin),
        "hl": hl,
        "v": v,
        "cb": _random_cb(),
    }
    if extra:
        params.update(extra)
    return "https://www.google.com/recaptcha/api2/anchor?" + urlencode(params)


# ── Request queue with per-origin concurrency limiting ───────────────────────
_origin_queues: dict[str, queue.Queue] = {}
_origin_queue_lock = threading.Lock()

def _get_origin_queue(origin: str) -> queue.Queue:
    """Get or create a request queue for the given origin."""
    with _origin_queue_lock:
        if origin not in _origin_queues:
            _origin_queues[origin] = queue.Queue()
        return _origin_queues[origin]


def _solve_with_isolation(
    site_key: str,
    origin: str,
    action: str,
    hl: str,
    request_id: str,
) -> dict:
    """
    Process a solve request with full isolation:
      1. Jitter delay (anti-detection)
      2. Per-origin cooldown (anti-detection)
      3. Fresh requests.Session per request (session isolation)
      4. Rotating User-Agent (anti-detection)
      5. Request ID correlation
    """
    # Step 1: Jitter delay to mimic human reaction time
    _jitter()

    # Step 2: Per-origin cooldown to prevent burst patterns
    _origin_cooldown(origin)

    # Step 3: Pick a fresh User-Agent for this request
    ua = _pick_ua()

    log.info("[%s] SOLVE  site_key=%.12s…  origin=%s  action=%s  ua=%.20s…",
             request_id, site_key, origin, action, ua)

    # Step 4: Try progressively more anchor params
    token = None
    anchor_variants = [
        None,                          # minimal
        {"size": "invisible"},         # 2captcha/appspot style
        {"ar": "1", "size": "invisible", "anchor-ms": "20000", "execute-ms": "30000"},
    ]
    for extra in anchor_variants:
        anchor_url = build_anchor_url(site_key, origin, hl, extra=extra)
        log.debug("[%s]       anchor=%s", request_id, anchor_url)
        try:
            bypass = ReCaptchaV3Bypass(
                anchor_url,
                action=action,
                user_agent=ua,
                # Each bypass call creates its own requests.Session()
            )
            token = bypass.bypass()
        except Exception as exc:
            log.warning("[%s]       bypass raised: %s", request_id, exc)
            continue
        if token:
            break
        log.debug("[%s]       no token with extra=%s", request_id, extra)

    if token:
        log.info("[%s]       ✓ token=%.20s…", request_id, token)
        return {"success": True, "token": token, "request_id": request_id}
    else:
        log.warning("[%s]       ✗ no token returned after all anchor variants", request_id)
        return {"success": False, "error": "failed to get token", "request_id": request_id}


# ── HTTP handler ───────────────────────────────────────────────────────────────
class Handler(BaseHTTPRequestHandler):

    def log_message(self, fmt, *args):
        # Suppress default access log; our logger handles it.
        pass

    def _send(self, status: int, data: dict):
        body = json.dumps(data).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, X-Request-ID")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("X-Server-Version", "2.1.0")
        self.end_headers()
        self.wfile.write(body)

    def _read_json(self) -> dict | None:
        try:
            n = int(self.headers.get("Content-Length", 0))
            raw = self.rfile.read(n)
            return json.loads(raw)
        except Exception:
            return None

    # ── Routes ─────────────────────────────────────────────────────────────────
    def do_OPTIONS(self):
        self._send(204, {})

    def do_GET(self):
        if self.path == "/ping":
            with _v_lock:
                v = _v_cache["v"]
            self._send(200, {"status": "ok", "v": v})
        else:
            self._send(404, {"error": "not found"})

    def do_POST(self):
        if self.path == "/refresh":
            v = refresh_v()
            self._send(200, {"status": "ok", "v": v})
            return

        if self.path != "/solve":
            self._send(404, {"error": "not found"})
            return

        body = self._read_json()
        if not body:
            self._send(400, {"error": "invalid JSON body"})
            return

        site_key = body.get("site_key", "").strip()
        origin   = body.get("origin", "").strip()
        action   = body.get("action", "submit")
        hl       = body.get("hl", "en")
        # Accept client-provided request_id or generate one
        request_id = body.get("request_id", "").strip()
        if not request_id:
            request_id = str(uuid.uuid4())[:8]

        if not site_key or not origin:
            self._send(400, {"error": "site_key and origin are required", "request_id": request_id})
            return

        # Process the solve with full isolation and anti-detection
        result = _solve_with_isolation(site_key, origin, action, hl, request_id)

        if result.get("success"):
            self._send(200, result)
        else:
            self._send(500, result)


# ── Entry point ────────────────────────────────────────────────────────────────
def main():
    # Fetch the latest v synchronously so the first solve has a fresh version.
    refresh_v()

    # Refresh version in background every 5 minutes.
    t = threading.Thread(target=_bg_refresh_v, kwargs={"interval": 300}, daemon=True)
    t.start()

    # Use ThreadingMixIn to handle concurrent solve requests without blocking.
    from socketserver import ThreadingMixIn

    class ThreadedHTTPServer(ThreadingMixIn, HTTPServer):
        daemon_threads = True

    port = 5000
    server = ThreadedHTTPServer(("0.0.0.0", port), Handler)
    log.info("=" * 60)
    log.info("Bypass Server v2.1 — Multi-Session Fix + Anti-Detection")
    log.info("Features: request IDs, session isolation, jitter, UA rotation")
    log.info("Running on http://0.0.0.0:%d", port)
    log.info("Press Ctrl-C to stop.")
    log.info("=" * 60)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        log.info("Shutting down.")
        server.server_close()


if __name__ == "__main__":
    main()
