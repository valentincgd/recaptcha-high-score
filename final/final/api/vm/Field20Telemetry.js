/**
 * Field20Telemetry — génère le champ 20 (télémétrie perf) DYNAMIQUEMENT à chaque appel,
 * comme un vrai navigateur (valeurs perf différentes à chaque token).
 *
 * Format réel (décodé de captures) : valeur stockée = base64(JSON).slice(2), où
 *   JSON = [null,null,
 *            [null,null,null,
 *              [longTaskType, longTaskMs, cpuMs, tickCount],   // perf : varie à chaque run
 *              [0,null,0], 0, 1, 0],
 *            ["www.gstatic.com", pageHost],                    // hôtes des scripts
 *            [1, scriptCount]]                                 // ~317 (quasi-constant)
 *
 * Observé sur 4 captures démo : longTaskType∈{6,8}, longTaskMs≈4.9–5.7, cpuMs≈0.27–0.30,
 * tickCount∈{13,14,15}, scriptCount=317 (constant). Les floats ont une longue mantisse
 * (sommes de performance.now() divisées) — on reproduit ce style.
 */

function rint(min, max) { return min + Math.floor(Math.random() * (max - min + 1)); }
function rfloat(min, max) { return min + Math.random() * (max - min); }

/** Un float "perf" au style navigateur : mantisse longue (division non ronde). */
function perfFloat(min, max) {
  // simule une somme de deltas / n → longue queue décimale
  const v = rfloat(min, max);
  const n = rint(2, 4);
  return (v * n) / n; // garde ~15-17 chiffres significatifs comme les vraies valeurs
}

