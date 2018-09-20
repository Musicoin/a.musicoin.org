import { Promise } from 'bluebird';
import * as crypto from 'crypto';
import * as express from 'express';
import * as passport from 'passport';

import { ExchangeRateProvider } from '../../extra/exchange-service';
import { AddressResolver } from '../../internal/address-resolver';
import { MusicoinAPI } from '../../internal/musicoin-api';
import { MusicoinOrgJsonAPI } from '../../rest-api/json-api';
import { RequestCache } from '../../utils/cached-request';
import * as FormUtils from '../../utils/form-utils';
const fs = require('fs');
const mime = require('mime');
const User = require('../../models/user');
const Release = require('../../models/release');
const APIClient = require('../../models/api-client');
const UserStats = require('../../models/user-stats');
const ReleaseStats = require('../../models/release-stats');
const router = express.Router();
const DAY = 1000 * 60 * 60 * 24;
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

    const bootSession = config.musicoinApi.bootSession;

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

    router.post('/admin/release/abuse', (req, res) => {
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
    router.post('/admin/users/AOWBadge', (req, res) => {
      console.log("bodyID",req.body.id);
      if (!req.body.id) return res.json({ success: false, reason: "No id" });
      User.findById(req.body.id).exec()
        .then(user => {
          console.log(`User AOW status changed by ${req.user.draftProfile.artistName}, artist=${user.draftProfile.artistName}, newStatus=${req.body.AOWBadge == "true"}`);
          user.AOWBadge = req.body.AOWBadge == "true";
          return user.save();
        })
        .then(() => {
          res.json({ success: true })
        })
    });

    router.post('/admin/session/boot', (req, res) => {
      const idx = bootSession.indexOf(req.body.session);
      if (idx < 0) {
        console.log(`Adding ${req.body.session} to blacklist`);
        bootSession.push(req.body.session);
      }
      res.redirect("/admin/overview");
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

    router.get('/admin/users', functions.isLoggedIn, functions.adminOnly, (req, res) => {
          return doRender(req, res, 'admin/admin-users.ejs', {});
    });

    router.get('/admin/contacts', (req, res) => {
      const length = typeof req.query.length != "undefined" ? parseInt(req.query.length) : 10;
      const start = typeof req.query.start != "undefined" ? parseInt(req.query.start) : 0;
      const previous = Math.max(0, start - length);
      const url = '/admin/contacts?search=' + (req.query.search ? req.query.search : '');
      const downloadUrl = '/admin/contacts/download?search=' + (req.query.search ? req.query.search : '');
      jsonAPI.getAddressBook(req.query.search, start, length)
        .then(users => {
          return doRender(req, res, 'admin/admin-contacts.ejs', {
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

    router.get('/admin/contacts/download', functions.isLoggedIn, functions.adminOnly, (req, res) => {
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

    router.get('/admin/elements/releases', functions.isLoggedIn, functions.adminOnly, (req, res) => {
      let l: any = req.query.length;
      let s: any = req.query.start;
      const length = typeof l !== "undefined" ? parseInt(l) : 1000;
      const start = typeof s !== "undefined" ? Math.max(0, parseInt(s)) : 0;
      jsonAPI.getAllReleases(req.body.search, start, length)
        .then(results => {
          const releases = results.releases;
          res.json(releases);
        });
    });
    router.get('/admin/elements/users', functions.isLoggedIn, functions.adminOnly, (req, res) => {
      let l: any = req.query.length;
      let s: any = req.query.start;
      let search : any = req.query.search.value ? req.query.search.value:"";
      const length = typeof l !== "undefined" ? parseInt(l) : 1000;
      const start = typeof s !== "undefined" ? Math.max(0, parseInt(s)) : 0;
      jsonAPI.getAllUsers(search, null, null, null, start, length, null)
        .then(results => {
          const users= results.users;
          res.json(users);
        });
    });

    router.get('/peerverif/a7565fbd8b81b42031fd893db7645856f9d6f377a188e95423702e804c7b64b1', (req, res) => {
      const length = 1000;
      const start = typeof req.query.start != "undefined" ? parseInt(req.query.start) : 0;
      const previous = Math.max(0, start - length);
      const url = '/admin/users?search=' + (req.query.search ? req.query.search : '');
      jsonAPI.getAllUsers(req.query.search, null, null, null, start, length, null)
        .then(results => {
          const users = results.users;
          return doRender(req, res, 'peer-verification.ejs', {
            search: req.query.search,
            users: users
          });
        });
    });

    router.post('/releases/link', function (req, res) {
      return Release.find({ artist: { $exists: false } }).limit(100).exec()
        .then(releases => {
          return Promise.all(releases.map(r => {
            return User.findOne({ profileAddress: r.artistAddress }).exec()
              .then(artist => {
                if (!artist) {
                  console.log(`Could not find an artist for release: ${r._id}, ${r.title}`);
                  return Promise.resolve(null);
                }
                const name = artist.draftProfile && artist.draftProfile.artistName
                  ? artist.draftProfile.artistName
                  : artist.profileAddress;
                console.log(`Linking ${r.title} to ${name}`);
                r.artist = artist._id;
                return r.save();
              })
          }))
        })
        .then(() => {
          return {
            success: true
          }
        })
        .catch(err => {
          console.log("Failed to link releases: " + err);
          return {
            success: true,
            reason: err
          }
        })
    });

    router.post('/admin/elements/release-count', function (req, res) {
      const a = Release.count({ contractAddress: { $exists: true, $ne: null }, state: "published" }).exec();
      const d = Release.count({ contractAddress: { $exists: true, $ne: null }, state: "published", releaseDate: { $gte: Date.now() - DAY } }).exec();
      return Promise.join(a, d, (all, day) => {
        doRender(req, res, 'admin/count.ejs', {
          count: all,
          type: "Total Releases",
          subcount: day,
          subtype: "in the last day"
        });
      })
    });

    router.post('/admin/elements/artist-count', function (req, res) {

      let a = User.count({
        profileAddress: { $exists: true, $ne: null },
        mostRecentReleaseDate: { $exists: true, $ne: null }
      });

      let v = User.count({
        profileAddress: { $exists: true, $ne: null },
        mostRecentReleaseDate: { $exists: true, $ne: null },
        verified: true
      });

      return Promise.join(a, v, (artistCount, verifiedCount) => {
        doRender(req, res, 'admin/count.ejs', {
          count: artistCount,
          type: "Total Artists",
          subcount: verifiedCount,
          subtype: "verified"
        });
      })
    });

    router.post('/admin/elements/user-count', function (req, res) {
      const a = User.count({ profileAddress: { $exists: true, $ne: null } }).exec();
      const d = User.count({ profileAddress: { $exists: true, $ne: null }, joinDate: { $gte: Date.now() - DAY } }).exec();
      return Promise.join(a, d, (all, day) => {
        doRender(req, res, 'admin/count.ejs', {
          count: all,
          type: "Total Users",
          subcount: day,
          subtype: "in the last day"
        })
      })
    });

    router.post('/admin/elements/play-count', function (req, res) {
      return ReleaseStats.aggregate([
        { $match: { duration: "all" } },
        { $group: { _id: "all", plays: { $sum: "$playCount" } } }])
        .then(results => {
          let count: number = results.length ? results[0].plays : 0;
          doRender(req, res, 'admin/count.ejs', {
            count: count,
            type: "Total Plays"
          });
        });
    });

    router.post('/admin/elements/tip-count', function (req, res) {
      const releaseTips = ReleaseStats.aggregate([
        { $match: { duration: "all" } },
        { $group: { _id: "all", tips: { $sum: "$tipCount" } } }]);

      const userTips = UserStats.aggregate([
        { $match: { duration: "all" } },
        { $group: { _id: "all", tips: { $sum: "$tipCount" } } }]);

      return Promise.join(releaseTips, userTips, (releaseResults, userResults) => {
        let count = (releaseResults.length ? releaseResults[0].tips : 0) + (userResults.length ? userResults[0].tips : 0);
        doRender(req, res, 'admin/count.ejs', {
          count: count,
          type: "Total Tips"
        });
      });
    });

    router.get('/admin/new-releases', functions.isLoggedIn, functions.adminOnly, function (req, res) {
      doRender(req, res, 'admin/releases.ejs', {});
    });
    router.get("/admin", functions.isLoggedIn, functions.adminOnly, function (req: any, res: any): any {
      let totalUser: number = User.count({ profileAddress: { $exists: true, $ne: null } }).exec();
      let lastDayUser: number = User.count({ profileAddress: { $exists: true, $ne: null }, joinDate: { $gte: Date.now() - DAY } }).exec();

      let artistCount: number = User.count({
        profileAddress: { $exists: true, $ne: null },
        mostRecentReleaseDate: { $exists: true, $ne: null }
      });

      let verifiedCount: number = User.count({
        profileAddress: { $exists: true, $ne: null },
        mostRecentReleaseDate: { $exists: true, $ne: null }, verified: true
      });

      let totalRelease: number = Release.count({ contractAddress: { $exists: true, $ne: null }, state: "published" }).exec();
      let lastDayRelease: number = Release.count({
        contractAddress: { $exists: true, $ne: null },
        state: "published", releaseDate: { $gte: Date.now() - DAY }
      }).exec();

      let playCount: number = ReleaseStats.aggregate([
        { $match: { duration: "all" } },
        { $group: { _id: "all", plays: { $sum: "$playCount" } } }])
        .then(results => {
          let count: number = results.length ? results[0].plays : 0;
          return count;
        });

      let releaseTips: number = ReleaseStats.aggregate([
        { $match: { duration: "all" } },
        { $group: { _id: "all", tips: { $sum: "$tipCount" } } }]);

      let userTips: number = UserStats.aggregate([
        { $match: { duration: "all" } },
        { $group: { _id: "all", tips: { $sum: "$tipCount" } } }]);

      let totalTip: number = (releaseTips > 0 ? releaseTips[0].tips : 0) + (userTips > 0 ? userTips[0].tips : 0);
      // tslint:disable-next-line:max-line-length
      return Promise.join(totalUser, lastDayUser, artistCount, verifiedCount, totalRelease, lastDayRelease, playCount, totalTip, (totalUsers, lastDayUsers, artistCounts, verifiedCounts, totalReleases, lastDayReleases, playCounts, totalTips) => {
        doRender(req, res, "admin/admin.ejs", {
          totalUser: totalUsers.toLocaleString("en"),
          lastDayUser: lastDayUsers.toLocaleString("en"),
          artistCount: artistCounts.toLocaleString("en"),
          verifiedCount: verifiedCounts.toLocaleString("en"),
          totalRelease: totalReleases.toLocaleString("en"),
          lastDayRelease: lastDayReleases.toLocaleString("en"),
          playCount: playCounts.toLocaleString("en"),
          totalTip: totalTips.toLocaleString("en")
        });
      });
    });



    router.get('/admin/playback-history', functions.isLoggedIn, functions.adminOnly, function (req, res) {
      doRender(req, res, 'admin/playback-history.ejs', {});
    });

    router.get('/admin/elements/playback-history', functions.isLoggedIn, functions.adminOnly, function (req, res) {
      let l: any = req.query.length;
      let s: any = req.query.start;
      const length = typeof l !== "undefined" ? parseInt(l) : 30000;
      const start = typeof s !== "undefined" ? Math.max(0, parseInt(s)) : 0;
      var options = { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' };

      jsonAPI.getPlaybackHistory(req.body.user, req.body.anonuser, req.body.release, start, length)
        .then(output => {
          output.records.forEach(r => {
            r.playbackDateDisplay = jsonAPI._timeSince(r.playbackDate) || "seconds ago";
            const user = r.user ? r.user : r.anonymousUser;
            r.nextPlaybackDateDisplay = user && user.freePlaysRemaining > 0 && user.nextFreePlayback
              ? user.nextFreePlayback.toLocaleDateString('en-US', options) + " (" + user.freePlaysRemaining + ")"
              : "N/A";
          });
          return output;
        })
        .then(output => {
          res.json(output.records);
        });
    });

    router.get('/admin/artist-verified', functions.isLoggedIn, functions.adminOnly, (req, res) => {
      const length = typeof req.query.length != "undefined" ? parseInt(req.query.length) : 10;
      const start = typeof req.query.start != "undefined" ? parseInt(req.query.start) : 0;
      const previous = Math.max(0, start - length);
      const url = '/admin/artist-verified?search=' + (req.query.search ? req.query.search : '');
      jsonAPI.getAllUsers(req.query.search, null, 'true', 'true', 0, length, null)
        .then(results => {
          const users = results.users;
          return doRender(req, res, 'admin/artist-verified.ejs', {
            search: req.query.search,
            users: users,
            navigation: {
              show10: `${url}&length=10`,
              show25: `${url}&length=25`,
              show50: `${url}&length=50`,
              show100: `${url}&length=100`,
              description: `Showing ${start + 1} to ${start + users.length}`,
              start: previous > 0 ? `${url}&length=${length}` : null,
              back: previous >= 0 && previous < start ? `${url}&length=${length}&start=${start - length}` : null,
              next: users.length >= length ? `${url}&length=${length}&start=${start + length}` : null
            }
          });
        });
    });

    router.get('/admin/user-blocked', functions.isLoggedIn, functions.adminOnly, (req, res) => {
      const length = typeof req.query.length != "undefined" ? parseInt(req.query.length) : 10;
      const start = typeof req.query.start != "undefined" ? parseInt(req.query.start) : 0;
      const previous = Math.max(0, start - length);
      const url = '/admin/user-blocked?search=' + (req.query.search ? req.query.search : '');
      jsonAPI.getAllUsers(req.query.search, null, 'false', 'false', 0, length, 'true')
        .then(results => {
          const users = results.users;
          return doRender(req, res, 'admin/user-blocked.ejs', {
            search: req.query.search,
            users: users,
            navigation: {
              show10: `${url}&length=10`,
              show25: `${url}&length=25`,
              show50: `${url}&length=50`,
              show100: `${url}&length=100`,
              description: `Showing ${start + 1} to ${start + users.length}`,
              start: previous > 0 ? `${url}&length=${length}` : null,
              back: previous >= 0 && previous < start ? `${url}&length=${length}&start=${start - length}` : null,
              next: users.length >= length ? `${url}&length=${length}&start=${start + length}` : null
            }
          });
        });
    });

    router.get('/admin/user-verified', functions.isLoggedIn, functions.adminOnly, (req, res) => {
      const length = typeof req.query.length != "undefined" ? parseInt(req.query.length) : 10;
      const start = typeof req.query.start != "undefined" ? parseInt(req.query.start) : 0;
      const previous = Math.max(0, start - length);
      const url = '/admin/user-verified?search=' + (req.query.search ? req.query.search : '');
      jsonAPI.getAllUsers(req.query.search, null, 'true', 'false', 0, length, null)
        .then(results => {
          const users = results.users;
          return doRender(req, res, 'admin/user-verified.ejs', {
            search: req.query.search,
            users: users,
            navigation: {
              show10: `${url}&length=10`,
              show25: `${url}&length=25`,
              show50: `${url}&length=50`,
              show100: `${url}&length=100`,
              description: `Showing ${start + 1} to ${start + users.length}`,
              start: previous > 0 ? `${url}&length=${length}` : null,
              back: previous >= 0 && previous < start ? `${url}&length=${length}&start=${start - length}` : null,
              next: users.length >= length ? `${url}&length=${length}&start=${start + length}` : null
            }
          });
        });
    });

    router.get('/admin/artist-unverified', functions.isLoggedIn, functions.adminOnly, (req, res) => {
      const length = typeof req.query.length != "undefined" ? parseInt(req.query.length) : 10;
      const start = typeof req.query.start != "undefined" ? parseInt(req.query.start) : 0;
      const previous = Math.max(0, start - length);
      const url = '/admin/artist-unverified?search=' + (req.query.search ? req.query.search : '');
      jsonAPI.getAllUsers(req.query.search, null, 'false', 'true', 0, length, null)
        .then(results => {
          const users = results.users;
          return doRender(req, res, 'admin/artist-unverified.ejs', {
            search: req.query.search,
            users: users,
            navigation: {
              show10: `${url}&length=10`,
              show25: `${url}&length=25`,
              show50: `${url}&length=50`,
              show100: `${url}&length=100`,
              description: `Showing ${start + 1} to ${start + users.length}`,
              start: previous > 0 ? `${url}&length=${length}` : null,
              back: previous >= 0 && previous < start ? `${url}&length=${length}&start=${start - length}` : null,
              next: users.length >= length ? `${url}&length=${length}&start=${start + length}` : null
            }
          });
        });
    });


    router.get('/admin/elements/account-balances', functions.isLoggedIn, functions.adminOnly, function (req, res) {
      // render the page and pass in any flash data if it exists
      const b = musicoinApi.getMusicoinAccountBalance();
      const o = musicoinApi.getAccountBalances(config.trackingAccounts.map(ta => ta.address));
      Promise.join(b, o, (mcBalance, balances) => {
        const output = [];
        balances.forEach((balance, index) => {
          const accountDetails = config.trackingAccounts[index];
          output.push({
            balance: balance.musicoins,
            formattedBalance: balance.formattedMusicoins,
            name: accountDetails.name,
            address: accountDetails.address,
          })
        })
        output.push({
          balance: mcBalance.musicoins,
          formattedBalance: mcBalance.formattedMusicoins,
          name: "MC Client Balance",
          address: "",
        });
        res.json(output);
      });
    });

    router.get('/admin/account-balances', functions.isLoggedIn, functions.adminOnly, function (req, res) {
      doRender(req, res, 'admin/account-balances.ejs', {});
    });

    router.get('/admin/ppp-analyzer', functions.isLoggedIn, functions.adminOnly, function (req, res) {
      doRender(req, res, 'admin/ppp-analyzer.ejs', {});
    });

    router.get('/admin/ppp-logs', functions.isLoggedIn, functions.adminOnly, function (req, res) {
      fs.stat(process.cwd() + '/logs/ppp.json', function (err) {
        if (err == null) {
          var mimetype = mime.lookup(process.cwd() + '/logs/ppp.json');
          res.setHeader('Content-disposition', 'attachment; filename=ppp.json');
          res.setHeader('Content-type', mimetype);
          var filestream = fs.createReadStream(process.cwd() + '/logs/ppp.json');
          filestream.pipe(res);
        } else if (err.code == 'ENOENT') {
        } else {
          console.log(err.code);
        }
      });
    });

    router.get('/admin/api-clients', functions.isLoggedIn, functions.adminOnly, function (req, res) {
      doRender(req, res, 'admin/api-clients.ejs', {});
    });
    router.get('/admin/elements/api-clients', functions.isLoggedIn, functions.adminOnly, function (req, res) {
      let l: any = req.query.length;
      let s: any = req.query.start;
      const length = typeof l !== "undefined" ? parseInt(l) : 10;
      const start = typeof s !== "undefined" ? Math.max(0, parseInt(s)) : 0;
      jsonAPI.getAllAPIClients(start, length)
        .then(results => {
          const clients = results.clients;
          res.json(clients);
        });
    });


    router.post('/api-clients/delete', (req, res) => {
      APIClient.findById(req.body.id).exec()
        .then(client => {
          if (!client) throw Error("Could not find requested client");
          return client.remove();
        })
        .then(() => {
          res.json({ success: true })
        })
        .catch(err => {
          console.log("Failed to delete API client: " + err);
          res.json({ success: false, err: err.message });
        })
    });

    router.post('/api-clients/add', (req, res) => {
      const clientId = crypto.randomBytes(16).toString('hex'); // 128-bits
      APIClient.create({
        name: req.body.name,
        clientId: clientId,
        domains: [],
        methods: ["GET"]
      })
        .then((record) => {
          res.json({ success: true });
        })
        .catch(err => {
          console.log(`could not create new API user: ${err}`);
          res.json({ success: false, err: err.message });
        });
    });

    router.post('/api-clients/lock', (req, res) => {
      if (!req.body.id) return res.json({ success: false, reason: "No id" });
      if (typeof req.body.lock == "undefined") return res.json({ success: false, reason: "specify true/false for 'lock' parameter" });
      APIClient.findById(req.body.id).exec()
        .then(user => {
          user.accountLocked = req.body.lock == "true";
          return user.save();
        })
        .then(() => {
          res.json({ success: true })
        })
    });

    router.post('/api-clients/save', (req, res) => {
      if (!req.body.id) return res.json({ success: false, reason: "No id" });
      APIClient.findById(req.body.id).exec()
        .then(user => {
          user.domains = req.body.domains.split(",").map(s => s.trim()).filter(s => s);
          user.methods = req.body.methods.split(",").map(s => s.trim()).filter(s => s);
          return user.save();
        })
        .then(() => {
          res.json({ success: true })
        })
    });

    function _timeSince(date) {
      const seconds = Math.floor((Date.now() - date) / 1000);

      const intervals = [
        { value: 60, unit: "min" },
        { value: 60, unit: "hour" },
        { value: 24, unit: "day" },
        { value: 30, unit: "month" },
        { value: 12, unit: "year" },
      ]

      let unit = "second";
      let value = seconds;
      for (let i = 0; i < intervals.length; i++) {
        const interval = intervals[i];
        if (value > interval.value) {
          unit = interval.unit;
          value = value / interval.value;
        }
        else {
          break;
        }
      }

      if (unit == "second") {
        return "";
      }

      const rounded = Math.round(value);
      if (rounded != 1) {
        unit += "s";
      }
      return `${rounded} ${unit} ago`;
    }
  }

  _formatNumber(value: any, decimals?: number) {
    var raw = parseFloat(value).toFixed(decimals ? decimals : 0);
    var parts = raw.toString().split(".");
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    return parts.join(".");
  }
  getRouter() {
    return router;
  }
}
