# Peekaboo

A Volumio 4 plugin with one job: Volumio's page works through a reverse proxy.

Without it, the page opened through a reverse proxy, over https or from another network, loads and then stays grey behind a spinner. The page asks the player where it is, is given an address of the player's own network, and from then on talks to that address alone: one the browser cannot reach from elsewhere, and may not talk to from an https page.

Peekaboo opens a second port for the reverse proxy to forward to. What comes in by it goes to Volumio as it is. Only the page's question is answered differently: with the address the browser came in by, so the page keeps talking through the proxy.

It changes no file of Volumio's, and the page opened the usual way, at the player's own address, works as before.

## Before anything else: a sign-in

Volumio has no sign-in. Whoever reaches its page controls the player, can read the files on it and can install plugins on it. On a home network that is how Volumio is used. Through a reverse proxy it means the proxy decides who gets in:

- have the proxy ask for a sign-in before it forwards anything, its own or a single sign-on service in front of it, or keep it reachable over a VPN only;
- never forward Peekaboo's port, or Volumio's own, to the internet as they are;
- name the proxy's address under *Proxy addresses* on the plugin's page, and every other address is refused on Peekaboo's port.

Peekaboo brings neither a sign-in nor https. It makes the page work behind a proxy that brings both.

## What the reverse proxy has to do

- Forward everything for a host name of its own to Peekaboo's port on the player, `3080` unless changed. The page is served from the root of a host: `https://music.example.com/`, not `https://example.com/volumio/`.
- Pass WebSocket connections on. Without them the page still works, by polling.
- Pass on the host name the browser asked for, as the `Host` header or as `X-Forwarded-Host`. Most proxies do one or the other by themselves; for one that does neither there is the *Public address* setting.

nginx, with the player at `192.168.1.50`:

```nginx
map $http_upgrade $connection_upgrade {
    default upgrade;
    ''      close;
}

server {
    listen 443 ssl;
    server_name music.example.com;
    # the certificate, and the sign-in

    location / {
        proxy_pass http://192.168.1.50:3080;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
        client_max_body_size 0;
    }
}
```

Caddy, which passes on what is needed by itself:

```
music.example.com {
    # the sign-in
    reverse_proxy 192.168.1.50:3080
}
```

Complete configurations, each with its certificate, its sign-in and plain http sent on to https, are in [examples/](examples/): nginx, Nginx Proxy Manager, Caddy, Apache httpd, Traefik, HAProxy, Envoy and lighttpd.

## What it does

Peekaboo listens on a port of its own, beside Volumio's. Everything that comes in by it is handed to Volumio on the player as it came, and Volumio's answer is handed back as it is, WebSocket connections included. Two requests it answers itself:

| Request | Volumio's answer | Peekaboo's answer |
| --- | --- | --- |
| `GET /api/host` | the player's addresses on its own network | the address the browser came in by |
| `GET /app/local-config.json` | `http://127.0.0.1:3000` | the address the browser came in by |

The page asks the first when it starts and the second where the first fails, which over https it always does, and then talks to the address it was given. With Peekaboo's answer that is the reverse proxy, for the page's socket, for the covers and for everything else.

The address is worked out for each request, from the first of these that applies:

1. the *Public address* of the settings page, where one is given;
2. the address of the page that asked, which the browser sends as `Origin` or `Referer`, where it names the host the request was for;
3. what the proxy says: `X-Forwarded-Proto`, `X-Forwarded-Host` and `X-Forwarded-Port`, or `Forwarded`;
4. the `Host` header, over http.

The second is what makes a proxy work that leaves out the scheme or the port: the browser knows both.

## What it has been tried with

One Raspberry Pi 5 with Volumio 4.245 and its Manifest interface; Chrome 158 kept from the player's own addresses, as a browser on another network is. The page counts as working when its socket is connected through the proxy, the player's state comes back over it, the cover loads, and nothing is asked of the player's own address.

