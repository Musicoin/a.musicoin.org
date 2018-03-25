import { Promise } from 'bluebird';
import Feed = require('feed');
import * as pathValidator from 'is-valid-path';
import * as urlValidator from 'valid-url';

import { ExchangeRateProvider } from '../../extra/exchange-service';
import { MailSender } from '../../extra/mail-sender';
import { AddressResolver } from '../../internal/address-resolver';
import { MusicoinAPI } from '../../internal/musicoin-api';
import { MusicoinHelper } from '../../internal/musicoin-helper';
import { MusicoinOrgJsonAPI } from '../../rest-api/json-api';
import { RequestCache } from '../../utils/cached-request';
import * as UrlUtils from '../../utils/url-utils';

var functions = require('../routes');

var express = require('express');
var router = express.Router();
const Release = require('../models/release');
const baseUrl = process.env.BASE_URL;
const addressResolver = new AddressResolver();
const User = require('./models/user');
const mailSender = new MailSender();
const ConfigUtils = require('./config/config');
const sendSeekable = require('send-seekable');
var config = ConfigUtils.loadConfig();
let publicPagesEnabled = false;
const AnonymousUser = require('../models/anonymous-user');
const cachedRequest = new RequestCache();
const exchangeRateProvider = new ExchangeRateProvider(config.exchangeRateService, cachedRequest);
const musicoinApi = new MusicoinAPI(config.musicoinApi);
const MediaProvider = require('./media/media-provider');
const mediaProvider = new MediaProvider(config.ipfs.ipfsHost, config.ipfs.ipfsAddUrl);
let mcHelper = new MusicoinHelper(musicoinApi, mediaProvider, config.playbackLinkTTLMillis);
const jsonAPI = new MusicoinOrgJsonAPI(musicoinApi, mcHelper, mediaProvider, mailSender, exchangeRateProvider, config);

router.get('/accept/:code', (req, res) => {
  console.log(`Processing /accept/${req.params.code}`)
  if (req.get('host') == 'alpha.musicoin.org') {
    console.log(`Redirecting accept from alpha.musicoin.org: ${req.params.code}`);
    return res.redirect(baseUrl + "/accept/" + req.params.code);
  }
  console.log(`Looking for invite: ${req.params.code}`);
  User.findOne({ "invite.inviteCode": req.params.code, "invite.claimed": { $ne: true } }).exec()
    .then((record) => {
      // console.log(`Invite query complete: ${record}`);
      delete req.session.inviteCode;
      let inviteClaimed = false;
      if (record) {
        if (!record.invite.claimed) {
          record.invite.clicked = true;
          record.save();
          req.session.inviteCode = req.params.code;
        }
        console.log(`Redirecting to welcome page, invite ok!: ${req.params.code}`);
        res.redirect("/welcome?inviteClaimed=" + record.invite.claimed);
      }
      else {
        console.log(`Checking for group invite: ${req.params.code}`);
        return User.findOne({
          "reusableInviteCode": req.params.code,
          "invitesRemaining": { $gt: 0 }
        }).exec()
          .then(inviter => {
            // console.log(`GroupInvite query complete: ${inviter}`);
            if (inviter) {
              console.log(`Redirecting to welcome page, group invite ok!: ${req.params.code}`);
              req.session.inviteCode = req.params.code;
              res.redirect("/welcome?inviteClaimed=false");
            }
            else {
              console.log(`Invalid invite code: ${req.params.code}`);
              res.redirect("/");
            }
          })
      }
    });
});

// This sucks.  If I want twitter cards to work, we need metadata about the
// track in the top frame, not the inner frame.  I can't sort out a better way
// Using the oembed server routerroach would be MUCH better, but I can't get it to work. :/
// Twitter just ignores my oembed link.
router.get('/nav/track/:address', (req, res) => {
  console.log("Got external request for a nav/track page, rendering metadata in the outer frame: " + req.params.address);
  jsonAPI.getLicense(req.params.address)
    .then(license => {
      if (!license) {
        console.log(`Failed to load track page for license: ${req.params.address}, err: Not found`);
        return res.render('not-found.ejs');
      }
      res.render('index-frames.ejs', {
        license: license,
        mainFrameLocation: req.originalUrl.substr(4)
      });
    });
});

