// models
import { Promise } from 'bluebird';

import { ExchangeRateProvider } from '../extra/exchange-service';
import { MailSender } from '../extra/mail-sender';
import { AddressResolver } from '../internal/address-resolver';
import { MusicoinAPI } from '../internal/musicoin-api';
import { MusicoinHelper } from '../internal/musicoin-helper';
import { MusicoinOrgJsonAPI } from '../rest-api/json-api';
import { RequestCache } from '../utils/cached-request';
import * as FormUtils from '../utils/form-utils';
import { DashboardRouter } from './admin-dashboard-routes';

const User = require('../models/user');
const Release = require('../models/release');

// internal
// rest-api
// extra
// utils
const MESSAGE_TYPES = {
    admin: "admin",
    comment: "comment",
    release: "release",
    donate: "donate",
    follow: "follow",
    tip: "tip",
};
const bootSession = process.env.BOOTSESSION;

export class AdminRoutes {
    constructor(app, passport, musicoinApi: MusicoinAPI, mediaProvider, config: any) {
        const cachedRequest = new RequestCache();
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

        app.use('/admin', isLoggedIn, adminOnly);
        app.use('/admin/*', isLoggedIn, adminOnly);
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

        app.get('/admin/su', isLoggedIn, adminOnly, function (req, res) {
            // render the page and pass in any flash data if it exists
            res.render('su.ejs', { message: req.flash('loginMessage') });
        });

        // process the login form
        // process the login form
        app.post('/admin/su', isLoggedIn, adminOnly, passport.authenticate('local-su', {
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

        app.get('/admin/licenses/dump', isLoggedIn, adminOnly, function (req, res) {
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

        app.get('/admin/artists/dump', isLoggedIn, adminOnly, function (req, res) {
            // render the page and pass in any flash data if it exists
            jsonAPI.getAllArtists()
                .then(function (all) {
                    res.json(all);
                })
        });

        app.get('/admin/overview', isLoggedIn, adminOnly, function (req, res) {
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
                userMetrics.push({ name: "Users", value: _formatNumber(usersWithProfile) });
                userMetrics.push({ name: "Musicians", value: _formatNumber(usersWithRelease) });

                const trackMetrics = [];
                trackMetrics.push({ name: "Tracks", value: _formatNumber(trackCount) });
                trackMetrics.push({ name: "Deleted Tracks", value: _formatNumber(deletedTrackCount) });
                trackMetrics.push({ name: "totalPlays", value: _formatNumber(allReleaseStats[0].totalPlays) });
                trackMetrics.push({ name: "totalTips", value: _formatNumber(allReleaseStats[0].totalTips) });
                trackMetrics.push({ name: "totalComments", value: _formatNumber(allReleaseStats[0].totalComments) });

                return doRender(req, res, 'admin-overview.ejs', {
                    accounts: output,
                    userMetrics: userMetrics,
                    trackMetrics: trackMetrics,
                    bootSessions: bootSession
                });
            })
        });

        app.get('/admin/mail/confirm', isLoggedIn, adminOnly, function (req, res) {
            res.render("mail/email-confirmation.ejs", {
                code: "XY12345"
            })
        });

        app.get('/admin/mail/reset', isLoggedIn, adminOnly, function (req, res) {
            res.render("mail/password-reset.ejs", {
                link: "http://google.com?test=123455"
            })
        });

        app.get('/admin/mail/invite', isLoggedIn, adminOnly, function (req, res) {
            res.render("mail/invite.ejs", {
                invite: {
                    invitedBy: "TestUser",
                    acceptUrl: "http://localhost:3000/accept/12345"
                }
            })
        });

        app.get('/admin/mail/message', isLoggedIn, adminOnly, function (req, res) {
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

        // route middleware to make sure a user is logged in
        function isLoggedIn(req, res, next) {

            // if (true) return next();
            // console.log(`Checking is user isAuthenticated: ${req.isAuthenticated()}, ${req.originalUrl}, session:${req.sessionID}`);

            // if user is authenticated in the session, carry on
            if (req.isAuthenticated())
                return next();

            // console.log(`User is not logged in, redirecting`);

            // if they aren't redirect them to the home page
            req.session.destinationUrl = req.originalUrl;
            res.redirect('/welcome');
        }

        function isAdmin(user) {
            return (user && user.google && user.google.email && user.google.email.endsWith("@musicoin.org"));
        }

        function adminOnly(req, res, next) {

            // if user is authenticated in the session, carry on
            if (isAdmin(req.user))
                return next();

            // if they aren't redirect them to the error page
            res.redirect('/error');
        }

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
                    isAdmin: isAdmin(req.user),
                    hasInvite: !req.isAuthenticated()
                        && req.session
                        && req.session.inviteCode
                        && req.session.inviteCode.trim().length > 0,
                    inviteClaimed: req.query.inviteClaimed == "true",
                };
                res.render(view, Object.assign({}, defaultContext, context));
            })
        }
        function _formatNumber(value: any, decimals?: number) {
            const raw = parseFloat(value).toFixed(decimals ? decimals : 0);
            const parts = raw.toString().split(".");
            parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
            return parts.join(".");
        }
    }
}