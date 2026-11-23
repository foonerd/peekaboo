'use strict';

// The Volumio side of Peekaboo. The work is done by a listener of the
// plugin's own (lib/doorway.js), on a port beside Volumio's, for a reverse
// proxy to forward to. This file opens it with the plugin and closes it
// with it, and keeps its three settings: the port, a public address for
// where the proxy does not say one, and the addresses the proxy comes from.

var fs = require('fs');
var os = require('os');
var path = require('path');
var Doorway = require('./lib/doorway');
var origin = require('./lib/origin');
var gate = require('./lib/gate');

// The zip carries no node_modules: kew and v-conf are Volumio's own copies,
// so the promises handed back are the kind the plugin manager checks for.
function coreModule(name) {
    try {
        return require('/volumio/node_modules/' + name);
    } catch (e) {
        return require(name);
    }
}

var libQ = coreModule('kew');

var PLUGIN_TYPE = 'system_controller';
var PLUGIN_NAME = 'peekaboo';
// Where Volumio itself listens, on the player.
var VOLUMIO_PORT = 3000;
var DEFAULT_PORT = 3080;
var id = 'peekaboo: ';

module.exports = Peekaboo;

function Peekaboo(context) {
    this.context = context;
    this.commandRouter = context.coreCommand;
    this.logger = context.logger;
    this.configManager = context.configManager;
    this.door = null;
    // Why the listener is not open, where it is not.
    this.failure = null;
}

Peekaboo.prototype.onVolumioStart = function () {
    var configFile = this.commandRouter.pluginManager.getConfigurationFile(this.context, 'config.json');
    this.config = new (coreModule('v-conf'))();
    this.config.loadFile(configFile);
    return libQ.resolve();
};

Peekaboo.prototype.getConfigurationFiles = function () {
    return ['config.json'];
};

// The settings as they are kept, each made sound: a file edited by hand
// does not stop the plugin.
Peekaboo.prototype.settings = function () {
    var port = Number(this.config.get('port'));
    return {
        port: validPort(port) ? port : DEFAULT_PORT,
        address: String(this.config.get('public_address') || '').trim(),
        allowed: String(this.config.get('allowed_from') || '').trim()
    };
};

function validPort(port) {
    return Number.isInteger(port) && port >= 1024 && port <= 65535 && port !== VOLUMIO_PORT;
}

// Switched on, the listener opens. A port that cannot be had does not fail
// the plugin: it stays on, says so, and the port can be changed on its page.
Peekaboo.prototype.onStart = function () {
    var self = this;
    var defer = libQ.defer();
    var now = self.settings();
    self.commandRouter.loadI18nStrings();
    self.door = new Doorway({
        host: '127.0.0.1',
        port: VOLUMIO_PORT,
        log: function (level, message) {
            if (level === 'error') {
                self.logger.error(id + message);
            } else {
                self.logger.info(id + message);
            }
        }
    });
    self.door.configure({
        address: origin.configured(now.address),
        allowed: gate.parse(now.allowed)
    });
    self.door.open(now.port).then(function (port) {
        self.failure = null;
        self.logger.info(id + 'listening on port ' + port);
        defer.resolve();
    }, function (e) {
        self.failure = e && e.message ? e.message : String(e);
        self.logger.error(id + 'port ' + now.port + ' could not be opened: ' + self.failure);
        self.commandRouter.pushToastMessage('error', self.text('PLUGIN_NAME'),
            self.text('STATE_FAILED', { port: now.port, error: self.failure }));
        defer.resolve();
    });
    return defer.promise;
};

// Switched off, the listener closes and every connection through it ends.
Peekaboo.prototype.onStop = function () {
    var self = this;
    var defer = libQ.defer();
    var door = self.door;
    self.door = null;
    if (!door) return libQ.resolve();
    door.close().then(function () {
        self.logger.info(id + 'closed');
        defer.resolve();
    }, function () {
        defer.resolve();
    });
    return defer.promise;
};

Peekaboo.prototype.onRestart = function () { };
Peekaboo.prototype.onInstall = function () { };
Peekaboo.prototype.onUninstall = function () { };

// A string of the plugin's in the player's language, its {{holes}} filled.
Peekaboo.prototype.text = function (key, values) {
    var text = String(this.commandRouter.getI18nString('PEEKABOO.' + key));
    Object.keys(values || {}).forEach(function (name) {
        text = text.split('{{' + name + '}}').join(String(values[name]));
    });
    return text;
};

// An address of the player's to have the proxy forward to: the wired one
// before the wireless one, its name where it has neither.
Peekaboo.prototype.playerAddress = function () {
    var all = os.networkInterfaces();
    var names = ['eth0', 'wlan0'].concat(Object.keys(all));
    for (var i = 0; i < names.length; i++) {
        var found = (all[names[i]] || []).filter(function (a) {
            return (a.family === 'IPv4' || a.family === 4) && !a.internal && a.address.indexOf('169.254.') !== 0;
        });
        if (found.length) return found[0].address;
    }
    return os.hostname() + '.local';
};

