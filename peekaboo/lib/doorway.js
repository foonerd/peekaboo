'use strict';

// The door a reverse proxy comes in by: a listener of its own beside
// Volumio's, which hands everything on to Volumio as it came, WebSocket
// connections included, and answers two questions itself:
//
//   GET /api/host               the address the page talks to the player at
//   GET /app/local-config.json  the same, where the page falls back to it
//
// Volumio answers both with an address of the player's own network, which
// a browser on the far side of a proxy cannot reach. Here they are answered
// with the address the browser came in by (lib/origin.js). Volumio's own
// listener and its files are left as they are.

var http = require('http');
var net = require('net');
var origin = require('./origin');
var gate = require('./gate');

// Headers that belong to one connection and are not handed on (RFC 9110,
// section 7.6.1), with whatever else the Connection header names.
var HOP = ['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization',
    'proxy-connection', 'te', 'trailer', 'transfer-encoding', 'upgrade'];

function hop(headers) {
    var names = {};
    HOP.forEach(function (name) { names[name] = true; });
    String(headers.connection || '').split(',').forEach(function (name) {
        name = name.trim().toLowerCase();
        if (name) names[name] = true;
    });
    return names;
}

function quiet() { }

function Doorway(options) {
    options = options || {};
    // Where Volumio listens.
    this.target = { host: options.host || '127.0.0.1', port: options.port || 3000 };
    // log(level, message), level being 'info' or 'error'.
    this.log = options.log || quiet;
    // The address to listen on; every address of the player where none is given.
    this.bind = options.bind || null;
    this.setting = null;
    this.allowed = null;
    this.door = null;
    this.port = null;
    this.last = null;
    this.refused = {};
}

// The public address (as lib/origin.js configured() gives it, or null) and
// the addresses let in (as lib/gate.js parse() gives them, or null). Takes
// effect from the next request.
Doorway.prototype.configure = function (settings) {
    this.setting = settings.address || null;
    this.allowed = settings.allowed || null;
    this.refused = {};
};

// Listen on a port. A door already open stays open until the new one is,
// so a port that cannot be had leaves things as they were. Resolves with
// the port.
Doorway.prototype.open = function (port) {
    var self = this;
    if (self.door && self.port === port) return Promise.resolve(port);
    return new Promise(function (resolve, reject) {
        var door = self.build();
        door.server.once('error', reject);
        var listening = function () {
            door.server.removeListener('error', reject);
            door.server.on('error', function (e) {
                self.log('error', 'the listener on port ' + port + ': ' + e.message);
            });
            var old = self.door;
            self.door = door;
            self.port = door.server.address().port;
            if (old) shut(old);
            resolve(self.port);
        };
        if (self.bind) {
            door.server.listen(port, self.bind, listening);
        } else {
            door.server.listen(port, listening);
        }
    });
};

// Stop listening and let go of every connection.
Doorway.prototype.close = function () {
    var door = this.door;
    this.door = null;
    this.port = null;
    return door ? shut(door) : Promise.resolve();
};

// { listening, port, last }: last is the latest answer given, as
// { origin, from, peer, at }, or null.
Doorway.prototype.status = function () {
    return { listening: this.door !== null, port: this.port, last: this.last };
};

function shut(door) {
    return new Promise(function (resolve) {
        door.server.close(function () { resolve(); });
        door.sockets.forEach(function (socket) { socket.destroy(); });
    });
}

Doorway.prototype.build = function () {
    var self = this;
    var sockets = new Set();
    // The listener lives in Volumio's own process: a fault here ends the one
    // connection it happened on and is said in the log, nothing more.
    var server = http.createServer(function (req, res) {
        try {
            self.request(req, res);
        } catch (e) {
            self.log('error', 'a request failed: ' + (e && e.stack ? e.stack : e));
            req.socket.destroy();
        }
    });
    server.on('upgrade', function (req, socket, head) {
        try {
            self.upgrade(req, socket, head);
        } catch (e) {
            self.log('error', 'an upgrade failed: ' + (e && e.stack ? e.stack : e));
            socket.destroy();
        }
    });
    server.on('connection', function (socket) {
        sockets.add(socket);
        socket.on('close', function () { sockets.delete(socket); });
    });
    server.on('clientError', function (e, socket) {
        if (socket.writable) {
            socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
        } else {
            socket.destroy();
        }
    });
    return { server: server, sockets: sockets };
};

// Whether a connection's address is let in; one that is not is said in the
// log once.
Doorway.prototype.admits = function (socket) {
    var from = gate.plain(socket.remoteAddress);
    if (gate.allows(this.allowed, from)) return true;
    if (!this.refused[from] && Object.keys(this.refused).length < 32) {
        this.refused[from] = true;
        this.log('info', 'refused ' + from + ': not among the proxy addresses');
    }
    return false;
};

