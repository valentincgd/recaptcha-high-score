import requests
API="http://127.0.0.1:3848/api/captcha/tmpt"
PROXY="http://kyzenpro:0637fd1ce4a6b5f3_country-France_session-4m67xOzg@proxy.packetstream.io:31112"
AUTH_URL="https://auth.ticketmaster.com/as/authorization.oauth2?client_id=8bf7204a7e97.web.ticketmaster.us&response_type=code&scope=openid%20profile%20phone%20email%20tm&redirect_uri=https%3A%2F%2Fidentity.ticketmaster.com%2Fexchange&visualPresets=tm&lang=en-us&placementId=mytmlogin&hideLeftPanel=false&integratorId=prd1741.iccp&intSiteToken=tm-us&disableAutoOptIn=false"
# 1) mint token+tmpt+eps_sid (action=login, key 6Ldo)
p={"websiteUrl":AUTH_URL,"recaptchaSitekey":"6LdoaXQrAAAAADQviABd-eByJu6kPL8awKDyc1zb","action":"login","warm":False,"proxy":PROXY}
r=requests.post(API,json=p,timeout=180); r.raise_for_status(); d=r.json()["data"]
print("mint OK  tmpt=%s...  eps_sid=%s  token_len=%d  mode=%s"%(d["tmpt"][:18], (d.get("eps_sid") or "?")[:10], len(d.get("token") or ""), d.get("mode")))
# 2) POST login
ck="tmpt=%s"%d["tmpt"]
if d.get("eps_sid"): ck+="; eps_sid=%s"%d["eps_sid"]
ck+="; BID=IL3vCtvF2fqdns4mMwsSgQ_vgr1lQmC716nPG246Jk0bTfZznvnkRK4vwnbRUBczuD1PSdtzm4pdBhvm; ma.LANGUAGE=en-us"
H={"accept":"*/*","accept-language":d.get("accept_lang","en-us"),"content-type":"application/json","origin":"https://auth.ticketmaster.com","referer":AUTH_URL,"sec-ch-ua":d.get("sec_ch_ua",""),"sec-ch-ua-mobile":"?0","sec-ch-ua-platform":'"Windows"',"sec-fetch-dest":"empty","sec-fetch-mode":"cors","sec-fetch-site":"same-origin","tm-client-id":"8bf7204a7e97.web.ticketmaster.us","tm-integrator-id":"prd1741.iccp","tm-oauth-type":"tm-auth","tm-placement-id":"mytmlogin","tm-site-token":"tm-us","user-agent":d.get("user_agent",""),"cookie":ck}
body={"email":"valentincgdpro@gmail.com","password":"SteV@l1417!!!!!","recaptchaToken":d["token"],"externalUserToken":None}
lr=requests.post("https://auth.ticketmaster.com/json/sign-in",headers=H,json=body,proxies={"http":PROXY,"https":PROXY},timeout=90,allow_redirects=False)
print("LOGIN HTTP %d"%lr.status_code)
print("body:", lr.text[:300].replace("\n"," "))
