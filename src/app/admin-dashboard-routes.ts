import * as express from 'express';
import {Promise} from 'bluebird';
import * as Formidable from 'formidable';
import * as MetadataLists from '../config/metadata-lists';
const router = express.Router();
import {AddressResolver} from "./address-resolver";
import {MusicoinOrgJsonAPI} from "./rest-api/json-api";
import * as FormUtils from "./form-utils";
import {MusicoinAPI} from "./musicoin-api";
const Release = require('../app/models/release');
const User = require('../app/models/user');
const Playback = require('../app/models/playback');
const ReleaseStats = require('../app/models/release-stats');
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
      const start = typeof req.body.start != "undefined" ? parseInt(req.body.start) : 0;
      var options = {year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit'};

      jsonAPI.getPlaybackHistory(req.body.user, req.body.release, start, length)
        .then(output => {
          output.records.forEach(r => {
            r.playbackDateDisplay = jsonAPI._timeSince(r.playbackDate) || "seconds ago";
            r.nextPlaybackDateDisplay = r.user.freePlaysRemaining > 0 && r.user.nextFreePlayback
              ? r.user.nextFreePlayback.toLocaleDateString('en-US', options) + " (" + r.user.freePlaysRemaining + ")"
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
      return User.count({
        profileAddress: { $exists: true, $ne: null },
        mostRecentReleaseDate: { $exists: true, $ne: null }
      }).exec()
        .then(count => {
          doRender(req, res, 'admin/count.ejs', {
            count: count,
            type: "Total Artists"
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
      const start = typeof req.body.start != "undefined" ? parseInt(req.body.start) : 0;
      jsonAPI.getAllUsers(req.body.search, req.body.invitedby, start, length)
        .then(results => {
          const users = results.users;
          const addresses = users.map(u => u.profileAddress).filter(a => a);

          const balanceMap = {};
          const ivb = req.body.invitedby ? User.findById(req.body.invitedby).exec() : Promise.resolve(null);
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
      const start = typeof req.body.start != "undefined" ? parseInt(req.body.start) : 0;
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


