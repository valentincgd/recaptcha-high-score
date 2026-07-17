import requests
API="http://127.0.0.1:3848/api/captcha/tmpt"
PROXY="http://kyzenpro:0637fd1ce4a6b5f3_country-France_session-4m67xOzg@proxy.packetstream.io:31112"
AUTH_URL="https://auth.ticketmaster.com/as/authorization.oauth2?client_id=8bf7204a7e97.web.ticketmaster.us&response_type=code&scope=openid%20profile%20phone%20email%20tm&redirect_uri=https%3A%2F%2Fidentity.ticketmaster.com%2Fexchange&visualPresets=tm&lang=en-us&placementId=mytmlogin"
for action in ["login","LoginPage"]:
    p={"websiteUrl":AUTH_URL,"recaptchaSitekey":"6LdoaXQrAAAAADQviABd-eByJu6kPL8awKDyc1zb","action":action,"warm":False,"proxy":PROXY}
    r=requests.post(API,json=p,timeout=180)
    print("action=%-10s HTTP %d  %s"%(action, r.status_code, r.text[:200]))
