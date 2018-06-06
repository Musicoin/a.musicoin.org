import { Promise } from 'bluebird';
import * as crypto from 'crypto';

import { ExchangeRateProvider } from './extra/exchange-service';
import { MailSender } from './extra/mail-sender';
import { AddressResolver } from './internal/address-resolver';
import { MusicoinAPI } from './internal/musicoin-api';
import { MusicoinHelper } from './internal/musicoin-helper';
import { PendingTxDaemon } from './internal/tx-daemon';
import { MusicoinOrgJsonAPI } from './rest-api/json-api';
import { MusicoinRestAPI } from './rest-api/rest-api';
import { AdminRoutes } from './routes/admin/admin-routes';
import { AuthRouter } from './routes/auth/auth';
import { ExtendedRouter } from './routes/extended-routes/extended';
import { IpfsRouter } from './routes/extended-routes/ipfs';
import { PlayerRouter } from './routes/extended-routes/player';
import { FrontRouter } from './routes/front-parts/front-routes';
import { HomeRouter } from './routes/home-page/home';
import { ProfileRouter } from './routes/profile/profile';
import { ReleaseManagerRouter } from './routes/release/release-manager-routes';
import { SocialRouter } from './routes/social/social';
import { RequestCache } from './utils/cached-request';
import * as FormUtils from './utils/form-utils';
import * as UrlUtils from './utils/url-utils';

var path = require('path');

var functions = require('./routes/routes-functions');

const Playback = require('./models/user-playback');
const Release = require('./models/release');
const AnonymousUser = require('./models/anonymous-user');
const TrackMessage = require('./models/track-message');
const EmailConfirmation = require('./models/email-confirmation');
const User = require('./models/user');
const sendSeekable = require('send-seekable');
const get_ip = require('request-ip');
const maxImageWidth = 400;
const maxHeroImageWidth = 1300;
const MAX_MESSAGE_LENGTH = 1000;
const MAX_MESSAGES = 50;
const MESSAGE_TYPES = {
  admin: "admin",
  comment: "comment",
  release: "release",
  donate: "donate",
  follow: "follow",
  tip: "tip",
};

let publicPagesEnabled = false;
var phoneNumberVal = 0;
var numberOfPhoneUsedTimesVal = 0;

