import sys, requests
import test_tmpt as T
TMPT_API="http://127.0.0.1:3848/api/captcha/tmpt"
TOKEN_API="http://127.0.0.1:3848/api/captcha/token"
AUTH_URL=T.AUTH_URL
def mint_tmpt():
    r=requests.post(TMPT_API,json={"websiteUrl":AUTH_URL,"recaptchaSitekey":T.TM_AUTH_KEY,"action":"LoginPage","warm":False,"proxy":T.PROXY_URL},timeout=180); r.raise_for_status(); return r.json()["data"]
def mint_token(action, ent):
    r=requests.post(TOKEN_API,json={"url":AUTH_URL,"sitekey":T.TM_AUTH_KEY,"action":action,"isEnterprise":ent,"proxy":T.PROXY_URL},timeout=180)
    b=r.json()
    if b.get("status")!="success": return None, b.get("error")
    return b["data"]["token"], None
def do_login(d, token):
    ck="tmpt=%s"%d["tmpt"]
    if d.get("eps_sid"): ck+="; eps_sid=%s"%d["eps_sid"]
    ck+="; "+T.LOGIN_SESSION_COOKIES
    H={"accept":"*/*","accept-language":"en-us","content-type":"application/json","origin":"https://auth.ticketmaster.com","referer":AUTH_URL,"sec-ch-ua":d.get("sec_ch_ua",""),"sec-ch-ua-mobile":"?0","sec-ch-ua-platform":'"Windows"',"sec-fetch-dest":"empty","sec-fetch-mode":"cors","sec-fetch-site":"same-origin","tm-client-id":"8bf7204a7e97.web.ticketmaster.us","tm-integrator-id":"prd1741.iccp","tm-oauth-type":"tm-auth","tm-placement-id":"mytmlogin","tm-site-token":"tm-us","user-agent":d.get("user_agent",""),"cookie":ck}
    body={"email":T.LOGIN_EMAIL,"password":T.LOGIN_PASSWORD,"recaptchaToken":token,"externalUserToken":None}
    lr=requests.post("https://auth.ticketmaster.com/json/sign-in",headers=H,json=body,proxies=T.proxies(),timeout=90,allow_redirects=False)
    return lr.status_code, lr.text[:160].replace("\n"," ")

mode = sys.argv[1] if len(sys.argv)>1 else "ent"
ent = (mode=="ent")
d=mint_tmpt()
tok,err=mint_token("login", ent)
if not tok: print("token KO:", err); sys.exit()
print("token(login, enterprise=%s) len=%d prefix=%s"%(ent, len(tok), tok[:12]))
st, body = do_login(d, tok)
print("LOGIN HTTP %d  %s"%(st, body))
