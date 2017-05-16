import * as express from 'express';
import {Promise} from 'bluebird';
const router = express.Router();
import {AddressResolver} from "./address-resolver";
import {MusicoinOrgJsonAPI} from "./rest-api/json-api";
import {MusicoinAPI} from "./musicoin-api";
import * as crypto from 'crypto';

const Release = require('../app/models/release');
const User = require('../app/models/user');
const ReleaseStats = require('../app/models/release-stats');
const APIClient = require('../app/models/api-client');
const UserStats = require('../app/models/user-stats');


export class DashboardRouter {
  constructor(musicoinApi: MusicoinAPI,
              jsonAPI: MusicoinOrgJsonAPI,
              addressResolver: AddressResolver,
              maxImageWidth: number,
              mediaProvider: any, // TODO
              config: any,
              doRender: any) {
    router.get('/', function(req, res) {
      doRender(req, res, 'admin/dashboard.ejs', {});
    });

    router.post('/elements/playback-history', function(req, res) {
      const length = typeof req.body.length != "undefined" ? parseInt(req.body.length) : 20;
      const start = typeof req.body.start != "undefined" ? Math.max(0, parseInt(req.body.start)) : 0;
      var options = {year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit'};

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
          doRender(req, res, 'admin/playback-history.ejs', {
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

    router.post('/releases/link', function(req, res) {
      return Release.find({artist: {$exists: false}}).limit(100).exec()
        .then(releases => {
          return Promise.all(releases.map(r => {
            return User.findOne({profileAddress: r.artistAddress}).exec()
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

    router.post('/elements/release-count', function(req, res) {
      return Release.count({contractAddress: { $exists: true, $ne: null }, state: "published"}).exec()
        .then(count => {
          doRender(req, res, 'admin/count.ejs', {
            count: count,
            type: "Total Releases"
          });
        })
    });

    router.post('/elements/artist-count', function(req, res) {

      let a = User.count({
        profileAddress: {$exists: true, $ne: null},
        mostRecentReleaseDate: {$exists: true, $ne: null}
      });

      let v = User.count({
        profileAddress: {$exists: true, $ne: null},
        mostRecentReleaseDate: {$exists: true, $ne: null},
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

    router.post('/elements/user-count', function(req, res) {
      return User.count({profileAddress: { $exists: true, $ne: null }}).exec()
        .then(count => {
          doRender(req, res, 'admin/count.ejs', {
            count: count,
            type: "Total Users"
          });
        })
    });

    router.post('/elements/play-count', function(req, res) {
      return ReleaseStats.aggregate(
        {$match: {duration: "all"}},
        {$group: {_id: "all", plays: {$sum: "$playCount"}}})
        .then(results => {
          doRender(req, res, 'admin/count.ejs', {
            count: results[0].plays,
            type: "Total Plays"
          });
        });
    });

    router.post('/elements/tip-count', function(req, res) {
      const releaseTips = ReleaseStats.aggregate(
        {$match: {duration: "all"}},
        {$group: {_id: "all", tips: {$sum: "$tipCount"}}});

      const userTips = UserStats.aggregate(
        {$match: {duration: "all"}},
        {$group: {_id: "all", tips: {$sum: "$tipCount"}}});

      return Promise.join(releaseTips, userTips, (releaseResults, userResults) => {
          doRender(req, res, 'admin/count.ejs', {
            count: releaseResults[0].tips + userResults[0].tips,
            type: "Total Tips"
          });
        });
    });

    router.post('/elements/users', function(req, res) {
      const length = typeof req.body.length != "undefined" ? parseInt(req.body.length) : 10;
      const start = typeof req.body.start != "undefined" ? Math.max(0, parseInt(req.body.start)) : 0;
      const invitedByIds = req.body.invitedby ? req.body.invitedby.split("|") : [];
      jsonAPI.getAllUsers(req.body.search, invitedByIds, req.body.verified, req.body.artist, start, length)
        .then(results => {
          const users = results.users;
          const addresses = users.map(u => u.profileAddress).filter(a => a);

          const balanceMap = {};
          const ivb = req.body.invitedby && invitedByIds.length == 1 ? User.findById(invitedByIds[0]).exec() : Promise.resolve(null);
          Promise.join(musicoinApi.getAccountBalances(addresses), ivb, (balances, invitedBy) => {
              balances.forEach((balance, idx) => {
                balanceMap[addresses[idx]] = balance.formattedMusicoinsShort;
              });

              users.forEach(u => {
                u.balance = balanceMap[u.profileAddress];
              });
              doRender(req, res, 'admin/users.ejs', {
                search: req.body.search,
                users: users,
                invitedBy: invitedBy && invitedBy.draftProfile ? invitedBy.draftProfile.artistName : "",
                totalUsers: results.count,
                navigation: {
                  description: `Showing ${start + 1} to ${start + users.length} of ${results.count}`,
                  start: start,
                  length: users.length
                }
              });
            });
        });
    });

    router.post('/elements/releases', function(req, res) {
      const length = typeof req.body.length != "undefined" ? parseInt(req.body.length) : 10;
      const start = typeof req.body.start != "undefined" ? Math.max(0, parseInt(req.body.start)) : 0;
      jsonAPI.getAllReleases(req.body.search, start, length)
        .then(results => {
          const releases = results.releases;
          const addresses = releases.map(u => u.contractAddress).filter(a => a);

          releases.forEach(r => {
            r.timeSince = _timeSince(r.releaseDate);
          });

          const balanceMap = {};
          musicoinApi.getAccountBalances(addresses)
            .then(balances => {
              balances.forEach((balance, idx) => {
                balanceMap[addresses[idx]] = balance.formattedMusicoinsShort;
              });
              releases.forEach(u => {
                u.balance = balanceMap[u.contractAddress];
              });
              doRender(req, res, 'admin/releases.ejs', {
                search: req.body.search,
                releases: releases,
                totalReleases: results.count,
                navigation: {
                  description: `Showing ${start + 1} to ${start + releases.length} of ${results.count}`,
                  length: length,
                  start: start
                }
              });
            });



        });
    });

    router.post('/elements/account-balances', function(req, res) {
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

        return doRender(req, res, 'admin/account-balances.ejs', {
          accounts: output,
        });
      })
    });

    router.post('/elements/api-clients', function(req, res) {
      const length = typeof req.body.length != "undefined" ? parseInt(req.body.length) : 10;
      const start = typeof req.body.start != "undefined" ? Math.max(0, parseInt(req.body.start)) : 0;
      jsonAPI.getAllAPIClients(start, length)
        .then(results => {
          const clients = results.clients;
          doRender(req, res, 'admin/api-clients.ejs', {
            apiClients: clients,
            totalClients: results.count,
            navigation: {
              description: `Showing ${start + 1} to ${start + clients.length} of ${results.count}`,
              start: start,
              length: clients.length
            }
          });
        });
    });

    router.post('/api-clients/delete', (req, res) => {
      APIClient.findById(req.body.id).exec()
        .then(client => {
          if (!client) throw Error("Could not find requested client");
          return client.remove();
        })
        .then(() => {
          res.json({success: true})
        })
        .catch(err => {
          console.log("Failed to delete API client: " + err);
          res.json({success: false, err: err.message});
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
          res.json({success: true});
        })
        .catch(err => {
          console.log(`could not create new API user: ${err}`);
          res.json({success: false, err: err.message});
        });
    });

    router.post('/api-clients/lock', (req, res) => {
      if (!req.body.id) return res.json({success: false, reason: "No id"});
      if (typeof req.body.lock == "undefined") return res.json({success: false, reason: "specify true/false for 'lock' parameter"});
      APIClient.findById(req.body.id).exec()
        .then(user => {
          user.accountLocked = req.body.lock == "true";
          return user.save();
        })
        .then(() => {
          res.json({success: true})
        })
    });

    router.post('/api-clients/save', (req, res) => {
      if (!req.body.id) return res.json({success: false, reason: "No id"});
      APIClient.findById(req.body.id).exec()
        .then(user => {
          user.domains = req.body.domains.split(",").map(s => s.trim()).filter(s => s);
          user.methods = req.body.methods.split(",").map(s => s.trim()).filter(s => s);
          return user.save();
        })
        .then(() => {
          res.json({success: true})
        })
    });

    function _timeSince(date) {
      const seconds = Math.floor((Date.now() - date) / 1000);

      const intervals = [
        {value: 60, unit: "min"},
        {value: 60, unit: "hour"},
        {value: 24, unit: "day"},
        {value: 30, unit: "month"},
        {value: 12, unit: "year"},
      ]

      let unit = "second";
      let value = seconds;
      for (let i=0; i < intervals.length; i++) {
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


