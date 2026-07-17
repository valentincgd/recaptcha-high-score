/**
 * Extrait URL, cookies et referer d'un "Copy as cURL" (reload ou anchor).
 */
export class CurlCaptureParser {
  static parse(raw) {
    const url =
      raw.match(/curl\s+'([^']+)'/)?.[1] ??
      raw.match(/curl\s+"([^"]+)"/)?.[1] ??
      raw.match(/curl\s+(\S+)/)?.[1] ??
      null;

    const cookie =
      raw.match(/(?:^|\n)\s*-b\s+'([^']+)'/)?.[1] ??
      raw.match(/(?:^|\n)\s*-b\s+"([^"]+)"/)?.[1] ??
      raw.match(/(?:^|\n)\s*--cookie\s+'([^']+)'/)?.[1] ??
      null;

    const referer =
      raw.match(/(?:^|\n)\s*-H\s+'referer:\s*([^']+)'/i)?.[1] ??
      raw.match(/(?:^|\n)\s*-H\s+"referer:\s*([^"]+)"/i)?.[1] ??
      null;

    let mode = null;
    if (url?.includes("/recaptcha/enterprise/")) mode = "enterprise";
    if (url?.includes("/recaptcha/api2/")) mode = "api2";

    return { url, cookie, referer, mode };
  }
}
