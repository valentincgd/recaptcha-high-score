export class EnterpriseBootstrapParser {
  static parse(js) {
    const apiMatch = js.match(/__recaptcha_api']='([^']+)'/);
    const releaseMatch = js.match(
      /recaptcha\/releases\/([^/]+)\/recaptcha__([a-z]{2})\.js/,
    );
    const renderMatch =
      js.match(/cfg\[['"]render['"]\][^;]*\.push\('([^']+)'\)/) ||
      js.match(/\[['"]render['"]\][^;]*\.push\('([^']+)'\)/);
    const keyFromQuery = js.match(/render=([A-Za-z0-9_-]+)/);

    return {
      apiBase:
        apiMatch?.[1] ??
        "https://www.google.com/recaptcha/api2/",
      mode: apiMatch?.[1]?.includes("/api2/")
        ? "api2"
        : apiMatch?.[1]?.includes("/enterprise/")
          ? "enterprise"
          : "unknown",
      version: releaseMatch?.[1] ?? null,
      locale: releaseMatch?.[2] ?? "en",
      scriptUrl: releaseMatch
        ? `https://www.gstatic.com/recaptcha/releases/${releaseMatch[1]}/recaptcha__${releaseMatch[2]}.js`
        : null,
      siteKey: renderMatch?.[1] ?? keyFromQuery?.[1] ?? null,
    };
  }
}
