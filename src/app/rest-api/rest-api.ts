import * as express from 'express';
import {JsonPromiseRouter} from './json-promise-router';
import {MusicoinOrgJsonAPI} from "./json-api";
const router = express.Router();
const jsonRouter = new JsonPromiseRouter(router, "rest-api");
const maxRecords = 100; // TODO: make configurable
const defaultRecords = 20; // TODO: make configurable

export class MusicoinRestAPI {
  constructor(jsonAPI: MusicoinOrgJsonAPI) {
    jsonRouter.get('/artist/:address', (req) => jsonAPI.getArtist(req.params.address, true, false));
    jsonRouter.get('/profile/:address', (req) => jsonAPI.getArtist(req.params.address, true, true));
    jsonRouter.get('/new-releases', (req) => {
      let limit = req.params.limit || defaultRecords;
      limit = Math.min(limit, maxRecords);
      return jsonAPI.getNewReleases(limit);
    });
  }

  getRouter() {
    return router;
  }
}


