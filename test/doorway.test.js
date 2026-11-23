'use strict';

// The listener against a stand-in for Volumio on the loopback.

const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const net = require('node:net');
const Doorway = require('../peekaboo/lib/doorway');
const gate = require('../peekaboo/lib/gate');

// A stand-in for Volumio: its /api/host with an address of its own network,
// a page, an echo, and an upgrade that echoes whatever follows it.
function standIn() {
    const seen = [];
    const server = http.createServer((req, res) => {
        seen.push({ method: req.method, url: req.url, headers: req.headers });
        if (req.url === '/api/host') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ host: 'http://192.168.1.50' }));
        } else if (req.url === '/echo') {
            const chunks = [];
            req.on('data', (c) => chunks.push(c));
            req.on('end', () => {
                res.writeHead(201, { 'Content-Type': 'text/plain' });
                res.end(Buffer.concat(chunks));
            });
        } else if (req.url === '/stream') {
            res.writeHead(200, { 'Content-Type': 'text/plain' });
            res.write('one ');
            setTimeout(() => res.end('two'), 20);
        } else {
            res.writeHead(200, [['Content-Type', 'text/html'], ['Set-Cookie', 'a=1'], ['Set-Cookie', 'b=2'], ['X-Kept', 'yes']]);
            res.end('<html>page</html>');
        }
    });
    const tunnels = new Set();
    server.on('upgrade', (req, socket) => {
        seen.push({ method: req.method, url: req.url, headers: req.headers, upgrade: true });
        tunnels.add(socket);
        socket.on('close', () => tunnels.delete(socket));
        socket.on('error', () => { });
        socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: echo\r\nConnection: Upgrade\r\n\r\n');
        socket.on('data', (d) => socket.write(d));
    });
    return new Promise((resolve) => {
        server.listen(0, '127.0.0.1', () => resolve({
            port: server.address().port,
            seen: seen,
            close: () => new Promise((done) => {
                tunnels.forEach((s) => s.destroy());
                server.close(done);
                server.closeAllConnections();
            })
        }));
    });
}

function ask(port, options, body) {
    return new Promise((resolve, reject) => {
        const req = http.request(Object.assign({ host: '127.0.0.1', port: port, agent: false }, options), (res) => {
            const chunks = [];
            res.on('data', (c) => chunks.push(c));
            res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, raw: res.rawHeaders, body: Buffer.concat(chunks).toString() }));
        });
        req.on('error', reject);
        req.end(body);
    });
}

// An upgrade request by hand; resolves with what came back within a moment.
function upgrade(port, send) {
    return new Promise((resolve) => {
        const socket = net.connect(port, '127.0.0.1');
        let got = '';
        let closed = false;
        socket.on('error', () => { });
        socket.on('close', () => { closed = true; });
        socket.on('data', (d) => {
            got += d;
            if (send && got.includes('\r\n\r\n') && !got.includes(send)) socket.write(send);
        });
        socket.on('connect', () => {
            socket.write('GET /socket.io/?EIO=3&transport=websocket HTTP/1.1\r\nHost: music.example.com\r\n' +
                'Connection: Upgrade\r\nUpgrade: echo\r\nSec-WebSocket-Key: abc\r\n\r\n');
        });
        setTimeout(() => resolve({ got: got, closed: () => closed, socket: socket }), 150);
    });
}

async function pair(t, settings) {
    const volumio = await standIn();
    const door = new Doorway({ host: '127.0.0.1', port: volumio.port });
    if (settings) door.configure(settings);
    const port = await door.open(0);
    t.after(async () => {
        await door.close();
        await volumio.close();
    });
    return { volumio: volumio, door: door, port: port };
}

test('a request goes to Volumio and its answer comes back as it was', async (t) => {
    const { volumio, port } = await pair(t);
    const got = await ask(port, { path: '/playback?x=1', headers: { Host: 'music.example.com', Cookie: 'k=v', Connection: 'keep-alive, X-Private', 'X-Private': 'no' } });
    assert.strictEqual(got.status, 200);
    assert.strictEqual(got.body, '<html>page</html>');
    assert.deepStrictEqual(got.headers['set-cookie'], ['a=1', 'b=2']);
    assert.ok(got.raw.includes('X-Kept'), 'the spelling of a header is kept');
    const sent = volumio.seen[0];
    assert.strictEqual(sent.url, '/playback?x=1');
    assert.strictEqual(sent.headers.host, 'music.example.com');
    assert.strictEqual(sent.headers.cookie, 'k=v');
    assert.strictEqual(sent.headers['x-private'], undefined, 'what Connection names is not handed on');
});

test('a body goes up and the status comes back', async (t) => {
    const { port } = await pair(t);
    const got = await ask(port, { path: '/echo', method: 'POST', headers: { 'Content-Type': 'text/plain' } }, 'a body of some length');
    assert.strictEqual(got.status, 201);
    assert.strictEqual(got.body, 'a body of some length');
});

test('an answer that comes in pieces arrives whole', async (t) => {
    const { port } = await pair(t);
    const got = await ask(port, { path: '/stream' });
    assert.strictEqual(got.body, 'one two');
});

