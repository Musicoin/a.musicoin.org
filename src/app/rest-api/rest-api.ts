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
    router.use((req: any, res, next) => {
      const referrerUrl = url.parse(req.headers.referer);
      const origin = `${referrerUrl.protocol}//${referrerUrl.hostname}`;
      const originWithPort = `${referrerUrl.protocol}//${referrerUrl.host}`;
      const clientid = req.query.clientid || req.params.clientid || req.body.clientid || req.header("clientid");
      const userName = req.user && req.user.draftProfile ? req.user.draftProfile.artistName : "Anonymous";
      if (!clientid) {
        console.log(`Failed CORS 0: ip: ${req.ip}, session: ${req.session}, user: ${userName}, req.originalUrl: ${req.originalUrl}`);
        return next();
      }

      APIClient.findOne({clientId: clientid}).exec()
        .then(client => {
          if (!client) {
            console.log(`Failed CORS 1: ip: ${req.ip}, session: ${req.session}, user: ${userName}, req.originalUrl: ${req.originalUrl}`);
            return next();
          }
          if (client.accountLocked) {
            console.log(`Failed CORS 2: ip: ${req.ip}, session: ${req.session}, user: ${userName}, req.originalUrl: ${req.originalUrl}`);
            throw new UnauthorizedError("Unauthorized: Locked");
          }
          if (client.domains.indexOf("*") < 0 && client.domains.indexOf(origin) < 0) {
            console.log(`Failed CORS 3: ip: ${req.ip}, session: ${req.session}, user: ${userName}, req.originalUrl: ${req.originalUrl}`);
            throw new UnauthorizedError(`Unauthorized (invalid origin: ${origin})`);
          }
          if (req.method != "OPTIONS" && client.methods.indexOf(req.method) < 0) {
            console.log(`Failed CORS 4: ip: ${req.ip}, session: ${req.session}, user: ${userName}, req.originalUrl: ${req.originalUrl}`);
            throw new UnauthorizedError(`Unauthorized (invalid method: ${req.method})`);
          }

          console.log(`Adding CORS headers: ip: ${req.ip}, session: ${req.session}, user: ${userName}, req.originalUrl: ${req.originalUrl}`);
          console.log(`CORS headers: Access-Control-Allow-Origin: ${req.headers.referer}`);
          console.log(`CORS headers: Access-Control-Allow-Methods: ${req.method}`);

          res.header('Access-Control-Allow-Origin', originWithPort);
          res.header('Access-Control-Allow-Methods', req.method);
          res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');

          if ('OPTIONS' == req.method) {
            console.log(`Responding to CORS OPTIONS request: ip: ${req.ip}, session: ${req.session}, user: ${userName}, req.originalUrl: ${req.originalUrl}`);
            return res.send(200);
          }
          else {
            console.log(`Responding to CORS request: ip: ${req.ip}, session: ${req.session}, user: ${userName}, req.originalUrl: ${req.originalUrl}`);
            next();
          }
        }).catch(err => {
          next(err);
      });
    });

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
        const userName = req.user && req.user.draftProfile ? req.user.draftProfile.artistName : "Anonymous";
        console.log(`Unauthorized API request: ip: ${req.ip}, session: ${req.session}, user: ${userName}, req.originalUrl: ${req.originalUrl}, err: ${err}`);
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


