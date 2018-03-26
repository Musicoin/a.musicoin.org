import { Promise } from 'bluebird';
import * as passport from 'passport';

import { ExchangeRateProvider } from '../../extra/exchange-service';
import { MailSender } from '../../extra/mail-sender';
import { AddressResolver } from '../../internal/address-resolver';
import { MusicoinAPI } from '../../internal/musicoin-api';
import { MusicoinHelper } from '../../internal/musicoin-helper';
import { MusicoinOrgJsonAPI } from '../../rest-api/json-api';
import { RequestCache } from '../../utils/cached-request';
import * as FormUtils from '../../utils/form-utils';
import { DashboardRouter } from './admin-dashboard-routes';

var functions = require('../routes-functions');
const User = require('../../models/user');
const Release = require('../../models/release');
const MESSAGE_TYPES = {
    admin: "admin",
    comment: "comment",
    release: "release",
    donate: "donate",
    follow: "follow",
    tip: "tip",
};
const bootSession = process.env.BOOTSESSION;

const cachedRequest = new RequestCache();
export function configure(app, passport, musicoinApi: MusicoinAPI, mediaProvider, config: any) {
    const exchangeRateProvider = new ExchangeRateProvider(config.exchangeRateService, cachedRequest);
    const mailSender = new MailSender();
    const addressResolver = new AddressResolver();
    const maxImageWidth = 400;
    let mcHelper = new MusicoinHelper(musicoinApi, mediaProvider, config.playbackLinkTTLMillis);
    let jsonAPI = new MusicoinOrgJsonAPI(musicoinApi, mcHelper, mediaProvider, mailSender, exchangeRateProvider, config);

    const dashboardManager = new DashboardRouter(musicoinApi,
        jsonAPI,
        addressResolver,
        maxImageWidth,
        mediaProvider,
        config,
        doRender);

    app.use('/admin', functions.isLoggedIn, functions.adminOnly);
    app.use('/admin/*', functions.isLoggedIn, functions.adminOnly);
    app.use('/admin/', dashboardManager.getRouter());

    app.post('/admin/hero/select', (req, res) => {
        jsonAPI.promoteTrackToHero(req.body.licenseAddress)
            .then(result => res.json(result))
            .catch(err => {
                console.log("failed to promote track to hero: " + err);
                res.json({ success: false, reason: "error" });
            });
    });

    app.post('/admin/release/abuse', (req, res) => {
        const markAsAbuse = req.body.abuse == "true";
        const msg = markAsAbuse ? config.ui.admin.markAsAbuse : config.ui.admin.unmarkAsAbuse;
        jsonAPI.markAsAbuse(req.body.licenseAddress, markAsAbuse)
            .then(result => res.json(result))
            .then(() => {
                return jsonAPI.postLicenseMessages(req.body.licenseAddress, null, config.musicoinAdminProfile, msg, MESSAGE_TYPES.admin, null, null);
            })
            .catch(err => {
                console.log("Failed to mark track as abuse: " + err);
                res.json({ success: false, reason: "error" });
            });
    });
    app.post('/admin/user/abuse', (req, res) => {
        // First blacklist the user (no invite bonus)
        const id = FormUtils.defaultString(req.body.id, null);
        if (!id) return res.json({ success: false, reason: "No id" });
        if (typeof req.body.blacklist == "undefined") return res.json({ success: false, reason: "specify true/false for 'blacklist' parameter" });
        User.findById(id).exec()
            .then(user => { // Blacklist user
                console.log(`User has been flagged as a gamer of the system.`)
                user.invite.noReward = req.body.blacklist == "true";
            })// Unverify user
            .then(user => {
                console.log(`User verification status changed by ${req.user.draftProfile.artistName}, artist=${user.draftProfile.artistName}, newStatus=${req.body.verified == "true"}`);
                user.verified = req.body.verified == "false";
            })// Next lets lock his account
            .then(user => {
                user.accountLocked = req.body.lock == "true";
            })
            .then(user => {
                user.followerCount = 0;
            })
            .then(user => {
                user.directTipCount = 0;
            })
            .then(user => {
                user.hideProfile = true;
                return user.save();
            });

        const artistProfileAddress = User.findById(id).exec().profileAddress;
        // const url = '/admin/releases?search=' + (req.query.search ? req.query.search : '');
        jsonAPI.getAllReleases('', 0, 100000) // we should change this once we scale.
            .then(result => {
                const releases = result.releases;
                for (var i = 0; i < releases.length; i++) {
                    if (artistProfileAddress == releases[i].artistAddress) {
                        const markAsAbuse = releases[i].abuse == "true";
                        jsonAPI.markAsAbuse(releases[i].licenseAddress, markAsAbuse)
                            .then(result => res.json(result))
                            .catch(err => {
                                console.log("Failed to mark track " + releases[i] + " as abuse: " + err);
                            });
                    }
                }
            });
    });

    // =====================================
    // ADMIN LOGIN =========================
    // =====================================

    app.get('/admin/su', functions.isLoggedIn, functions.adminOnly, function (req, res) {
        // render the page and pass in any flash data if it exists
        res.render('su.ejs', { message: req.flash('loginMessage') });
    });

    app.post('/admin/su', functions.isLoggedIn, functions.adminOnly, passport.authenticate('local-su', {
        failureRedirect: '/admin/su', // redirect back to the signup page if there is an error
        failureFlash: true // allow flash messages
    }), function (req, res) {
        //admin loggined succesfully
        if (req.user) {
            if (req.user.profileAddress && req.user.profileAddress !== '') {
                req.session.userAccessKey = req.user.profileAddress; //set session value as user.profileAddress;
            } else if (req.user.id && req.user.id !== '') {
                req.session.userAccessKey = req.user.id;  //set session value as user.id
            }
        }
        res.redirect('/profile'); // redirect to the secure profile section
    });

    app.get('/admin/licenses/dump', functions.isLoggedIn, functions.adminOnly, function (req, res) {
        // render the page and pass in any flash data if it exists
        jsonAPI.getAllContracts()
            .then(function (all) {
                return Promise.all(all.map(contract => {
                    const k = musicoinApi.getKey(contract.address)
                        .catch(err => "Unknown: " + err);
                    return k.then(function (key) {
                        contract.key = key;
                        return contract;
                    })
                }));
            })
            .then(all => res.json(all));
    });

    app.get('/admin/artists/dump', functions.isLoggedIn, functions.adminOnly, function (req, res) {
        // render the page and pass in any flash data if it exists
        jsonAPI.getAllArtists()
            .then(function (all) {
                res.json(all);
            })
    });

    app.get('/admin/overview', functions.isLoggedIn, functions.adminOnly, function (req, res) {
        // render the page and pass in any flash data if it exists
        const b = musicoinApi.getMusicoinAccountBalance();
        const o = musicoinApi.getAccountBalances(config.trackingAccounts.map(ta => ta.address));
        const wp = User.count({ profileAddress: { $exists: true, $ne: null } }).exec();
        const wr = User.count({
            profileAddress: { $exists: true, $ne: null },
            mostRecentReleaseDate: { $exists: true, $ne: null }
        }).exec();
        const tc = Release.count({ contractAddress: { $exists: true, $ne: null }, state: "published" }).exec();
        const dtc = Release.count({ contractAddress: { $exists: true, $ne: null }, state: "deleted" }).exec();
        const au = jsonAPI.getOverallReleaseStats();
        Promise.join(b, o, wp, wr, tc, dtc, au, (mcBalance, balances, usersWithProfile, usersWithRelease, trackCount, deletedTrackCount, allReleaseStats) => {
            const output = [];
            balances.forEach((balance, index) => {
                const accountDetails = config.trackingAccounts[index];
                output.push({
                    balance: balance.musicoins,
                    formattedBalance: balance.formattedMusicoins,
                    name: accountDetails.name,
                    address: accountDetails.address,
                })
            });
            output.push({
                balance: mcBalance.musicoins,
                formattedBalance: mcBalance.formattedMusicoins,
                name: "MC Client Balance",
                address: "",
            });

            const userMetrics = [];
            userMetrics.push({ name: "Users", value: functions._formatNumber(usersWithProfile) });
            userMetrics.push({ name: "Musicians", value: functions._formatNumber(usersWithRelease) });

            const trackMetrics = [];
            trackMetrics.push({ name: "Tracks", value: functions._formatNumber(trackCount) });
            trackMetrics.push({ name: "Deleted Tracks", value: functions._formatNumber(deletedTrackCount) });
            trackMetrics.push({ name: "totalPlays", value: functions._formatNumber(allReleaseStats[0].totalPlays) });
            trackMetrics.push({ name: "totalTips", value: functions._formatNumber(allReleaseStats[0].totalTips) });
            trackMetrics.push({ name: "totalComments", value: functions._formatNumber(allReleaseStats[0].totalComments) });

            return doRender(req, res, 'admin-overview.ejs', {
                accounts: output,
                userMetrics: userMetrics,
                trackMetrics: trackMetrics,
                bootSessions: bootSession
            });
        })
    });

    app.get('/admin/mail/confirm', functions.isLoggedIn, functions.adminOnly, function (req, res) {
        res.render("mail/email-confirmation.ejs", {
            code: "XY12345"
        })
    });

    app.get('/admin/mail/reset', functions.isLoggedIn, functions.adminOnly, function (req, res) {
        res.render("mail/password-reset.ejs", {
            link: "http://google.com?test=123455"
        })
    });

    app.get('/admin/mail/invite', functions.isLoggedIn, functions.adminOnly, function (req, res) {
        res.render("mail/invite.ejs", {
            invite: {
                invitedBy: "TestUser",
                acceptUrl: "http://localhost:3000/accept/12345"
            }
        })
    });

    app.get('/admin/mail/message', functions.isLoggedIn, functions.adminOnly, function (req, res) {
        res.render("mail/message.ejs", {
            notification: {
                senderName: "Sender-Dan",
                message: "This is some message.  It's really long. This is some message.  It's really long. This is some message.  It's really long. This is some message.  It's really long. This is some message.  It's really long. actually This is some message.  It's really long. This is some message.  It's really long. ",
                trackName: "My Track",
                acceptUrl: "http://localhost:3000/track/12345"
            }
        })
    });

    app.post('/admin/send-weekly-report', (req, res) => {
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

    app.post('/admin/invites/add', (req, res) => {
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

    app.post('/admin/invites/blacklist', (req, res) => {
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

    app.post('/admin/users/block', (req, res) => {
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

    app.post('/admin/users/verify', (req, res) => {
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

    app.post('/admin/session/unboot', (req, res) => {
        const idx = bootSession.indexOf(req.body.session);
        if (idx >= 0) {
            console.log(`Removing ${req.body.session} from blacklist`);
            (bootSession as any).splice(idx, 1);
        }
        res.redirect("/admin/overview");
    });

    app.post('/admin/users/lock', (req, res) => {
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

    app.get('/admin/errors', (req, res) => {
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

    app.get('/admin/users', (req, res) => {
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

    app.get('/admin/contacts', (req, res) => {
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

    app.get('/admin/contacts/download', (req, res) => {
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

    app.get('/admin/releases', (req, res) => {
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

    app.get('/peerverif/a7565fbd8b81b42031fd893db7645856f9d6f377a188e95423702e804c7b64b1', (req, res) => {
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

    app.get('/playback-history/a6565fbd8b81b42031fd893db7645856f9d6f377a188e95423702e804c7b64b1', functions.isLoggedIn, functions.adminOnly, function (req, res) {
        const length = 1000;
        const start = 0;
        var options = { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' };

        jsonAPI.getPlaybackHistory(req.body.user, req.body.anonuser, req.body.release, start, length)
            .then(output => {
                output.records.forEach(r => {
                    r.playbackDateDisplay = jsonAPI._timeSince(r.playbackDate) || "just now";
                    const user = r.user ? r.user : r.anonymousUser;
                    r.nextPlaybackDateDisplay = user && user.freePlaysRemaining > 0 && user.nextFreePlayback
                        ? user.nextFreePlayback.toLocaleDateString('en-US', options) + " (" + user.freePlaysRemaining + ")"
                        : "N/A";
                });
                return output;
            })
            .then(output => {
                doRender(req, res, 'playback-main.ejs', {
                    search: req.body.search,
                    playbacks: output.records,
                    navigation: {
                        description: `Showing ${start + 1} to ${start + output.records.length}`,
                        start: start,
                        length: length,
                    }
                });
            });
    });
    function doRender(req, res, view, context) {
        // console.log("Calling doRender in " + view);
        const b = req.user && req.user.profileAddress ? musicoinApi.getAccountBalance(req.user.profileAddress) : Promise.resolve(null);
        return b.then(balance => {
            if (req.user) {
                req.user.formattedBalance = balance ? balance.formattedMusicoinsShort : "0";
            }
            const defaultContext = {
                user: req.user || {},
                isAuthenticated: req.isAuthenticated(),
                isAdmin: this.isAdmin(req.user),
                hasInvite: !req.isAuthenticated()
                    && req.session
                    && req.session.inviteCode
                    && req.session.inviteCode.trim().length > 0,
                inviteClaimed: req.query.inviteClaimed == "true",
            };
            res.render(view, Object.assign({}, defaultContext, context));
        })
    }
}