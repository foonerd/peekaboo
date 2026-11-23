# Nginx Proxy Manager

Volumio's page at `https://music.example.com`, by way of Peekaboo on the player at `192.168.1.50`, behind a sign-in. Nginx Proxy Manager has no file to edit: these are the fields of its pages, named as version 2.17.1 names them.

## The certificate

Under *SSL Certificates*, the certificate for `music.example.com`: one the manager fetches, or a *Custom Certificate* from files of your own.

## The sign-in

Under *Access Lists*, a list with a name and a password in it.

| Field | |
| --- | --- |
| Satisfy Any | off |
| Pass Auth to Upstream | off: the password stops at the proxy, the player has no use for it |

## The proxy host

Under *Proxy Hosts*, one host.

| Field | |
| --- | --- |
| Domain Names | `music.example.com` |
| Scheme | `http` |
| Forward Hostname / IP | `192.168.1.50` |
| Forward Port | `3080` |
| Websockets Support | on |
| Access List | the list made above |
| SSL Certificate | the certificate above |
| Force SSL | on: plain http is sent on to https |

*Block Common Exploits*, *Cache Assets*, *HTTP/2 Support* and *HSTS Enabled* were off where this was run.
