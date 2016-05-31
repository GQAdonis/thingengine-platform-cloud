// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2016 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const Q = require('q');

const ThingPediaDiscovery = require('thingpedia-discovery');

const db = require('./db');
const device = require('../model/device');
const user = require('../model/user');
const organization = require('../model/organization');
const schema = require('../model/schema');

const S3_HOST = function() {
    return platform.getOrigin() + '/thingpedia/zipfiles/';
}

const LEGACY_MAPS = {
    'linkedin': 'com.linkedin',
    'bodytrace-scale': 'com.bodytrace.scale',
    'twitter-account': 'com.twitter',
    'google-account': 'com.google',
    'facebook': 'com.facebook'
};

class ThingPediaDiscoveryDatabase {
    getByAnyKind(kind) {
        return db.withClient(function(dbClient) {
            return device.getByAnyKind(dbClient, kind);
        });
    }

    getAllKinds(deviceId) {
        return db.withClient(function(dbClient) {
            return device.getAllKinds(dbClient, deviceId);
        });
    }

    getByPrimaryKind(kind) {
        return db.withClient(function(dbClient) {
            return device.getByPrimaryKind(dbClient, kind);
        });
    }
}

var _discoveryServer = new ThingPediaDiscovery.Server(new ThingPediaDiscoveryDatabase());

module.exports = class ThingPediaClientCloud {
    constructor(developerKey) {
        this.developerKey = developerKey;
    }

    getModuleLocation(kind) {
        if (kind in LEGACY_MAPS)
            kind = LEGACY_MAPS[kind];

        var developerKey = this.developerKey;

        return db.withClient(function(dbClient) {
            return Q.try(function() {
                if (developerKey)
                    return organization.getByDeveloperKey(dbClient, developerKey);
                else
                    return [];
            }).then(function(orgs) {
                var org = null;
                if (orgs.length > 0)
                    org = orgs[0];

                return device.getByPrimaryKind(dbClient, kind);
            }).then(function(device) {
                if (device.fullcode)
                    throw new Error('No Code Available');

                if (org !== null && org.id === device.owner)
                    return (S3_HOST() + device.primary_kind + '-v' + device.developer_version + '.zip');
                else if (device.approved_version !== null)
                    return (S3_HOST() + device.primary_kind + '-v' + device.approved_version + '.zip');
                else
                    throw new Error('Not Authorized');
            });
        });
    }

    getDeviceCode(kind) {
        if (kind in LEGACY_MAPS)
            kind = LEGACY_MAPS[kind];

        var developerKey = this.developerKey;

        return db.withClient(function(dbClient) {
            return Q.try(function() {
                if (developerKey)
                    return organization.getByDeveloperKey(dbClient, developerKey);
                else
                    return [];
            }).then(function(orgs) {
                var org = null;
                if (orgs.length > 0)
                    org = orgs[0];

                return device.getFullCodeByPrimaryKind(dbClient, kind, org);
            }).then(function(devs) {
                if (devs.length < 1)
                    throw new Error(kind + ' not Found');

                var dev = devs[0];
                var ast = JSON.parse(dev.code);
                ast.version = dev.version;
                if (dev.version !== dev.approved_version)
                    ast.developer = true;
                else
                    ast.developer = false;

                return ast;
            });
        });
    }

    getSchemas(schemas) {
        var developerKey = this.developerKey;

        return db.withClient(function(dbClient) {
            return Q.try(function() {
                if (developerKey)
                    return organization.getByDeveloperKey(dbClient, developerKey);
                else
                    return [];
            }).then(function(orgs) {
                var org = null;
                if (orgs.length > 0)
                    org = orgs[0];

                return schema.getTypesByKinds(dbClient, schemas, org);
            }).then(function(rows) {
                var obj = {};

                rows.forEach(function(row) {
                    if (row.types === null)
                        return;
                    obj[row.kind] = {
                        triggers: row.types[0],
                        actions: row.types[1],
                        queries: (row.types[2] || {})
                    };
                });

                return obj;
            });
        });
    }

    getMetas(schemas) {
        var developerKey = this.developerKey;

        return db.withClient(function(dbClient) {
            return Q.try(function() {
                if (developerKey)
                    return organization.getByDeveloperKey(dbClient, developerKey);
                else
                    return [];
            }).then(function(orgs) {
                var org = null;
                if (orgs.length > 0)
                    org = orgs[0];

                return schema.getMetasByKinds(dbClient, schemas, org);
            }).then(function(rows) {
                var obj = {};

                rows.forEach(function(row) {
                    if (row.types === null)
                        return;

                    var types = { triggers: {}, queries: {}, actions: {} };

                    function doOne(what, id) {
                        for (var name in row.types[id]) {
                            var obj = {
                                schema: row.types[id][name]
                            };
                            if (name in row.meta[id]) {
                                obj.args = row.meta[id][name].args;
                                obj.doc = row.meta[id][name].doc;
                                obj.questions = rows.meta[id][name].questions || [];
                            } else {
                                obj.args = obj.schema.map(function(_, i) {
                                    return 'arg' + (i+1);
                                });
                                obj.questions = obj.schema.map(function() {
                                    return '';
                                });
                            }
                            types[what][name] = obj;
                        }
                    }

                    doOne('triggers', 0);
                    doOne('actions', 1);
                    doOne('queries', 2);
                    obj[row.kind] = types;
                });

                return obj;
            });
        });
    }

    getKindByDiscovery(body) {
        return _discoveryServer.decode(body);
    }
}
module.exports.prototype.$rpcMethods = ['getModuleLocation', 'getDeviceCode',
                                        'getSchemas', 'getKindByDiscovery'];
