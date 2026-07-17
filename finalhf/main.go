// Command genhf — génère le token de REPLI reCAPTCHA v3 « HF… » en PUR GO, sans navigateur,
// sans jsdom, sans VM. Module autonome (stdlib uniquement).
//
// Le token « HF… » est celui que le script reCAPTCHA produit CÔTÉ CLIENT quand le POST /reload
// échoue. Reversé/vérifié bit-à-bit (cf. gen_hf.js à la racine du repo) :
//
//	HF = "HF" + base64url( seed[3] ++ ( encodeURIComponent(JSON.stringify(E)) XOR key XOR seed ) )
//	  key  = la site-key (bytes)
//	  seed = 3 lettres minuscules aléatoires, préfixées au chiffré (self-describing → toute valeur marche)
//	  E    = tableau JSON de 13 signaux d'erreur, TOUS dérivables (aucune VM, aucun champ 16) :
//	         [ "fetoken", now_ms, "Error: reCAPTCHA XhrError", pageURL, version, 0,
//	           anchorToken, 20000, 30000, null, action, co(origin:443), userAgent ]
//	  anchorToken = GET /anchor → id="recaptcha-token".
//
// ⚠️ RECHERCHE / ÉDUCATIF. Ce token ENCODE l'erreur « reload a échoué » : structurellement
// valide/parseable mais il SCORE comme un échec côté serveur. Utile pour tests/replay.
//
// Usage :
//
//	go run .                                         # défauts Ticketmaster (action Event)
//	go run . -sitekey <k> -action <a> -page <url> [-json]
//	RECAPTCHA_PROXY=http://user:pass@host:port go run .
package main

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"math/big"
	"net/http"
	"net/url"
	"os"
	"regexp"
	"strings"
	"time"
)

const (
	defaultUA      = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36"
	defaultSecChUa = `"Not;A=Brand";v="8", "Chromium";v="150", "Google Chrome";v="150"`
	defaultSiteKey = "6LcvL3UrAAAAAO_9u8Seiuf-I6F_tP_jSS-zndXV"
	defaultAction  = "Event"
	defaultPage    = "https://www.ticketmaster.com/event/020064BAD9B8236F"
)

var (
	reVersion = regexp.MustCompile(`releases/([A-Za-z0-9_-]{8,})/recaptcha__([a-z]{2})\.js`)
	reAPIBase = regexp.MustCompile(`__recaptcha_api['"]\]=['"]([^'"]+)['"]`)
	reToken   = regexp.MustCompile(`(?i)id\s*=\s*["']recaptcha-token["'][^>]*value\s*=\s*["']([^"']+)["']`)
	reTokenFB = regexp.MustCompile(`(03[c]?AFcWeA[A-Za-z0-9_-]{80,})`)
)

// HFResult regroupe le token + le contexte (pour --json / debug).
type HFResult struct {
	Token       string `json:"token"`
	AnchorToken string `json:"anchorToken"`
	Version     string `json:"version"`
	PlainLen    int    `json:"plainLen"`
	E           []any  `json:"E"`
	AnchorURL   string `json:"anchorURL"`
}

func main() {
	var (
		siteKey = flag.String("sitekey", envOr("RECAPTCHA_SITEKEY", defaultSiteKey), "site-key reCAPTCHA")
		action  = flag.String("action", envOr("RECAPTCHA_ACTION", defaultAction), "action reCAPTCHA")
		page    = flag.String("page", envOr("RECAPTCHA_PAGEURL", defaultPage), "URL de la page (origin → co)")
		ua      = flag.String("ua", envOr("RECAPTCHA_UA", defaultUA), "User-Agent")
		jsonOut = flag.Bool("json", false, "sortie JSON détaillée")
	)
	flag.Parse()

	res, err := generateHF(*siteKey, *action, *page, *ua)
	if err != nil {
		fmt.Fprintln(os.Stderr, "✖ "+err.Error())
		os.Exit(2)
	}
	if *jsonOut {
		abbrev := make([]any, len(res.E))
		copy(abbrev, res.E)
		for i, v := range abbrev {
			if s, ok := v.(string); ok && len(s) > 40 {
				abbrev[i] = s[:40] + fmt.Sprintf("…(%d)", len(s))
			}
		}
		res.E = abbrev
		b, _ := json.MarshalIndent(res, "", "  ")
		fmt.Println(string(b))
	} else {
		fmt.Println(res.Token)
	}
}

