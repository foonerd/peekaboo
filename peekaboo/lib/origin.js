'use strict';

// The address a page is told the player is at.
//
// Volumio's page asks the player where it is and then talks to that address
// alone. Behind a reverse proxy the right answer is the address the browser
// has in its address bar, which the player cannot know by itself. This file
// works it out from a request, in this order:
//
//   1. the public address given on the settings page, when there is one;
//   2. the address of the page that asked (the Origin or Referer header),
//      when it names the same host the proxy says the request was for;
//   3. what the proxy says: X-Forwarded-Proto, X-Forwarded-Host and
//      X-Forwarded-Port, or Forwarded (RFC 7239);
//   4. the Host header, over http.
//
// The page's own address comes second because it is what the browser
// sees, and so carries the scheme and the port a proxy leaves out or gets
// wrong. It counts only for the host the request was for, so that a page
// of another site asking the same question is not told its own address.

var NAME = /^(\[[0-9A-Fa-f:.]+\]|[A-Za-z0-9._-]+)(?::(\d{1,5}))?$/;

// The first of a comma-separated list: with proxies in a chain, the one
// nearest the browser writes first.
function first(value) {
    if (Array.isArray(value)) value = value[0];
    if (typeof value !== 'string') return '';
    return value.split(',')[0].trim();
}

// A host with or without a port, as { name, port }, or null.
function hostOf(value) {
    var m = NAME.exec(String(value || '').trim());
    if (!m) return null;
    var port = m[2] === undefined ? null : Number(m[2]);
    if (port !== null && (port < 1 || port > 65535)) return null;
    return { name: m[1].toLowerCase().replace(/\.$/, ''), port: port };
}

function standardPort(scheme) {
    return scheme === 'https' ? 443 : 80;
}

function join(scheme, name, port) {
    return scheme + '://' + name + (port === null || port === standardPort(scheme) ? '' : ':' + port);
}

// An address written by a person or sent by a browser: http or https, a
// host, nothing after it but a slash. Returned as scheme://host[:port], or
// null where it is not one.
function address(value) {
    var text = String(value || '').trim();
    if (text === '' || text === 'null') return null;
    var url;
    try {
        url = new URL(text);
    } catch (e) {
        return null;
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    if (url.username || url.password || !url.hostname) return null;
    return url.protocol + '//' + url.host;
}

// The public address of the settings page: as address(), and it may not
// carry a path, a query or a fragment, since the page is served from the
// root of a host and nowhere else.
function configured(value) {
    var text = String(value || '').trim();
    var found = address(text);
    if (!found) return null;
    var url = new URL(text);
    if ((url.pathname !== '/' && url.pathname !== '') || url.search || url.hash) return null;
    return found;
}

// The first element of a Forwarded header, as its pairs.
function forwarded(value) {
    var pairs = {};
    first(value).split(';').forEach(function (part) {
        var at = part.indexOf('=');
        if (at < 1) return;
        var key = part.slice(0, at).trim().toLowerCase();
        var val = part.slice(at + 1).trim();
        if (val.charAt(0) === '"' && val.charAt(val.length - 1) === '"') val = val.slice(1, -1);
        pairs[key] = val;
    });
    return pairs;
}

// What the proxy says the request was: { scheme, host, said }, where said
// tells whether a proxy header named the host, or null where no header
// names a host at all.
function told(headers) {
    var fwd = forwarded(headers.forwarded);
    var scheme = first(headers['x-forwarded-proto']).toLowerCase() || String(fwd.proto || '').toLowerCase();
    if (scheme !== 'http' && scheme !== 'https') {
        scheme = first(headers['x-forwarded-ssl']).toLowerCase() === 'on' ? 'https' : 'http';
    }
    var said = true;
    var host = hostOf(first(headers['x-forwarded-host'])) || hostOf(fwd.host);
    if (!host) {
        said = false;
        host = hostOf(first(headers.host));
    }
    if (!host) return null;
    if (host.port === null) {
        var port = Number(first(headers['x-forwarded-port']));
        if (Number.isInteger(port) && port >= 1 && port <= 65535) host.port = port;
    }
    return { scheme: scheme, host: host, said: said };
}

// The address of the page that asked, from the headers a browser sends.
function page(headers) {
    return address(first(headers.origin)) || address(first(headers.referer));
}

// The answer for one request: { origin, from }, from being 'setting',
// 'page', 'proxy' or 'host', or null where the request names no host.
function answer(headers, setting) {
    if (setting) return { origin: setting, from: 'setting' };
    var proxy = told(headers || {});
    if (!proxy) return null;
    var asked = page(headers);
    var askedHost = asked ? hostOf(new URL(asked).host) : null;
    if (askedHost && askedHost.name === proxy.host.name) {
        return { origin: asked, from: 'page' };
    }
    return {
        origin: join(proxy.scheme, proxy.host.name, proxy.host.port),
        from: proxy.said ? 'proxy' : 'host'
    };
}

module.exports = {
    answer: answer,
    configured: configured,
    address: address,
    told: told,
    page: page
};
