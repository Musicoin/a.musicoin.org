import * as express from 'express';

import * as FormUtils from '../utils/form-utils';
import { MusicoinOrgJsonAPI } from './json-api';
import { JsonPromiseRouter } from './json-promise-router';

const APIClient = require('../../app/models/api-client');
const url = require('url');
const router = express.Router();
const jsonRouter = new JsonPromiseRouter(router, "rest-api");
const maxRecords = 100; // TODO: make configurable
const defaultRecords = 20; // TODO: make configurable
const defaultMaxGroupSize = 8;
const get_ip = require('request-ip');

class UnauthorizedError extends Error {
  constructor(message) {
    super(message);
    this.name = 'UnauthorizedError';
  }
}

export class MusicoinRestAPI {
  constructor(jsonAPI: MusicoinOrgJsonAPI) {
    router.use((req: any, res, next) => {

      let referrerUrl;
      let origin;
      let originWithPort;
      let rawClientId;
      let clientId;
      let userName;

      try {
        referrerUrl = url.parse(req.headers.referer || '');
        origin = `${referrerUrl.protocol}//${referrerUrl.hostname}`;
        originWithPort = `${referrerUrl.protocol}//${referrerUrl.host}`;
        rawClientId = req.query.clientid || req.params.clientid || req.body.clientid || req.header("clientid");
        clientId = FormUtils.defaultString(rawClientId, "");
        userName = req.user && req.user.draftProfile ? req.user.draftProfile.artistName : "Anonymous";
      }
      catch (exception) {
        console.log(exception.toString());
        clientId = '';
      }

      if (!clientId || clientId.trim().length == 0) {
        return next();
      }

      APIClient.findOne({ clientId: clientId }).exec()
        .then(client => {
          if (!client) {
            return next();
          }
          if (client.accountLocked) {
            console.log(`Failed CORS 2: ip: ${get_ip.getClientIp(req)}, session: ${req.session}, user: ${userName}, req.originalUrl: ${req.originalUrl}`);
            throw new UnauthorizedError("Unauthorized: Locked");
          }
          if (client.domains.indexOf("*") < 0 && client.domains.indexOf(origin) < 0) {
            console.log(`Failed CORS 3: ip: ${get_ip.getClientIp(req)}, session: ${req.session}, user: ${userName}, req.originalUrl: ${req.originalUrl}`);
            throw new UnauthorizedError(`Unauthorized (invalid origin: ${origin})`);
          }
          if (req.method != "OPTIONS" && client.methods.indexOf(req.method) < 0) {
            console.log(`Failed CORS 4: ip: ${get_ip.getClientIp(req)}, session: ${req.session}, user: ${userName}, req.originalUrl: ${req.originalUrl}`);
            throw new UnauthorizedError(`Unauthorized (invalid method: ${req.method})`);
          }

          res.header('Access-Control-Allow-Origin', originWithPort);
          res.header('Access-Control-Allow-Methods', req.method);
          res.header('Access-Control-Allow-Headers', 'Content-Type, clientid');

          if ('OPTIONS' == req.method) {
            console.log(`Responding to CORS OPTIONS request: ip: ${get_ip.getClientIp(req)}, session: ${req.session}, user: ${userName}, req.originalUrl: ${req.originalUrl}`);
            return res.send(200);
          } else {
            console.log(`Responding to CORS request: ip: ${get_ip.getClientIp(req)}, session: ${req.session}, user: ${userName}, req.originalUrl: ${req.originalUrl}`);
            next();
          }
        }).catch(err => {
          next(err);
        });
    });

    jsonRouter.post('/user/send-email-address-verification-email', (req) => jsonAPI.userService.sendEmailAddressVerificationEmail(req.user));

    jsonRouter.get('/profile/me', (req) => jsonAPI.getUser(req.isAuthenticated() ? req.user._id.toString() : "You aren't logged in"));
    jsonRouter.get('/profile/:address', (req) => jsonAPI.getArtist(req.params.address, true, true));

    jsonRouter.post('/profile/voting-power/add', (req) => jsonAPI.userService.incrementVotingPower(req.body));
    jsonRouter.post('/profile/voting-power/remove', (req) => jsonAPI.userService.decrementVotingPower(req.body));

    jsonRouter.get('/artist/:address', (req) => jsonAPI.getArtist(req.params.address, true, false));
    jsonRouter.get('/artists/featured', (req) => jsonAPI.getFeaturedArtists(this._getLimit(req)));
    jsonRouter.get('/artists/new', (req) => jsonAPI.getNewArtists(this._getLimit(req)));
    jsonRouter.get('/artists/find', (req) => jsonAPI.findArtists(this._getLimit(req), req.query.term));

    jsonRouter.post('/artists/earnings', (req) => jsonAPI.getArtistEarnings(req.body.artistid));

    jsonRouter.get('/track/:address', (req) => jsonAPI.getLicense(req.params.address));
    jsonRouter.get('/tracks/new', (req) => jsonAPI.getNewReleases(this._getLimit(req)));
    jsonRouter.get('/tracks/recent', (req) => jsonAPI.getRecentPlays(this._getLimit(req)));
    jsonRouter.get('/tracks/top', req => jsonAPI.getTopPlayed(this._getLimit(req), req.query.genre));
    jsonRouter.get('/tracks/random', (req) => jsonAPI.getSampleOfVerifiedTracks(this._getLimit(req), req.query.genre));
    jsonRouter.get('/tracks/random/new', (req) => jsonAPI.doGetRandomReleases({ ...req.query, limit: this._getLimit(req) }));
    jsonRouter.get('/tracks/details', (req) => jsonAPI.getTrackDetailsByIds(req.query.addresses));

    jsonRouter.get('/tracks/:address/votes', (req) => jsonAPI.getVotesByTrack({ songAddress: req.params.address, user: req.isAuthenticated() ? req.user._id.toString() : null }));
    jsonRouter.post('/tracks/:address/votes', (req) => jsonAPI.addVote({ ...req.params, ...req.body, user: req.isAuthenticated() ? req.user._id.toString() : null }));
    jsonRouter.delete('/tracks/:address/votes', (req) => jsonAPI.removeVote({ ...req.params, user: req.isAuthenticated() ? req.user._id.toString() : null }));

    jsonRouter.post('/track/earnings/', req => jsonAPI.getTrackEarnings(req.body.releaseid));

    jsonRouter.get('/tracks/search', (req) => {
      return jsonAPI.getNewReleasesByGenre(
        this._getLimit(req),
        defaultMaxGroupSize,
        req.query.search);
    });

    jsonRouter.get('/tx/status/:tx', req => jsonAPI.getTransactionStatus(req.params.tx));

    router.use(function (err, req, res, next) {
      if (err.name === 'UnauthorizedError') {
        const userName = req.user && req.user.draftProfile ? req.user.draftProfile.artistName : "Anonymous";
        console.log(`Unauthorized API request: ip: ${get_ip.getClientIp(req)}, session: ${req.session}, user: ${userName}, req.originalUrl: ${req.originalUrl}, err: ${err}`);
        res.status(401).send(err.message);
      }
    });
  }

  getRouter() {
    return router;
  }

  _getLimit(req) {
    return Math.max(0, Math.min(req.query.limit || defaultRecords, maxRecords));
  }

  _getStart(req) {
    return Math.max(req.query.start || 0, 0);
  }
}
