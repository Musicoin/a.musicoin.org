import * as express from 'express';
import * as passport from 'passport';

import { ExchangeRateProvider } from '../../extra/exchange-service';
import { AddressResolver } from '../../internal/address-resolver';
import { MusicoinAPI } from '../../internal/musicoin-api';
import { MusicoinOrgJsonAPI } from '../../rest-api/json-api';
import { RequestCache } from '../../utils/cached-request';
import * as FormUtils from '../../utils/form-utils';

const User = require('../../models/user');
const Release = require('../../models/release');
const router = express.Router();
const bootSession = process.env.BOOTSESSION;
const MESSAGE_TYPES = {
    admin: "admin",
    comment: "comment",
    release: "release",
    donate: "donate",
    follow: "follow",
    tip: "tip",
};
var functions = require('../routes-functions');
export class AdminRoutes {
    constructor(musicoinApi: MusicoinAPI,
        jsonAPI: MusicoinOrgJsonAPI,
        addressResolver: AddressResolver,
        exchangeRateProvider: ExchangeRateProvider,
        cachedRequest: RequestCache,
        mediaProvider: any, // TODO
        passport: any,
        config: any,
        doRender: any) {

        router.post('/admin/send-weekly-report', (req, res) => {
            if (!req.body.id) return res.json({ success: false, reason: "No id" });
            return exchangeRateProvider.getMusicoinExchangeRate()
                .then(exchangeRateInfo => {
                    jsonAPI.sendUserStatsReport(req.body.id, "week", "weekly", exchangeRateInfo)
                        .then(() => {
                            res.json({ success: true })
                        })
                        .catch(err => {
                            console.log("Failed to send report: " + err);
                            res.json({ success: false, message: "Failed to send report" })
                        })
                })

        });

        router.post('/admin/invites/add', (req, res) => {
            if (!req.body.id) return res.json({ success: false, reason: "No id" });
            if (!req.body.count) return res.json({ success: false, reason: "Invite count to add not provided" });
            User.findById(req.body.id).exec()
                .then(user => {
                    user.invitesRemaining += parseInt(req.body.count);
                    return user.save();
                })
                .then(() => {
                    res.json({ success: true })
                })
        });

        router.post('/admin/invites/blacklist', (req, res) => {
            const id = FormUtils.defaultString(req.body.id, null);
            if (!id) return res.json({ success: false, reason: "No id" });
            if (typeof req.body.blacklist == "undefined") return res.json({ success: false, reason: "specify true/false for 'blacklist' parameter" });
            User.findById(id).exec()
                .then(user => {
                    user.invite.noReward = req.body.blacklist == "true";
                    return user.save();
                })
                .then(() => {
                    res.json({ success: true })
                })
        });

        router.post('/admin/users/block', (req, res) => {
            const id = FormUtils.defaultString(req.body.id, null);
            if (!id) return res.json({ success: false, reason: "No id" });
            User.findById(req.body.id).exec()
                .then(user => {
                    user.blocked = req.body.block == "true";
                    return user.save();
                })
                .then(() => {
                    res.json({ success: true })
                })
        });

        router.post('/admin/users/verify', (req, res) => {
            if (!req.body.id) return res.json({ success: false, reason: "No id" });
            User.findById(req.body.id).exec()
                .then(user => {
                    console.log(`User verification status changed by ${req.user.draftProfile.artistName}, artist=${user.draftProfile.artistName}, newStatus=${req.body.verified == "true"}`);
                    user.verified = req.body.verified == "true";
                    return user.save();
                })
                .then(() => {
                    res.json({ success: true })
                })
        });

        router.post('/admin/session/unboot', (req, res) => {
            const idx = bootSession.indexOf(req.body.session);
            if (idx >= 0) {
                console.log(`Removing ${req.body.session} from blacklist`);
                (bootSession as any).splice(idx, 1);
            }
            res.redirect("/admin/overview");
        });

        router.post('/admin/users/lock', (req, res) => {
            if (!req.body.id) return res.json({ success: false, reason: "No id" });
            if (typeof req.body.lock == "undefined") return res.json({ success: false, reason: "specify true/false for 'lock' parameter" });
            User.findById(req.body.id).exec()
                .then(user => {
                    user.accountLocked = req.body.lock == "true";
                    return user.save();
                })
                .then(() => {
                    res.json({ success: true })
                })
        });

        router.get('/admin/errors', (req, res) => {
            const length = typeof req.query.length != "undefined" ? parseInt(req.query.length) : 20;
            const start = typeof req.query.start != "undefined" ? parseInt(req.query.start) : 0;
            const previous = Math.max(0, start - length);
            const url = '/admin/errors?search=' + (req.query.search ? req.query.search : '');
            const options = { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' };
            jsonAPI.getErrors(req.query.search, start, length)
                .then(errors => {
                    errors.forEach(r => {
                        r.dateDisplay = r.report.date.toLocaleDateString('en-US', options);
                    });
                    return errors;
                })
                .then(errors => {
                    return doRender(req, res, 'admin-errors.ejs', {
                        search: req.query.search,
                        errors: errors,
                        navigation: {
                            description: `Showing ${start + 1} to ${start + errors.length}`,
                            start: previous > 0 ? `${url}&length=${length}` : null,
                            back: previous >= 0 && previous < start ? `${url}&length=${length}&start=${start - length}` : null,
                            next: errors.length >= length ? `${url}&length=${length}&start=${start + length}` : null
                        }
                    });
                });
        });

        router.get('/admin/users', (req, res) => {
            const length = typeof req.query.length != "undefined" ? parseInt(req.query.length) : 10;
            const start = typeof req.query.start != "undefined" ? parseInt(req.query.start) : 0;
            const previous = Math.max(0, start - length);
            const url = '/admin/users?search=' + (req.query.search ? req.query.search : '');
            jsonAPI.getAllUsers(req.query.search, null, null, null, start, length)
                .then(results => {
                    const users = results.users;
                    return doRender(req, res, 'admin-users.ejs', {
                        search: req.query.search,
                        users: users,
                        navigation: {
                            show10: `${url}&length=10`,
                            show25: `${url}&length=25`,
                            show50: `${url}&length=50`,
                            description: `Showing ${start + 1} to ${start + users.length}`,
                            start: previous > 0 ? `${url}&length=${length}` : null,
                            back: previous >= 0 && previous < start ? `${url}&length=${length}&start=${start - length}` : null,
                            next: users.length >= length ? `${url}&length=${length}&start=${start + length}` : null
                        }
                    });
                });
        });

        router.get('/admin/contacts', (req, res) => {
            const length = typeof req.query.length != "undefined" ? parseInt(req.query.length) : 10;
            const start = typeof req.query.start != "undefined" ? parseInt(req.query.start) : 0;
            const previous = Math.max(0, start - length);
            const url = '/admin/contacts?search=' + (req.query.search ? req.query.search : '');
            const downloadUrl = '/admin/contacts/download?search=' + (req.query.search ? req.query.search : '');
            jsonAPI.getAddressBook(req.query.search, start, length)
                .then(users => {
                    return doRender(req, res, 'admin-contacts.ejs', {
                        search: req.query.search,
                        users: users,
                        navigation: {
                            show10: `${url}&length=10`,
                            show25: `${url}&length=25`,
                            show50: `${url}&length=50`,
                            showAll: `${url}&offset=0&length=0`,
                            download: `${downloadUrl}`,
                            description: `Showing ${start + 1} to ${start + users.length}`,
                            start: previous > 0 ? `${url}&length=${length}` : null,
                            back: previous >= 0 && previous < start ? `${url}&length=${length}&start=${start - length}` : null,
                            next: users.length >= length ? `${url}&length=${length}&start=${start + length}` : null
                        }
                    });
                });
        });

        router.get('/admin/contacts/download', (req, res) => {
            jsonAPI.getAddressBook(req.query.search, 0, -1)
                .then(users => {
                    // Handling UTF-8 character set
                    // http://stackoverflow.com/questions/27802123/utf-8-csv-encoding
                    const BOM = String.fromCharCode(0xFEFF);

                    res.charset = "UTF-8";
                    res.set({ "Content-Disposition": "attachment; filename=contacts.csv", "Content-Type": "text/csv; charset=utf-8" });
                    res.send(BOM + "email,name,artistName\n" + users.map(u => `${u.email},"${u.name}","${u.artistName}"`).join("\n"));
                });
        });

        router.get('/admin/releases', (req, res) => {
            const length = typeof req.query.length != "undefined" ? parseInt(req.query.length) : 10;
            const start = typeof req.query.start != "undefined" ? parseInt(req.query.start) : 0;
            const previous = Math.max(0, start - length);
            const url = '/admin/releases?search=' + (req.query.search ? req.query.search : '');
            jsonAPI.getAllReleases(req.query.search, start, length)
                .then(result => {
                    const releases = result.releases;
                    return doRender(req, res, 'admin-releases.ejs', {
                        search: req.query.search,
                        releases: releases,
                        navigation: {
                            show10: `${url}&length=10`,
                            show25: `${url}&length=25`,
                            show50: `${url}&length=50`,
                            description: `Showing ${start + 1} to ${start + releases.length} of ${result.count}`,
                            start: previous > 0 ? `${url}&length=${length}` : null,
                            back: previous >= 0 && previous < start ? `${url}&length=${length}&start=${start - length}` : null,
                            next: releases.length >= length ? `${url}&length=${length}&start=${start + length}` : null
                        }
                    });
                });
        });

        router.get('/peerverif/a7565fbd8b81b42031fd893db7645856f9d6f377a188e95423702e804c7b64b1', (req, res) => {
            const length = 1000;
            const start = typeof req.query.start != "undefined" ? parseInt(req.query.start) : 0;
            const previous = Math.max(0, start - length);
            const url = '/admin/users?search=' + (req.query.search ? req.query.search : '');
            jsonAPI.getAllUsers(req.query.search, null, null, null, start, length)
                .then(results => {
                    const users = results.users;
                    return doRender(req, res, 'peer-verification.ejs', {
                        search: req.query.search,
                        users: users
                    });
                });
        });
    }
    getRouter() {
        return router;
    }
}