router.get('/nav/artist/:address', functions.isLoggedInOrIsPublic, (req, res) => {
  console.log("Got external request for a nav/artist page, rendering metadata in the outer frame: " + req.params.address);
  jsonAPI.getArtist(req.params.address, false, false)
    .then(result => {
      try {
        res.render('index-frames.ejs', {
          artist: result.artist,
          mainFrameLocation: req.originalUrl.substr(4)
        });
      } catch (Error) {
        res.render('not-found.ejs')
      }
    }
    ).catch(error => {
      console.log('ERROR!!', error.message);
    });
});

// anything under "/nav/" is a pseudo url that indicates the location of the mainFrame
// e.g. /nav/xyz will be re-routed to "/" with a parameter that sets the mainFrame url to "xyz"
router.get('/nav/*', functions.isLoggedInOrIsPublic, (req, res) => {
  res.render('index-frames.ejs', { mainFrameLocation: req.originalUrl.substr(4) });
});

// =====================================
// LOGIN & LOGOUT ======================
// =====================================

router.get('/loginRedirect', (req, res) => {
  if (req.session && req.session.destinationUrl) {
    console.log("Found login redirect override: " + req.session.destinationUrl);
    const url = req.session.destinationUrl;
    req.session.destinationUrl = null;
    return res.redirect(url);
  }
  res.redirect('/nav/feed');
});

router.get('/logout', function (req, res) {
  req.logout();
  if (req.query.returnTo && (urlValidator.isWebUri(req.query.returnTo) || pathValidator(req.query.returnTo))) {
    return res.redirect(req.query.returnTo);
  }
  res.redirect('/');
});

router.post('/user/canPlay', functions.populateAnonymousUser, function (req, res) {
  getPlaybackEligibility(req)
    .then(result => {
      res.json(result);
    })
});

router.get('/rss/new-releases', (req, res) => {
  const feedConfig = config.ui.rss.newReleases;
  const rs = jsonAPI.getNewReleases(feedConfig.items).catchReturn([]);
  rs.then(newReleases => {
    const feed = new Feed({
      title: feedConfig.title,
      description: feedConfig.description,
      id: `${config.serverEndpoint}/rss/new-releases`,
      link: `${config.serverEndpoint}/rss/new-releases`,
      image: `${config.serverEndpoint}/images/thumbnail.png`,
      copyright: feedConfig.copyright,
      updated: newReleases && newReleases.length > 0 ? newReleases[0].releaseDate : Date.now(),
      author: feedConfig.author
    });

    newReleases.forEach(release => {
      feed.addItem({
        title: release.title,
        id: `${config.serverEndpoint}/nav/track/${release.address}`,
        link: `${config.serverEndpoint}/nav/track/${release.address}`,
        description: `New release by ${release.artistName}`,
        author: [{
          name: `${release.artistName}`,
          link: `${config.serverEndpoint}/nav/artist/${release.artistProfileAddress}`
        }],
        date: release.releaseDate,
        image: `${config.serverEndpoint}${release.image}`
      });
    });
    res.set('Content-Type', 'text/xml');
    res.send(feed.render('rss-2.0'));
    res.end();
  })
});

router.get('/rss/daily-top-tipped', (req, res) => {
  const feedConfig = config.ui.rss.dailyTopTipped;
  const dtt = jsonAPI.getTopTippedLastPeriod(feedConfig.items, "day").catchReturn([]);
  dtt.then(topTipped => {
    const feed = new Feed({
      title: feedConfig.title,
      description: feedConfig.description,
      id: `${config.serverEndpoint}/rss/daily-top-tipped`,
      link: `${config.serverEndpoint}/rss/daily-top-tipped`,
      image: `${config.serverEndpoint}/images/thumbnail.png`,
      copyright: feedConfig.copyright,
      updated: topTipped && topTipped.length > 0 ? topTipped[0].releaseDate : Date.now(),
      author: feedConfig.author
    });

    topTipped.forEach(release => {
      feed.addItem({
        title: release.title,
        id: `${config.serverEndpoint}/nav/track/${release.address}`,
        link: `${config.serverEndpoint}/nav/track/${release.address}`,
        description: `${release.artistName} is a top-tipped track!`,
        author: [{
          name: `${release.artistName}`,
          link: `${config.serverEndpoint}/nav/artist/${release.artistProfileAddress}`
        }],
        date: release.releaseDate,
        image: `${config.serverEndpoint}${release.image}`
      });
    });
    res.set('Content-Type', 'text/xml');
    res.send(feed.render('rss-2.0'));
    res.end();
  })
});

router.get('/media/:encryptedHash', function (req, res) {
  // Hash is encrypted to avoid being a global proxy for IPFS.  This should ensure we are only proxying the URLs
  // we are giving out.
  mediaProvider.getRawIpfsResource(req.params.encryptedHash)
    .then(function (result) {
      res.writeHead(200, result.headers);
      result.stream.pipe(res);
    })
    .catch(function (err) {
      console.error(err.stack);
      res.status(500);
      res.send(err);
    });
});