| Reverse proxy | Page opened at | |
| --- | --- | --- |
| nginx 1.31, forwarding straight to Volumio, no Peekaboo | `https://name/` | grey behind a spinner |
| nginx 1.31, as above | `https://name/` | works, over a WebSocket |
| nginx 1.31, the port left out of `Host` | `https://name:8443/` | works, over a WebSocket |
| nginx 1.31, no TLS | `http://name/` | works, over a WebSocket |
| Caddy 2.11, as above | `https://name/` | works, over a WebSocket |
| nginx 1.31 with `proxy_pass` and nothing else | `https://name/` | finds no player |
| the same, with the *Public address* set | `https://name/` | works, by polling |

The configurations in [examples/](examples/) were each run the same way behind their sign-in, with nginx 1.31, OpenResty 1.31, Angie 1.12, Nginx Proxy Manager 2.17, Caddy 2.11, Apache httpd 2.4, Traefik 3.7, HAProxy 3.4, Envoy 1.40 and lighttpd 1.4: the page works over a WebSocket through each, and nothing gets past the sign-in without the name and password.

With the way from the proxy back to the browser slowed, the page found its player at round trips of up to 450 ms, in about twelve seconds at that, and not at 500 ms or more.

Other browsers, Volumio's Classic and Contemporary interfaces, and signing in to MyVolumio through a proxy have not been tried.

## What it does not do

- It asks nobody to sign in and it does not speak https. Both are the proxy's.
- It does not serve the page under a path. The page needs a host name of its own.
- Over plain http it wants the proxy on port 80: the page asks its first question there, whatever port it was opened on. Over https any port does.
- It does not make a slow path quick. Volumio's page gives its socket half a second to connect, so where a round trip between the browser and the proxy takes that long or longer, the page finds no player.

## Installing

Copy a release's zip to the player, unpack it into a folder of its own and run `volumio plugin install` there. Switch the plugin on under Plugins, Installed Plugins. No restart is needed.

## The settings page

The page says what the port is doing: that it is listening, where to have the proxy forward to, and what the last page that asked was told and by way of which address. That last line is the place to look when a page opens through the proxy and finds no player.

| Setting | |
| --- | --- |
| Port | The port the reverse proxy forwards to, `3080` at first: a number from 1024 to 65535. The new port is open before the old one closes; a port that cannot be had is said and nothing changes. |
| Public address | Empty, the address is worked out for each request as above. Filled in, as `https://music.example.com`, it is the answer to every request. It is for a proxy that passes on neither `Host` nor `X-Forwarded-Host`. |
| Proxy addresses | The addresses the proxy connects from: single addresses or networks, as `192.168.1.5, 192.168.1.0/24`. Every other address is refused. Empty lets every address in, as Volumio's own port does. |

## Switching it off, and uninstalling

Switching the plugin off closes the port and ends the connections through it. Peekaboo puts nothing outside its own folder, so uninstalling leaves nothing behind.

## What is where

    peekaboo/          the plugin: its listener, its Volumio side, its settings page
    examples/          a reverse proxy's configuration for each of ten, as run
    test/              the plugin's tests
    scripts/           check, package, release notes

## Building

    scripts/check.sh     shell lint, the plugin's files and languages, the examples, the tests
    scripts/package.sh   the plugin's zip, into dist/

Node 20 is used where it is installed and the `node:20-slim` container where it is not.

## Releases

The version is the one in `peekaboo/package.json`; `CHANGELOG.md` has a section for it and the `changelog` line of `package.json` starts with it.

    git tag v0.1.0 && git push origin v0.1.0

The tag runs the check, packages the plugin and publishes the zip with its SHA-256 as a pre-release, with that version's section of the changelog as the notes. It becomes the latest release once it has been tried on a player:

    gh release edit v0.1.0 --prerelease=false --latest

The release workflow can also be run by hand; it then builds everything and publishes nothing.

## Support this project

Peekaboo is free and open source, designed, built and maintained by one developer in his own time. If it has earned a place on your player, you can support its development:

- GitHub Sponsors: https://github.com/sponsors/foonerd
- Ko-fi: https://ko-fi.com/justanerd

## Licence

MIT.
