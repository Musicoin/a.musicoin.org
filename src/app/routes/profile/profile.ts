import { Promise } from 'bluebird';
import * as express from 'express';
import * as Formidable from 'formidable';

import { ExchangeRateProvider } from '../../extra/exchange-service';
import { MailSender } from '../../extra/mail-sender';
import { AddressResolver } from '../../internal/address-resolver';
import { MusicoinAPI } from '../../internal/musicoin-api';
import { MusicoinHelper } from '../../internal/musicoin-helper';
import * as MetadataLists from '../../metadata/metadata-lists';
import { MusicoinOrgJsonAPI } from '../../rest-api/json-api';
import { RequestCache } from '../../utils/cached-request';
import * as FormUtils from '../../utils/form-utils';
import * as fs from 'fs';
const get_ip = require('request-ip');
const Aria2 = require("aria2");
const ARIA_OPTIONS = {
    host: 'localhost',
    port: 6800,
    secure: false,
    secret: '',
    path: '/jsonrpc'
}
const aria2 = new Aria2([ARIA_OPTIONS]);

const router = express.Router();
const Playback = require('../../models/user-playback');
const maxImageWidth = 400;
const maxHeroImageWidth = 1300;
var functions = require('../routes-functions');
const User = require('../../models/user');
const Release = require('../../models/release');
let publicPagesEnabled = false;
let pin = functions.pinCodeReturnVal();
let tDate = functions.tCodeReturnVal();
let extraCode = functions.extraCodeReturnVal();
var txRequest = [];
const MESSAGE_TYPES = {
    admin: "admin",
    comment: "comment",
    release: "release",
    donate: "donate",
    follow: "follow",
    tip: "tip",
};
export class ProfileRouter {
    constructor(musicoinApi: MusicoinAPI,
        jsonAPI: MusicoinOrgJsonAPI,
        addressResolver: AddressResolver,
        maxImageWidth: number,
        maxHeroImageWidth: number,
        mediaProvider: any, // TODO
        config: any,
        doRender: any) {
        const serverEndpoint = config.serverEndpoint;
        const whiteLocalIpList = config.musicoinApi.whiteLocalIpList;
        const mailSender = new MailSender();
        const cachedRequest = new RequestCache();
        const exchangeRateProvider = new ExchangeRateProvider(config.exchangeRateService, cachedRequest);
        let mcHelper = new MusicoinHelper(musicoinApi, mediaProvider, config.playbackLinkTTLMillis);
        const defaultProfileIPFSImage = config.musicoinApi.defaultProfileIPFSImage;

        // =====================================
        // PUBLIC ARTIST PROFILE SECTION =======
        // =====================================

        router.get('/info/:address', function (req, res) {
            return doRender(req, res, "info.ejs", { artist: req.params.address })
        })

        router.get('/artist/:address', function (req, res) {

            // find tracks for artist
            const m = jsonAPI.getUserMessages(req.params.address, 30);
            const a = jsonAPI.getArtist(req.params.address, true, false);
            const h = jsonAPI.getUserHero(req.params.address);
            const r = jsonAPI.getUserStatsReport(req.params.address, Date.now(), 'all');
            const x = exchangeRateProvider.getMusicoinExchangeRate();
            Promise.join(a, m, h, r, x, (output, messages, hero, statsReport, exchangeRate) => {
                if (!output) return res.redirect("/not-found");

                let totalTips = statsReport.stats.user.tipCount;
                let totalPlays = 0;
                statsReport.stats.releases.forEach(rs => {
                    totalPlays += rs.playCount;
                    totalTips += rs.tipCount;
                });

                output.messages = messages;
                hero.description = output.artist.description;
                output.hero = hero;
                output.showPlayAll = true;
                output.artistStats = {
                    playCount: totalPlays,
                    tipCount: totalTips,
                    totalEarned: (totalPlays + totalTips),
                    formattedTotalUSD: "$" + functions._formatNumber((totalPlays + totalTips) * exchangeRate.usd, 2)
                };
                output.exchangeRate = exchangeRate;
                return doRender(req, res, "artist.ejs", output);
            })
        });

        router.get('/music-player/:address', function (req, res) {
            const address = FormUtils.defaultString(req.params.address, null);
            if (!address) {
                console.log(`Failed to load track page, no address provided`);
                return res.render('not-found.ejs');
            }
            const l = jsonAPI.getLicense(address);
            const r = Release.findOne({ contractAddress: address, state: 'published' })

            Promise.join(l, r, (license, release) => {
                if (!license || !release) {
                    console.log(`Failed to load track page for license: ${address}, err: Not found`);
                    return res.render('not-found.ejs');
                }
                fs.stat(config.streaming.tracks + '/' + address + '/' + 'index.m3u8', function (err) {
                    if (err == null) {
                        //console.log("hls transcoding already done");
                        return doRender(req, res, "player/simple-player.ejs", {
                            trackAddress: config.musicoinApi.baseUrl + '/tracks/' + address + '/index.m3u8',
                            license: license
                        });
                    } else if (err.code == 'ENOENT') {
                        fs.stat(config.streaming.org + '/' + address + '/' + address + '.mp3', function (err) {
                            if (err == null) {
                                //console.log("track already saved");
                                fs.stat(config.streaming.org + '/' + address + '/' + 'index.m3u8', function (err) {
                                    if (err == null) {
                                        //console.log("hls transcoding already done");
                                    } else if (err.code == 'ENOENT') {
                                        require('child_process').exec('ffmpeg -re -i ' + config.streaming.org + '/' + address + '/' + address + '.mp3' + ' -codec copy -bsf h264_mp4toannexb -map 0 -f segment -segment_time ' + config.streaming.segments + ' -segment_format mpegts -segment_list ' + config.streaming.org + '/' + address + '/' + 'index.m3u8 -segment_list_type m3u8 ' + config.streaming.org + '/' + address + '/ts%d.ts ' + '&& cd ' + config.streaming.tracks + '/' + ' && mkdir ' + address + ' && cd ' + config.streaming.org + '/' + address + '/' + ' && find . ' + "-regex '.*\\.\\(ts\\|m3u8\\)' -exec mv {} " + config.streaming.tracks + '/' + address + '/' + ' \\;');
                                    } else {
                                        console.log('Something went wrong with hls file detection', err.code);
                                    }
                                });
                                res.render('encoding/encoding-not-done.ejs');
                            } else if (err.code == 'ENOENT') {
                                aria2.open();
                                aria2.call("addUri", [musicoinApi.getPPPUrl(address)], { continue: "true", out: address + ".mp3", dir: config.streaming.org + '/' + address });
                                aria2.on("onDownloadError", ([guid]) => {
                                    console.log('trackDownloadError: ' + address, guid);
                                });
                                aria2.on("onDownloadStart", ([guid]) => {
                                    console.log('trackDownloadStart: ' + address, guid);
                                });
                                aria2.on("onDownloadComplete", ([guid]) => {
                                    console.log('trackDownloadComplete: ' + address, guid);
                                    aria2.close();
                                    fs.stat(config.streaming.org + '/' + address + '/' + 'index.m3u8', function (err) {
                                        if (err == null) {
                                            //console.log("hls transcoding already done");
                                        } else if (err.code == 'ENOENT') {
                                            require('child_process').exec('ffmpeg -re -i ' + config.streaming.org + '/' + address + '/' + address + '.mp3' + ' -codec copy -bsf h264_mp4toannexb -map 0 -f segment -segment_time ' + config.streaming.segments + ' -segment_format mpegts -segment_list ' + config.streaming.org + '/' + address + '/' + 'index.m3u8 -segment_list_type m3u8 ' + config.streaming.org + '/' + address + '/ts%d.ts ' + '&& cd ' + config.streaming.tracks + '/' + ' && mkdir ' + address + ' && cd ' + config.streaming.org + '/' + address + '/' + ' && find . ' + "-regex '.*\\.\\(ts\\|m3u8\\)' -exec mv {} " + config.streaming.tracks + '/' + address + '/' + ' \\;');
                                        } else {
                                            console.log('Something went wrong with hls file detection', err.code);
                                        }
                                    });
                                    res.render('encoding/encoding-not-done.ejs');
                                });
                            } else {
                                console.log('Save file from ppp error', err.code);
                            }
                        });
                    } else {
                        console.log('Something went wrong with hls file detection', err.code);
                    }
                });
            })
                .catch(err => {
                    console.log(`Failed to load track page for license: ${address}, err: ${err}`);
                    res.render('not-found.ejs');
                })
        });

        router.get('/track/:address', function (req, res) {

            console.log("Loading track page for track address: " + req.params.address);
            const address = FormUtils.defaultString(req.params.address, null);
            if (!address) {
                console.log(`Failed to load track page, no address provided`);
                return res.render('not-found.ejs');
            }
            const ms = jsonAPI.getLicenseMessages(address, 20);
            const l = jsonAPI.getLicense(address);
            const r = Release.findOne({ contractAddress: address, state: 'published' });
            const x = exchangeRateProvider.getMusicoinExchangeRate();
            const votesPromise = jsonAPI.getVotesByTrack({ user: req.isAuthenticated() ? req.user._id : null, songAddress: address });

            Promise.join(l, ms, r, x, votesPromise, (license, messages, release, exchangeRate, votes) => {
                if (!license || !release) {
                    console.log(`Failed to load track page for license: ${address}, err: Not found`);
                    return res.render('not-found.ejs');
                }


                license.votes = votes;

                const ras = addressResolver.resolveAddresses("", license.contributors);
                const a = jsonAPI.getArtist(license.artistProfileAddress, false, false);
                Promise.join(a, ras, (response, resolvedAddresses) => {
                    let totalShares = 0;
                    resolvedAddresses.forEach(r => totalShares += parseInt(r.shares));
                    resolvedAddresses.forEach(r => r.percentage = functions._formatNumber(100 * r.shares / totalShares, 1));
                    const plays = release.directPlayCount || 0;
                    const tips = release.directTipCount || 0;
                    const usd = exchangeRate.success ? "$" + functions._formatNumber((plays + tips) * exchangeRate.usd, 2) : "";
                    fs.stat(config.streaming.tracks + '/' + address + '/' + 'index.m3u8', function (err) {
                        if (err == null) {
                            //console.log("hls transcoding already done");
                            return doRender(req, res, "track.ejs", {
                                artist: response.artist,
                                license: license,
                                trackAddress: config.musicoinApi.baseUrl + '/tracks/' + address + '/index.m3u8',
                                contributors: resolvedAddresses,
                                releaseId: release._id,
                                description: release.description,
                                messages: messages,
                                isArtist: req.user && req.user.profileAddress == license.artistProfileAddress,
                                abuseMessage: config.ui.admin.markAsAbuse,
                                exchangeRate: exchangeRate,
                                trackStats: {
                                    playCount: plays,
                                    tipCount: tips,
                                    totalEarned: (plays + tips),
                                    formattedTotalUSD: usd
                                }
                            });
                        } else if (err.code == 'ENOENT') {
                            fs.stat(config.streaming.org + '/' + address + '/' + address + '.mp3', function (err) {
                                if (err == null) {
                                    //console.log("track already saved");
                                    fs.stat(config.streaming.org + '/' + address + '/' + 'index.m3u8', function (err) {
                                        if (err == null) {
                                            //console.log("hls transcoding already done");
                                        } else if (err.code == 'ENOENT') {
                                            require('child_process').exec('ffmpeg -re -i ' + config.streaming.org + '/' + address + '/' + address + '.mp3' + ' -codec copy -bsf h264_mp4toannexb -map 0 -f segment -segment_time ' + config.streaming.segments + ' -segment_format mpegts -segment_list ' + config.streaming.org + '/' + address + '/' + 'index.m3u8 -segment_list_type m3u8 ' + config.streaming.org + '/' + address + '/ts%d.ts ' + '&& cd ' + config.streaming.tracks + '/' + ' && mkdir ' + address + ' && cd ' + config.streaming.org + '/' + address + '/' + ' && find . ' + "-regex '.*\\.\\(ts\\|m3u8\\)' -exec mv {} " + config.streaming.tracks + '/' + address + '/' + ' \\;');
                                        } else {
                                            console.log('Something went wrong with hls file detection', err.code);
                                        }
                                    });
                                    res.render('encoding/encoding-not-done.ejs');
                                } else if (err.code == 'ENOENT') {
                                    aria2.open();
                                    //console.log('aria2c ' + ' --allow-overwrite=true ' + musicoinApi.getPPPUrl(address) + ' -d ' + config.streaming.org + '/' + address + ' -o ' + address + ".mp3");
                                    aria2.call("addUri", [musicoinApi.getPPPUrl(address)], { continue: "true", out: address + ".mp3", dir: config.streaming.org + '/' + address });
                                    aria2.on("onDownloadError", ([guid]) => {
                                        console.log('trackDownloadError: ' + address, guid);
                                    });
                                    aria2.on("onDownloadStart", ([guid]) => {
                                        console.log('trackDownloadStart: ' + address, guid);
                                    });
                                    aria2.on("onDownloadComplete", ([guid]) => {
                                        console.log('trackDownloadComplete: ' + address, guid);
                                        aria2.close();
                                        fs.stat(config.streaming.org + '/' + address + '/' + 'index.m3u8', function (err) {
                                            if (err == null) {
                                                //console.log("hls transcoding already done");
                                            } else if (err.code == 'ENOENT') {
                                                require('child_process').exec('ffmpeg -re -i ' + config.streaming.org + '/' + address + '/' + address + '.mp3' + ' -codec copy -bsf h264_mp4toannexb -map 0 -f segment -segment_time ' + config.streaming.segments + ' -segment_format mpegts -segment_list ' + config.streaming.org + '/' + address + '/' + 'index.m3u8 -segment_list_type m3u8 ' + config.streaming.org + '/' + address + '/ts%d.ts ' + '&& cd ' + config.streaming.tracks + '/' + ' && mkdir ' + address + ' && cd ' + config.streaming.org + '/' + address + '/' + ' && find . ' + "-regex '.*\\.\\(ts\\|m3u8\\)' -exec mv {} " + config.streaming.tracks + '/' + address + '/' + ' \\;');
                                            } else {
                                                console.log('Something went wrong with hls file detection', err.code);
                                            }
                                        });
                                        res.render('encoding/encoding-not-done.ejs');
                                    });
                                } else {
                                    console.log('Save file from ppp error', err.code);
                                }
                            });
                        } else {
                            console.log('Something went wrong with hls file detection', err.code);
                        }
                    });
                })
            })
                .catch(err => {
                    console.log(`Failed to load track page for license: ${address}, err: ${err}`);
                    res.render('not-found.ejs');
                })

        });

        router.get('/invite-history', functions.isLoggedIn, (req, res) => {
            const length = typeof req.query.length != "undefined" ? parseInt(req.query.length) : 20;
            const start = typeof req.query.start != "undefined" ? parseInt(req.query.start) : 0;
            const previous = Math.max(0, start - length);
            const url = `/invite-history`;
            jsonAPI.getInvitedBy(req.user._id, start, length)
                .then(invites => {
                    const output = invites.map(i => {
                        return {
                            invitedAs: i.invitedAs,
                            invitedOn: functions._formatDate(i.invitedOn.getTime() / 1000),
                            claimed: i.claimed,
                            inviteCode: i.inviteCode,
                            profileAddress: i.profileAddress,
                            artistName: i.artistName,
                            hasReleased: i.hasReleased
                        };
                    });
                    return doRender(req, res, 'invite-history.ejs', {
                        invites: output,
                        navigation: {
                            description: `Showing ${start + 1} to ${start + output.length}`,
                            start: previous > 0 ? `${url}?length=${length}` : null,
                            back: previous >= 0 && previous < start ? `${url}?length=${length}&start=${start - length}` : null,
                            next: output.length >= length ? `${url}?length=${length}&start=${start + length}` : null
                        }
                    });
                });
        });

        // =====================================
        // PROFILE SECTION =====================
        // =====================================
        // we will want this protected so you have to be logged in to visit
        // we will use router middleware to verify this (the functions.isLoggedIn function)

        router.get('/profile', functions.isLoggedIn, function (req, res) {
            const a = jsonAPI.getArtist(req.user.profileAddress, true, true);
            const r = exchangeRateProvider.getMusicoinExchangeRate();
            Promise.join(a, r, (output, exchangeRate) => {
                output['invited'] = {
                    email: req.query.invited,
                    success: req.query.success == "true",
                    reason: req.query.reason,
                    inviteUrl: req.query.inviteCode ? serverEndpoint + "/accept/" + req.query.inviteCode : "",
                };
                output['profileUpdateError'] = req.query.profileUpdateError;
                output['releaseError'] = req.query.releaseError;
                if (typeof req.query.sendError != "undefined") {
                    output['sendResult'] = {
                        error: req.query.sendError,
                    };
                }
                if (typeof req.query.sendMail != "undefined") {
                    output['sendMailResult'] = {
                        error: req.query.sendMail,
                    };
                }
                if (typeof req.query.pwdError != "undefined") {
                    output['pwdResult'] = {
                        error: req.query.pwdError,
                    };
                }
                output['metadata'] = {
                    languages: MetadataLists.languages,
                    moods: MetadataLists.moods,
                    genres: MetadataLists.genres,
                    regions: MetadataLists.regions,
                };

                output.exchangeRate = exchangeRate;
                output.artist.formattedBalance = functions._formatNumber(output.artist.balance);
                output.artist.formattedUSD = exchangeRate.success
                    ? "$" + functions._formatNumber(output.artist.balance * exchangeRate.usd, 2)
                    : "";
                return doRender(req, res, "profile.ejs", output);
            })
        });

        router.post('/follows', function (req, res) {
            if (!req.isAuthenticated()) return res.json({ success: false, authenticated: false });
            if (!req.user.profileAddress) return res.json({ success: false, authenticated: true, profile: false });
            jsonAPI.isUserFollowing(req.user._id, req.body.toFollow)
                .then(result => {
                    res.json(result);
                })
                .catch((err) => {
                    console.log(`Failed to check following status, user: ${req.user._id} follows: ${req.body.toFollow}, ${err}`)
                })
        });

        router.post('/follow', function (req, res) {
            if (!req.isAuthenticated()) return res.json({ success: false, authenticated: false });
            if (!req.user.profileAddress) return res.json({ success: false, authenticated: true, profile: false });

            const updateStatus = (req.body.follow == "true")
                ? jsonAPI.startFollowing(req.user._id, req.body.toFollow)
                : jsonAPI.stopFollowing(req.user._id, req.body.toFollow);

            updateStatus
                .then(result => {
                    res.json(result);
                    return result;
                })
                .then((result) => {
                    if (result.following) {
                        if (req.body.licenseAddress) {
                            Release.findOne({ contractAddress: req.body.licenseAddress }).exec()
                                .then(release => {
                                    if (release) {
                                        return jsonAPI.postLicenseMessages(
                                            req.body.licenseAddress,
                                            null,
                                            req.user.profileAddress,
                                            `${req.user.draftProfile.artistName} is now following ${release.artistName}`,
                                            MESSAGE_TYPES.follow,
                                            null
                                        )
                                    }
                                    return null;
                                })
                                .catch(err => {
                                    console.log("Failed to send a automated-follow message: " + err);
                                })
                        }
                        else {
                            User.findById(req.body.toFollow).exec()
                                .then((followedUser) => {
                                    return jsonAPI.postLicenseMessages(
                                        null,
                                        followedUser.profileAddress,
                                        req.user.profileAddress,
                                        `${req.user.draftProfile.artistName} is now following ${followedUser.draftProfile.artistName}`,
                                        MESSAGE_TYPES.follow,
                                        null)
                                })
                        }
                    }
                })
                .catch((err) => {
                    console.log(`Failed to toggle following, user: ${req.user._id} tried to follow/unfollow: ${req.body.toFollow}, ${err}`)
                })
        });

        router.post('/tip', function (req, res) {
            if (!req.isAuthenticated()) return res.json({ success: false, authenticated: false });
            if (!req.user.profileAddress) return res.json({ success: false, authenticated: true, profile: false });

            const contractAddress = FormUtils.defaultString(req.body.recipient, null);
            if (!contractAddress) return res.json({ success: false, authenticated: true, profile: true, self: true });

            if (req.user.profileAddress == contractAddress) return res.json({ success: false, authenticated: true, profile: true, self: true });
            const units = req.body.amount == 1 ? " coin" : "coins";
            const amount = parseInt(req.body.amount);

            return Release.findOne({ contractAddress: contractAddress })
                .then(r => {
                    if (r && r.artistAddress == req.user.profileAddress) {
                        return res.json({ success: false, authenticated: true, profile: true, self: true });
                    }

                    return musicoinApi.sendFromProfile(req.user.profileAddress, req.body.recipient, req.body.amount)
                        .then(function (tx) {
                            console.log(`Payment submitted! tx : ${tx}`);
                            res.json({ success: true, tx: tx });
                        })
                        .then(() => {
                            // if this was a tip to a track, add a message to the track saying the user tipped it
                            // fire and forget (don't fail if this fails)
                            if (req.body.contextType == "TrackMessage") {
                                return jsonAPI.addToMessageTipCount(req.body.contextId, amount);
                            }
                            else if (req.body.contextType == "Release") {
                                return jsonAPI.addToReleaseTipCount(req.body.recipient, amount)
                                    .then(release => {
                                        if (release) {
                                            return jsonAPI.postLicenseMessages(
                                                req.body.recipient,
                                                null,
                                                req.user.profileAddress,
                                                `${req.user.draftProfile.artistName} tipped ${req.body.amount} ${units} on "${release.title}"`,
                                                MESSAGE_TYPES.tip,
                                                null)
                                        }
                                    })
                            }
                            else if (req.body.contextType == "User") {
                                return jsonAPI.addToUserTipCount(req.body.recipient, amount)
                                    .then(tippedUser => {
                                        if (tippedUser) {
                                            return jsonAPI.postLicenseMessages(
                                                null,
                                                tippedUser.profileAddress,
                                                req.user.profileAddress,
                                                `${req.user.draftProfile.artistName} tipped ${req.body.amount} ${units} to ${tippedUser.draftProfile.artistName}!`,
                                                MESSAGE_TYPES.tip,
                                                null)
                                        }
                                    });
                            }
                            else if (req.body.contextType == "Donate") {
                                const msg = req.body.recipient == "0xfef55843244453abc7e183d13139a528bdfbcbed"
                                    ? `${req.user.draftProfile.artistName} sponsored ${req.body.amount} plays!`
                                    : `${req.user.draftProfile.artistName} donated ${req.body.amount} ${units} to Musicoin.org!`;

                                return jsonAPI.postLicenseMessages(
                                    null,
                                    null,
                                    req.user.profileAddress,
                                    msg,
                                    MESSAGE_TYPES.donate,
                                    null)
                            }
                        })
                        .catch(function (err) {
                            console.log(err);
                            res.json({ success: false });
                        })
                })
        });

        router.post('/send', functions.isLoggedIn, function (req, res) {
            if ((req.body.recipient == "0x0000000000000000000000000000000000000000") || (req.body.recipient == "0x1111111111111111111111111111111111111111")) {
                res.redirect("/profile?sendError=false");
            } else {
                functions.pinCode();
                let amount = req.body.amount;
                let txRecipient = req.body.recipient;
                let rTime = new Date().toISOString().replace(/T/, ' ').replace(/\..+/, '');
                let ip = get_ip.getClientIp(req);
                let uAgent = "" + req.headers['user-agent'];
                functions.extraCode();
                functions.tCode();
                let cTime = tDate;
                txRequest = [req.user.profileAddress, txRecipient, amount, ip, extraCode, cTime];

                mailSender.sendWithdrawConfirmation(req.user.primaryEmail, amount, txRecipient, rTime, ip, uAgent, config.serverEndpoint + "/send/" + pin)
                    .then(() => console.log("Message notification sent to " + req.user.primaryEmail))
                    .catch(err => `Failed to send message to ${req.user.primaryEmail}, error: ${err}`);
                res.redirect("/profile?sendMail=false");
            }
        });

        router.get('/send/:pinId', functions.isLoggedIn, function (req, res) {
            if (req.params.pinId !== pin) {
                console.log(`Incorrect withdraw details provided: Wrong security code`);
            } else if (txRequest[4] !== extraCode) {
                let ip = get_ip.getClientIp(req);
                console.log(`Incorrect extraCode, possible hacking attempt from: ` + ip);
            } else if (txRequest[5] !== tDate) {
                console.log(`Incorrect details provided: Wrong withdrawal time`);
            } else {
                if (req.params.pinId == pin && txRequest[4] == extraCode && txRequest[5] == tDate) {
                    function foxySend(target, recipient, count) {
                        if (req.params.pinId !== pin) {
                            return;
                        } else {
                            functions.pinCode();
                            functions.extraCode();
                            functions.tCode();
                            return musicoinApi.sendFromProfile(target, recipient, count)
                                .then(function (tx) {
                                    if (tx) {
                                        console.log(`Payment submitted! tx : ${tx}`);
                                        res.redirect("/profile?sendError=false=" + `${tx}`);
                                    }
                                    else throw new Error(`Failed to send payment`);
                                })
                                .catch(function (err) {
                                    console.log(err);
                                    res.redirect("/profile?sendError=true");
                                });
                        }
                    }
                    foxySend(txRequest[0], txRequest[1], txRequest[2]);
                    txRequest = [];
                } else {
                    res.redirect("/profile?sendError=true");
                }
            }
        });

        router.post('/api/getUserInfoById', function (req, res) {
            //checking request's ip adress. if request source not local network, we don't servise api.
            if (functions.ipMatch(get_ip.getClientIp(req), whiteLocalIpList)) {
                //request's ipaddress local. we can send user information.
                functions.FindUserByIdOrProfileAddress(req, function (_result) {
                    res.send(JSON.stringify(_result));
                });
            } else {
                //request's ipaddress not local we send error message.
                var result = {
                    result: false,
                    message: 'unauthorized request',
                    ip: get_ip.getClientIp(req) || 'your-ip'
                }
                res.send(JSON.stringify(result));
            }
        });
        router.get('/api/getUserInfoById/:userAccessKey', function (req, res) {
            //checking request's ip adress. if request source not local network, we don't servise api.

            if (functions.ipMatch(get_ip.getClientIp(req), whiteLocalIpList)) {
                //request's ipaddress local. we can send user information.
                functions.FindUserByIdOrProfileAddress(req, function (_result) {
                    res.send(JSON.stringify(_result));
                });
            } else {
                //request's ipaddress not local we send error message.
                var result = {
                    result: false,
                    message: 'unauthorized request',
                    ip: get_ip.getClientIp(req) || 'your-ip'
                }
                res.send(JSON.stringify(result));
            }
        });

        router.post('/profile/save', functions.isLoggedIn, function (req, res) {
            const form = new Formidable.IncomingForm();
            form.parse(req, (err, fields: any, files: any) => {

                // if somehow the user when to the new user page, but already has a profile,
                // just skip this step
                const isNewUserPage = fields["isNewUserPage"] == "true";
                if (req.user.profileAddress && isNewUserPage) {
                    return res.redirect("/profile");
                }

                const prefix = "social.";
                const socialData = FormUtils.groupByPrefix(fields, prefix);

                const profile = req.user.draftProfile || {};

                // if a new image was selected, upload it to ipfs.
                // otherwise, use the existing IPFS url
                const uploadImage = (!files.photo || files.photo.size == 0)
                    ? (profile.ipfsImageUrl && profile.ipfsImageUrl.trim().length > 0)
                        ? Promise.resolve(profile.ipfsImageUrl)
                        : Promise.resolve(defaultProfileIPFSImage)
                    : FormUtils.resizeImage(files.photo.path, maxImageWidth)
                        .then((newPath) => mediaProvider.upload(newPath));

                const uploadHeroImage = (!files.hero || files.hero.size == 0)
                    ? (profile.heroImageUrl && profile.heroImageUrl.trim().length > 0)
                        ? Promise.resolve(profile.heroImageUrl)
                        : Promise.resolve(null)
                    : FormUtils.resizeImage(files.hero.path, maxHeroImageWidth)
                        .then((newPath) => mediaProvider.upload(newPath));

                const version = profile.version ? profile.version : 1;
                const genres = fields.genres || "";
                const regions = fields.regions || "";

                const tryUpdateEmailAddress = jsonAPI.userService.tryUpdateEmailAddress({ _id: req.user._id, primaryEmail: fields.primaryEmail });

                Promise.join(uploadImage, uploadHeroImage, tryUpdateEmailAddress, (imageUrl, heroImageUrl) => {
                    req.user.draftProfile = {
                        artistName: fields.artistName,
                        description: fields.description,
                        social: socialData,
                        ipfsImageUrl: imageUrl,
                        heroImageUrl: heroImageUrl,
                        genres: genres.split(",").map(s => s.trim()).filter(s => s),
                        regions: regions.split(",").map(s => s.trim()).filter(s => s),
                        version: version + 1
                    };
                    return req.user.save();
                })
                    .then(() => {
                        const d = mediaProvider.uploadText(fields.description);
                        const s = mediaProvider.uploadText(JSON.stringify(socialData));
                        return Promise.join(d, s, (descriptionUrl, socialUrl) => {
                            return musicoinApi.publishProfile(req.user.profileAddress, fields.artistName, descriptionUrl, profile.ipfsImageUrl, "", socialUrl)
                                .then((tx) => {
                                    req.user.pendingTx = tx;
                                    req.user.updatePending = true;
                                    req.user.hideProfile = !!fields.hideProfile;
                                    req.user.save(function (err) {
                                        if (err) {
                                            res.send(500);
                                        }
                                        else {
                                            if (isNewUserPage) {
                                                return res.redirect('/loginRedirect');
                                            }
                                            res.redirect("/profile");
                                        }
                                    });
                                })
                        })
                    })
                    .catch((err) => {
                        res.redirect("/profile?profileUpdateError=true");
                    })
            });
        });

        router.post('/license/view/', (req, res) => {
            const hideButtonBar = req.body.hideButtonBar == "true";
            jsonAPI.getLicense(req.body.address)
                .then(function (license) {
                    const address = req.user ? req.user.profileAddress : "";
                    return Promise.join(
                        addressResolver.resolveAddresses(address, license.contributors),
                        function (contributors) {
                            license.contributors = contributors;
                            return doRender(req, res, 'license.ejs', { showRelease: false, license: license, hideButtonBar: hideButtonBar });
                        });
                })
        });

        function convertFormToLicense(artistName, selfAddress, fields) {
            const trackFields = FormUtils.groupByPrefix(fields, `track0.`);
            const recipients = FormUtils.extractRecipients(trackFields);
            return Promise.join(
                addressResolver.resolveAddresses(selfAddress, recipients.contributors),
                addressResolver.resolveAddresses(selfAddress, recipients.royalties),
                function (resolvedContributors, resolveRoyalties) {
                    const license = {
                        coinsPerPlay: 1,
                        title: trackFields['title'],
                        artistName: artistName,
                        royalties: resolveRoyalties,
                        contributors: resolvedContributors,
                        errors: []
                    };
                    license.errors = doValidation(license);
                    return license;
                })
        }

        function doValidation(license): string[] {
            const errors = [];
            if (!license.royalties.every(r => !r.invalid)) errors.push("Invalid addresses");
            if (!license.contributors.every(r => !r.invalid)) errors.push("Invalid addresses");
            if (!(license.title && license.title.trim() != "")) errors.push("Title is required");
            return errors;
        }

        router.post('/license/distributeBalance', functions.isLoggedIn, functions.hasProfile, function (req, res) {
            const contractAddress = req.body.contractAddress;
            musicoinApi.distributeBalance(contractAddress)
                .then(tx => {
                    console.log(`distributed balance: ${tx}`);
                    res.json({ success: true });
                })
                .catch(function (err) {
                    res.json({ success: false, message: err.message });
                });
        });

        router.post('/license/delete', functions.isLoggedIn, functions.hasProfile, function (req, res) {
            // mark release status as deleted
            // remove from playbacks
            const contractAddress = FormUtils.defaultString(req.body.contractAddress, "");
            if (!contractAddress) return res.json({ success: false, message: "Not contractAddress was specified" });
            Release.findOne({ contractAddress: contractAddress, artistAddress: req.user.profileAddress }).exec()
                .then(function (record) {
                    if (!record) {
                        console.log(`Failed to delete release: no record found with contractAddress: ${contractAddress}`);
                        throw new Error("Could not find record");
                    }
                    record.state = 'deleted';
                    record.save(function (err) {
                        if (err) {
                            console.log(`Failed to delete release: no record found with contractAddress: ${contractAddress}, error: ${err}`);
                            throw new Error("The database responded with an error");
                        }
                    })
                })
                .then(function () {
                    return Playback.find({ contractAddress: contractAddress }).remove().exec();
                })
                .then(function () {
                    res.json({ success: true });
                })
                .catch(function (err) {
                    res.json({ success: false, message: err.message });
                });
        });
    }
    getRouter() {
        return router;
    }
}
