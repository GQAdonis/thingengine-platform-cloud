// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingPedia
//
// Copyright 2015 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details

const db = require('../util/db');
const Q = require('q');

function insertKinds(client, deviceId, extraKinds) {
    var extraMarks = [];
    var extraValues = [];
    for (var i = 0; i < extraKinds.length; i++) {
        var k = extraKinds[i];
        extraMarks.push('(?,?)');
        extraValues.push(deviceId);
        extraValues.push(k);
    }

    return db.query(client, 'insert into device_class_kind(device_id, kind) '
                    + 'values' + extraMarks.join(','), extraValues);
}

function create(client, device, extraKinds, code) {
    var KEYS = ['primary_kind', 'global_name', 'owner', 'name', 'description', 'fullcode',
                'approved_version', 'developer_version'];
    KEYS.forEach(function(key) {
        if (device[key] === undefined)
            device[key] = null;
    });
    var vals = KEYS.map(function(key) {
        return device[key];
    });
    var marks = KEYS.map(function() { return '?'; });

    return db.insertOne(client, 'insert into device_class(' + KEYS.join(',') + ') '
                        + 'values (' + marks.join(',') + ')', vals)
        .then(function(id) {
            device.id = id;

            if (extraKinds && extraKinds.length > 0)
                return insertKinds(client, device.id, extraKinds);
        }).then(function() {
            return db.insertOne(client, 'insert into device_code_version(device_id, version, code) '
                                + 'values(?, ?, ?)', [device.id, device.developer_version, code]);
        }).then(function() {
            return device;
        });
}

function update(client, id, device, extraKinds, code) {
    return db.query(client, "update device_class set ? where id = ?", [device, id])
        .then(function() {
            return db.query(client, "delete from device_class_kind where device_id = ?", [id]);
        })
        .then(function() {
            if (extraKinds && extraKinds.length > 0)
                return insertKinds(client, id, extraKinds);
        })
        .then(function() {
            return db.insertOne(client, 'insert into device_code_version(device_id, version, code) '
                                + 'values(?, ?, ?)', [id, device.developer_version, code]);
        })
        .then(function() {
            return device;
        });
}