// What the listener is doing, in a sentence or two.
Peekaboo.prototype.sentence = function () {
    var now = this.settings();
    var status = this.door ? this.door.status() : { listening: false, port: null, last: null };
    if (!status.listening) {
        return this.text('STATE_FAILED', { port: now.port, error: this.failure || '-' });
    }
    var said = this.text('STATE_LISTENING', { port: status.port, address: this.playerAddress() });
    if (status.last) {
        return said + ' ' + this.text('LAST_TOLD', { peer: status.last.peer, origin: status.last.origin });
    }
    return said + ' ' + this.text('LAST_NONE');
};

// -----------------------------------------------------------------------------
// The settings page.
// -----------------------------------------------------------------------------

Peekaboo.prototype.getUIConfig = function () {
    var self = this;
    var defer = libQ.defer();
    var lang = self.commandRouter.sharedVars.get('language_code');
    self.commandRouter.i18nJson(path.join(__dirname, 'i18n', 'strings_' + lang + '.json'),
        path.join(__dirname, 'i18n', 'strings_en.json'),
        path.join(__dirname, 'UIConfig.json'))
        .then(function (uiconf) {
            var now = self.settings();
            uiconf.sections[0].description = self.sentence();
            uiconf.sections[1].content[0].value = now.port;
            uiconf.sections[1].content[1].value = now.address;
            uiconf.sections[1].content[2].value = now.allowed;
            defer.resolve(uiconf);
        })
        .fail(function (e) {
            self.logger.error(id + 'UI config: ' + e);
            defer.reject(new Error());
        });
    return defer.promise;
};

Peekaboo.prototype.setUIConfig = function () { };
Peekaboo.prototype.getConf = function (varName) { return this.config.get(varName); };
Peekaboo.prototype.setConf = function (varName, varValue) { this.config.set(varName, varValue); };

Peekaboo.prototype.refreshPage = function () {
    var self = this;
    self.commandRouter.getUIConfigOnPlugin(PLUGIN_TYPE, PLUGIN_NAME, {}).then(function (uiconf) {
        self.commandRouter.broadcastMessage('pushUiConfig', uiconf);
    });
};

// Save: all three settings are checked before any is kept, and the new port
// is open before the old one closes. Where anything is wrong, nothing
// changes and the message says what.
Peekaboo.prototype.saveSettings = function (data) {
    var self = this;
    var defer = libQ.defer();
    var name = self.text('PLUGIN_NAME');
    data = data || {};

    var port = Number(String(data.port === undefined ? '' : data.port).trim());
    var address = String(data.public_address || '').trim();
    var allowed = String(data.allowed_from || '').trim();
    var publicAddress = address === '' ? null : origin.configured(address);
    var from = gate.parse(allowed);

    var wrong = null;
    if (!validPort(port)) {
        wrong = self.text('BAD_PORT');
    } else if (address !== '' && !publicAddress) {
        wrong = self.text('BAD_ADDRESS');
    } else if (from.bad.length) {
        wrong = self.text('BAD_ALLOWED', { entries: from.bad.join(', ') });
    }
    if (wrong) {
        self.commandRouter.pushToastMessage('error', name, wrong);
        return libQ.resolve();
    }
    if (!self.door) return libQ.resolve();

    self.door.open(port).then(function (open) {
        self.failure = null;
        self.config.set('port', open);
        self.config.set('public_address', publicAddress || '');
        self.config.set('allowed_from', from.entries.join(', '));
        self.door.configure({ address: publicAddress, allowed: from });
        self.logger.info(id + 'listening on port ' + open);
        self.commandRouter.pushToastMessage('success', name, self.text('SAVED', { port: open }));
        self.refreshPage();
        defer.resolve();
    }, function (e) {
        var why = e && e.message ? e.message : String(e);
        self.logger.error(id + 'port ' + port + ' could not be opened: ' + why);
        self.commandRouter.pushToastMessage('error', name, self.text('PORT_TAKEN', { port: port, error: why }));
        defer.resolve();
    });
    return defer.promise;
};

// called from commandrouter to find the language file
Peekaboo.prototype.getI18nFile = function (langCode) {
    var i18nFiles = fs.readdirSync(path.join(__dirname, 'i18n'));
    var langFile = 'strings_' + langCode + '.json';
    if (i18nFiles.some(function (f) { return f === langFile; })) {
        return path.join(__dirname, 'i18n', langFile);
    }
    return path.join(__dirname, 'i18n', 'strings_en.json');
};
