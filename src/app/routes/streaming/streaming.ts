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
import * as path from 'path';

const get_ip = require('request-ip');

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
export class StreamingRouter {
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

        router.use('/play', express.static(path.join(config.streaming.tracks)));
    }
    getRouter() {
        return router;
    }
}