export class Field20Telemetry {
  /**
   * @param {object} o
   * @param {string} o.pageHost   host de la page (ex "recaptcha-demo.appspot.com" / "www.ticketmaster.com")
   * @param {string} [o.scriptHost="www.gstatic.com"]  hôte du script recaptcha
   * @param {number} [o.scriptCount=317]  compteur de scripts (arr[4][1], quasi-constant)
   * @returns {string} valeur du champ 20 (base64(JSON).slice(2))
   */
  static build({ pageHost, scriptHost = "www.gstatic.com", scriptCount = 317, heavy = false, firstSignal = null, enterprise = false, signin = false } = {}) {
    // PROFIL SIGN-IN (auth.ticketmaster.com, capture genuine du navigateur) :
    //  [0]=null [1]=null
    //  [2]=[null,null,null,[longType~7,longMs~40-55,cpu~0.05,ticks~280-340],[type2~78,ms2~0.17,cpu2~0.002,ticks2~2],0,0,1]
    //  [3]=[pageHost,"aa.s.tmol.io","www.googletagmanager.com","www.google.com","www.gstatic.com"]  (5 hôtes)
    //  [4]=[0, resourceCount~600]
    if (signin) {
      const json = [
        null,
        null,
        [
          null, null, null,
          [rint(5, 9), perfFloat(40, 55), perfFloat(0.04, 0.08), rint(280, 340)],
          [rint(60, 90), perfFloat(0.1, 0.25), perfFloat(0.0015, 0.004), rint(2, 4)],
          0, 0, 1,
        ],
        [pageHost, "aa.s.tmol.io", "www.googletagmanager.com", "www.google.com", "www.gstatic.com"],
        [0, rint(560, 640)],
      ];
      return Buffer.from(JSON.stringify(json), "utf8").toString("base64").slice(2);
    }
    // PROFIL ENTERPRISE (www.ticketmaster.com Event, capture réelle du navigateur) — structure RICHE :
    //  [0] = 3 nav-timings [[3,x,y],[1,x,y],[2,x,y]]
    //  [1] = liste de resource-timings [[2,id,ms],...] (page lourde → plusieurs)
    //  [2] = [null,null,null,[perfType~42,longMs~11,cpuMs~0.77,ticks~169],[0,null,0],0,0,3]
    //  [3] = [pageHost,"www.google.com","www.gstatic.com"]  (3 domaines, cet ordre)
    //  [4] = [9, resourceCount~580]
    if (enterprise) {
      // Aligné BYTE-EXACT sur le 1er reload AUTO du navigateur (contexte du tmpt), 3 captures propres
      // genuine (_gen_auto, www Event) → len ~282-302. Ce qui est STABLE vs ce qui VARIE :
      //  [0] = 2 nav-timings  [[3,X0,Y0],[1,X1,Y1]]   (types 3/1 stables ; X/Y varient)
      //        X0∈~100-115 Y0∈~290-355 ; X1∈~160-205 Y1∈~460-550
      //  [1] = 2 resource-timings [[2,Xr0,Yr0],[2,Xr1,Yr1]]  (type 2 stable)
      //        Xr0∈~105-122 Yr0∈~230-255 ; Xr1∈~82-93 Yr1∈~860-985
      //  [2] = [null,null,null, A, B, 0,0,T]
      //        A = [7, ms~3.6-4.1, cpu~0.51-0.55, 10]   ← type=7 et ticks=10 CONSTANTS (3/3)
      //        B = [0,null,0]                            ← SPARSE CONSTANT (l'ancien profil le populait = tell)
      //        T = trailing ∈ {3,4}                      ← (l'ancien mettait 0 = tell)
      //  [3] = [pageHost,"www.google.com","www.gstatic.com"]  (ordre stable)
      //  [4] = [K, 594]   ← K∈{1,2} varie, 594 CONSTANT  (l'ancien [6,~594] = tell)
      // Les valeurs restent DYNAMIQUES (perf différentes à chaque token) → octets variables comme le genuine.
      const navs = [
        [3, rint(100, 116), rint(288, 356)],
        [1, rint(158, 206), rint(458, 552)],
      ];
      const res = [
        [2, rint(104, 122), perfFloat(228, 256)],
        [2, rint(82, 94), perfFloat(858, 988)],
      ];
      const json = [
        navs,
        res,
        [null, null, null, [7, perfFloat(3.6, 4.1), perfFloat(0.50, 0.55), 10], [0, null, 0], 0, 0, rint(3, 4)],
        [pageHost, "www.google.com", "www.gstatic.com"],
        [rint(1, 2), 594],
      ];
      return Buffer.from(JSON.stringify(json), "utf8").toString("base64").slice(2);
    }
    // Deux profils de télémétrie observés :
    //  - DÉMO (page légère) : [0]=null, perf faible (type 6-8, ms 4.8-5.8, cpu 0.27-0.30, ticks 13-15), [4]=[1,317].
    //  - TM/heavy (page lourde, www.ticketmaster.com) : [0]=[[1,92,40]] CONSTANT, perf ÉLEVÉE
    //    (type 7-10, ms 6.1-9.2, cpu 0.27-0.40, ticks 19-47), [4]=[rint(1,6),317]. (3 captures genuine).
    // Calibrer sur la cible : un field20 "démo" envoyé à TM est un tell (perf trop basse, [0] manquant).
    let head, longTaskType, longTaskMs, cpuMs, tickCount, tail0;
    if (heavy) {
      // TM standard (jsdom qui PASSE) : head=[[1,92,40]] MAIS perf BASSE + tail0=1 (vérifié 2 runs jsdom
      // frais : type=6, ms≈5.4, cpu≈0.28, ticks=16-17, [K,317] K=1). L'ancien profil "heavy" (type 7-10,
      // ticks 19-47, tail0 rint(1,6)) était un TELL (perf 2× trop haute, K faux).
      head = firstSignal || [[1, 92, 40]];
      longTaskType = 6;
      longTaskMs = perfFloat(5.3, 5.6);
      cpuMs = perfFloat(0.25, 0.33);
      tickCount = rint(16, 17);
      tail0 = 1;
    } else {
      head = firstSignal; // null en démo
      longTaskType = rint(6, 8);
      longTaskMs = perfFloat(4.8, 5.8);
      cpuMs = perfFloat(0.27, 0.30);
      tickCount = rint(13, 15);
      tail0 = 1;
    }

    const json = [
      head,
      null,
      [
        null,
        null,
        null,
        [longTaskType, longTaskMs, cpuMs, tickCount],
        [0, null, 0],
        0,
        1,
        0,
      ],
      [scriptHost, pageHost],
      [tail0, scriptCount],
    ];

    const b64 = Buffer.from(JSON.stringify(json), "utf8").toString("base64");
    return b64.slice(2); // le client stocke base64(JSON).slice(2)
  }
}
