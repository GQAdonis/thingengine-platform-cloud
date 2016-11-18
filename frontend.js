// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2015 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details

/**
 * Module dependencies.
 */

const Q = require('q');

const express = require('express');
const http = require('http');
const path = require('path');
const logger = require('morgan');
const favicon = require('serve-favicon');
const cookieParser = require('cookie-parser');
const bodyParser = require('body-parser');
const session = require('express-session');
const csurf = require('csurf');
const errorHandler = require('errorhandler');
const url = require('url');
const passport = require('passport');
const connect_flash = require('connect-flash');
const cacheable = require('cacheable-middleware');
const xmlBodyParser = require('express-xml-bodyparser');
const Gettext = require('node-gettext');
const acceptLanguage = require('accept-language');

const passportUtil = require('./util/passport');
const secretKey = require('./util/secret_key');

function Frontend() {
    this._init.apply(this, arguments);
}

Frontend.prototype._init = function _init() {
    // all environments
    this._app = express();

    this._app.set('port', process.env.PORT || 8080);
    this._app.set('views', path.join(__dirname, 'views'));
    this._app.set('view engine', 'jade');
    this._app.enable('trust proxy');
    this._app.use(favicon(__dirname + '/public/images/favicon.ico'));

    this._app.use(logger('dev'));

    this._app.use(function(req, res, next) {
        if (req.headers['x-forwarded-proto'] === 'http') {
            res.redirect(301, 'https://' + req.hostname + req.originalUrl);
            return;
        }
        next();
    });

    this._app.use(bodyParser.json());
    this._app.use(bodyParser.urlencoded({ extended: true }));
    this._app.use(xmlBodyParser({ explicitArray: true, trim: false }));
    this._app.use(cookieParser());
    this._app.use(session({ resave: false,
                            saveUninitialized: false,
                            secret: secretKey.getSecretKey(this._app) }));
    this._app.use(connect_flash());
    this._app.use(express.static(path.join(__dirname, 'public'),
                                 { maxAge: 86400000 }));
    this._app.use(cacheable());

    // development only
    if ('development' == this._app.get('env')) {
        this._app.use(errorHandler());
    }

    this._app.use(passport.initialize());
    this._app.use(passport.session());
    passportUtil.initialize();

    var basicAuth = passport.authenticate('basic', { failWithError: true });
    var omletAuth = passport.authenticate('local-omlet', { failureRedirect: '/user/login',
                                                           failureFlash: false });
    this._app.use(function(req, res, next) {
        if (req.query.auth === 'app') {
            basicAuth(req, res, function(err) {
                if (err)
                    res.status(401);
                // eat the error
                next();
            });
        } else if (req.query.auth === 'omlet') {
            omletAuth(req, res, next);
        } else
            next();
    });
    this._app.use(function(req, res, next) {
        if (req.user) {
            res.locals.authenticated = true;
            res.locals.user = req.user;
        } else {
            res.locals.authenticated = false;
            res.locals.user = { isConfigured: true };
        }
        next();
    });

    // i18n support
    const LANGS = ['en-US', 'it', 'es', 'zh-CN'];
    acceptLanguage.languages(LANGS);
    var languages = {};
    for (var l of LANGS) {
        if (l !== 'en-US') {
            var gt = new Gettext();
            gt.setlocale(l);
            var modir = path.resolve(path.dirname(module.filename), './po');
            try {
                gt.loadTextdomainDirectory('thingengine-platform-cloud', modir);
            } catch(e) {
                console.log('Failed to load translations for ' + l + ': ' + e.message);
            }
            gt.textdomain('thingengine-platform-cloud');
            languages[l] = {
                gettext: gt.gettext.bind(gt),
                pgettext: gt.pgettext.bind(gt),
                ngettext: gt.ngettext.bind(gt)
            };
        } else {
            languages[l] = {
                gettext: x => x,
                pgettext: (c, x) => x,
                ngettext: (m1, m2, n) => (n === 1 ? m1 : m2)
            };
        }
    }
    this._app.use(function(req, res, next) {
        var locale = req.session.locale;
        if (!locale && req.user)
            locale = req.user.locale;
        if (!locale && req.headers['accept-language'])
            locale = acceptLanguage.get(req.headers['accept-language']);
        if (!locale)
            locale = 'en-US';
        locale = locale.split(/[-_\@\.,]/);
        var lang = languages[locale.join('-')];
        while (!lang && locale.length > 0) {
            locale.pop();
            lang = languages[locale.join('-')];
        }
        if (!lang)
            lang = languages['en-US'];

        req.locale = locale;
        req.gettext = lang.gettext;
        req._ = req.gettext;
        req.pgettext = lang.pgettext;
        req.ngettext = lang.ngettext;

        res.locals.gettext = req.gettext;
        res.locals._ = req._;
        res.locals.pgettext = req.pgettext;
        res.locals.ngettext = req.ngettext;
        next();
    });

    // apis are CORS enabled always
    this._app.use('/thingpedia/api', function(req, res, next) {
        res.set('Access-Control-Allow-Origin', '*');
        next();
    });

    // mount /api before CSRF
    // as we don't need CSRF protection for that
    this._app.use('/api/webhook', require('./routes/webhook'));
    this._app.use('/me/api/oauth2', require('./oauth2'));
    this._app.use('/thingpedia/api', require('./routes/thingpedia_api'));
    this._app.use('/thingpedia/download', require('./routes/thingpedia_download'));
    // initialize csurf after /upload too
    // because upload uses multer, which is incompatible
    // with csurf
    // MAKE SURE ALL ROUTES HAVE CSURF IN /upload
    this._app.use('/thingpedia/upload', require('./routes/thingpedia_upload'));

    this._app.use(csurf({ cookie: false }));
    this._app.use('/', require('./routes/index'));
    this._app.use('/', require('./routes/qrcode'));

    this._app.use('/me', require('./routes/my_stuff'));
    this._app.use('/me/devices', require('./routes/devices'));
    this._app.use('/me/status', require('./routes/status'));
    this._app.get('/devices', require('./routes/devices_compat'));

    this._app.use('/thingpedia/examples', require('./routes/thingpedia_examples'));
    this._app.use('/thingpedia/training', require('./routes/train_sabrina'));
    this._app.use('/thingpedia/devices', require('./routes/thingpedia_devices'));
    this._app.use('/thingpedia/schemas', require('./routes/thingpedia_schemas'));
    this._app.use('/thingpedia/translate', require('./routes/thingpedia_translate'));
    this._app.use('/user', require('./routes/user'));
    this._app.use('/admin', require('./routes/admin'));
    this._app.use('/doc', require('./routes/doc'));
    this._app.use('/omlet', require('./routes/omlet'));

    this._websocketEndpoints = {};
}

