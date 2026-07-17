import test_tmpt as T
login = [t for t in T.TARGETS if t["name"]=="login"][0]
print("proxy:", T.PROXY_URL[:60], "...")
name, idx, ok, status, tmpt, info = T.run(login, 1)
print("RESULT  ok=%s  HTTP=%s  tmpt=%s"%(ok, status, tmpt))
print("info:", info)