test('/api/host is answered with the address the browser came in by', async (t) => {
    const { volumio, door, port } = await pair(t);
    const got = await ask(port, { path: '/api/host', headers: { Host: 'music.example.com', 'X-Forwarded-Proto': 'https' } });
    assert.strictEqual(got.status, 200);
    assert.deepStrictEqual(JSON.parse(got.body), { host: 'https://music.example.com' });
    assert.strictEqual(got.headers['cache-control'], 'no-store');
    assert.strictEqual(got.headers['access-control-allow-origin'], '*');
    assert.strictEqual(volumio.seen.length, 0, 'Volumio is not asked');
    const last = door.status().last;
    assert.strictEqual(last.origin, 'https://music.example.com');
    assert.strictEqual(last.peer, '127.0.0.1');
});

test('/app/local-config.json is answered the same way, under its own key', async (t) => {
    const { port } = await pair(t);
    const got = await ask(port, { path: '/app/local-config.json?v=2', headers: { Host: 'music.example.com', Referer: 'https://music.example.com:8443/' } });
    assert.deepStrictEqual(JSON.parse(got.body), { localhost: 'https://music.example.com:8443' });
});

test('the public address of the settings page is the answer where there is one', async (t) => {
    const { port } = await pair(t, { address: 'https://music.example.com' });
    const got = await ask(port, { path: '/api/host', headers: { Host: '192.168.1.50:3080' } });
    assert.deepStrictEqual(JSON.parse(got.body), { host: 'https://music.example.com' });
});

test('HEAD has the headers and no body; anything but GET and HEAD is Volumio\'s', async (t) => {
    const { volumio, port } = await pair(t);
    const head = await ask(port, { path: '/api/host', method: 'HEAD', headers: { Host: 'music.example.com' } });
    assert.strictEqual(head.status, 200);
    assert.strictEqual(head.body, '');
    const post = await ask(port, { path: '/api/host', method: 'POST', headers: { Host: 'music.example.com' } }, '{}');
    assert.deepStrictEqual(JSON.parse(post.body), { host: 'http://192.168.1.50' });
    assert.strictEqual(volumio.seen.length, 1);
});

test('an upgrade becomes one connection with Volumio', async (t) => {
    const { volumio, port } = await pair(t);
    const got = await upgrade(port, 'ping-through');
    assert.match(got.got, /^HTTP\/1\.1 101 Switching Protocols\r\n/);
    assert.ok(got.got.endsWith('ping-through'), 'what is sent after the upgrade comes back from the far side');
    const sent = volumio.seen[0];
    assert.strictEqual(sent.upgrade, true);
    assert.strictEqual(sent.url, '/socket.io/?EIO=3&transport=websocket');
    assert.strictEqual(sent.headers['sec-websocket-key'], 'abc');
    got.socket.destroy();
});

test('an address that is not among the proxy addresses is refused', async (t) => {
    const { volumio, port } = await pair(t, { allowed: gate.parse('192.0.2.1') });
    const got = await ask(port, { path: '/api/host', headers: { Host: 'music.example.com' } });
    assert.strictEqual(got.status, 403);
    const page = await ask(port, { path: '/' });
    assert.strictEqual(page.status, 403);
    const up = await upgrade(port);
    assert.strictEqual(up.got, '');
    assert.strictEqual(up.closed(), true);
    assert.strictEqual(volumio.seen.length, 0);
});

test('an address among the proxy addresses is let in', async (t) => {
    const { port } = await pair(t, { allowed: gate.parse('127.0.0.0/8') });
    const got = await ask(port, { path: '/' });
    assert.strictEqual(got.status, 200);
});

test('given an address to listen on, it listens there alone', async (t) => {
    const volumio = await standIn();
    const door = new Doorway({ host: '127.0.0.1', port: volumio.port, bind: '127.0.0.1' });
    const port = await door.open(0);
    t.after(async () => {
        await door.close();
        await volumio.close();
    });
    assert.strictEqual(door.door.server.address().address, '127.0.0.1');
    assert.strictEqual((await ask(port, { path: '/' })).status, 200);
});

test('Volumio not answering is a 502', async (t) => {
    const volumio = await standIn();
    const door = new Doorway({ host: '127.0.0.1', port: volumio.port });
    const port = await door.open(0);
    await volumio.close();
    t.after(() => door.close());
    const got = await ask(port, { path: '/' });
    assert.strictEqual(got.status, 502);
    const up = await upgrade(port);
    assert.strictEqual(up.closed(), true);
});

test('a port that is taken leaves the open door open', async (t) => {
    const { door, port } = await pair(t);
    const taken = net.createServer();
    await new Promise((resolve) => taken.listen(0, resolve));
    t.after(() => new Promise((resolve) => taken.close(resolve)));
    await assert.rejects(door.open(taken.address().port), { code: 'EADDRINUSE' });
    assert.strictEqual(door.status().port, port);
    assert.strictEqual((await ask(port, { path: '/' })).status, 200);
});

test('a new port is open before the old one closes, and the old one closes', async (t) => {
    const { door, port } = await pair(t);
    const moved = await door.open(0);
    assert.notStrictEqual(moved, port);
    assert.strictEqual(door.status().port, moved);
    assert.strictEqual((await ask(moved, { path: '/' })).status, 200);
    await new Promise((resolve) => setTimeout(resolve, 50));
    await assert.rejects(ask(port, { path: '/' }), { code: 'ECONNREFUSED' });
});

test('closing lets go of the connections it holds', async (t) => {
    const { door, port } = await pair(t);
    const up = await upgrade(port, 'x');
    assert.strictEqual(up.closed(), false);
    await door.close();
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.strictEqual(up.closed(), true);
    assert.deepStrictEqual(door.status(), { listening: false, port: null, last: null });
});
