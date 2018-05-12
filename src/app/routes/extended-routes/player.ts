import { Promise } from 'bluebird';
import * as data2xml from 'data2xml';
import * as express from 'express';

import { ExchangeRateProvider } from '../../extra/exchange-service';
import { AddressResolver } from '../../internal/address-resolver';
import { MusicoinAPI } from '../../internal/musicoin-api';
import { MusicoinOrgJsonAPI } from '../../rest-api/json-api';
import * as FormUtils from '../../utils/form-utils';

const router = express.Router();
const User = require('../../models/user');
const AnonymousUser = require('../../models/anonymous-user');
import * as UrlUtils from '../../utils/url-utils';
var functions = require('../routes-functions');
const addressResolver = new AddressResolver();
let publicPagesEnabled = false;
const Release = require('../../models/release');
export class PlayerRouter {
    constructor(musicoinApi: MusicoinAPI,
        jsonAPI: MusicoinOrgJsonAPI,
        addressResolver: AddressResolver,
        exchangeRateProvider: ExchangeRateProvider,
        mediaProvider: any, // TODO
        config: any,
        doRender: any) {
        const baseUrl = config.musicoinApi.baseUrl;
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

  function populateAnonymousUser(req, res, next) {
    if (!req.isAuthenticated()) {
      return getAnonymousUser(req)
        .then(anon => {
          req.anonymousUser = anon;
          next();
        })
    }
    return next();
  }

  function getAnonymousUser(req) {
    return AnonymousUser.findOne({ session: req.session.id })
      .then(anonymous => {
        // normal case.  Same IP, same session
        if (anonymous && anonymous.ip && anonymous.ip == req.ip)
          return anonymous;

        if (anonymous) {
          // the ip don't match.  probably some scammer trying to use the same sessionID
          // across multiple hosts.
          console.log(`Matching session with mismatched IPs: req.session: ${req.session.id}, recordIP: ${anonymous.ip}, req.ip: ${req.ip}`);
          return null;
        }
        else {
          // maybe create an new entry in the DB for this session, but first make sure this IP isn't
          // used by another session
          return AnonymousUser.findOne({ ip: req.ip })
            .then(otherRecord => {
              if (!otherRecord) {
                // new IP, new session.
                const newUserData = { ip: req.ip, session: req.session.id };
                console.log(`Creating new user for ${JSON.stringify(newUserData)}`);
                return AnonymousUser.create(newUserData);
              }

              // ip associated with a different session
              const diff = Date.now() - new Date(otherRecord.sessionDate).getTime();
              if (diff > config.ipSessionChangeTimeout) {
                // ok, session changed but it's been a while since the last request.  just update the session
                // associated with this IP address
                otherRecord.session = req.session.id;
                otherRecord.sessionDate = Date.now();
                return otherRecord.save();
              }
              console.log(`Different session with same IPs: session changed too quickly: req.session: ${req.session.id}, recordSession: "Anonymous Session", req.ip: ${req.ip}, msSinceLastSession: ${diff}`);
              return null;
            });
        }
      })
  }
        router.get('/player', (req, res) => {
            res.render('player-frame.ejs');
        });

  router.post('/user/canPlay', populateAnonymousUser, function (req, res) {
    getPlaybackEligibility(req)
      .then(result => {
        res.json(result);
      })
  });

 function getPlaybackEligibility(req) {
    const user = req.isAuthenticated() ? req.user : req.anonymousUser;

    // if ((!req.anonymousUser) && (!req.user)) {

    // most probably this guy must be a anonymous user, do nothing
    //   return Promise.resolve({ success: false, skip: false, message: "Sorry, there was a problem with this request.  (code: 1)" });
    // }

    if (req.anonymousUser) {
      user.accountLocked == false;
    }

    if (user.accountLocked) {
      console.log("Blocking playback for locked user.");
      return Promise.resolve({ success: false, skip: false, message: "Sorry, there was a problem with this request (code: 2)" });
    }

    // if the request if for their current track AND the current playback isn't expired
    // short circuit these checks
    const address = req.body && req.body.address ? req.body.address : req.params.address;
    const canUseCache = user.currentPlay
      && user.currentPlay.licenseAddress == address
      && UrlUtils.resolveExpiringLink(user.currentPlay.encryptedKey);
    if (canUseCache) return Promise.resolve({ success: true, canUseCache: true });

    return Release.findOne({ contractAddress: address, state: "published" }).exec()
      .then(release => {
        if (!release) {
          return { success: false, skip: true, message: "The requested track was not found" };
        }
        if (release.markedAsAbuse) {
          return { success: false, skip: true, message: "This track was flagged abusive by our users" };
        }

        return User.findOne({ profileAddress: release.artistAddress })
          .then(artist => {
            const verifiedArtist = artist && artist.verified;
            const hasNoFreePlays = false; //user.freePlaysRemaining <= 0; This should technically never happen
            const payFromProfile = req.isAuthenticated() && (!verifiedArtist);
            const b = payFromProfile
              ? musicoinApi.getAccountBalance(user.profileAddress)
              : Promise.resolve(null);

            const l = musicoinApi.getLicenseDetails(address);
            return Promise.join(b, l, (pendingPayments, profileBalance, license) => {
              if (payFromProfile) {
                let totalCoinsPending = 0;
                pendingPayments.forEach(r => totalCoinsPending += r.coins);
                console.log("Pending ppp payments: " + totalCoinsPending);
                if (profileBalance.musicoins - totalCoinsPending < license.coinsPerPlay)
                  return { success: false, skip: false, message: "It looks like you don't have enough coins or are trying to play a track from a non verified artist" }
              }
              else if (hasNoFreePlays) {
                user.freePlaysRemaining += 1000; // this part of the code should never get executed, just in case.
              }
              else if (!verifiedArtist) {
                return { success: false, skip: true, message: "Only tracks from verified artists are eligible for free plays." }
              }
              else {
                const diff = new Date(user.nextFreePlayback).getTime() - Date.now();
                if (diff > 0 && diff < config.freePlayDelay) {
                  return { success: false, skip: false, message: "Sorry, please wait a few more seconds for your next free play." }
                }
              }
              const unit = user.freePlaysRemaining - 1 == 1 ? "play" : "plays";
              return {
                success: true,
                payFromProfile: payFromProfile,
                message: payFromProfile
                  ? hasNoFreePlays
                    ? "THanks for encouraging musicians to release more wonderful content!"
                    : "This playback was paid for by you, because this artist is not yet verified and is therefore not eligible for free plays."
                  : `This playback was paid for by UBI, enjoy the music and tip artists!`
              };
            })
          })
      });
  }

        router.get('/embedded-player/:address', (req, res) => {

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
                    console.log("artist " + response.artist + "license " + license + "contributors " + resolvedAddresses + "releaseId " + release._id + "description " + release.description + "messages " + messages + "playCount " + plays + "tipCount " + tips);
                        console.log("exchangeRate " + exchangeRate + "formattedTotalUSD " + usd);
                        console.log("Pls work or display something useful");
                        return doRender(req, res, 'embedded-player-frame.ejs', {
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
    }
    getRouter() {
        return router;
    }
}