func generateHF(siteKey, action, pageURL, ua string) (HFResult, error) {
	client := newHTTPClient()
	origin, referer := pageOriginReferer(pageURL)
	co := encodeCoDot(origin + ":443")

	// 1. bootstrap : version + APIBase
	version, apiBase, err := bootstrap(client, siteKey, ua)
	if err != nil {
		return HFResult{}, fmt.Errorf("bootstrap: %w", err)
	}

	// 2. GET /anchor → anchor token (la clé de chiffrement n'est PAS nécessaire au HF)
	anchorToken, anchorURL, err := fetchAnchorToken(client, apiBase, siteKey, co, version, referer, ua)
	if err != nil {
		return HFResult{}, fmt.Errorf("anchor: %w", err)
	}

	// 3. tableau E (ordre EXACT observé au dump)
	E := []any{
		"fetoken",
		time.Now().UnixMilli(),
		"Error: reCAPTCHA XhrError",
		pageURL,
		version,
		0,
		anchorToken,
		20000,
		30000,
		nil,
		action,
		co,
		ua,
	}
	plain, err := marshalJSLike(E)
	if err != nil {
		return HFResult{}, err
	}

	// 4. cipher + préfixe
	token := cipherHF(plain, siteKey, randSeed())
	return HFResult{
		Token: token, AnchorToken: anchorToken, Version: version,
		PlainLen: len(plain), E: E, AnchorURL: anchorURL,
	}, nil
}

// ----- réseau ---------------------------------------------------------------

func newHTTPClient() *http.Client {
	tr := &http.Transport{
		ForceAttemptHTTP2:   true,
		MaxIdleConns:        50,
		IdleConnTimeout:     90 * time.Second,
		TLSHandshakeTimeout: 15 * time.Second,
	}
	if p := envOr("RECAPTCHA_PROXY", os.Getenv("HTTPS_PROXY")); p != "" {
		if u, err := url.Parse(p); err == nil {
			tr.Proxy = http.ProxyURL(u)
		}
	}
	return &http.Client{Transport: tr, Timeout: 45 * time.Second}
}

func bootstrap(client *http.Client, siteKey, ua string) (version, apiBase string, err error) {
	urls := []string{
		"https://www.google.com/recaptcha/enterprise.js?render=" + url.QueryEscape(siteKey),
		"https://www.google.com/recaptcha/api.js?render=" + url.QueryEscape(siteKey),
	}
	apiBase = "https://www.google.com/recaptcha/enterprise/"
	var lastErr error
	for _, u := range urls {
		body, _, e := httpGet(client, u, http.Header{
			"Accept":          {"*/*"},
			"Accept-Language": {"fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7"},
			"Referer":         {"https://www.google.com/"},
			"Sec-Ch-Ua":       {defaultSecChUa},
			"Sec-Fetch-Dest":  {"script"},
			"Sec-Fetch-Mode":  {"no-cors"},
			"Sec-Fetch-Site":  {"cross-site"},
			"User-Agent":      {ua},
		})
		if e != nil {
			lastErr = e
			continue
		}
		if m := reAPIBase.FindStringSubmatch(body); len(m) > 1 {
			apiBase = m[1]
		}
		if m := reVersion.FindStringSubmatch(body); len(m) > 1 {
			return m[1], apiBase, nil
		}
	}
	if lastErr != nil {
		return "", "", lastErr
	}
	return "", "", fmt.Errorf("version introuvable")
}

func fetchAnchorToken(client *http.Client, apiBase, siteKey, co, version, referer, ua string) (token, anchorURL string, err error) {
	anchorURL = fmt.Sprintf("%sanchor?ar=1&k=%s&co=%s&hl=fr&v=%s&size=invisible&anchor-ms=20000&execute-ms=30000&cb=%s",
		apiBase, url.QueryEscape(siteKey), co, url.QueryEscape(version), callback())
	body, status, err := httpGet(client, anchorURL, http.Header{
		"Accept":                    {"text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8"},
		"Accept-Language":           {"fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7"},
		"Referer":                   {referer},
		"Sec-Ch-Ua":                 {defaultSecChUa},
		"Sec-Ch-Ua-Mobile":          {"?0"},
		"Sec-Ch-Ua-Platform":        {`"Windows"`},
		"Sec-Fetch-Dest":            {"iframe"},
		"Sec-Fetch-Mode":            {"navigate"},
		"Sec-Fetch-Site":            {"cross-site"},
		"Upgrade-Insecure-Requests": {"1"},
		"User-Agent":                {ua},
	})
	if err != nil {
		return "", anchorURL, err
	}
	if m := reToken.FindStringSubmatch(body); len(m) > 1 {
		return strings.TrimSpace(m[1]), anchorURL, nil
	}
	if m := reTokenFB.FindStringSubmatch(body); len(m) > 1 {
		return m[1], anchorURL, nil
	}
	hint := ""
	if strings.Contains(body, "Invalid domain for site key") {
		hint = " (domaine refusé pour cette site-key — ajuster -page/origin)"
	}
	return "", anchorURL, fmt.Errorf("recaptcha-token introuvable (HTTP %d, %d octets)%s", status, len(body), hint)
}

