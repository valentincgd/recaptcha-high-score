package main

import (
	_ "embed"
	"encoding/base64"
	"encoding/json"
	"testing"
)

//go:embed testdata/hf_vector.json
var hfVectorRaw []byte

// TestCipherByteExact : le vecteur ground-truth (plain + clé + token RÉELS capturés dans un vrai
// navigateur/jsdom) doit être reproduit BYTE-À-BYTE par cipherHF (encodeURIComponent + triple XOR
// + base64url). C'est la preuve que le pipeline Go == le script reCAPTCHA.
func TestCipherByteExact(t *testing.T) {
	var v struct {
		Key   string `json:"key"`
		Plain string `json:"plain"`
		Token string `json:"token"`
	}
	if err := json.Unmarshal(hfVectorRaw, &v); err != nil {
		t.Fatalf("vecteur illisible: %v", err)
	}
	// seed = 3 premiers octets du corps base64url du token réel
	body, err := base64.RawURLEncoding.DecodeString(v.Token[2:])
	if err != nil {
		t.Fatalf("decode token: %v", err)
	}
	seed := [3]byte{body[0], body[1], body[2]}

	got := cipherHF(v.Plain, v.Key, seed)
	if got != v.Token {
		n := 0
		for n < len(got) && n < len(v.Token) && got[n] == v.Token[n] {
			n++
		}
		t.Fatalf("cipher NON byte-exact (1er écart à %d)", n)
	}
}

// TestJSONMatchesBrowser : marshalJSLike(E) doit reproduire EXACTEMENT la string JSON du navigateur
// (JSON.stringify) — sinon le plaintext chiffré diffère.
func TestJSONMatchesBrowser(t *testing.T) {
	var v struct {
		Plain string `json:"plain"`
	}
	if err := json.Unmarshal(hfVectorRaw, &v); err != nil {
		t.Fatal(err)
	}
	var arr []any
	if err := json.Unmarshal([]byte(v.Plain), &arr); err != nil {
		t.Fatalf("plain n'est pas du JSON: %v", err)
	}
	got, err := marshalJSLike(arr)
	if err != nil {
		t.Fatal(err)
	}
	if got != v.Plain {
		t.Fatalf("JSON re-sérialisé ≠ navigateur")
	}
}
