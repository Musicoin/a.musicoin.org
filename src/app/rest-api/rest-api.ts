import * as express from 'express';
import {JsonPromiseRouter} from './json-promise-router';
import {MusicoinOrgJsonAPI} from "./json-api";
const APIClient = require('../../app/models/api-client');
const url = require('url');
const router = express.Router();
const jsonRouter = new JsonPromiseRouter(router, "rest-api");
const maxRecords = 100; // TODO: make configurable
const defaultRecords = 20; // TODO: make configurable
const defaultMaxGroupSize = 8;

class UnauthorizedError extends Error {
  constructor(message) {
    super(message);
    this.name = 'UnauthorizedError';
  }
}

export class MusicoinRestAPI {
  constructor(jsonAPI: MusicoinOrgJsonAPI) {
    // router.use((req: any, res, next) => {
    //   const referrerUrl = url.parse(req.headers.referer);
    //   const origin = `${referrerUrl.protocol}//${referrerUrl.hostname}`;
    //   const clientid = req.query.clientid || req.params.clientid || req.body.clientid || req.header("clientid");
    //   if (!clientid) {
    //     const userName = req.user && req.user.draftProfile ? req.user.draftProfile.artistName : "Anonymous";
    //     console.log(`Unauthoirized API request: ip: ${req.ip}, session: ${req.session}, user: ${userName}`);
    //     throw new UnauthorizedError("Unauthorized: " + req.ip);
    //   }
    //
    //   APIClient.findOne({clientId: clientid}).exec()
    //     .then(client => {
    //       if (!client) throw new UnauthorizedError(`Unauthorized: unknown clientId: ${clientid}`);
    //       if (client.accountLocked) throw new UnauthorizedError("Unauthorized: Locked");
    //       if (client.domains.indexOf("*") < 0 && client.domains.indexOf(origin) < 0) throw new UnauthorizedError(`Unauthorized (invalid origin: ${origin})`);
    //       if (client.methods.indexOf(req.method) < 0) throw new UnauthorizedError(`Unauthorized (invalid method: ${req.method})`);
    //
    //       res.header('Access-Control-Allow-Origin', origin);
    //       res.header('Access-Control-Allow-Methods', req.method);
    //       res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    //
    //       if ('OPTIONS' == req.method) {
    //         return res.send(200);
    //       }
    //       else {
    //         next();
    //       }
    //     }).catch(err => {
    //       next(err);
    //   });
    // });

    jsonRouter.get('/profile/:address', (req) => jsonAPI.getArtist(req.params.address, true, true));

    jsonRouter.get('/artist/:address', (req) => jsonAPI.getArtist(req.params.address, true, false));
    jsonRouter.get('/artists/featured', (req) => jsonAPI.getFeaturedArtists(this._getLimit(req)));
    jsonRouter.get('/artists/new', (req) => jsonAPI.getNewArtists(this._getLimit(req)));
    jsonRouter.get('/artists/find', (req) => jsonAPI.findArtists(this._getLimit(req), req.query.term));

    jsonRouter.post('/artists/earnings', (req) => jsonAPI.getArtistEarnings(req.body.artistid));

    jsonRouter.get('/track/:address', (req) => jsonAPI.getLicense(req.params.address));
    jsonRouter.get('/tracks/new', (req) => jsonAPI.getNewReleases(this._getLimit(req)));
    jsonRouter.get('/tracks/recent', (req) => jsonAPI.getRecentPlays(this._getLimit(req)));
    jsonRouter.get('/tracks/top', req => jsonAPI.getTopPlayed(this._getLimit(req), req.query.genre));
    jsonRouter.get('/tracks/random', (req) => jsonAPI.getRandomReleases(this._getLimit(req)));
    jsonRouter.get('/tracks/details', (req) => jsonAPI.getTrackDetailsByIds(req.query.addresses));

    jsonRouter.post('/track/earnings/', req => jsonAPI.getTrackEarnings(req.body.releaseid));

    jsonRouter.get('/tracks/search', (req) => {
      return jsonAPI.getNewReleasesByGenre(
        this._getLimit(req),
        defaultMaxGroupSize,
        req.query.search);
    });

    jsonRouter.get('/tx/history/:address', req => jsonAPI.getTransactionHistory(req.params.address, this._getLimit(req), this._getStart(req)));
    jsonRouter.get('/tx/status/:tx', req => jsonAPI.getTransactionStatus(req.params.tx));

    router.use(function (err, req, res, next) {
      if (err.name === 'UnauthorizedError') {
        console.log(err.message);
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