export function configure(app, passport, musicoinApi: MusicoinAPI, mediaProvider, config: any) {

  const serverEndpoint = config.serverEndpoint;
  const captchaSecret = config.captcha.secret;
  const bootSession = config.musicoinApi.bootSession;
  const baseUrl = config.musicoinApi.baseUrl;
  publicPagesEnabled = config.publicPagesEnabled;
  let mcHelper = new MusicoinHelper(musicoinApi, mediaProvider, config.playbackLinkTTLMillis);
  const mailSender = new MailSender();
  const cachedRequest = new RequestCache();
  const exchangeRateProvider = new ExchangeRateProvider(config.exchangeRateService, cachedRequest);

  let jsonAPI = new MusicoinOrgJsonAPI(musicoinApi, mcHelper, mediaProvider, mailSender, exchangeRateProvider, config);
  let restAPI = new MusicoinRestAPI(jsonAPI);
  const addressResolver = new AddressResolver();

  const releaseManager = new ReleaseManagerRouter(musicoinApi,
    jsonAPI,
    addressResolver,
    maxImageWidth,
    mediaProvider,
    config,
    doRender);

  const frontRouter = new FrontRouter();
  const socialRouter = new SocialRouter(passport);
  const ipfsRouter = new IpfsRouter(mediaProvider);
  const homeRouter = new HomeRouter(musicoinApi,
    jsonAPI,
    addressResolver,
    mediaProvider,
    config,
    doRender);

  const profileRouter = new ProfileRouter(musicoinApi,
    jsonAPI,
    addressResolver,
    maxImageWidth,
    maxHeroImageWidth,
    mediaProvider,
    config,
    doRender);

  const authRouter = new AuthRouter(musicoinApi,
    jsonAPI,
    addressResolver,
    exchangeRateProvider,
    config,
    doRender);

  const playerRouter = new PlayerRouter(musicoinApi,
    jsonAPI,
    addressResolver,
    exchangeRateProvider,
    mediaProvider,
    config,
    doRender);

  const extendedRouter = new ExtendedRouter(musicoinApi,
    jsonAPI,
    addressResolver,
    mediaProvider,
    config,
    doRender);

  const adminRoutes = new AdminRoutes(musicoinApi,
    jsonAPI,
    addressResolver,
    exchangeRateProvider,
    cachedRequest,
    mediaProvider, // TODO
    passport,
    config,
    doRender);

  const newProfileListener = p => {
    jsonAPI.sendRewardsForInvite(p)
      .then((results) => console.log(`Rewards sent for inviting ${p._id} profile=${p.profileAddress}, txs: ${JSON.stringify(results)}`))
      .catch(err => console.log(`Failed to send invite rewards: ${err}`));
  };

  const newReleaseListener = r => {
    let msgText = r.description ? "[New Release] " + r.description : "New release!";

    // TODO: This should be handled in the UI, but for now just chop the message text
    if (msgText.length > 150) msgText = msgText.substring(0, 150) + "...";
    jsonAPI.postLicenseMessages(r.contractAddress, null, r.artistAddress, msgText, MESSAGE_TYPES.release, null)
      .catch(err => {
        console.log(`Failed to post a message about a new release: ${err}`)
      });
  };

  new PendingTxDaemon(newProfileListener, newReleaseListener)
    .start(musicoinApi, config.database.pendingReleaseIntervalMs);

  function handleBrowseRequest(req, res, _search, genre) {
    const search = FormUtils.defaultString(_search, null);
    const maxGroupSize = req.query.maxGroupSize ? parseInt(req.query.maxGroupSize) : 8;
    const sort = req.query.sort || "tips";
    const rs = jsonAPI.getNewReleasesByGenre(150, maxGroupSize, search, genre, sort).catchReturn([]);
    const as = jsonAPI.getNewArtists(maxGroupSize, search, genre).catchReturn([]);
    Promise.join(rs, as, function (releases, artists) {
      return doRender(req, res, "browse.ejs", {
        searchTerm: search,
        genreFilter: genre,
        releases: releases,
        maxItemsPerGroup: maxGroupSize,
        artists: artists,
        sort: sort
      });
    })
      .catch(function (err) {
        console.log(err);
        res.redirect('/error');
      });
  }
  app.use('/json-api', restAPI.getRouter());
  app.use('/', preProcessUser(mediaProvider, jsonAPI), functions.checkInviteCode);
  app.use('/release-manager', functions.isLoggedIn, releaseManager.getRouter());
  app.use('/', frontRouter.getRouter());
  app.use('/', homeRouter.getRouter());
  app.use('/', socialRouter.getRouter());
  app.use('/', profileRouter.getRouter());
  app.use('/', authRouter.getRouter());
  app.use('/', playerRouter.getRouter());
  app.use('/', ipfsRouter.getRouter());
  app.use('/', extendedRouter.getRouter());
  app.use('/', adminRoutes.getRouter());
  app.use('/admin', functions.isLoggedIn, functions.adminOnly);
  app.use('/elements', functions.isLoggedIn, functions.adminOnly);
  app.use('/admin/*', functions.isLoggedIn, functions.adminOnly);
  app.use('/elements/*', functions.isLoggedIn, functions.adminOnly);

  app.delete('/admin/user/delete', (req, res) => {
    if (req.body.email) { req.body.email = req.body.email.trim(); }
    jsonAPI.removeUser(req.body.email)
      .then(result => {
        res.json(result);
      });
  });

  app.post('/admin/user/blacklist', functions.isLoggedIn, functions.adminOnly, (req, res) => {
    if (req.body.email) {
      jsonAPI.blacklistUser(req.body.email.trim())
        .then(result => {
          res.json(result);
        });
    }
  });

  app.get('/relases/random', (req, res) => {
    jsonAPI.randomSong()
      .then(result => {
        res.json(result);
      });
  });

  app.get('/loginRedirect', (req, res) => {

    if (req.session && req.session.destinationUrl) {
      console.log("Found login redirect override: " + req.session.destinationUrl);
      const url = req.session.destinationUrl;
      req.session.destinationUrl = null;
      return res.redirect(url);
    }
    return res.redirect('/nav/feed');
  });

  app.post('/login/confirm', function (req, res) {
    if (req.body.email) req.body.email = req.body.email.trim();
    if (!FormUtils.validateEmail(req.body.email)) {
      res.json({
        success: false,
        email: req.body.email,
        reason: "The email address does not appear to be valid"
      });
    }
    else {
      const code = "MUSIC" + crypto.randomBytes(11).toString('hex');
      if (captchaSecret == "6LeIxAcTAAAAAGG-vFI1TnRWxMZNFuojJ4WifJWe") {
        var emailState = true;
      } else {
        var emailState = false;
      }
      return EmailConfirmation.create({ email: req.body.email, code: code })
        .then(() => {
          mailSender.sendEmailConfirmationCode(req.body.email, code)
            .then(() => {
              console.log(`Sent email confirmation code to ${req.body.email}: ${code}, session=${req.session.id}`);
              return doRender(req, res, "landing-email-confirmation.ejs", { email: req.body.email });
            })
        })
        .catch((err) => {
          console.log(`Failed to send email confirmation code ${code}: ${err}`);
          res.json({
            success: emailState,
            email: req.body.email,
            reason: "An internal error occurred.  Please try again later."
          });
        });
    }
  });

  app.get('/admin/su', functions.isLoggedIn, functions.adminOnly, function (req, res) {
    // render the page and pass in any flash data if it exists
    res.render('su.ejs', { message: req.flash('loginMessage') });
  });

  // process the login form
  app.post('/admin/su', functions.isLoggedIn, functions.adminOnly, passport.authenticate('local-su', {
    failureRedirect: '/admin/su', // redirect back to the signup page if there is an error
    failureFlash: true // allow flash messages
  }), function (req, res) {
    //admin loggined succesfully
    if (req.user) {
      if (req.user.profileAddress && req.user.profileAddress !== '') {
        req.session.userAccessKey = req.user.profileAddress; //set session value as user.profileAddress;
      } else if (req.user.id && req.user.id !== '') {
        req.session.userAccessKey = req.user.id;  //set session value as user.id
      }
    }
    res.redirect('/profile'); // redirect to the secure profile section
  });

  function doRender(req, res, view, context) {
    // console.log("Calling doRender in " + view);
    const b = req.user && req.user.profileAddress ? musicoinApi.getAccountBalance(req.user.profileAddress) : Promise.resolve(null);
    return b.then(balance => {
      if (req.user) {
        req.user.formattedBalance = balance ? balance.formattedMusicoinsShort : "0";
      }
      const defaultContext = {
        user: req.user || {},
        isAuthenticated: req.isAuthenticated(),
        isAdmin: functions.isAdmin(req.user),
        hasInvite: !req.isAuthenticated()
          && req.session
          && req.session.inviteCode
          && req.session.inviteCode.trim().length > 0,
        inviteClaimed: req.query.inviteClaimed == "true",
      };
      res.render(view, Object.assign({}, defaultContext, context));
    })
  }

  app.get('/accept/:code', (req, res) => {
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

  app.get('/playback-history/a6565fbd8b81b42031fd893db7645856f9d6f377a188e95423702e804c7b64b1', functions.isLoggedIn, functions.adminOnly, function (req, res) {
    const length = 1000;
    const start = 0;
    var options = { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' };

    jsonAPI.getPlaybackHistory(req.body.user, req.body.anonuser, req.body.release, start, length)
      .then(output => {
        output.records.forEach(r => {
          r.playbackDateDisplay = jsonAPI._timeSince(r.playbackDate) || "just now";
          const user = r.user ? r.user : r.anonymousUser;
          r.nextPlaybackDateDisplay = user && user.freePlaysRemaining > 0 && user.nextFreePlayback
            ? user.nextFreePlayback.toLocaleDateString('en-US', options) + " (" + user.freePlaysRemaining + ")"
            : "N/A";
        });
        return output;
      })
      .then(output => {
        doRender(req, res, 'playback-main.ejs', {
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

  app.post('/admin/user/abuse', (req, res) => {
    // First blacklist the user (no invite bonus)
    const id = FormUtils.defaultString(req.body.id, null);
    if (!id) return res.json({ success: false, reason: "No id" });
    if (typeof req.body.blacklist == "undefined") return res.json({ success: false, reason: "specify true/false for 'blacklist' parameter" });
    User.findById(id).exec()
      .then(user => { // Blacklist user
        console.log(`User has been flagged as a gamer of the system.`)
        user.invite.noReward = req.body.blacklist == "true";
      })// Unverify user
      .then(user => {
        console.log(`User verification status changed by ${req.user.draftProfile.artistName}, artist=${user.draftProfile.artistName}, newStatus=${req.body.verified == "true"}`);
        user.verified = req.body.verified == "false";
      })// Next lets lock his account
      .then(user => {
        user.accountLocked = req.body.lock == "true";
      })
      .then(user => {
        user.followerCount = 0;
      })
      .then(user => {
        user.directTipCount = 0;
      })
      .then(user => {
        user.hideProfile = true;
        return user.save();
      });


    const artistProfileAddress = User.findById(id).exec().profileAddress;
    // const url = '/admin/releases?search=' + (req.query.search ? req.query.search : '');
    jsonAPI.getAllReleases('', 0, 100000) // we should change this once we scale.
      .then(result => {
        const releases = result.releases;
        for (var i = 0; i < releases.length; i++) {
          if (artistProfileAddress == releases[i].artistAddress) {
            const markAsAbuse = releases[i].abuse == "true";
            jsonAPI.markAsAbuse(releases[i].licenseAddress, markAsAbuse)
              .then(result => res.json(result))
              .catch(err => {
                console.log("Failed to mark track " + releases[i] + " as abuse: " + err);
              });
          }
        }
      });
  });

  app.get('/admin/artists/dump', functions.isLoggedIn, functions.adminOnly, function (req, res) {
    // render the page and pass in any flash data if it exists
    jsonAPI.getAllArtists()
      .then(function (all) {
        res.json(all);
      })
  });


  app.get('/admin/overview', functions.isLoggedIn, functions.adminOnly, function (req, res) {
    // render the page and pass in any flash data if it exists
    const b = musicoinApi.getMusicoinAccountBalance();
    const o = musicoinApi.getAccountBalances(config.trackingAccounts.map(ta => ta.address));
    const wp = User.count({ profileAddress: { $exists: true, $ne: null } }).exec();
    const wr = User.count({
      profileAddress: { $exists: true, $ne: null },
      mostRecentReleaseDate: { $exists: true, $ne: null }
    }).exec();
    const tc = Release.count({ contractAddress: { $exists: true, $ne: null }, state: "published" }).exec();
    const dtc = Release.count({ contractAddress: { $exists: true, $ne: null }, state: "deleted" }).exec();
    const au = jsonAPI.getOverallReleaseStats();
    Promise.join(b, o, wp, wr, tc, dtc, au, (mcBalance, balances, usersWithProfile, usersWithRelease, trackCount, deletedTrackCount, allReleaseStats) => {
      const output = [];
      balances.forEach((balance, index) => {
        const accountDetails = config.trackingAccounts[index];
        output.push({
          balance: balance.musicoins,
          formattedBalance: balance.formattedMusicoins,
          name: accountDetails.name,
          address: accountDetails.address,
        })
      });
      output.push({
        balance: mcBalance.musicoins,
        formattedBalance: mcBalance.formattedMusicoins,
        name: "MC Client Balance",
        address: "",
      });

      const userMetrics = [];
      userMetrics.push({ name: "Users", value: functions._formatNumber(usersWithProfile) });
      userMetrics.push({ name: "Musicians", value: functions._formatNumber(usersWithRelease) });

      const trackMetrics = [];
      trackMetrics.push({ name: "Tracks", value: functions._formatNumber(trackCount) });
      trackMetrics.push({ name: "Deleted Tracks", value: functions._formatNumber(deletedTrackCount) });
      trackMetrics.push({ name: "totalPlays", value: functions._formatNumber(allReleaseStats[0].totalPlays) });
      trackMetrics.push({ name: "totalTips", value: functions._formatNumber(allReleaseStats[0].totalTips) });
      trackMetrics.push({ name: "totalComments", value: functions._formatNumber(allReleaseStats[0].totalComments) });

      return doRender(req, res, 'admin-overview.ejs', {
        accounts: output,
        userMetrics: userMetrics,
        trackMetrics: trackMetrics,
        bootSessions: bootSession
      });
    })
  });



  // =====================================
  // EMAIL ==============================
  // =====================================

  app.get('/welcome', function (req, res) {
    if (req.user) {
      return res.redirect('/loginRedirect');
    }
    if (req.query.returnTo) {
      req.session.destinationUrl = req.query.returnTo;
    }
    // render the page and pass in any flash data if it exists
    const message = req.flash('loginMessage');
    return doRender(req, res, 'landing-musician-vs-listener.ejs', {
      message: message,
    });
  });

  app.get('/welcome-musician', function (req, res) {
    if (req.user) {
      return res.redirect('/loginRedirect');
    }
    // render the page and pass in any flash data if it exists
    const message = req.flash('loginMessage');
    return doRender(req, res, 'landing-login.ejs', {
      message: message,
    });
  });

  app.get('/welcome-listener', function (req, res) {
    if (req.user) {
      return res.redirect('/loginRedirect');
    }
    if (req.query.returnTo) {
      req.session.destinationUrl = req.query.returnTo;
    }
    // render the page and pass in any flash data if it exists
    const message = req.flash('loginMessage');
    return doRender(req, res, 'landing-listener.ejs', {
      message: message,
    });
  });

  app.get('/welcome-artist', function (req, res) {
    if (req.user) {
      return res.redirect('/loginRedirect');
    }
    if (req.query.returnTo) {
      req.session.destinationUrl = req.query.returnTo;
    }
    // render the page and pass in any flash data if it exists
    const message = req.flash('loginMessage');
    return doRender(req, res, 'landing-musician.ejs', {
      message: message,
    });
  });

  app.get('/ppp/:address', populateAnonymousUser, sendSeekable, resolveExpiringLink, function (req, res) {
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

  app.post('/admin/hero/select', (req, res) => {
    jsonAPI.promoteTrackToHero(req.body.licenseAddress)
      .then(result => res.json(result))
      .catch(err => {
        console.log("failed to promote track to hero: " + err);
        res.json({ success: false, reason: "error" });
      });
  });

  app.get('/admin/mail/confirm', functions.isLoggedIn, functions.adminOnly, function (req, res) {
    res.render("mail/email-confirmation.ejs", {
      code: "XY12345"
    })
  });

  app.get('/admin/mail/reset', functions.isLoggedIn, functions.adminOnly, function (req, res) {
    res.render("mail/password-reset.ejs", {
      link: "http://google.com?test=123455"
    })
  });

  app.get('/admin/mail/invite', functions.isLoggedIn, functions.adminOnly, function (req, res) {
    res.render("mail/invite.ejs", {
      invite: {
        invitedBy: "TestUser",
        acceptUrl: "http://localhost:3000/accept/12345"
      }
    })
  });

  app.get('/admin/mail/message', functions.isLoggedIn, functions.adminOnly, function (req, res) {
    res.render("mail/message.ejs", {
      notification: {
        senderName: "Sender-Dan",
        message: "This is some message.  It's really long. This is some message.  It's really long. This is some message.  It's really long. This is some message.  It's really long. This is some message.  It's really long. actually This is some message.  It's really long. This is some message.  It's really long. ",
        trackName: "My Track",
        acceptUrl: "http://localhost:3000/track/12345"
      }
    })
  });

  app.get('/playback-history/a6565fbd8b81b42031fd893db7645856f9d6f377a188e95423702e804c7b64b1', functions.isLoggedIn, functions.adminOnly, function (req, res) {
    const length = 1000;
    const start = 0;
    var options = { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' };

    jsonAPI.getPlaybackHistory(req.body.user, req.body.anonuser, req.body.release, start, length)
      .then(output => {
        output.records.forEach(r => {
          r.playbackDateDisplay = jsonAPI._timeSince(r.playbackDate) || "just now";
          const user = r.user ? r.user : r.anonymousUser;
          r.nextPlaybackDateDisplay = user && user.freePlaysRemaining > 0 && user.nextFreePlayback
            ? user.nextFreePlayback.toLocaleDateString('en-US', options) + " (" + user.freePlaysRemaining + ")"
            : "N/A";
        });
        return output;
      })
      .then(output => {
        doRender(req, res, 'playback-main.ejs', {
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

  app.post('/user/canPlay', populateAnonymousUser, function (req, res) {
    getPlaybackEligibility(req)
      .then(result => {
        res.json(result);
      })
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
        if (anonymous && anonymous.ip && anonymous.ip == get_ip.getClientIp(req))
          return anonymous;

        if (anonymous) {
          // the ip don't match.  probably some scammer trying to use the same sessionID
          // across multiple hosts.
          console.log(`Matching session with mismatched IPs: req.session: ${req.session.id}, recordIP: ${anonymous.ip}, get_ip.getClientIp(req): ${get_ip.getClientIp(req)}`);
          return null;
        }
        else {
          // maybe create an new entry in the DB for this session, but first make sure this IP isn't
          // used by another session
          return AnonymousUser.findOne({ ip: get_ip.getClientIp(req) })
            .then(otherRecord => {
              if (!otherRecord) {
                // new IP, new session.
                const newUserData = { ip: get_ip.getClientIp(req), session: req.session.id };
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
              console.log(`Different session with same IPs: session changed too quickly: req.session: ${req.session.id}, recordSession: "Anonymous Session", get_ip.getClientIp(req): ${get_ip.getClientIp(req)}, msSinceLastSession: ${diff}`);
              return null;
            });
        }
      })
  }

  function getPlaybackEligibility(req) {
    const user = req.isAuthenticated() ? req.user : req.anonymousUser;
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
            return Promise.join(b, l, (profileBalance, license) => {
              if (payFromProfile) {
                let totalCoinsPending = 0;
                if (profileBalance.musicoins - totalCoinsPending < license.coinsPerPlay)
                  return { success: false, skip: false, message: "It looks like you don't have enough coins or are trying to play a track from a non verified artist" }
              }
              else if (hasNoFreePlays) {
                user.freePlaysRemaining += 1000; // this part of the code should never get executed, just in case.
              }
              else if (!verifiedArtist) {
                return { success: false, skip: true, message: "Only tracks from verified artists are eligible for free plays." }
              }
              else if (req.anonymousUser) {
                return { success: true, message: "Thank you for listening" };
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
        : req.user ? req.user._id : get_ip.getClientIp(req);
      const profileAddress = req.user ? req.user.profileAddress : "Anonymous";
      console.log(`Resolve ppp request for ${resolved}, ip: ${get_ip.getClientIp(req)}, session: ${req.session.id}, user: ${profileAddress} (${userName})`);
    }
    req.params.address = resolved;
    next();
  }

  function payForPPPKey(req, release, license, payFromProfile): Promise<any> {
    const user = req.isAuthenticated() ? req.user : req.anonymousUser;
    const ttl = config.playbackLinkTTLMillis;
    const userName = user.draftProfile ? user.draftProfile.artistName : user._id;
    const licenseAddress = release.contractAddress;
    let paymentPromise;
    paymentPromise = musicoinApi.getKey(licenseAddress)
      .then(keyResponse => {
        user.freePlaysRemaining; // don't deduct from free plays since UBI is in place.
        user.nextFreePlayback = Date.now() + config.freePlayDelay;
        console.log(`User ${userName} has played a song, eligible for the next free play in ${ttl}ms`);
        return keyResponse;
      });

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

  function getPPPKeyForUser(req, release, license, playbackEligibility) {
    const user = req.isAuthenticated() ? req.user : req.anonymousUser;
    const cachedKey = user.currentPlay
      ? UrlUtils.resolveExpiringLink(user.currentPlay.encryptedKey)
      : null;

    return playbackEligibility.canUseCache && cachedKey
      ? Promise.resolve({ key: cachedKey, cached: true })
      : payForPPPKey(req, release, license, playbackEligibility.payFromProfile);
  }

  function preProcessUser(mediaProvider, jsonAPI) {
    return function preProcessUser(req, res, next) {
      if (req.session && bootSession.indexOf(req.session.id) >= 0 && req.originalUrl != "/logout") {
        console.log(`Redirecting banned session: url=${req.originalUrl}`);
        return res.redirect("/logout");
      }
      const user = req.user;
      if (user) {
        // force locked accounts to log out immediately
        if (!!user.accountLocked && req.originalUrl != "/logout") {
          return res.redirect("/logout");
        }
        if (req.user.pendingInitialization) {
          return jsonAPI.setupNewUser(user)
            .then(() => {
              return res.redirect('/loginRedirect');
            })
            .catch(err => {
              console.log("Failed to setup new user: " + err);
              return next();
            })
        }
        else {
          if (user.profile) {
            user.profile.image = user.profile.ipfsImageUrl
              ? mediaProvider.resolveIpfsUrl(user.profile.ipfsImageUrl)
              : user.profile.image;
            user.profile.heroImage = user.profile.heroImageUrl
              ? mediaProvider.resolveIpfsUrl(user.profile.heroImageUrl)
              : user.profile.heroImage;
          }
          user.canInvite = functions.canInvite(user);
          user.isAdmin = functions.isAdmin(user);
          const fixFacebook = (user.facebook.id && !user.facebook.url);
          const fixTwitter = (user.twitter.id && !user.twitter.url);
          if (fixFacebook || fixTwitter) {
            if (fixFacebook) user.facebook.url = `https://www.facebook.com/app_scoped_user_id/${user.facebook.id}/`;
            if (fixTwitter) user.twitter.url = `https://twitter.com/${user.twitter.username}/`;
            return user.save()
              .then(() => {
                console.log("fixed social urls!");
                return next();
              })
              .catch((err) => {
                console.log("failed to update social urls: " + err);
                return next();
              })
          }
        }
      }
      next();
    }
  }
}