Doorway.prototype.request = function (req, res) {
    var self = this;
    req.on('error', quiet);
    res.on('error', quiet);
    if (!self.admits(req.socket)) {
        var no = 'Not allowed from ' + gate.plain(req.socket.remoteAddress) + '\n';
        res.writeHead(403, {
            'Content-Type': 'text/plain; charset=utf-8',
            'Content-Length': Buffer.byteLength(no),
            'Connection': 'close'
        });
        res.end(no);
        return;
    }
    if (req.method === 'GET' || req.method === 'HEAD') {
        var path = req.url.split('?')[0];
        var key = path === '/api/host' || path === '/api/host/' ? 'host'
            : path === '/app/local-config.json' ? 'localhost' : null;
        var found = key ? origin.answer(req.headers, self.setting) : null;
        if (found) {
            self.last = {
                origin: found.origin,
                from: found.from,
                peer: gate.plain(req.socket.remoteAddress),
                at: Date.now()
            };
            var body = {};
            body[key] = found.origin;
            var text = JSON.stringify(body);
            // As Volumio answers /api: any site may read it. Never kept: the
            // answer depends on who asks.
            res.writeHead(200, {
                'Content-Type': 'application/json; charset=utf-8',
                'Content-Length': Buffer.byteLength(text),
                'Cache-Control': 'no-store',
                'Access-Control-Allow-Origin': '*'
            });
            res.end(req.method === 'HEAD' ? undefined : text);
            return;
        }
    }
    self.forward(req, res);
};

// Hand a request on to Volumio and its answer back, each as it came. Every
// request has a connection of its own: on the loopback one costs next to
// nothing, and none can go stale between two requests.
Doorway.prototype.forward = function (req, res) {
    var drop = hop(req.headers);
    // Node has already said "100 Continue" where it was asked for.
    drop.expect = true;
    var headers = {};
    Object.keys(req.headers).forEach(function (name) {
        if (!drop[name]) headers[name] = req.headers[name];
    });
    var up = http.request({
        host: this.target.host,
        port: this.target.port,
        method: req.method,
        path: req.url,
        headers: headers,
        agent: false
    });
    up.on('response', function (answer) {
        var gone = hop(answer.headers);
        var out = {};
        var spelt = {};
        for (var i = 0; i < answer.rawHeaders.length; i += 2) {
            var lower = answer.rawHeaders[i].toLowerCase();
            if (gone[lower]) continue;
            var name = spelt[lower] || (spelt[lower] = answer.rawHeaders[i]);
            if (out[name] === undefined) {
                out[name] = answer.rawHeaders[i + 1];
            } else {
                out[name] = [].concat(out[name], answer.rawHeaders[i + 1]);
            }
        }
        answer.on('error', function () { res.destroy(); });
        res.writeHead(answer.statusCode, answer.statusMessage, out);
        answer.pipe(res);
    });
    up.on('error', function () {
        if (res.headersSent) {
            res.destroy();
            return;
        }
        var no = 'The player did not answer\n';
        res.writeHead(502, {
            'Content-Type': 'text/plain; charset=utf-8',
            'Content-Length': Buffer.byteLength(no)
        });
        res.end(no);
    });
    // A browser that went away has its request to Volumio dropped.
    res.on('close', function () {
        if (!res.writableFinished) up.destroy();
    });
    req.pipe(up);
};

// A WebSocket (or any other upgrade): the request is passed to Volumio
// byte for byte, and from then on the two connections are one.
Doorway.prototype.upgrade = function (req, socket, head) {
    var over = false;
    var up = null;
    function end() {
        if (over) return;
        over = true;
        socket.destroy();
        if (up) up.destroy();
    }
    socket.on('error', end);
    socket.on('close', end);
    if (!this.admits(socket)) {
        end();
        return;
    }
    up = net.connect(this.target.port, this.target.host);
    up.on('error', end);
    up.on('close', end);
    up.on('connect', function () {
        if (over) return;
        up.setNoDelay(true);
        socket.setNoDelay(true);
        var lines = [req.method + ' ' + req.url + ' HTTP/' + req.httpVersion];
        for (var i = 0; i < req.rawHeaders.length; i += 2) {
            lines.push(req.rawHeaders[i] + ': ' + req.rawHeaders[i + 1]);
        }
        up.write(lines.join('\r\n') + '\r\n\r\n');
        if (head && head.length) up.write(head);
        up.pipe(socket);
        socket.pipe(up);
    });
};

module.exports = Doorway;