var server = null;

Frontend.prototype.open = function() {
    var server = http.createServer(this._app);
    server.on('upgrade', function(req, socket, head) {
        var parsed = url.parse(req.url);
        var endpoint = this._websocketEndpoints[parsed.pathname];
        if (endpoint === undefined) {
            socket.write('HTTP/1.1 404 Not Found\r\n');
            socket.write('Content-type: text/plain;charset=utf8;\r\n');
            socket.write('\r\n\r\n');
            socket.end('Invalid cloud ID');
            return;
        }

        endpoint(req, socket, head);
    }.bind(this));
    this.server = server;

    // '::' means the same as 0.0.0.0 but for IPv6
    // without it, node.js will only listen on IPv4
    return Q.ninvoke(server, 'listen', this._app.get('port'), '::')
        .then(function() {
            console.log('Express server listening on port ' + this._app.get('port'));
        }.bind(this));
}

Frontend.prototype.close = function() {
    // close the server asynchronously to avoid waiting on open
    // connections
    this.server.close(function(err) {
        if (err) {
            console.log('Error stopping Express server: ' + error);
            console.log(error.stack);
        } else {
            console.log('Express server stopped');
        }
    });
    return Q();
}

Frontend.prototype.getApp = function() {
    return this._app;
}

Frontend.prototype.registerWebSocketEndpoint = function(path, callback) {
    this._websocketEndpoints[path] = callback;
}

Frontend.prototype.unregisterWebSocketEndpoint = function(path) {
    delete this._websocketEndpoints[path];
}

module.exports = Frontend;
