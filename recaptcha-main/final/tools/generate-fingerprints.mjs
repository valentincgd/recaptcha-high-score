#!/usr/bin/env node
/**
 * Génère un catalogue massif de fingerprints (UA récents uniquement).
 *
 *   node tools/generate-fingerprints.mjs
 *   node tools/generate-fingerprints.mjs --count 600 --min-chrome 145
 */

import { writeFileSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_GO = join(ROOT, "go/internal/fingerprint/data/fingerprints.json");
const OUT_NODE = join(ROOT, "fingerprints.json");

const args = process.argv.slice(2);
const TARGET = args.includes("--count") ? Number(args[args.indexOf("--count") + 1]) : 520;
const minChrome = args.includes("--min-chrome") ? Number(args[args.indexOf("--min-chrome") + 1]) : 145;
const NO_SEED = args.includes("--no-seed");
const PRETTY = args.includes("--pretty");

const CHROME = [145, 146, 147, 148, 149].filter((v) => v >= minChrome);
const FIREFOX = [135, 136, 137, 138];
const NOT_A_BRAND = ["99", "24", "8"];

const LANGS = [
  "fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7",
  "en-US,en;q=0.9",
  "en-GB,en;q=0.9,en-US;q=0.8",
  "de-DE,de;q=0.9,en-US;q=0.8,en;q=0.7",
  "es-ES,es;q=0.9,en;q=0.8",
  "it-IT,it;q=0.9,en-US;q=0.8,en;q=0.7",
  "pt-BR,pt;q=0.9,en;q=0.8",
  "pt-PT,pt;q=0.9,en;q=0.8",
  "nl-NL,nl;q=0.9,en;q=0.8",
  "pl-PL,pl;q=0.9,en;q=0.8",
  "sv-SE,sv;q=0.9,en;q=0.8",
  "da-DK,da;q=0.9,en;q=0.8",
  "nb-NO,nb;q=0.9,en;q=0.8",
  "fi-FI,fi;q=0.9,en;q=0.8",
  "cs-CZ,cs;q=0.9,en;q=0.8",
  "hu-HU,hu;q=0.9,en;q=0.8",
  "ro-RO,ro;q=0.9,en;q=0.8",
  "tr-TR,tr;q=0.9,en;q=0.8",
  "ru-RU,ru;q=0.9,en;q=0.8",
  "ja-JP,ja;q=0.9,en;q=0.8",
  "ko-KR,ko;q=0.9,en;q=0.8",
  "zh-CN,zh;q=0.9,en;q=0.8",
  "ar-SA,ar;q=0.9,en;q=0.8",
  "th-TH,th;q=0.9,en;q=0.8",
  "vi-VN,vi;q=0.9,en;q=0.8",
  "id-ID,id;q=0.9,en;q=0.8",
  "fr-CA,fr;q=0.9,en-CA;q=0.8",
  "en-CA,en;q=0.9,fr;q=0.8",
  "en-AU,en;q=0.9",
  "es-MX,es;q=0.9,en;q=0.8",
];

const DESKTOP_RES = [
  [1920, 1080, 1], [2560, 1440, 1], [1366, 768, 1], [1536, 864, 1.25],
  [1440, 900, 1], [1680, 1050, 1], [1600, 900, 1], [1920, 1200, 1],
  [3440, 1440, 1], [1280, 720, 1],
];
const MAC_RES = [[1440, 900, 2], [1512, 982, 2], [1728, 1117, 2], [2560, 1440, 2]];
const MOB_RES = [[390, 844, 3], [393, 852, 2.75], [412, 915, 2.625], [384, 824, 3], [414, 896, 3]];

const GPUS_WIN = [
  ["Google Inc. (NVIDIA)", "ANGLE (NVIDIA, NVIDIA GeForce RTX 4070 Direct3D11 vs_5_0 ps_5_0, D3D11)", 46],
  ["Google Inc. (NVIDIA)", "ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)", 45],
  ["Google Inc. (Intel)", "ANGLE (Intel, Intel(R) Iris(R) Xe Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)", 41],
  ["Google Inc. (AMD)", "ANGLE (AMD, AMD Radeon RX 6700 XT Direct3D11 vs_5_0 ps_5_0, D3D11)", 44],
];

const ANDROID = [
  ["14", "SM-S928B"], ["14", "Pixel 8"], ["13", "Pixel 7"], ["14", "CPH2449"], ["10", "K"],
];

function secCh(v, browser = "Google Chrome", nb = "99") {
  const b = browser === "Microsoft Edge" ? "Microsoft Edge" : browser;
  return `"Chromium";v="${v}", "${b}";v="${v}", "Not/A)Brand";v="${nb}"`;
}

function fastId(parts) {
  let h = 2166136261;
  const s = parts.join("|");
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

function mk(p) {
  return {
    id: p.id,
    userAgent: p.ua,
    acceptLang: p.lang,
    secChUa: p.sec,
    secChUaMobile: p.mobile,
    secChUaPlatform: p.plat,
    platform: p.platform,
    width: p.w,
    height: p.h,
    devicePixelRatio: p.dpr,
    webgl: { vendor: p.gv, renderer: p.gr, extensionCount: p.ge },
  };
}

function isRecentUA(ua) {
  const c = ua.match(/Chrome\/(\d+)/);
  if (c && Number(c[1]) < minChrome) return false;
  const f = ua.match(/Firefox\/(\d+)/);
  if (f && Number(f[1]) < 130) return false;
  const cr = ua.match(/CriOS\/(\d+)/);
  if (cr && Number(cr[1]) < minChrome) return false;
  return true;
}

function buildCatalog() {
  const seen = new Set();
  const out = [];

  const add = (p) => {
    const key = `${p.userAgent}\0${p.width}\0${p.height}\0${p.acceptLang}\0${p.secChUa}`;
    if (seen.has(key)) return false;
    seen.add(key);
    out.push(p);
    return true;
  };

  if (!NO_SEED) {
    try {
      const seed = JSON.parse(readFileSync(OUT_GO, "utf8")).profiles;
      for (const p of seed) {
        if (isRecentUA(p.userAgent)) add(p);
      }
    } catch {
      /* ignore */
    }
  }

  const factories = [];
  const reg = (fn) => factories.push(fn);

  // Gros volume : résolutions quasi-uniques par index
  reg((n) => {
    const v = CHROME[n % CHROME.length];
    const build = 1000 + ((n * 37) % 8000);
    const w = 1100 + ((n * 73) % 2600);
    const h = 640 + ((n * 47) % 1600);
    const dpr = [1, 1.1, 1.25, 1.5, 2][n % 5];
    const lang = LANGS[n % LANGS.length];
    const gpu = GPUS_WIN[(n + 2) % GPUS_WIN.length];
    const nb = NOT_A_BRAND[(n + 1) % NOT_A_BRAND.length];
    return mk({
      id: `gen_chrome_dense_${v}_${n}`,
      ua: `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${v}.0.${build}.0 Safari/537.36`,
      lang,
      sec: secCh(String(v), "Google Chrome", nb),
      mobile: "?0",
      plat: '"Windows"',
      platform: "Win32",
      w, h, dpr,
      gv: gpu[0], gr: gpu[1], ge: gpu[2] + (n % 6),
    });
  });

  reg((n) => {
    const v = CHROME[n % CHROME.length];
    const [w, h, dpr] = DESKTOP_RES[(n * 3) % DESKTOP_RES.length];
    const lang = LANGS[(n * 7) % LANGS.length];
    const gpu = GPUS_WIN[n % GPUS_WIN.length];
    const nb = NOT_A_BRAND[n % NOT_A_BRAND.length];
    return mk({
      id: `gen_chrome_win_${v}_${fastId([n, w, lang])}`,
      ua: `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${v}.0.0.0 Safari/537.36`,
      lang,
      sec: secCh(String(v), "Google Chrome", nb),
      mobile: "?0",
      plat: '"Windows"',
      platform: "Win32",
      w, h, dpr,
      gv: gpu[0], gr: gpu[1], ge: gpu[2] + (n % 4),
    });
  });

  reg((n) => {
    const v = CHROME[n % CHROME.length];
    const [w, h, dpr] = DESKTOP_RES[n % DESKTOP_RES.length];
    const lang = LANGS[n % LANGS.length];
    const gpu = GPUS_WIN[(n + 1) % GPUS_WIN.length];
    return mk({
      id: `gen_edge_${v}_${fastId([n, w])}`,
      ua: `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${v}.0.0.0 Safari/537.36 Edg/${v}.0.0.0`,
      lang,
      sec: secCh(String(v), "Microsoft Edge"),
      mobile: "?0",
      plat: '"Windows"',
      platform: "Win32",
      w, h, dpr,
      gv: gpu[0], gr: gpu[1], ge: 44,
    });
  });

  reg((n) => {
    const v = CHROME[n % CHROME.length];
    const [w, h, dpr] = MAC_RES[n % MAC_RES.length];
    const lang = LANGS[n % LANGS.length];
    return mk({
      id: `gen_chrome_mac_${v}_${fastId([n])}`,
      ua: `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${v}.0.0.0 Safari/537.36`,
      lang,
      sec: secCh(String(v)),
      mobile: "?0",
      plat: '"macOS"',
      platform: "MacIntel",
      w, h, dpr,
      gv: "Google Inc. (Apple)",
      gr: "ANGLE (Apple, Apple M3, OpenGL 4.1)",
      ge: 37,
    });
  });

  reg((n) => {
    const v = CHROME[n % CHROME.length];
    const [av, dev] = ANDROID[n % ANDROID.length];
    const [w, h, dpr] = MOB_RES[n % MOB_RES.length];
    const lang = LANGS[(n + 5) % LANGS.length];
    const ua =
      dev === "K"
        ? `Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${v}.0.0.0 Mobile Safari/537.36`
        : `Mozilla/5.0 (Linux; Android ${av}; ${dev}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${v}.0.0.0 Mobile Safari/537.36`;
    return mk({
      id: `gen_android_${v}_${fastId([dev, n])}`,
      ua,
      lang,
      sec: secCh(String(v)),
      mobile: "?1",
      plat: '"Android"',
      platform: "Linux armv81",
      w, h, dpr,
      gv: "Qualcomm",
      gr: "Adreno (TM) 740",
      ge: 29,
    });
  });

  reg((n) => {
    const v = CHROME[n % CHROME.length];
    const ios = ["17_5", "17_6", "18_0", "18_1", "18_2"][n % 5];
    const [w, h, dpr] = MOB_RES[n % MOB_RES.length];
    const lang = LANGS[n % LANGS.length];
    return mk({
      id: `gen_crios_${v}_${ios}_${n}`,
      ua: `Mozilla/5.0 (iPhone; CPU iPhone OS ${ios} like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/${v}.0.0.0 Mobile/15E148 Safari/604.1`,
      lang,
      sec: secCh(String(v)),
      mobile: "?1",
      plat: '"iOS"',
      platform: "iPhone",
      w, h, dpr,
      gv: "Apple Inc.",
      gr: "Apple GPU",
      ge: 24,
    });
  });

  reg((n) => {
    const v = FIREFOX[n % FIREFOX.length];
    const [w, h, dpr] = DESKTOP_RES[n % DESKTOP_RES.length];
    const lang = LANGS[n % LANGS.length];
    return mk({
      id: `gen_firefox_${v}_${n}`,
      ua: `Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:${v}.0) Gecko/20100101 Firefox/${v}.0`,
      lang,
      sec: `"Not)A;Brand";v="8", "Firefox";v="${v}", "Gecko";v="20100101"`,
      mobile: "?0",
      plat: '"Windows"',
      platform: "Win32",
      w, h, dpr,
      gv: GPUS_WIN[0][0],
      gr: GPUS_WIN[0][1],
      ge: 40,
    });
  });

  reg((n) => {
    const v = CHROME[n % CHROME.length];
    const [w, h, dpr] = DESKTOP_RES[n % DESKTOP_RES.length];
    const lang = LANGS[n % LANGS.length];
    return mk({
      id: `gen_linux_${v}_${n}`,
      ua: `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${v}.0.0.0 Safari/537.36`,
      lang,
      sec: secCh(String(v)),
      mobile: "?0",
      plat: '"Linux"',
      platform: "Linux x86_64",
      w, h, dpr,
      gv: "Intel",
      gr: "Mesa Intel(R) UHD Graphics 620 (KBL GT2)",
      ge: 35,
    });
  });

  // Brave / Opera / Vivaldi (Chromium récents)
  reg((n) => {
    const v = CHROME[n % CHROME.length];
    const brands = ["Brave", "Opera", "Vivaldi"];
    const brand = brands[n % brands.length];
    const [w, h, dpr] = DESKTOP_RES[(n + 2) % DESKTOP_RES.length];
    const lang = LANGS[(n + 3) % LANGS.length];
    return mk({
      id: `gen_${brand.toLowerCase()}_${v}_${n}`,
      ua: `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${v}.0.0.0 Safari/537.36`,
      lang,
      sec: secCh(String(v), brand),
      mobile: "?0",
      plat: '"Windows"',
      platform: "Win32",
      w, h, dpr,
      gv: GPUS_WIN[n % GPUS_WIN.length][0],
      gr: GPUS_WIN[n % GPUS_WIN.length][1],
      ge: 43,
    });
  });

  const factoryCount = factories.length;
  let n = 0;
  const maxAttempts = TARGET * 80;
  for (let attempts = 0; out.length < TARGET && attempts < maxAttempts; attempts++) {
    if (add(factories[attempts % factoryCount](n))) {
      /* compte uniquement les ajouts uniques */
    }
    n++;
  }

  return out.slice(0, TARGET);
}

const profiles = buildCatalog();
const doc = {
  version: 2,
  generatedAt: new Date().toISOString(),
  minChromeVersion: minChrome,
  profileCount: profiles.length,
  profiles,
};

const json = PRETTY ? JSON.stringify(doc, null, 2) : JSON.stringify(doc);
writeFileSync(OUT_GO, json, "utf8");
writeFileSync(OUT_NODE, json, "utf8");

console.log(`[fingerprints] ${profiles.length} profils (${(json.length / 1024).toFixed(0)} Ko${PRETTY ? " pretty" : " compact"})`);
console.log(`  ${OUT_GO}`);
console.log(`  ${OUT_NODE}`);
