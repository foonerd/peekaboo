# Changelog

All notable changes to Peekaboo are recorded here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-11-23

The first release.

- **A port of its own for a reverse proxy.** What comes in by it goes to Volumio as it is, WebSocket connections included, and Volumio's page opened through the proxy, over https or from another network, finds its player.
- **The page's question, answered with the address the browser came in by.** `GET /api/host` and `GET /app/local-config.json` are answered from the page's own address, from what the proxy says (`X-Forwarded-Proto`, `X-Forwarded-Host`, `X-Forwarded-Port`, `Forwarded`) or from the `Host` header.
- **Nothing of Volumio's is changed.** No file and no port of Volumio's is touched, and the page opened at the player's own address works as before.
- **Three settings**: the port, `3080` at first; a public address, for a proxy that passes on no host name; and the addresses the proxy may come from, every other being refused.
- **A settings page that says what the port is doing**: where to have the proxy forward to, and what the last page that asked was told.
- The settings page is in English, German, Spanish, French, Italian, Japanese, Dutch, Polish, Portuguese, Russian and Chinese.