func httpGet(client *http.Client, u string, h http.Header) (string, int, error) {
	req, err := http.NewRequestWithContext(context.Background(), http.MethodGet, u, nil)
	if err != nil {
		return "", 0, err
	}
	req.Header = h
	resp, err := client.Do(req)
	if err != nil {
		return "", 0, err
	}
	defer resp.Body.Close()
	b, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", resp.StatusCode, err
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return string(b), resp.StatusCode, fmt.Errorf("HTTP %d", resp.StatusCode)
	}
	return string(b), resp.StatusCode, nil
}

// ----- primitives cipher ----------------------------------------------------

// cipherHF : fn_H_3 = triple XOR par caractère (clé cyclée + seed 3 octets cyclé), préfixe « HF ».
func cipherHF(plain, key string, seed [3]byte) string {
	eu := []byte(encodeURIComponent(plain))
	out := make([]byte, 3+len(eu))
	out[0], out[1], out[2] = seed[0], seed[1], seed[2]
	kb := []byte(key)
	for f := 0; f < len(eu); f++ {
		out[3+f] = eu[f] ^ kb[f%len(kb)] ^ seed[f%3]
	}
	return "HF" + base64.RawURLEncoding.EncodeToString(out)
}

func randSeed() [3]byte {
	const az = "abcdefghijklmnopqrstuvwxyz"
	var s [3]byte
	for i := range s {
		n, _ := rand.Int(rand.Reader, big.NewInt(26))
		s[i] = az[n.Int64()]
	}
	return s
}

// encodeURIComponent : identique à la fonction JS (jeu non-réservé A-Za-z0-9 - _ . ! ~ * ' ( )),
// encodage octet-par-octet de l'UTF-8, hex MAJUSCULE.
func encodeURIComponent(s string) string {
	const upperhex = "0123456789ABCDEF"
	var b strings.Builder
	b.Grow(len(s))
	for i := 0; i < len(s); i++ {
		c := s[i]
		if (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') ||
			strings.IndexByte("-_.!~*'()", c) >= 0 {
			b.WriteByte(c)
		} else {
			b.WriteByte('%')
			b.WriteByte(upperhex[c>>4])
			b.WriteByte(upperhex[c&0x0f])
		}
	}
	return b.String()
}

// marshalJSLike : JSON.stringify(array) — pas d'échappement HTML (Go échappe <>& par défaut, pas JS).
func marshalJSLike(v any) (string, error) {
	var buf bytes.Buffer
	enc := json.NewEncoder(&buf)
	enc.SetEscapeHTML(false)
	if err := enc.Encode(v); err != nil {
		return "", err
	}
	return strings.TrimRight(buf.String(), "\n"), nil
}

// encodeCoDot : co façon reCAPTCHA — base64 puis +→- /→_ =→.
func encodeCoDot(origin string) string {
	s := base64.StdEncoding.EncodeToString([]byte(origin))
	s = strings.ReplaceAll(s, "+", "-")
	s = strings.ReplaceAll(s, "/", "_")
	s = strings.ReplaceAll(s, "=", ".")
	return s
}

func pageOriginReferer(pageURL string) (origin, referer string) {
	u, err := url.Parse(pageURL)
	if err != nil || u.Host == "" {
		return "https://www.ticketmaster.com", "https://www.ticketmaster.com/"
	}
	origin = u.Scheme + "://" + u.Host
	referer = pageURL
	if u.Path == "" && !strings.HasSuffix(referer, "/") {
		referer += "/"
	}
	return origin, referer
}

func callback() string {
	const chars = "0123456789abcdefghijklmnopqrstuvwxyz"
	b := make([]byte, 12)
	for i := range b {
		n, _ := rand.Int(rand.Reader, big.NewInt(int64(len(chars))))
		b[i] = chars[n.Int64()]
	}
	return string(b)
}

func envOr(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}
