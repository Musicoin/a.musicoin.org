import * as express from 'express';
import {JsonPromiseRouter} from './json-promise-router';
import {MusicoinOrgJsonAPI} from "./json-api";
const router = express.Router();
const jsonRouter = new JsonPromiseRouter(router, "rest-api");
const maxRecords = 100; // TODO: make configurable
const defaultRecords = 20; // TODO: make configurable
const defaultMaxGroupSize = 8;

export class MusicoinRestAPI {
  constructor(jsonAPI: MusicoinOrgJsonAPI) {
    jsonRouter.get('/profile/:address', (req) => jsonAPI.getArtist(req.params.address, true, true));

    jsonRouter.get('/artist/:address', (req) => jsonAPI.getArtist(req.params.address, true, false));
    jsonRouter.get('/artists/featured', (req) => jsonAPI.getFeaturedArtists(this._getLimit(req)));
    jsonRouter.get('/artists/new', (req) => jsonAPI.getNewArtists(this._getLimit(req)));

    jsonRouter.get('/track/:address', (req) => jsonAPI.getLicense(req.params.address));
    jsonRouter.get('/tracks/new', (req) => jsonAPI.getNewReleases(this._getLimit(req)));
    jsonRouter.get('/tracks/recent', (req) => jsonAPI.getRecentPlays(this._getLimit(req)));
    jsonRouter.get('/tracks/top', req => jsonAPI.getTopPlayed(this._getLimit(req), req.query.genre));

    jsonRouter.get('/tracks/search', (req) => {
      return jsonAPI.getNewReleasesByGenre(
        this._getLimit(req),
        defaultMaxGroupSize,
        req.query.search);
    });

    jsonRouter.get('/tx/history/:address', req => jsonAPI.getTransactionHistory(req.params.address, this._getLimit(req), this._getStart(req)))
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


