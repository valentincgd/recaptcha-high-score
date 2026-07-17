const r = await fetch("https://auth.ticketmaster.com/", {
  headers: {
    "user-agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36",
    accept: "text/html,*/*",
    "accept-language": "fr-FR,fr;q=0.8",
  },
  redirect: "follow",
});
const html = await r.text();
console.log("status", r.status, "len", html.length);
const keys = [...new Set(html.match(/6L[a-zA-Z0-9_-]{30,}/g) ?? [])];
console.log("site keys", keys);
for (const pat of ["grecaptcha", "recaptcha", "execute(", "enterprise"]) {
  console.log(pat, (html.match(new RegExp(pat, "gi")) ?? []).length);
}
console.log("snippet", html.includes("6LdoaXQr") ? html.slice(html.indexOf("6LdoaXQr") - 80, html.indexOf("6LdoaXQr") + 120) : "no key");
