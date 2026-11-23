# Reverse proxy examples

One configuration for each reverse proxy, complete: the certificate, plain http sent on to https, a sign-in, WebSocket connections, and what Peekaboo works the address out from. Each puts Volumio's page at `https://music.example.com`, with the player at `192.168.1.50` and Peekaboo on its port, `3080`.

| Reverse proxy | Example | Run with |
| --- | --- | --- |
| nginx | [nginx/peekaboo.conf](nginx/peekaboo.conf) | nginx 1.31.9 |
| OpenResty | the nginx example, unchanged | OpenResty 1.31.9.1 |
| Angie | the nginx example, unchanged | Angie 1.12.5 |
| Nginx Proxy Manager | [nginx-proxy-manager/README.md](nginx-proxy-manager/README.md), the fields of its pages | Nginx Proxy Manager 2.17.1 |
| Caddy | [caddy/Caddyfile](caddy/Caddyfile) | Caddy 2.11.9 |
| Apache httpd | [apache/peekaboo.conf](apache/peekaboo.conf) | httpd 2.4.71 |
| Traefik | [traefik/traefik.yml](traefik/traefik.yml) and [traefik/dynamic.yml](traefik/dynamic.yml) | Traefik 3.7.19 |
| HAProxy | [haproxy/haproxy.cfg](haproxy/haproxy.cfg) | HAProxy 3.4.8 |
| Envoy | [envoy/envoy.yaml](envoy/envoy.yaml) | Envoy 1.40.2 |
| lighttpd | [lighttpd/peekaboo.conf](lighttpd/peekaboo.conf) | lighttpd 1.4.85 |

## Using one

1. Put your own in place of `music.example.com`, of `192.168.1.50`, and of `3080` where the plugin's port was changed.
2. Give it the certificate and make the sign-in, as the first lines of the example say. The name `music` is an example too.
3. On the plugin's page, put the proxy's address under *Proxy addresses*. Peekaboo's port then takes connections from the proxy and refuses every other address.
4. Open `https://music.example.com`. Where the page opens and finds no player, the plugin's page says what the last page that asked was told, and by way of which address.

The page needs a host name of its own: it cannot be served under a path.

## The sign-in

Volumio has no sign-in, so each example asks for one before it forwards anything: a name and a password, the sign-in every reverse proxy has. It stands in front of everything, WebSocket connections included, and the password stops at the proxy: none of the examples passes it on to the player.

A single sign-on service in front of the proxy does the same work where one is at hand. None has been run with these examples.

One thing shows in the browser's console behind such a sign-in: the browser asks for the page's web app manifest without the name and password, and is refused. The page is not affected.

## What was run

Each example was run as it is written here, with four things put in: a name for `music.example.com`, the player's address, a certificate, and a password. Caddy's had its `tls` line switched on, since it cannot fetch a certificate for a test name. Nginx Proxy Manager was set up through its API, with the fields its pages have.

The player was a Raspberry Pi 5 with Volumio 4.245 and Peekaboo 0.1.0; the browser Chrome 158, kept from the player's own addresses as a browser on another network is. For every proxy in the table:

- without the sign-in a request is refused, and so is a WebSocket connection; with a wrong password also;
- plain http is sent on to https, the path and the query kept;
- signed in, a request reaches the player as it was sent, with the host name the browser asked for and without the password;
- Peekaboo answers `GET /api/host` with `https://` and that name;
- the page, signed in to once, finds its player: its socket connected through the proxy over a WebSocket, the player's state back over it, the cover loaded, and nothing asked of the player's own address.

HAProxy and lighttpd carry the WebSocket over HTTP/2, the others over HTTP/1.1.

Not run: a certificate fetched by the proxy itself (Caddy, Traefik, Nginx Proxy Manager), other browsers, and other versions than those in the table.

## Other reverse proxies

What any of them has to do is in the [README](../README.md#what-the-reverse-proxy-has-to-do): forward everything for a host name to Peekaboo's port, pass WebSocket connections on, and pass on the host name the browser asked for. For one that cannot do the last, the plugin's *Public address* setting gives the answer in its place.

Reverse proxies set up through pages of their own other than Nginx Proxy Manager, and tunnels that publish a player without a proxy of yours, have not been run.
