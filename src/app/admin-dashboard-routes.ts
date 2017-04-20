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
      return Release.count().exec()
        .then(count => {
          doRender(req, res, 'admin/count.ejs', {
            count: count,
            type: "Total Releases"
          });
        })
    });

    router.post('/elements/user-count', function(req, res) {
      return User.count().exec()
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
      jsonAPI.getAllUsers(req.body.search, start, length)
        .then(results => {
          const users = results.users;
          doRender(req, res, 'admin/users.ejs', {
            search: req.body.search,
            users: users,
            totalUsers: results.count,
            navigation: {
              description: `Showing ${start + 1} to ${start + users.length}`,
              start: start,
              length: users.length
            }
          });
        });
    });

    router.post('/elements/releases', function(req, res) {
      const length = typeof req.body.length != "undefined" ? parseInt(req.body.length) : 10;
      const start = typeof req.body.start != "undefined" ? parseInt(req.body.start) : 0;
      jsonAPI.getAllReleases(req.body.search, start, length)
        .then(results => {
          const releases = results.releases;
          doRender(req, res, 'admin/releases.ejs', {
            search: req.body.search,
            releases: releases,
            totalReleases: results.count,
            navigation: {
              description: `Showing ${start + 1} to ${start + releases.length}`,
              length: length,
              start: start
            }
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