router.get('/ppp/:address', functions.populateAnonymousUser, sendSeekable, resolveExpiringLink, function (req, res) {
  getPlaybackEligibility(req)
    .then(playbackEligibility => {
      if (!playbackEligibility.success) {
        console.log("Rejecting ppp request: " + JSON.stringify(playbackEligibility));
        return res.send(new Error("PPP request failed: " + playbackEligibility.message));
      }

      const context = { contentType: "audio/mpeg" };
      const l = musicoinApi.getLicenseDetails(req.params.address);
      const r = Release.findOne({ contractAddress: req.params.address, state: "published" }).exec();

      return Promise.join(l, r, (license, release) => {
        return getPPPKeyForUser(req, release, license, playbackEligibility)
          .then(keyResponse => {
            return mediaProvider.getIpfsResource(license.resourceUrl, () => keyResponse.key)
              .then(function (result) {
                res.sendSeekable(result.stream, {
                  type: context.contentType,
                  length: result.headers['content-length']
                });
              })
          })
      })
    })
    .catch(function (err) {
      console.error(err.stack);
      res.status(500);
      res.send("Failed to play track");
    });
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

function resolveExpiringLink(req, res, next) {
  const resolved = UrlUtils.resolveExpiringLink(req.params.address);
  if (!resolved) {
    console.log(`Got ppp request for expired URL: authenticated=${req.isAuthenticated()}, profile: ${req.isAuthenticated() ? req.user.profileAddress : ""}, session: ${req.session.id}`);
    return res.send(new Error("Expired linked: " + req.session.id));
  }
  else {
    const userName = req.user && req.user.draftProfile
      ? req.user.draftProfile.artistName
      : req.user ? req.user._id : req.ip;
    const profileAddress = req.user ? req.user.profileAddress : "Anonymous";
    console.log(`Resolve ppp request for ${resolved}, ip: ${req.ip}, session: ${req.session.id}, user: ${profileAddress} (${userName})`);
  }
  req.params.address = resolved;
  next();
}

function getPPPKeyForUser(req, release, license, playbackEligibility) {
  const user = req.isAuthenticated() ? req.user : req.anonymousUser;
  const cachedKey = user.currentPlay
    ? UrlUtils.resolveExpiringLink(user.currentPlay.encryptedKey)
    : null;

  return playbackEligibility.canUseCache && cachedKey
    ? Promise.resolve({ key: cachedKey, cached: true })
    : payForPPPKey(req, release, license, playbackEligibility.payFromProfile);
}

function payForPPPKey(req, release, license, payFromProfile): Promise<any> {
  const user = req.isAuthenticated() ? req.user : req.anonymousUser;
  const ttl = config.playbackLinkTTLMillis;
  const userName = user.draftProfile ? user.draftProfile.artistName : user._id;
  const licenseAddress = release.contractAddress;
  let paymentPromise;

  if (payFromProfile) {
    // user pays.  In this case, we need to track the payment tx to make sure they don't double spend
    paymentPromise = musicoinApi.pppFromProfile(user.profileAddress, licenseAddress)
  }
  else {
    // free play.  in this case, just deduct 1 from the number of remaining free plays
    paymentPromise = musicoinApi.getKey(licenseAddress)
      .then(keyResponse => {
        user.freePlaysRemaining; // don't deduct from free plays since UBI is in place.
        user.nextFreePlayback = Date.now() + config.freePlayDelay;
        console.log(`User ${userName} has played a song, eligible for the next free play in ${ttl}ms`);
        return keyResponse;
      });
  }

  // once the payment is initiated, update the release stats
  return paymentPromise.then(keyResponse => {
    const userId = req.isAuthenticated() ? user._id : null;
    const anonymousUserId = req.isAuthenticated() ? null : user._id;
    return jsonAPI.addToReleasePlayCount(userId, anonymousUserId, release._id)
      .then(() => {
        console.log("Caching key for current playback...");
        user.currentPlay = {
          licenseAddress: licenseAddress,
          release: release._id,
          encryptedKey: UrlUtils.createExpiringLink(keyResponse.key, ttl),
        };
        return user.save()
      })
      .then(() => {
        return keyResponse;
      })
      .catch(err => {
        console.log(`Failed to update playback stats : ${err}`);
        throw err;
      })
  })
}

module.exports.router = router;