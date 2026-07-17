/**
 * Champ 25 — compteurs d'événements (préfixe W1tb + base64).
 */
export class EventCounterBuilder {
  static #DEFAULT = [
    [5006, 1879],
    [64607, 6],
    [35837, 5],
    [45464, 5],
    [31617, 29],
    [37178, 29],
  ];

  static build(counts = EventCounterBuilder.#DEFAULT) {
    const json = JSON.stringify(counts);
    const b64 = Buffer.from(json, "utf8").toString("base64");
    return `W1tb${b64.slice(4)}`;
  }

  /** Champ 25 format plat TM — base64 de `[[hash,count],…]`. */
  static buildFlat(counts) {
    const payload = counts ?? EventCounterBuilder.#DEFAULT;
    return Buffer.from(JSON.stringify(payload), "utf8").toString("base64");
  }
}
