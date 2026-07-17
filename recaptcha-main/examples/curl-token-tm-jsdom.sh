#!/usr/bin/env bash
# Token Ticketmaster via JSDOM (dynamic) — pas de Playwright.
# Prérequis : npm start

curl -sS -X POST "http://127.0.0.1:3847/api/token/tm" \
  -H "Content-Type: application/json" \
  -d '{
    "siteKey": "6LdoaXQrAAAAADQviABd-eByJu6kPL8awKDyc1zb",
    "enterprise": false,
    "action": "login"
  }'
