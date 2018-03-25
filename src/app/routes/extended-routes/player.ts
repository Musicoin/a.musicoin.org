import { Promise } from 'bluebird';
import * as data2xml from 'data2xml';

import { ExchangeRateProvider } from '../../extra/exchange-service';
import { MailSender } from '../../extra/mail-sender';
import { AddressResolver } from '../../internal/address-resolver';
import { MusicoinAPI } from '../../internal/musicoin-api';
import { MusicoinHelper } from '../../internal/musicoin-helper';
import { MusicoinOrgJsonAPI } from '../../rest-api/json-api';
import { RequestCache } from '../../utils/cached-request';
import * as FormUtils from '../../utils/form-utils';

var functions = require('../routes');
const addressResolver = new AddressResolver();
var express = require('express');
var router = express.Router();
let publicPagesEnabled = false;
const Release = require('../models/release');
const baseUrl = process.env.BASE_URL;
const mailSender = new MailSender();
const ConfigUtils = require('./config/config');
var config = ConfigUtils.loadConfig();
const cachedRequest = new RequestCache();
const exchangeRateProvider = new ExchangeRateProvider(config.exchangeRateService, cachedRequest);
const musicoinApi = new MusicoinAPI(config.musicoinApi);
const MediaProvider = require('./media/media-provider');
const mediaProvider = new MediaProvider(config.ipfs.ipfsHost, config.ipfs.ipfsAddUrl);
let mcHelper = new MusicoinHelper(musicoinApi, mediaProvider, config.playbackLinkTTLMillis);
const jsonAPI = new MusicoinOrgJsonAPI(musicoinApi, mcHelper, mediaProvider, mailSender, exchangeRateProvider, config);
router.use('/oembed', (req, res) => res.render('oembed.ejs'));
router.use('/services/oembed', (req, res) => {
    // https://musicoin.org/nav/track/0x28e4f842f0a441e0247bdb77f3e10b4a54da2502
    console.log("Got oEmbed request: " + req.query.url);
    if (req.query.url && req.query.url.startsWith("baseUrl")) {
        const parts = req.query.url.split('/');
        const type = parts[parts.length - 2];
        const id = parts[parts.length - 1];
        console.log("Parsed oEmbed request: " + id);
        if (type == "track" && id && id.trim().length > 0) {
            console.log("Looking for track: " + id);
            return Release.findOne({ contractAddress: id })
                .then(release => {
                    if (!release) {
                        console.log("Could not find track: " + id);
                        res.status(404);
                        return res.end();
                    }

                    let maxHeight = +(req.query.maxHeight || '65');
                    let maxWidth = +(req.query.maxWidth || '480');
                    let json = {
                        thumbnail_width: 480,
                        html: `<iframe width="480" height="270" src=baseUrl + "/embedded-player/${id}" frameborder="0" gesture="media" allowfullscreen></iframe>`,
                        thumbnail_height: 360,
                        height: maxHeight > 65 ? 65 : maxHeight,
                        width: maxWidth > 480 ? 480 : maxWidth,
                        title: release.title,
                        thumbnail_url: baseUrl + '/images/thumbnail.png',
                        author_name: release.artistName,
                        provider_url: 'baseUrl',
                        type: "video",
                        version: "1.0",
                        provider_name: 'Musicoin',
                        author_url: baseUrl + `/nav/artist/${release.artistAddress}`
                    };

                    console.log("Responding with: " + JSON.stringify(json, null, 2), req.query);

                    if ((req.query.format || '').indexOf('xml') !== -1) {
                        const objectToXMLConverter = data2xml();
                        return res.end(objectToXMLConverter('oembed', json));
                    }

                    res.json(json);

                });

        }
    }
    res.status(404);
    res.end();
});

router.get('/player', functions.isLoggedInOrIsPublic, (req, res) => {
    res.render('player-frame.ejs');
});

router.get('/embedded-player/:address', functions.isLoggedInOrIsPublic, (req, res) => {

    const address = FormUtils.defaultString(req.params.address, null);
    if (!address) {
        console.log(`Failed to load track page, no address provided`);
        return res.render('not-found.ejs', { error: 'Failed to load track page, no address provided' }); // TODO: Change later
    }
    const messagePromise = jsonAPI.getLicenseMessages(address, 20);
    const licensePromise = jsonAPI.getLicense(address);
    const releasePromise = Release.findOne({ contractAddress: address, state: 'published' });
    const exchangeRatePromise = exchangeRateProvider.getMusicoinExchangeRate();

    Promise.join(licensePromise, messagePromise, releasePromise, exchangeRatePromise, (license, messages, release, exchangeRate) => {
        if (!license || !release) {
            console.log(`Failed to load track page for license: ${address}, err: Not found`);
            return res.render('not-found.ejs');
        }

        const ras = addressResolver.resolveAddresses("", license.contributors);
        const a = jsonAPI.getArtist(license.artistProfileAddress, false, false);
        Promise.join(a, ras, (response, resolvedAddresses) => {
            let totalShares = 0;
            resolvedAddresses.forEach(r => totalShares += parseInt(r.shares));
            resolvedAddresses.forEach(r => r.percentage = functions._formatNumber(100 * r.shares / totalShares, 1));
            const plays = release.directPlayCount || 0;
            const tips = release.directTipCount || 0;
            const usd = exchangeRate.success ? "$" + functions._formatNumber((plays + tips) * exchangeRate.usd, 2) : "";
            return functions.doRender(req, res, 'embedded-player-frame.ejs', {
                address: address,
                data: {
                    artist: response.artist,
                    license: license,
                    contributors: resolvedAddresses,
                    releaseId: release._id,
                    description: release.description,
                    messages: messages,
                    isArtist: req.user && req.user.profileAddress == license.artistProfileAddress,
                    abuseMessage: config.ui.admin.markAsAbuse,
                    exchangeRate: exchangeRate,
                    trackStats: {
                        playCount: plays,
                        tipCount: tips,
                        totalEarned: (plays + tips),
                        formattedTotalUSD: usd
                    }
                }
            });
        });
    })
        .catch(err => {
            console.log(`Failed to load track page for license: ${req.params.address}, err: ${err}`);
            res.render('not-found.ejs', { error: err }); // TODO: Change later
        });

});

module.exports.router = router;