module.exports = {
    get: function(client, id) {
        return db.selectOne(client, "select * from device_class where id = ?", [id]);
    },

    getFullCodeByPrimaryKind: function(client, kind, developer) {
        if (developer !== null) {
            return db.selectAll(client, "select code, version, approved_version from device_code_version dcv, device_class d "
                                + "where d.fullcode and d.primary_kind = ? and dcv.device_id = d.id "
                                + "and ((dcv.version = d.developer_version and d.owner = ?) "
                                + "or (dcv.version = d.approved_version and d.owner <> ?))",
                                [kind, developer.id, developer.id]);
        } else {
            return db.selectAll(client, "select code, version, approved_version from device_code_version dcv, device_class d "
                                + "where d.fullcode and d.primary_kind = ? and dcv.device_id = d.id "
                                + "and dcv.version = d.approved_version", [kind]);
        }
    },

    getDeveloperCode: function(client, id) {
        return db.selectOne(client, "select code from device_code_version dcv, device_class d "
                            + "where dcv.device_id = d.id and d.id = ? and dcv.version = "
                            + "d.developer_version", [id]);
    },

    getApprovedCode: function(client, id) {
        return db.selectOne(client, "select code from device_code_version dcv, device_class d "
                            + "where dcv.device_id = d.id and d.id = ? and dcv.version = "
                            + "d.approved_version", [id]);
    },

    getByPrimaryKind: function(client, kind) {
        return db.selectOne(client, "select * from device_class where primary_kind = ?", [kind]);
    },

    getByAnyKind: function(client, kind) {
        return db.selectAll(client, "select * from device_class where primary_kind = ? or "
                            + "global_name = ? union "
                            + "(select d.* from device_class d, device_class_kind dk "
                            + "where dk.device_id = d.id and dk.kind = ?)", [kind, kind, kind]);
    },

    getByTag: function(client, tag) {
        return db.selectAll(client, "select dc.* from device_class dc, device_class_tag dct "
                            + "where dct.device_id = dc.id and dct.tag = ? order by dc.name", [tag]);
    },

    getAllKinds: function(client, id) {
        return db.selectAll(client, "select * from device_class_kind where device_id = ? "
                            + "order by kind", [id]);
    },

    create: create,
    update: update,
    delete: function(client, id) {
        return db.query(client, "delete from device_class where id = ?", [id]);
    },

    approve: function(client, id) {
        return db.query(client, "update device_class set approved_version = developer_version where id = ?", [id]);
    },

    getAll: function(client, start, end) {
        if (start !== undefined && end !== undefined) {
            return db.selectAll(client, "select * from device_class order by name limit ?,?",
                                [start, end]);
        } else {
            return db.selectAll(client, "select * from device_class order by name");
        }
    },

    getAllWithKind: function(client, kind, start, end) {
        var query = "select d.* from device_class d where exists (select 1 from device_class_kind "
            + "dk where dk.device_id = d.id and dk.kind = ?) order by d.name";
        if (start !== undefined && end !== undefined) {
            return db.selectAll(client, query + " limit ?,?", [kind, start, end]);
        } else {
            return db.selectAll(client, query, [kind]);
        }
    },

    getAllWithoutKind: function(client, kind, start, end) {
        var query = "select d.* from device_class d where not exists (select 1 from device_class_kind "
            + "dk where dk.device_id = d.id and dk.kind = ?) order by d.name";
        if (start !== undefined && end !== undefined) {
            return db.selectAll(client, query + " limit ?,?", [kind, start, end]);
        } else {
            return db.selectAll(client, query, [kind]);
        }
    },

    getAllApprovedWithCode: function(client, developer, start, end) {
        if (developer !== null) {
            var query = "select d.*, dcv.code from device_class d, "
                + "device_code_version dcv where d.id = dcv.device_id and "
                + "((dcv.version = d.developer_version and d.owner = ?) or "
                + " (dcv.version = d.approved_version and d.owner <> ?)) order by d.name";
            if (start !== undefined && end !== undefined) {
                return db.selectAll(client, query + " limit ?,?",
                                    [developer.id, developer.id, start, end]);
            } else {
                return db.selectAll(client, query, [developer.id, developer.id]);
            }
        } else {
            var query = "select d.*, dcv.code from device_class d, "
                + "device_code_version dcv where d.id = dcv.device_id and "
                + "dcv.version = d.approved_version order by d.name";
            if (start !== undefined && end !== undefined) {
                return db.selectAll(client, query + " limit ?,?",
                                    [start, end]);
            } else {
                return db.selectAll(client, query, []);
            }
        }
    },

    getAllApprovedWithKindWithCode: function(client, kind, developer, start, end) {
        if (developer !== null) {
            var query = "select d.*, dcv.code from device_class d, "
                + "device_code_version dcv where d.id = dcv.device_id and "
                + "((dcv.version = d.developer_version and d.owner = ?) or "
                + " (dcv.version = d.approved_version and d.owner <> ?)) and "
                + "exists (select 1 from device_class_kind dk where dk.device_id "
                + "= d.id and dk.kind = ?) order by d.name";
            if (start !== undefined && end !== undefined) {
                return db.selectAll(client, query + " limit ?,?",
                                    [developer.id, developer.id, kind, start, end]);
            } else {
                return db.selectAll(client, query, [developer.id, developer.id, kind]);
            }
        } else {
            var query = "select d.*, dcv.code from device_class d, "
                + "device_code_version dcv where d.id = dcv.device_id and "
                + "dcv.version = d.approved_version and "
                + "exists (select 1 from device_class_kind dk where dk.device_id "
                + "= d.id and dk.kind = ?) order by d.name";
            if (start !== undefined && end !== undefined) {
                return db.selectAll(client, query + " limit ?,?", [kind, start, end]);
            } else {
                return db.selectAll(client, query, [kind]);
            }
        }
    },

    getAllApprovedWithoutKindWithCode: function(client, kind, developer, start, end) {
        if (developer !== null) {
            var query = "select d.*, dcv.code from device_class d, "
                + "device_code_version dcv where d.id = dcv.device_id and "
                + "((dcv.version = d.developer_version and d.owner = ?) or "
                + " (dcv.version = d.approved_version and d.owner <> ?)) and "
                + "not exists (select 1 from device_class_kind dk where dk.device_id "
                + "= d.id and dk.kind = ?) order by d.name";
            if (start !== undefined && end !== undefined) {
                return db.selectAll(client, query + " limit ?,?",
                                    [developer.id, developer.id, kind, start, end]);
            } else {
                return db.selectAll(client, query, [developer.id, developer.id, kind]);
            }
        } else {
            var query = "select d.*, dcv.code from device_class d, "
                + "device_code_version dcv where d.id = dcv.device_id and "
                + "dcv.version = d.approved_version and "
                + "not exists (select 1 from device_class_kind dk where dk.device_id "
                + "= d.id and dk.kind = ?) order by d.name";
            if (start !== undefined && end !== undefined) {
                return db.selectAll(client, query + " limit ?,?", [kind, start, end]);
            } else {
                return db.selectAll(client, query, [kind]);
            }
        }
    },
}
