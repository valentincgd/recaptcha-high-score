'use strict';
/**
 * crack_dsc.js — reverse deriveSignalCode = encode(hashString(value, seed)).
 * hashString connu (Java hashCode 31*h+c, 32-bit). On brute-force seed + schéma d'encodage
 * contre les 36 paires (value→code) du README.
 */
const HC = '0123456789abcdefghijklmnopqrstuvwxyz';
const codeNum = (c) => HC.indexOf(c[0]) * 36 + HC.indexOf(c[1]); // a*36+b

// README recaptcha/README.md lignes 414-449
const PAIRS = [
  ['BUTTON,195a81c9', 'wg'], ['wgia1z9pwq', '21'], ['1', 'p1'], ['8cc68d83', 'ld'],
  ['https://nextcaptcha.com/demo', '9p'], ['4', 'op'], ['false', '1r'], ['7', 'qf'],
  ['jYAQSHAEAI', '1z'], ['', '80'], ['2', 'jk'], ['AAAAAAAAAA', '1z'],
  ['h3', '9p'], ['0,BUTTON,195a81c9', 'ia'], ['-1', '1u'], ['0', 'wq'],
  ['74,fbfbc5b3', '6z'], ['-1,-1', '1m'],
  ['sha384-TNm', '23'], ['GA1.1.354395113.1778502448', '1g'],
];

function hashString(str, seed) {
  let h = seed | 0;
  for (let i = 0; i < str.length; i++) { h = (Math.imul(31, h) + str.charCodeAt(i)) | 0; }
  return h;
}
const mod = (n, m) => ((n % m) + m) % m;

// schémas d'encodage candidats : h (32-bit) → nombre 0..1295
const ENCODINGS = {
  'mod1296':       h => mod(h, 1296),
  'u_mod1296':     h => (h >>> 0) % 1296,
  'abs_mod1296':   h => Math.abs(h) % 1296,
  'and0x7FF_?':    h => (h >>> 0) & 0x7FF,     // 0..2047 (peut dépasser, filtré)
  'lowbytes':      h => (h >>> 0) & 0xFFFF,
};

let best = null;
for (let seed = -5000; seed <= 5000; seed++) {
  for (const [ename, efn] of Object.entries(ENCODINGS)) {
    let ok = 0;
    for (const [val, code] of PAIRS) {
      const h = hashString(val, seed);
      if (efn(h) === codeNum(code)) ok++;
    }
    if (!best || ok > best.ok) best = { seed, ename, ok };
    if (ok === PAIRS.length) { console.log(`✅ TROUVÉ : seed=${seed}  encodage=${ename}  (${ok}/${PAIRS.length})`); }
  }
}
console.log(`meilleur : seed=${best.seed} ${best.ename} ${best.ok}/${PAIRS.length}`);

// Si mod1296 marche, montre a=floor(n/36), b=n%36 vs le code
if (best.ok === PAIRS.length) {
  console.log('\nvérif:');
  for (const [val, code] of PAIRS.slice(0, 8)) {
    const n = ENCODINGS[best.ename](hashString(val, best.seed));
    console.log(`  ${JSON.stringify(val).padEnd(20)} → n=${n} → ${HC[Math.floor(n / 36)]}${HC[n % 36]} (attendu ${code})`);
  }
}
