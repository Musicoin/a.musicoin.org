import {MusicoinAPI} from './musicoin-api';
import {Promise} from 'bluebird';
import * as Formidable from 'formidable';
import * as crypto from 'crypto';
import {MusicoinHelper} from "./musicoin-helper";
import * as FormUtils from "./form-utils";
import * as UrlUtils from "./url-utils";
import * as MetadataLists from '../config/metadata-lists';
import {MusicoinOrgJsonAPI, ArtistProfile} from "./rest-api/json-api";
import {MusicoinRestAPI} from "./rest-api/rest-api";
import {AddressResolver} from "./address-resolver";
import {MailSender} from "./mail-sender";
import {PendingTxDaemon} from './tx-daemon';
import moment = require("moment");
import Feed = require('feed');
import * as request from 'request';
import {ReleaseManagerRouter} from "./release-manager-routes";
import {DashboardRouter} from "./admin-dashboard-routes";
const sendSeekable = require('send-seekable');
const Playback = require('../app/models/playback');
const Release = require('../app/models/release');
const TrackMessage = require('../app/models/track-message');
const EmailConfirmation = require('../app/models/email-confirmation');
const User = require('../app/models/user');
const ErrorReport = require('../app/models/error-report');
const loginRedirect = "/loginRedirect";
const defaultPage = "/nav/feed";
const notLoggedInRedirect = "/welcome"
const maxImageWidth = 400;
const maxHeroImageWidth = 1300;
const defaultProfileIPFSImage = "ipfs://QmQTAh1kwntnDUxf8kL3xPyUzpRFmD3GVoCKA4D37FK77C";
const MAX_MESSAGE_LENGTH = 1000;
const MAX_MESSAGES = 50;
let publicPagesEnabled = false;
const bootSession = ["4i_eBdaFIuXXnQmPcD-Xb5e1lNSmtb8k", "Et_OEXYXR0ig-8yLmXWkVLSr8T7HM_y1"];

const MESSAGE_TYPES = {
  admin: "admin",
  comment: "comment",
  release: "release",
  donate: "donate",
  follow: "follow",
  tip: "tip",
}

export function configure(app, passport, musicoinApi: MusicoinAPI, mediaProvider, config: any) {

  const serverEndpoint = config.serverEndpoint;
  publicPagesEnabled = config.publicPagesEnabled;
  let mcHelper = new MusicoinHelper(musicoinApi, mediaProvider, config.playbackLinkTTLMillis);
  const mailSender = new MailSender();
  let jsonAPI = new MusicoinOrgJsonAPI(musicoinApi, mcHelper, mediaProvider, mailSender, config);
  let restAPI = new MusicoinRestAPI(jsonAPI);
  const addressResolver = new AddressResolver();

  const releaseManager = new ReleaseManagerRouter(musicoinApi,
                                                   jsonAPI,
                                                   addressResolver,
                                                   maxImageWidth,
                                                   mediaProvider,
                                                   config,
                                                   doRender);
  const dashboardManager = new DashboardRouter(musicoinApi,
                                                    jsonAPI,
                                                    addressResolver,
                                                    maxImageWidth,
                                                    mediaProvider,
                                                    config,
                                                    doRender);

  const newProfileListener = p => {
    jsonAPI.sendRewardsForInvite(p)
      .then((results) => console.log(`Rewards sent for inviting ${p._id} profile=${p.profileAddress}, txs: ${JSON.stringify(results)}`))
      .catch(err => console.log(`Failed to send invite rewards: ${err}`));
  };

  const newReleaseListener = r => {
    jsonAPI.postLicenseMessages(r.contractAddress, null, r.artistAddress, "New release!", MESSAGE_TYPES.release, null)
      .catch(err => {
        console.log(`Failed to post a message about a new release: ${err}`)
      });
  };

  new PendingTxDaemon(newProfileListener, newReleaseListener)
    .start(musicoinApi, config.database.pendingReleaseIntervalMs);


  app.use('/oembed', (req, res) => res.render('oembed.ejs'));
  app.use('/services/oembed', (req, res, next) => {
    // https://musicoin.org/nav/track/0x28e4f842f0a441e0247bdb77f3e10b4a54da2502
    console.log("Got oEmbed request: " + req.query.url);
    if (req.query.url && req.query.url.startsWith("https://musicoin.org/")) {
      const parts = req.query.url.split('/');
      const type = parts[parts.length-2];
      const id = parts[parts.length-1];
      console.log("Parsed oEmbed request: " + id);
      if (type == "track" && id && id.trim().length > 0) {
        console.log("Looking for track: " + id);
        return Release.findOne({contractAddress: id})
          .then(release => {
            if (!release) {
              console.log("Could not find track: " + id);
              res.status(404);
              return res.end();
            }
            const json = {
              "version": 1.0,
              "type": "rich",
              "provider_name": "Musicoin",
              "provider_url": "https://musicoin.org",
              "height": 65,
              "width": "100%",
              "title": release.title,
              "description": release.description || `${release.title} by ${release.artistName}`,
              "thumbnail_url": "https://musicoin.org/images/thumbnail.png",
              "html": `\u003Ciframe width=\"300\" height=\"64\" scrolling=\"no\" frameborder=\"no\" src=\"https://musicoin.org/eplayer?track=${id}\"\u003E\u003C/iframe\u003E`,
              "author_name": release.artistName,
              "author_url": `https://musicoin.org/nav/artist/${release.artistAddress}`
            };
            console.log("Responding with: " + JSON.stringify(json, null, 2));
            res.json(json);
          });

      }
    }
    res.status(404);
    res.end();
  });

  // app.get('/eplayer', isLoggedInOrIsPublic, (req, res) => {
  //   if (req.query.track) {
  //     const l = jsonAPI.getLicense(req.query.track);
  //     const r = Release.findOne({contractAddress: req.query.track});
  //
  //     Promise.join(l, r, (license, release) => {
  //       return User.findOne({profileAddress: license.artistProfileAddress}).exec()
  //         .then(artist => {
  //           doRender(req, res, "eplayer.ejs", {
  //             artist: artist,
  //             license: license,
  //             releaseId: release._id,
  //             description: release.description,
  //           });
  //         })
  //     })
  //       .catch(err => {
  //         console.log(`Failed to load embedded player for license: ${req.params.address}, err: ${err}`);
  //         res.render('not-found.ejs');
  //       });
  //   }
  // });

  app.use('/health/shallow', (req, res) => {
    res.json({ok: true})
  });

  app.use('/json-api', restAPI.getRouter());
  app.use('/', preProcessUser(mediaProvider, jsonAPI), checkInviteCode);
  app.use('/admin', isLoggedIn, adminOnly);
  app.use('/admin/*', isLoggedIn, adminOnly);
  app.use('/release-manager', isLoggedIn, releaseManager.getRouter());
  app.use('/admin/', dashboardManager.getRouter());

  app.get('/loginRedirect', (req, res) => {
    if (req.session && req.session.destinationUrl) {
      console.log("Found login redirect override: " + req.session.destinationUrl);
      var url = req.session.destinationUrl
      req.session.destinationUrl = null;
      return res.redirect(url);
    }
    res.redirect(defaultPage);
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
        isAdmin: isAdmin(req.user),
        hasInvite: !req.isAuthenticated()
        && req.session
        && req.session.inviteCode
        && req.session.inviteCode.trim().length > 0,
        inviteClaimed: req.query.inviteClaimed == "true",
      };
      res.render(view, Object.assign({}, defaultContext, context));
    })
  }

  function _formatNumber(value: any, decimals?: number) {
    var raw = parseFloat(value).toFixed(decimals ? decimals : 0);
    var parts = raw.toString().split(".");
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    return parts.join(".");
  }

  function _formatAsISODateTime(timestamp) {
    const iso = new Date(timestamp * 1000).toISOString();
    return `${iso.substr(0, 10)} ${iso.substr(11, 8)} UTC`;
  }

  function _formatDate(timestamp) {
    // TODO: Locale
    var options = {year: 'numeric', month: 'short', day: 'numeric'};
    return new Date(timestamp * 1000).toLocaleDateString('en-US', options);
  }

  app.get('/', (req, res) => {
    res.render(__dirname + '/../overview/index.html', {});
  });
  // app.get('/', unauthRedirect("/info"), checkLoginRedirect, function (req, res) {
  //   res.render('index-frames.ejs', {mainFrameLocation: "/main"});
  // });

  app.get('/accept/:code', (req, res) => {
    console.log(`Processing /accept/${req.params.code}`)
    if (req.get('host') == 'alpha.musicoin.org') {
      console.log(`Redirecting accept from alpha.musicoin.org: ${req.params.code}`);
      return res.redirect("https://musicoin.org/accept/" + req.params.code);
    }
    console.log(`Looking for invite: ${req.params.code}`);
    User.findOne({"invite.inviteCode": req.params.code, "invite.claimed": {$ne: true}}).exec()
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
            "invitesRemaining": {$gt: 0}
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

  app.get('/player', isLoggedInOrIsPublic, (req, res) => {
    res.render('player-frame.ejs');
  });


  // This sucks.  If I want twitter cards to work, we need metadata about the
  // track in the top frame, not the inner frame.  I can't sort out a better way
  // Using the oembed server approach would be MUCH better, but I can't get it to work. :/
  // Twitter just ignores my oembed link.
  app.get('/nav/track/:address', isLoggedInOrIsPublic, (req, res) => {
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

  app.get('/nav/artist/:address', isLoggedInOrIsPublic, (req, res) => {
    console.log("Got external request for a nav/artist page, rendering metadata in the outer frame: " + req.params.address);
    jsonAPI.getArtist(req.params.address, false, false)
      .then(result => {
        res.render('index-frames.ejs', {
          artist: result.artist,
          mainFrameLocation: req.originalUrl.substr(4)
        });
      });
  });

  // anything under "/nav/" is a pseudo url that indicates the location of the mainFrame
  // e.g. /nav/xyz will be re-routed to "/" with a parameter that sets the mainFrame url to "xyz"
  app.get('/nav/*', isLoggedInOrIsPublic, (req, res) => {
    res.render('index-frames.ejs', {mainFrameLocation: req.originalUrl.substr(4)});
  });

  // =====================================
  // HOME PAGE
  // =====================================
  app.get('/main', isLoggedIn, function (req, res) {
    const rs = jsonAPI.getNewReleases(config.ui.home.newReleases).catchReturn([]);
    const fa = jsonAPI.getFeaturedArtists(config.ui.home.newArtists).catchReturn([]);
    const tpw = jsonAPI.getTopPlayedLastPeriod(config.ui.home.topPlayLastWeek, "week").catchReturn([]);
    const ttw = jsonAPI.getTopTippedLastPeriod(config.ui.home.topTippedLastWeek, "week").catchReturn([]);
    const h  = jsonAPI.getHero();
    const b = musicoinApi.getMusicoinAccountBalance().catchReturn(0);
    Promise.join(rs, fa, b, h, tpw, ttw, function (releases, artists, balance, hero, topPlayed, topTipped) {
      doRender(req, res, "index-new.ejs", {
        musicoinClientBalance: balance,
        hero: hero,
        releases: releases,
        featuredArtists: artists,
        topPlayedLastWeek: topPlayed,
        topTippedLastWeek: topTipped,
        ui: config.ui.home
      });
    })
      .catch(function (err) {
        console.log(err);
        res.redirect('/error');
      });
  });

  app.get('/feed', isLoggedIn, function (req, res) {
    const m = jsonAPI.getFeedMessages(req.user._id, config.ui.feed.newMessages);
    const tpw = jsonAPI.getTopPlayedLastPeriod(config.ui.feed.topPlayLastWeek, "week").catchReturn([]);
    const ttw = jsonAPI.getTopTippedLastPeriod(config.ui.feed.topTippedLastWeek, "week").catchReturn([]);
    const h  = jsonAPI.getHero();

    Promise.join(m, h, tpw, ttw, function (messages, hero, topPlayed, topTipped) {
      if (messages.length > 0) {
        console.log("mini: " + req.user.preferences.minimizeHeroInFeed);
        doRender(req, res, "feed.ejs", {
          showFeedPlayAll: true,
          messages: messages,
          topPlayedLastWeek: topPlayed,
          topTippedLastWeek: topTipped,
          hero: hero,
          minimizeHeroInFeed: !!req.user.preferences.minimizeHeroInFeed,
          ui: config.ui.feed
        });
      }
      else {
        res.redirect("/main");
      }
    })
      .catch(function (err) {
        console.log(err);
        res.redirect('/error');
      });
  });

  function handleBrowseRequest(req, res, search, genre) {
    const maxGroupSize = req.query.maxGroupSize ? parseInt(req.query.maxGroupSize) : 8;
    const sort = req.query.sort || "tips";
    const rs = jsonAPI.getNewReleasesByGenre(150, maxGroupSize, search, genre, sort).catchReturn([]);
    const as = jsonAPI.getNewArtists(maxGroupSize, search, genre).catchReturn([]);
    Promise.join(rs, as, function (releases, artists) {
      doRender(req, res, "browse.ejs", {
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

  app.post('/browse', isLoggedIn, function (req, res) {
    handleBrowseRequest(req, res, req.body.search, req.body.genre || req.query.genre);
  });

  app.get('/browse', isLoggedIn, function (req, res) {
    handleBrowseRequest(req, res, req.query.search, req.query.genre);
  });

  app.post('/elements/musicoin-balance', function (req, res) {
    musicoinApi.getMusicoinAccountBalance()
      .then(function (balance) {
        res.render('partials/musicoin-balance.ejs', {musicoinClientBalance: balance});
      });
  });
  app.post('/elements/pending-releases', function (req, res) {
    jsonAPI.getArtist(req.user.profileAddress, true, true)
      .then(function (output) {
        res.render('partials/pending-releases.ejs', output);
      });
  });

  app.post('/elements/release-list', function (req, res) {
    jsonAPI.getArtist(req.user.profileAddress, true, true)
      .then(function (output) {
        res.render('partials/release-list.ejs', output);
      });
  });

  app.post('/elements/featured-artists', function (req, res) {
    const iconSize = req.body.iconSize ? req.body.iconSize : "large";
    jsonAPI.getFeaturedArtists(12)
      .then(function (artists) {
        res.render('partials/featured-artist-list.ejs', {artists: artists, iconSize: iconSize});
      });
  });

  app.post('/elements/new-artists', function (req, res) {
    const iconSize = req.body.iconSize ? req.body.iconSize : "small";
    jsonAPI.getNewArtists(12)
      .then(function (artists) {
        res.render('partials/featured-artist-list.ejs', {artists: artists, iconSize: iconSize});
      });
  });

  app.post('/elements/artist-events', function (req, res) {
    const limit = req.body.limit && req.body.limit > 0 && req.body.limit < MAX_MESSAGES ? parseInt(req.body.limit) : 20;
    const iconSize = req.body.iconSize ? req.body.iconSize : "small";
    jsonAPI.getFeaturedArtists(limit)
      .then(function (artists) {
        res.render('partials/artist-events.ejs', {artists: artists, iconSize: iconSize});
      });
  });

  app.post('/elements/release-events', function (req, res) {
    const limit = req.body.limit && req.body.limit > 0 && req.body.limit < MAX_MESSAGES ? parseInt(req.body.limit) : 20;
    jsonAPI.getNewReleases(limit)
      .then(function (releases) {
        res.render('partials/release-events.ejs', {releases: releases});
      });
  });

  app.post('/elements/top-played-period', function (req, res) {
    const limit = req.body.limit && req.body.limit > 0 && req.body.limit < MAX_MESSAGES ? parseInt(req.body.limit) : 20;
    const period = req.body.period || 'week';
    jsonAPI.getTopPlayedLastPeriod(limit, period)
      .then(function (releases) {
        res.render('partials/release-events.ejs', {releases: releases});
      });
  });

  app.post('/elements/top-tipped-period', function (req, res) {
    const limit = req.body.limit && req.body.limit > 0 && req.body.limit < MAX_MESSAGES ? parseInt(req.body.limit) : 20;
    const period = req.body.period || 'week';
    jsonAPI.getTopTippedLastPeriod(limit, period)
      .then(function (releases) {
        res.render('partials/release-events.ejs', {releases: releases});
      });
  });

  app.post('/elements/new-releases', function (req, res) {
    jsonAPI.getNewReleases(12)
      .then(function (releases) {
        res.render('partials/track-list.ejs', {releases: releases});
      });
  });

  app.post('/elements/recently-played', function (req, res) {
    jsonAPI.getRecentPlays(12)
      .then(function (releases) {
        res.render('partials/track-list.ejs', {releases: releases});
      });
  });

  app.post('/elements/top-played', function (req, res) {
    jsonAPI.getTopPlayed(12)
      .then(function (releases) {
        res.render('partials/track-list.ejs', {releases: releases});
      });
  });

  function handleMessagePost(req) {
    if (req.isAuthenticated() && req.user.profileAddress) {
      if (req.body.message) {
        if (req.body.message.length < MAX_MESSAGE_LENGTH) {
          return jsonAPI.postLicenseMessages(req.body.address, null, req.user.profileAddress, req.body.message, MESSAGE_TYPES.comment, req.body.replyto, req.body.thread)
            .then((post) => {
              if (!req.body.address) return post;
              return jsonAPI.addToReleaseCommentCount(req.body.address)
                .then(() => post);
            })
        }
      }
      else if (req.body.repostMessage) {
        return jsonAPI.repostMessages(req.user.profileAddress,req.body.repostMessage);
      }
      else if (req.body.deleteMessage) {
        return jsonAPI.deleteMessage(req.user.profileAddress,req.body.deleteMessage);
      }
    }

    return Promise.resolve(null);
  }

  app.get('/thread-page', function (req, res) {
    // don't redirect if they aren't logged in, this is just page section
    const limit = req.query.limit && req.query.limit > 0 && req.query.limit < MAX_MESSAGES ? parseInt(req.query.limit) : config.ui.thread.newMessages;
    const showTrack = req.query.showtrack ? req.query.showtrack == "true" : false;
    handleMessagePost(req).then(() => jsonAPI.getThreadMessages(req.query.thread, limit))
      .then(messages => {
        doRender(req, res, "thread.ejs", {
          messages: messages,
          threadId: req.query.thread,
          threadUrl: `${config.serverEndpoint}/thread-page/?thread=${req.query.thread}`,
          showTrack: showTrack,
          ui: config.ui.thread
        });
      })
      .catch(err => {
        console.log("Failed to load thread messages: " + err);
        doRender(req, res, "thread.ejs", {messages: []});
      })
  });

  app.post('/thread-view', function (req, res) {
    // don't redirect if they aren't logged in, this is just page section
    const limit = req.body.limit && req.body.limit > 0 && req.body.limit < MAX_MESSAGES ? parseInt(req.body.limit) : config.ui.thread.newMessages;
    const showTrack = req.body.showtrack ? req.body.showtrack == "true" : false;
    handleMessagePost(req).then(() => jsonAPI.getThreadMessages(req.query.thread, limit))
      .then(messages => {
        doRender(req, res, "thread-view.ejs", {
          messages: messages,
          threadId: req.query.thread,
          threadUrl: `${config.serverEndpoint}/thread-page/?thread=${req.query.thread}`,
          showTrack: showTrack,
          ui: config.ui.thread
        });
      })
      .catch(err => {
        console.log("Failed to load thread messages: " + err);
        doRender(req, res, "thread-view.ejs", {messages: []});
      })
  });

  app.post('/elements/thread', function (req, res) {
    // don't redirect if they aren't logged in, this is just page section
    const limit = req.body.limit && req.body.limit > 0 && req.body.limit < MAX_MESSAGES ? parseInt(req.body.limit) : config.ui.thread.newMessages;
    const showTrack = req.body.showtrack ? req.body.showtrack == "true" : false;
    handleMessagePost(req).then(() => jsonAPI.getThreadMessages(req.body.thread, limit))
      .then(messages => {
        doRender(req, res, "partials/track-messages.ejs", {messages: messages, showTrack: showTrack});
      })
      .catch(err => {
        console.log("Failed to load track messages: " + err);
        doRender(req, res, "partials/track-messages.ejs", {messages: []});
      })
  });


  app.post('/elements/track-messages', function (req, res) {
    // don't redirect if they aren't logged in, this is just page section
    const limit = req.body.limit && req.body.limit > 0 && req.body.limit < MAX_MESSAGES ? parseInt(req.body.limit) : 20;
    const showTrack = req.body.showtrack ? req.body.showtrack == "true" : false;
    handleMessagePost(req).then(() => jsonAPI.getLicenseMessages(req.body.address, limit))
      .then(messages => {
        doRender(req, res, "partials/track-messages.ejs", {messages: messages, showTrack: showTrack});
      })
      .catch(err => {
        console.log("Failed to load track messages: " + err);
        doRender(req, res, "partials/track-messages.ejs", {messages: []});
      })
  });

  app.post('/elements/user-messages', function (req, res) {
    const limit = req.body.limit && req.body.limit > 0 && req.body.limit < MAX_MESSAGES ? parseInt(req.body.limit) : 20;
    const showTrack = req.body.showtrack ? req.body.showtrack == "true" : false;
    const noContentMessage = req.body.nocontentmessage ? req.body.nocontentmessage : "No messages";
    handleMessagePost(req).then(() => jsonAPI.getUserMessages(req.body.user, limit))
      .then(messages => {
        doRender(req, res, "partials/track-messages.ejs", {messages: messages, showTrack: showTrack, noContentMessage: noContentMessage});
      })
      .catch(err => {
        console.log("Failed to load track messages: " + err);
        doRender(req, res, "partials/track-messages.ejs", {messages: []});
      })
  });

  app.post('/elements/feed', function (req, res) {
    // don't redirect if they aren't logged in, this is just page section
    if (!req.isAuthenticated()) {
      return doRender(req, res, "partials/track-messages.ejs", {messages: []});
    }

    const limit = req.body.limit && req.body.limit > 0 && req.body.limit < MAX_MESSAGES ? parseInt(req.body.limit) : 20;
    const showTrack = req.body.showtrack ? req.body.showtrack == "true" : false;
    handleMessagePost(req).then(() => jsonAPI.getFeedMessages(req.user._id, limit))
      .then(messages => {
        return doRender(req, res, "partials/track-messages.ejs", {
          messages: messages,
          showTrack: showTrack,
          noContentMessage: req.body.nocontent
        });
      })
      .catch(err => {
        console.log("Failed to load track messages: " + err);
        return doRender(req, res, "partials/track-messages.ejs", {messages: []});
      })
  });

  app.get('/not-found', function (req, res) {
    res.render('not-found.ejs');
  });

  app.get('/tx/history/:address', isLoggedIn, function (req, res) {
    const length = typeof req.query.length != "undefined" ? parseInt(req.query.length) : 20;
    const start = typeof req.query.start != "undefined" ? parseInt(req.query.start) : 0;
    const previous = Math.max(0, start - length);
    const url = `/tx/history/${req.params.address}`;

    Promise.join(
      musicoinApi.getTransactionHistory(req.params.address, length, start),
      addressResolver.lookupAddress(req.user.profileAddress, req.params.address),
      function (history, name) {
        history.forEach(h => {
          h.formattedDate = _formatAsISODateTime(h.timestamp);
          h.musicoins = _formatNumber(h.musicoins, 5);
        });
        doRender(req, res, 'history.ejs', {
          address: req.params.address,
          name: name ? name : "Transaction History",
          history: history,
          navigation: {
            description: `Showing ${start + 1} to ${start + length}`,
            start: previous > 0 ? `${url}?length=${length}` : null,
            back: previous >= 0 && previous < start ? `${url}?length=${length}&start=${start - length}` : null,
            next: `${url}?length=${length}&start=${start + length}`,
          }
        });
      });
  });

  //app.get('/projects', (req, res) => doRender(req, res, 'projects.ejs', {}));
  //app.get('/team', (req, res) => doRender(req, res, 'team.ejs', {}));
  
  app.get('/faq', (req, res) => doRender(req, res, 'faq.ejs', {}));
  app.get('/info', (req, res) => doRender(req, res, 'info.ejs', {}));
  // app.get('/landing',  (req, res) => doRender(req, res, 'landing.ejs', {}));
  app.get('/welcome',  redirectIfLoggedIn(loginRedirect), (req, res) => {
    if (req.user) {
      console.log("User is already logged in, redirecting away from login page");
      return res.redirect(loginRedirect);
    }
    // render the page and pass in any flash data if it exists
    if (req.query.redirect) {
      console.log(`Session post-login redirect to ${req.query.redirect}, session=${req.session.id}`)
      req.session.destinationUrl = req.query.redirect;
    }
    const message = req.flash('loginMessage');
    doRender(req, res, 'landing.ejs', {
      message: message,
      code: req.session.inviteCode
    });
  });
  app.get('/invite', (req, res) => {
    res.redirect('/welcome');
  });

  app.post('/admin/waitlist/remove', (req, res) => {
    jsonAPI.removeInviteRequest(req.body._id)
      .then(result => res.json(result))
      .catch(err => {
        console.log("failed to remove invite: " + err);
        res.json({success: false, reason: "error"});
      });
  });

  app.post('/admin/hero/select', (req, res) => {
    jsonAPI.promoteTrackToHero(req.body.licenseAddress)
      .then(result => res.json(result))
      .catch(err => {
        console.log("failed to promote track to hero: " + err);
        res.json({success: false, reason: "error"});
      });
  });

  app.post('/admin/release/abuse', (req, res) => {
    const markAsAbuse = req.body.abuse == "true";
    const msg = markAsAbuse ? config.ui.admin.markAsAbuse : config.ui.admin.unmarkAsAbuse;
    jsonAPI.markAsAbuse(req.body.licenseAddress, markAsAbuse)
      .then(result => res.json(result))
      .then(() => {
        jsonAPI.postLicenseMessages(req.body.licenseAddress, null, config.musicoinAdminProfile, msg, MESSAGE_TYPES.admin, null, null);
      })
      .catch(err => {
        console.log("failed to mark track as abuse: " + err);
        res.json({success: false, reason: "error"});
      });
  });



  /*
  app.post('/waitlist/add', (req, res) => {
    if (!req.body) {
      console.log(`Waitlist request failed because no body was included`);
      return res.json({
          success: false,
          message: "Invalid email address"
        });
    }

    if (!FormUtils.validateEmail(req.body.email)) {
      console.log(`Waitlist request failed because email does not appear to be valid: ${req.body.email}`);
      return res.json({
          success: false,
          message: "Invalid email address"
        });
    }

    return jsonAPI.addInviteRequest(req.body.email, req.body.musician == "true")
      .then(result => {
        res.json(result);
      })
      .catch(e => {
        console.log(`Waitlist request failed for ${req.body.email}, musician=${req.body.musician}: ${e}`);
        res.json({
          success: false,
          message: "ok"
        })
      })
  });
  */


  app.get('/new-user', (req, res) => {
    if (req.user.draftProfile && req.user.draftProfile.artistName) {
      return res.redirect("/profile");
    }
    doRender(req, res, 'new-user.ejs', {})
  });
  app.get('/terms', (req, res) => doRender(req, res, 'terms.ejs', {}));
  app.get('/error', (req, res) => doRender(req, res, 'error.ejs', {}));
  app.get('/json-api/demo', isLoggedIn, (req, res) => doRender(req, res, 'api-demo.ejs', {}));

  app.get('/api', (req, res) => doRender(req, res, 'api.ejs', {}));
  app.post('/invite', isLoggedIn, function (req, res) {
    if (canInvite(req.user)) {
      jsonAPI.sendInvite(req.user, req.body.email)
        .then(result => {
          res.redirect(`profile?invited=${result.email}&success=${result.success}&reason=${result.reason}&inviteCode=${result.inviteCode}`);
        });
    }
    else {
      throw new Error("Not authorized");
    }
  });

  app.post('/invite/send', isLoggedIn, function (req, res) {
    if (canInvite(req.user)) {
      jsonAPI.sendInvite(req.user, req.body.email)
        .then(result => {
          res.json(result);
        });
    }
    else {
      throw new Error("Not authorized");
    }
  });

  app.post('/preferences/urlIsPublic', isLoggedIn, function(req, res) {
    const urlIsPublic = req.body.urlIsPublic == "true";
    const provider = req.body.provider;
    if (provider == "twitter" || provider == "facebook") {
      const originalValue = req.user.preferences.urlIsPublic || false;
      req.user[provider].urlIsPublic = urlIsPublic;
      req.user.save()
        .then(() => {
          res.json({
            success: true
          });
        })
        .catch((err) => {
          console.log(`Failed to save user preferences: ${err}`);
          res.json({
            success: false,
            urlIsPublic: originalValue
          });
        })
    }
  });

  app.post('/preferences/update', isLoggedIn, function(req, res) {
    if (!req.user.preferences) {
      req.user.preferences = {};
    }

    const originalValue = req.user.preferences.notifyOnComment || false;
    req.user.preferences.notifyOnComment = req.body.notifyOnComment ? req.body.notifyOnComment == "true" : originalValue;
    req.user.preferences.activityReporting = req.body.activityReporting ? req.body.activityReporting : req.user.preferences.activityReporting || "week";
    req.user.preferences.minimizeHeroInFeed = req.body.minimizeHeroInFeed ? req.body.minimizeHeroInFeed == "true" : req.user.preferences.minimizeHeroInFeed;
    req.user.save()
      .then(() => {
        res.json({
          success: true
        });
      })
      .catch((err) => {
        console.log(`Failed to save user preferences: ${err}`);
        res.json({
          success: false,
          notifyOnComment: originalValue
        });
      })
  });

  // =====================================
  // LOGIN ===============================
  // =====================================
  app.get('/admin/su', isLoggedIn, adminOnly, function (req, res) {
    // render the page and pass in any flash data if it exists
    res.render('su.ejs', {message: req.flash('loginMessage')});
  });

  // process the login form
  // process the login form
  app.post('/admin/su', isLoggedIn, adminOnly, passport.authenticate('local-su', {
    successRedirect: '/profile', // redirect to the secure profile section
    failureRedirect: '/admin/su', // redirect back to the signup page if there is an error
    failureFlash: true // allow flash messages
  }));

  app.get('/admin/licenses/dump', isLoggedIn, adminOnly, function (req, res) {
    // render the page and pass in any flash data if it exists
    jsonAPI.getAllContracts()
      .then(function (all) {
        return Promise.all(all.map(contract => {
          const k = musicoinApi.getKey(contract.address)
            .catch(err => "Unknown: " + err);
          return k.then(function (key) {
            contract.key = key;
            return contract;
          })
        }));
      })
      .then(all => res.json(all));
  });

  app.get('/admin/artists/dump', isLoggedIn, adminOnly, function (req, res) {
    // render the page and pass in any flash data if it exists
    jsonAPI.getAllArtists()
      .then(function (all) {
        res.json(all);
      })
  });

  app.get('/admin/overview', isLoggedIn, adminOnly, function (req, res) {
    // render the page and pass in any flash data if it exists
    const b = musicoinApi.getMusicoinAccountBalance();
    const o = musicoinApi.getAccountBalances(config.trackingAccounts.map(ta => ta.address));
    const wp = User.count({profileAddress: { $exists: true, $ne: null }}).exec();
    const wr = User.count({
      profileAddress: { $exists: true, $ne: null },
      mostRecentReleaseDate: { $exists: true, $ne: null }
    }).exec();
    const tc = Release.count({contractAddress: { $exists: true, $ne: null }, state: "published"}).exec();
    const dtc = Release.count({contractAddress: { $exists: true, $ne: null }, state: "deleted"}).exec();
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
      })
      output.push({
        balance: mcBalance.musicoins,
        formattedBalance: mcBalance.formattedMusicoins,
        name: "MC Client Balance",
        address: "",
      })

      const userMetrics = [];
      userMetrics.push({name: "Users", value: _formatNumber(usersWithProfile)});
      userMetrics.push({name: "Musicians", value: _formatNumber(usersWithRelease)});

      const trackMetrics = [];
      trackMetrics.push({name: "Tracks", value: _formatNumber(trackCount)});
      trackMetrics.push({name: "Deleted Tracks", value: _formatNumber(deletedTrackCount)});
      trackMetrics.push({name: "totalPlays", value: _formatNumber(allReleaseStats[0].totalPlays)});
      trackMetrics.push({name: "totalTips", value: _formatNumber(allReleaseStats[0].totalTips)});
      trackMetrics.push({name: "totalComments", value: _formatNumber(allReleaseStats[0].totalComments)});

      return doRender(req, res, 'admin-overview.ejs', {
        accounts: output,
        userMetrics: userMetrics,
        trackMetrics: trackMetrics,
        bootSessions: bootSession
      });
    })
  });

  app.get('/admin/mail/confirm', isLoggedIn, adminOnly, function (req, res) {
    res.render("mail/email-confirmation.ejs", {
      code: "XY12345"
    })
  });

  app.get('/admin/mail/invite', isLoggedIn, adminOnly, function (req, res) {
    res.render("mail/invite.ejs", {invite: {
      invitedBy: "TestUser",
      acceptUrl: "http://localhost:3000/accept/12345"
    }})
  });

  app.get('/admin/mail/message', isLoggedIn, adminOnly, function (req, res) {
    res.render("mail/message.ejs", {notification: {
      senderName: "Sender-Dan",
      message: "This is some message.  It's really long. This is some message.  It's really long. This is some message.  It's really long. This is some message.  It's really long. This is some message.  It's really long. actually This is some message.  It's really long. This is some message.  It's really long. ",
      trackName: "My Track",
      acceptUrl: "http://localhost:3000/track/12345"
    }})
  });

  app.get('/admin/mail/activity/daily/:profileAddress', isLoggedIn, adminOnly, function (req, res) {
    renderReport(req, res, "day", "daily");
  });

  app.get('/admin/mail/activity/weekly/:profileAddress', isLoggedIn, adminOnly, function (req, res) {
    renderReport(req, res, "week", "weekly");
  });

  app.get('/admin/mail/activity/monthly/:profileAddress', isLoggedIn, adminOnly, function (req, res) {
    renderReport(req, res, "month", "monthly");
  });

  app.get('/admin/mail/activity/yearly/:profileAddress', isLoggedIn, adminOnly, function (req, res) {
    renderReport(req, res, "year", "yearly");
  });

  app.get('/admin/mail/activity/all/:profileAddress', isLoggedIn, adminOnly, function (req, res) {
    renderReport(req, res, "all", "historical");
  });

  function renderReport(req, res, duration, durationAdj) {
    const offset = req.query.offset ? req.query.offset : 0;
    const asOf = moment().subtract(offset, duration).startOf(duration).toDate().getTime();
    jsonAPI.getUserStatsReport(req.params.profileAddress, asOf, duration)
      .then(report => {
        report.actionUrl = config.serverEndpoint + loginRedirect;
        report.baseUrl = config.serverEndpoint;
        report.description = `Musicoin ${durationAdj} report`;
        report.duration = duration;
        res.render("mail/activity-report.ejs", {report: report});
      })
  }

  app.post('/admin/send-weekly-report', (req, res) => {
    if (!req.body.id) return res.json({success: false, reason: "No id"});
    jsonAPI.sendUserStatsReport(req.body.id, "week", "weekly")
      .then(() => {
        res.json({success: true})
      })
      .catch(err => {
        console.log("Failed to send report: " + err);
        res.json({success: false, message: "Failed to send report"})
      })
  });

  app.post('/admin/send-all-weekly-reports', (req, res) => {
    jsonAPI.sendAllUserReports("week", "weekly")
      .then((result) => {
        res.json(result);
      })
      .catch(err => {
        console.log("Failed to send reports: " + err);
        res.json({success: false, message: "Failed to send report"})
      })
  });

  app.post('/admin/free-plays/add', (req, res) => {
    if (!req.body.id) return res.json({success: false, reason: "No id"});
    if (!req.body.count) return res.json({success: false, reason: "Free plays to add not provided"});
    User.findById(req.body.id).exec()
      .then(user => {
        user.freePlaysRemaining += parseInt(req.body.count);
        return user.save();
      })
      .then(() => {
        res.json({success: true})
      })
  });

  app.post('/admin/free-plays/clear', (req, res) => {
    if (!req.body.id) return res.json({success: false, reason: "No id"});
    User.findById(req.body.id).exec()
      .then(user => {
        user.freePlaysRemaining = 0;
        return user.save();
      })
      .then(() => {
        res.json({success: true})
      })
  });

  app.post('/admin/invites/add', (req, res) => {
    if (!req.body.id) return res.json({success: false, reason: "No id"});
    if (!req.body.count) return res.json({success: false, reason: "Invite count to add not provided"});
    User.findById(req.body.id).exec()
      .then(user => {
        user.invitesRemaining += parseInt(req.body.count);
        return user.save();
      })
      .then(() => {
        res.json({success: true})
      })
  });

  app.post('/admin/invites/blacklist', (req, res) => {
    if (!req.body.id) return res.json({success: false, reason: "No id"});
    if (typeof req.body.blacklist == "undefined") return res.json({success: false, reason: "specify true/false for 'blacklist' parameter"});
    User.findById(req.body.id).exec()
      .then(user => {
        user.invite.noReward = req.body.blacklist == "true";
        return user.save();
      })
      .then(() => {
        res.json({success: true})
      })
  });

  app.post('/admin/users/block', (req, res) => {
    if (!req.body.id) return res.json({success: false, reason: "No id"});
    User.findById(req.body.id).exec()
      .then(user => {
        user.blocked = req.body.block == "true";
        return user.save();
      })
      .then(() => {
        res.json({success: true})
      })
  });

  app.post('/admin/users/verify', (req, res) => {
    if (!req.body.id) return res.json({success: false, reason: "No id"});
    User.findById(req.body.id).exec()
      .then(user => {
        console.log(`User verification status changed by ${req.user.draftProfile.artistName}, artist=${user.draftProfile.artistName}, newStatus=${req.body.verified == "true"}`);
        user.verified = req.body.verified == "true";
        return user.save();
      })
      .then(() => {
        res.json({success: true})
      })
  });

  app.post('/admin/session/boot', (req, res) => {
    const idx = bootSession.indexOf(req.body.session);
    if (idx < 0) {
      console.log(`Adding ${req.body.session} to blacklist`)
      bootSession.push(req.body.session);
    }
    res.redirect("/admin/overview");
  });

  app.post('/admin/session/unboot', (req, res) => {
    const idx = bootSession.indexOf(req.body.session);
    if (idx >= 0) {
      console.log(`Removing ${req.body.session} from blacklist`)
      bootSession.splice(idx, 1);
    }
    res.redirect("/admin/overview");
  });

  app.post('/admin/users/lock', (req, res) => {
    if (!req.body.id) return res.json({success: false, reason: "No id"});
    if (typeof req.body.lock == "undefined") return res.json({success: false, reason: "specify true/false for 'lock' parameter"});
    User.findById(req.body.id).exec()
      .then(user => {
        user.accountLocked = req.body.lock == "true";
        return user.save();
      })
      .then(() => {
        res.json({success: true})
      })
  });

  app.get('/admin/invite-requests', (req, res) => {
    const length = typeof req.query.length != "undefined" ? parseInt(req.query.length) : 20;
    const start = typeof req.query.start != "undefined" ? parseInt(req.query.start) : 0;
    const previous = Math.max(0, start - length);
    const url = '/admin/invite-requests?search=' + (req.query.search ? req.query.search : '');
    var options = {year: 'numeric', month: 'short', day: 'numeric'};
    jsonAPI.getAllInviteRequests(req.query.search, start, length)
      .then(requests => {
        requests.forEach(r => {
          r.requestDateDisplay = r.requestDate.toLocaleDateString('en-US', options);
        });
        return requests;
      })
      .then(requests => {
        doRender(req, res, 'admin-invite-requests.ejs', {
          search: req.query.search,
          requests: requests,
          navigation: {
            description: `Showing ${start + 1} to ${start + requests.length}`,
            start: previous > 0 ? `${url}&length=${length}` : null,
            back: previous >= 0 && previous < start ? `${url}&length=${length}&start=${start - length}` : null,
            next: requests.length >= length ? `${url}&length=${length}&start=${start + length}` : null
          }
        });
      });
  });

  app.get('/admin/playback-history', (req, res) => {
    const length = typeof req.query.length != "undefined" ? parseInt(req.query.length) : 20;
    const start = typeof req.query.start != "undefined" ? parseInt(req.query.start) : 0;
    const previous = Math.max(0, start - length);
    const url = '/admin/playback-history?search=' + (req.query.search ? req.query.search : '');
    var options = {year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit'};

    jsonAPI.getPlaybackHistory(req.query.user, req.query.release, start, length)
      .then(output => {
        output.records.forEach(r => {
          r.playbackDateDisplay = r.playbackDate.toLocaleDateString('en-US', options);
          r.nextPlaybackDateDisplay = r.user.freePlaysRemaining > 0 && r.user.nextFreePlayback
            ? r.user.nextFreePlayback.toLocaleDateString('en-US', options) + " (" + r.user.freePlaysRemaining + ")"
            : "N/A";
        });
        return output;
      })
      .then(output => {
        const playbacks = output.records;
        doRender(req, res, 'admin-playback-history.ejs', {
          search: req.query.search,
          playbacks: playbacks,
          navigation: {
            show10: `${url}&length=10`,
            show25: `${url}&length=25`,
            show50: `${url}&length=50`,
            description: `Showing ${start + 1} to ${start + playbacks.length} of ${output.total}`,
            start: previous > 0 ? `${url}&length=${length}` : null,
            back: previous >= 0 && previous < start ? `${url}&length=${length}&start=${start - length}` : null,
            next: playbacks.length >= length ? `${url}&length=${length}&start=${start + length}` : null
          }
        });
      });
  });

  app.post('/admin/errors/remove', (req, res) => {
    jsonAPI.removeError(req.body._id)
      .then(result => res.json(result))
      .catch(err => {
        console.log("failed to remove error: " + err);
        res.json({success: false, reason: "error"});
      });
  });

  app.get('/admin/errors', (req, res) => {
    const length = typeof req.query.length != "undefined" ? parseInt(req.query.length) : 20;
    const start = typeof req.query.start != "undefined" ? parseInt(req.query.start) : 0;
    const previous = Math.max(0, start - length);
    const url = '/admin/errors?search=' + (req.query.search ? req.query.search : '');
    var options = {year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit'};
    jsonAPI.getErrors(req.query.search, start, length)
      .then(errors => {
        errors.forEach(r => {
          r.dateDisplay = r.report.date.toLocaleDateString('en-US', options);
        });
        return errors;
      })
      .then(errors => {
        doRender(req, res, 'admin-errors.ejs', {
          search: req.query.search,
          errors: errors,
          navigation: {
            description: `Showing ${start + 1} to ${start + errors.length}`,
            start: previous > 0 ? `${url}&length=${length}` : null,
            back: previous >= 0 && previous < start ? `${url}&length=${length}&start=${start - length}` : null,
            next: errors.length >= length ? `${url}&length=${length}&start=${start + length}` : null
          }
        });
      });
  });

  app.get('/admin/users', (req, res) => {
    const length = typeof req.query.length != "undefined" ? parseInt(req.query.length) : 10;
    const start = typeof req.query.start != "undefined" ? parseInt(req.query.start) : 0;
    const previous = Math.max(0, start - length);
    const url = '/admin/users?search=' + (req.query.search ? req.query.search : '');
    jsonAPI.getAllUsers(req.query.search, null, null, null, start, length)
      .then(results => {
        const users = results.users;
        doRender(req, res, 'admin-users.ejs', {
          search: req.query.search,
          users: users,
          navigation: {
            show10: `${url}&length=10`,
            show25: `${url}&length=25`,
            show50: `${url}&length=50`,
            description: `Showing ${start + 1} to ${start + users.length}`,
            start: previous > 0 ? `${url}&length=${length}` : null,
            back: previous >= 0 && previous < start ? `${url}&length=${length}&start=${start - length}` : null,
            next: users.length >= length ? `${url}&length=${length}&start=${start + length}` : null
          }
        });
      });
  });

  app.get('/admin/contacts', (req, res) => {
    const length = typeof req.query.length != "undefined" ? parseInt(req.query.length) : 10;
    const start = typeof req.query.start != "undefined" ? parseInt(req.query.start) : 0;
    const previous = Math.max(0, start - length);
    const url = '/admin/contacts?search=' + (req.query.search ? req.query.search : '');
    const downloadUrl = '/admin/contacts/download?search=' + (req.query.search ? req.query.search : '');
    jsonAPI.getAddressBook(req.query.search, start, length)
      .then(users => {
        doRender(req, res, 'admin-contacts.ejs', {
          search: req.query.search,
          users: users,
          navigation: {
            show10: `${url}&length=10`,
            show25: `${url}&length=25`,
            show50: `${url}&length=50`,
            showAll: `${url}&offset=0&length=0`,
            download: `${downloadUrl}`,
            description: `Showing ${start + 1} to ${start + users.length}`,
            start: previous > 0 ? `${url}&length=${length}` : null,
            back: previous >= 0 && previous < start ? `${url}&length=${length}&start=${start - length}` : null,
            next: users.length >= length ? `${url}&length=${length}&start=${start + length}` : null
          }
        });
      });
  });

  app.get('/admin/contacts/download', (req, res) => {
    jsonAPI.getAddressBook(req.query.search, 0, -1)
      .then(users => {
        // Handling UTF-8 character set
        // http://stackoverflow.com/questions/27802123/utf-8-csv-encoding
        var BOM = String.fromCharCode(0xFEFF);

        res.charset = "UTF-8";
        res.set({"Content-Disposition":"attachment; filename=contacts.csv", "Content-Type": "text/csv; charset=utf-8"});
        res.send(BOM + "email,name,artistName\n" + users.map(u => `${u.email},"${u.name}","${u.artistName}"`).join("\n"));
      });
  });

  app.get('/admin/releases', (req, res) => {
    const length = typeof req.query.length != "undefined" ? parseInt(req.query.length) : 10;
    const start = typeof req.query.start != "undefined" ? parseInt(req.query.start) : 0;
    const previous = Math.max(0, start - length);
    const url = '/admin/releases?search=' + (req.query.search ? req.query.search : '');
    jsonAPI.getAllReleases(req.query.search, start, length)
      .then(result => {
        const releases = result.releases;
        doRender(req, res, 'admin-releases.ejs', {
          search: req.query.search,
          releases: releases,
          navigation: {
            show10: `${url}&length=10`,
            show25: `${url}&length=25`,
            show50: `${url}&length=50`,
            description: `Showing ${start + 1} to ${start + releases.length} of ${result.count}`,
            start: previous > 0 ? `${url}&length=${length}` : null,
            back: previous >= 0 && previous < start ? `${url}&length=${length}&start=${start - length}` : null,
            next: releases.length >= length ? `${url}&length=${length}&start=${start + length}` : null
          }
        });
      });
  });

  // =====================================
  // EMAIL ==============================
  // =====================================
  app.get('/login', function (req, res) {
    if (req.user) {
      console.log("User is already logged in, redirecting away from login page");
      return res.redirect(loginRedirect);
    }
    // render the page and pass in any flash data if it exists
    doRender(req, res, 'login.ejs', {message: req.flash('loginMessage')});
  });

  app.get('/connect/email', function (req, res) {
    // render the page and pass in any flash data if it exists
    doRender(req, res, 'login.ejs', {
      message: req.flash('loginMessage'),
    });
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
      const code = crypto.randomBytes(4).toString('hex')
      EmailConfirmation.create({email: req.body.email, code: code})
        .then(record => {
          return mailSender.sendEmailConfirmationCode(req.body.email, code)
            .then(() => {
              console.log(`Sent email confirmation code to ${req.body.email}: ${code}, session=${req.session.id}`);
              res.json({
                success: true,
                email: req.body.email
              });
            })
        })
        .catch((err) => {
          console.log(`Failed to send email confirmation code: ${err}`);
          res.json({
            success: false,
            email: req.body.email,
            reason: "An internal error occurred.  Please try again later."
          });
        });
    }
  });

  function validateLoginEmail(errRedirect) {
    return function (req, res, next) {
      if (req.body.email) req.body.email = req.body.email.trim();
      if (!FormUtils.validateEmail(req.body.email)) {
        req.flash('loginMessage', `The email address you entered '${req.body.email}' does not appear to be valid`);
        return res.redirect(errRedirect);
      }

      // in cases where the user is creating/linking an email address, check the password
      const isLinking = req.isAuthenticated();
      if (isLinking) {
        // passwords must match (also check client side, but don't count on it)
        if (req.body.password != req.body.password2) {
          req.flash('loginMessage', `Your passwords did not match`);
          return res.redirect(errRedirect);
        }

        // minimum password strength
        const error = FormUtils.checkPasswordStrength(req.body.password);
        if (error) {
          req.flash('loginMessage', error);
          return res.redirect(errRedirect);
        }

        return EmailConfirmation.findOne({email: req.body.email, code: req.body.confirmation})
          .then(record => {
            if (record) {
              next();
            }
            else {
              req.flash('loginMessage', "The confirmation code provided did not match the email address provided.");
              return res.redirect(errRedirect);
            }
          })
      }
      return next();
    }
  }

  function validateNewAccount(errRedirect) {
    return function (req, res, next) {
      if (req.body.email) req.body.email = req.body.email.trim().toLowerCase();
      if (!FormUtils.validateEmail(req.body.email)) {
        req.flash('loginMessage', `The email address you entered '${req.body.email}' does not appear to be valid`);
        return res.redirect(errRedirect);
      }

      // in cases where the user is creating/linking an email address, check the password
      // passwords must match (also check client side, but don't count on it)
      if (req.body.password != req.body.password2) {
        req.flash('loginMessage', `Your passwords did not match`);
        return res.redirect(errRedirect);
      }

      if ((!req.body.name || req.body.name.trim().length == 0)) {
        req.flash('loginMessage', `Please enter a screen name`);
        return res.redirect(errRedirect);
      }

      // minimum password strength
      const error = FormUtils.checkPasswordStrength(req.body.password);
      if (error) {
        req.flash('loginMessage', error);
        return res.redirect(errRedirect);
      }

      const cc = EmailConfirmation.findOne({email: req.body.email, code: req.body.confirmation});
      const eu = User.findOne({"local.email": req.body.email});
      const cp = checkCaptcha(req);

      return Promise.join(cc, eu, cp, function(confirmation, existingUser, captchaOk) {
        if (!captchaOk) {
          req.flash('loginMessage', "The reCAPTCHA validation failed.");
          return res.redirect(errRedirect);
        }

        if (existingUser) {
          req.flash('loginMessage', "An account already exists with this email address");
          return res.redirect(errRedirect);
        }

        if (confirmation) {
          next();
        }
        else {
          req.flash('loginMessage', "The confirmation code provided did not match the email address provided.");
          return res.redirect(errRedirect);
        }
      });
    }
  }

  function checkCaptcha(req) {
    const userResponse = req.body['g-recaptcha-response'];
    const url = config.captcha.url;
    return new Promise(function (resolve, reject) {
      var verificationUrl = `${url}?secret=${config.captcha.secret}&response=${userResponse}&remoteip=${req.ip}`;
      console.log(`Sending post to reCAPTCHA,  url=${verificationUrl}`);
      const options = {
        method: 'post',
        url: verificationUrl
      };
      request(options, function (err, res, body) {
        if (err) {
          console.log(err);
          return reject(err);
        }
        else if (res.statusCode != 200) {
          console.log(`reCAPTCHA request failed with status code ${res.statusCode}, url: ${url}`);
          return reject(new Error(`Request failed with status code ${res.statusCode}, url: ${url}`));
        }
        resolve(body);
      });
    }.bind(this))
      .then(captchaResponse => {
        return JSON.parse(captchaResponse);
      })
      .then(captchaResponse => {
        console.log("reCAPTCHA response from google: " + JSON.stringify(captchaResponse));
        return captchaResponse && captchaResponse.success;
      })
      .catch(err => {
        console.log("Failed to process captcha: " + err);
        return false;
      });
  }

  app.post('/connect/email', validateLoginEmail('/connect/email'), passport.authenticate('local', {
    successRedirect : loginRedirect, // redirect to the secure profile section
    failureRedirect : '/connect/email', // redirect back to the signup page if there is an error
    failureFlash : true // allow flash messages
  }));

  app.post('/login', validateLoginEmail('/login'), passport.authenticate('local', {
    successRedirect : loginRedirect, // redirect to the secure profile section
    failureRedirect : '/login', // redirect back to the signup page if there is an error
    failureFlash : true // allow flash messages
  }));

  app.post('/signin', validateLoginEmail('/welcome'), passport.authenticate('local', {
    successRedirect : loginRedirect, // redirect to the secure profile section
    failureRedirect : '/welcome', // redirect back to the signup page if there is an error
    failureFlash : true // allow flash messages
  }));

  app.post('/signup', validateNewAccount('/welcome'), passport.authenticate('local', {
    successRedirect : loginRedirect, // redirect to the secure profile section
    failureRedirect : '/welcome', // redirect back to the signup page if there is an error
    failureFlash : true // allow flash messages
  }));

  // =====================================
  // PUBLIC ARTIST PROFILE SECTION =====================
  // =====================================
  app.get('/artist/:address', isLoggedInOrIsPublic, function (req, res, next) {
    // find tracks for artist
    const m = jsonAPI.getUserMessages(req.params.address, 30);
    const a = jsonAPI.getArtist(req.params.address, true, false);
    const h = jsonAPI.getUserHero(req.params.address);
    const r = jsonAPI.getUserStatsReport(req.params.address, Date.now(), 'all');
    Promise.join(a, m, h, r, (output, messages, hero, statsReport) => {
        if (!output) return res.redirect("/not-found");

        let totalTips = statsReport.stats.user.tipCount;
        let totalPlays = 0;
        statsReport.stats.releases.forEach(rs => {
          totalPlays += rs.playCount;
          totalTips += rs.tipCount;
        });

        output.messages = messages;
        hero.description = output.artist.description;
        output.hero = hero;
        output.showPlayAll = true;
        output.artistStats = {
          playCount: totalPlays,
          tipCount: totalTips,
          totalEarned: (totalPlays + totalTips)
        };
        doRender(req, res, "artist.ejs", output);
      })
  });

  app.post('/track/description', isLoggedIn, function (req, res, next) {
    Release.findOne({
      contractAddress: req.body.contractAddress,
      artistAddress: req.user.profileAddress
    }).
      then((record) => {
        record.description = req.body.description;
        return record.save();
    })
      .then(() => {
        console.log("Save track description: " + req.body.contractAddress);
        res.json({success: true})
      })
      .catch((err) => {
        console.log("Failed to save track description: " + req.body.contractAddress + ": " + err);
        res.json({success: false})
      })
  });

  //0xa0f17e527d50b5973bc0d029006f0f55ace16819
  app.get('/track/:address', isLoggedInOrIsPublic, function (req, res, next) {
    console.log("Loading track page for track address: " + req.params.address);
    const ms = jsonAPI.getLicenseMessages(req.params.address, 20);
    const l = jsonAPI.getLicense(req.params.address);
    const r = Release.findOne({contractAddress: req.params.address, state: 'published'});

    Promise.join(l, ms, r, (license, messages, release) => {
      if (!license || !release) {
        console.log(`Failed to load track page for license: ${req.params.address}, err: Not found`);
        return res.render('not-found.ejs');
      }

      const ras = addressResolver.resolveAddresses("", license.contributors);
      const a = jsonAPI.getArtist(license.artistProfileAddress, false, false);
      Promise.join(a, ras, (response, resolvedAddresses) => {
          let totalShares = 0;
          resolvedAddresses.forEach(r => totalShares += parseInt(r.shares));
          resolvedAddresses.forEach(r => r.percentage = _formatNumber(100 * r.shares / totalShares, 1));
          doRender(req, res, "track.ejs", {
            artist: response.artist,
            license: license,
            contributors: resolvedAddresses,
            releaseId: release._id,
            description: release.description,
            messages: messages,
            isArtist: req.user && req.user.profileAddress == license.artistProfileAddress,
            abuseMessage: config.ui.admin.markAsAbuse
          });
        })
    })
    .catch(err => {
      console.log(`Failed to load track page for license: ${req.params.address}, err: ${err}`);
      res.render('not-found.ejs');
    })
  });

  app.get('/invite-history', isLoggedIn, (req, res) => {
    const length = typeof req.query.length != "undefined" ? parseInt(req.query.length) : 20;
    const start = typeof req.query.start != "undefined" ? parseInt(req.query.start) : 0;
    const previous = Math.max(0, start - length);
    const url = `/invite-history`;
    jsonAPI.getInvitedBy(req.user._id, start, length)
      .then(invites => {
        const output = invites.map(i => {
          return {
            invitedAs: i.invitedAs,
            invitedOn: _formatDate(i.invitedOn.getTime() / 1000),
            claimed: i.claimed,
            inviteCode: i.inviteCode,
            inviteUrl: serverEndpoint + "/accept/" + i.inviteCode,
            profileAddress: i.profileAddress,
            artistName: i.artistName,
            hasReleased: i.hasReleased
          };
        });
        doRender(req, res, 'invite-history.ejs', {
          invites: output,
          navigation: {
            description: `Showing ${start + 1} to ${start + output.length}`,
            start: previous > 0 ? `${url}?length=${length}` : null,
            back: previous >= 0 && previous < start ? `${url}?length=${length}&start=${start - length}` : null,
            next: output.length >= length ? `${url}?length=${length}&start=${start + length}` : null
          }
        });
      });
  });

  app.post("/error-report", function(req, res) {
    const userProfileAddress = req.user ? req.user.profileAddress : "Unknown";
    const userId = req.user ? req.user._id : null;
    console.log(`Error reported by client: 
      licenseAddress: ${req.body.licenseAddress}, 
      errorCode: ${req.body.errorCode}, 
      errorContext: ${req.body.errorContext},
      userProfileAddress: ${userProfileAddress}, 
      user: ${userId}`);

    ErrorReport.create({
      licenseAddress: req.body.licenseAddress,
      user: userId,
      userProfileAddress: userProfileAddress,
      errorCode: req.body.errorCode,
      errorContext: req.body.errorContext
    }); // async, not checking result

    res.json({success: true});
  });

  // =====================================
  // PROFILE SECTION =====================
  // =====================================
  // we will want this protected so you have to be logged in to visit
  // we will use route middleware to verify this (the isLoggedIn function)
  app.get('/profile', isLoggedIn, function (req, res) {
    jsonAPI.getArtist(req.user.profileAddress, true, true).then((output) => {
      output['invited'] = {
        email: req.query.invited,
        success: req.query.success == "true",
        reason: req.query.reason,
        inviteUrl: req.query.inviteCode ? serverEndpoint + "/accept/" + req.query.inviteCode : "",
      };
      output['profileUpdateError'] = req.query.profileUpdateError;
      output['releaseError'] = req.query.releaseError;
      if (typeof req.query.sendError != "undefined") {
        output['sendResult'] = {
          error: req.query.sendError,
        };
      }
      output['metadata'] = {
        languages: MetadataLists.languages,
        moods: MetadataLists.moods,
        genres: MetadataLists.genres,
        regions: MetadataLists.regions
      }
      output.artist.formattedBalance = _formatNumber(output.artist.balance);
      doRender(req, res, "profile.ejs", output);
    })
  });

  app.post('/follows', function(req, res) {
    if (!req.isAuthenticated()) return res.json({success: false, authenticated: false});
    if (!req.user.profileAddress) return res.json({success: false, authenticated: true, profile: false});
    jsonAPI.isUserFollowing(req.user._id, req.body.toFollow)
      .then(result => {
        res.json(result);
      })
      .catch((err) => {
        console.log(`Failed to check following status, user: ${req.user._id} follows: ${req.body.toFollow}, ${err}`)
      })
  });

  app.post('/follow', function(req, res) {
    if (!req.isAuthenticated()) return res.json({success: false, authenticated: false});
    if (!req.user.profileAddress) return res.json({success: false, authenticated: true, profile: false});

    const updateStatus = (req.body.follow == "true")
      ? jsonAPI.startFollowing(req.user._id, req.body.toFollow)
      : jsonAPI.stopFollowing(req.user._id, req.body.toFollow)

    updateStatus
      .then(result => {
        res.json(result);
        return result;
      })
      .then((result) => {
        if (result.following) {
          if (req.body.licenseAddress) {
            Release.findOne({contractAddress: req.body.licenseAddress}).exec()
              .then(release => {
                if (release) {
                  return jsonAPI.postLicenseMessages(
                    req.body.licenseAddress,
                    null,
                    req.user.profileAddress,
                    `${req.user.draftProfile.artistName} is now following ${release.artistName}`,
                    MESSAGE_TYPES.follow,
                    null
                  )
                }
                return null;
              })
              .catch(err => {
                console.log("Failed to send a automated-follow message: " + err);
              })
          }
          else {
            User.findById(req.body.toFollow).exec()
              .then((followedUser) => {
                return jsonAPI.postLicenseMessages(
                  null,
                  followedUser.profileAddress,
                  req.user.profileAddress,
                  `${req.user.draftProfile.artistName} is now following ${followedUser.draftProfile.artistName}`,
                  MESSAGE_TYPES.follow,
                  null)
              })
          }
        }
      })
      .catch((err) => {
        console.log(`Failed to toggle following, user: ${req.user._id} tried to follow/unfollow: ${req.body.toFollow}, ${err}`)
      })
  });

  app.post('/tip', function (req, res) {
    if (!req.isAuthenticated()) return res.json({success: false, authenticated: false});
    if (!req.user.profileAddress) return res.json({success: false, authenticated: true, profile: false});
    if (req.user.profileAddress == req.body.recipient) return res.json({success: false, authenticated: true, profile: true, self: true});
    const units = req.body.amount == 1 ? " coin" : "coins";
    const amount = parseInt(req.body.amount);

    return Release.findOne({contractAddress: req.body.recipient})
      .then(r => {
        if (r && r.artistAddress == req.user.profileAddress) {
          return res.json({success: false, authenticated: true, profile: true, self: true});
        }

        return musicoinApi.sendFromProfile(req.user.profileAddress, req.body.recipient, req.body.amount)
          .then(function (tx) {
            console.log(`Payment submitted! tx : ${tx}`);
            res.json({success: true, tx: tx});
          })
          .then(() => {
            // if this was a tip to a track, add a message to the track saying the user tipped it
            // fire and forget (don't fail if this fails)
            if (req.body.contextType == "TrackMessage") {
              return jsonAPI.addToMessageTipCount(req.body.contextId, amount);
            }
            else if (req.body.contextType == "Release") {
              return jsonAPI.addToReleaseTipCount(req.body.recipient, amount)
                .then(release => {
                  if (release) {
                    return jsonAPI.postLicenseMessages(
                      req.body.recipient,
                      null,
                      req.user.profileAddress,
                      `${req.user.draftProfile.artistName} tipped ${req.body.amount} ${units} on "${release.title}"`,
                      MESSAGE_TYPES.tip,
                      null)
                  }
                })
            }
            else if (req.body.contextType == "User") {
              return jsonAPI.addToUserTipCount(req.body.recipient, amount)
                .then(tippedUser => {
                  if (tippedUser) {
                    return jsonAPI.postLicenseMessages(
                      null,
                      tippedUser.profileAddress,
                      req.user.profileAddress,
                      `${req.user.draftProfile.artistName} tipped ${req.body.amount} ${units} to ${tippedUser.draftProfile.artistName}!`,
                      MESSAGE_TYPES.tip,
                      null)
                  }
                });
            }
            else if (req.body.contextType == "Donate") {
              const msg = req.body.recipient == "0xfef55843244453abc7e183d13139a528bdfbcbed"
                ? `${req.user.draftProfile.artistName} sponsored ${req.body.amount} plays!`
                : `${req.user.draftProfile.artistName} donated ${req.body.amount} ${units} to Musicoin.org!`;

              return jsonAPI.postLicenseMessages(
                null,
                null,
                req.user.profileAddress,
                msg,
                MESSAGE_TYPES.donate,
                null)
            }
          })
          .catch(function (err) {
            console.log(err);
            res.json({success: false});
          })
      })
  });

  app.post('/send', isLoggedIn, function (req, res) {
    musicoinApi.sendFromProfile(req.user.profileAddress, req.body.recipient, req.body.amount)
      .then(function (tx) {
        if (tx) {
          console.log(`Payment submitted! tx : ${tx}`);
          res.redirect("/profile?sendError=false");
        }
        else throw new Error(`Failed to send payment, no tx id was returned: from: ${req.user.profileAddress} to ${req.body.recipient}, amount: ${req.body.amount}`);
      })
      .catch(function (err) {
        console.log(err);
        res.redirect("/profile?sendError=true");
      })
  });

  app.post('/profile/save', isLoggedIn, function (req, res) {
    const form = new Formidable.IncomingForm();
    form.parse(req, (err, fields: any, files: any) => {
      console.log(`Fields: ${JSON.stringify(fields)}`);
      console.log(`Files: ${JSON.stringify(files)}`);

      // if somehow the user when to the new user page, but already has a profile,
      // just skip this step
      const isNewUserPage = fields["isNewUserPage"] == "true";
      if (req.user.profileAddress && isNewUserPage) {
        console.log("Not saving from new user page, since the user already has a profile");
        return res.redirect("/profile");
      }

      const prefix = "social.";
      const socialData = FormUtils.groupByPrefix(fields, prefix);

      const profile = req.user.draftProfile || {};

      // if a new image was selected, upload it to ipfs.
      // otherwise, use the existing IPFS url
      const uploadImage = (!files.photo || files.photo.size == 0)
        ? (profile.ipfsImageUrl && profile.ipfsImageUrl.trim().length > 0)
          ? Promise.resolve(profile.ipfsImageUrl)
          : Promise.resolve(defaultProfileIPFSImage)
        : FormUtils.resizeImage(files.photo.path, maxImageWidth)
          .then((newPath) => mediaProvider.upload(newPath));

      const uploadHeroImage = (!files.hero || files.hero.size == 0)
        ? (profile.heroImageUrl && profile.heroImageUrl.trim().length > 0)
          ? Promise.resolve(profile.heroImageUrl)
          : Promise.resolve(null)
        : FormUtils.resizeImage(files.hero.path, maxHeroImageWidth)
          .then((newPath) => mediaProvider.upload(newPath));

      const version = profile.version ? profile.version : 1;
      const genres = fields.genres || "";
      const regions = fields.regions || "";

      Promise.join(uploadImage, uploadHeroImage, (imageUrl, heroImageUrl) => {
        req.user.draftProfile = {
          artistName: fields.artistName,
          description: fields.description,
          social: socialData,
          ipfsImageUrl: imageUrl,
          heroImageUrl: heroImageUrl,
          genres: genres.split(",").map(s => s.trim()).filter(s => s),
          regions: regions.split(",").map(s => s.trim()).filter(s => s),
          version: version + 1
        };
        console.log(`Saving updated profile to database...`);
        return req.user.save();
      })
        .then((result) => {
          const d = mediaProvider.uploadText(fields.description);
          const s = mediaProvider.uploadText(JSON.stringify(socialData));
          return Promise.join(d, s, (descriptionUrl, socialUrl) => {
            return musicoinApi.publishProfile(req.user.profileAddress, fields.artistName, descriptionUrl, profile.ipfsImageUrl, socialUrl)
              .then((tx) => {
                console.log(`Transaction submitted! Profile tx : ${tx}`);
                req.user.pendingTx = tx;
                req.user.updatePending = true;
                req.user.hideProfile = !!fields.hideProfile;
                console.log(`Saving profile tx info to the database...`);
                req.user.save(function (err) {
                  if (err) {
                    console.log(`Saving profile to database failed! ${err}`);
                    res.send(500);
                  }
                  else {
                    console.log(`Saving profile to database ok!`);
                    if (isNewUserPage) {
                      return res.redirect(loginRedirect);
                    }
                    res.redirect("/profile");
                  }
                });
              })
          })
        })
        .catch((err) => {
          console.log("Failed to update user profile: " + err);
          res.redirect("/profile?profileUpdateError=true");
        })
    });
  });

  app.post('/license/preview/', (req, res) => {
    console.log("Getting license preview");
    convertFormToLicense(req.user.draftProfile.artistName, req.user.profileAddress, req.body)
      .then(function (license) {
        doRender(req, res, 'license.ejs', {showRelease: true, license: license});
      })
  });

  app.post('/license/view/', (req, res) => {
    const hideButtonBar = req.body.hideButtonBar == "true";
    jsonAPI.getLicense(req.body.address)
      .then(function (license) {
        const address = req.user ? req.user.profileAddress : "";
        return Promise.join(
          addressResolver.resolveAddresses(address, license.contributors),
          function (contributors) {
            license.contributors = contributors;
            doRender(req, res, 'license.ejs', {showRelease: false, license: license, hideButtonBar: hideButtonBar});
          });
      })
  });

  function convertFormToLicense(artistName, selfAddress, fields) {
    const trackFields = FormUtils.groupByPrefix(fields, `track0.`);
    const recipients = FormUtils.extractRecipients(trackFields);
    return Promise.join(
      addressResolver.resolveAddresses(selfAddress, recipients.contributors),
      addressResolver.resolveAddresses(selfAddress, recipients.royalties),
      function (resolvedContributors, resolveRoyalties) {
        const license = {
          coinsPerPlay: 1,
          title: trackFields['title'],
          artistName: artistName,
          royalties: resolveRoyalties,
          contributors: resolvedContributors,
          errors: []
        }
        license.errors = doValidation(license);
        return license;
      })
  }

  function doValidation(license): string[] {
    const errors = [];
    if (!license.royalties.every(r => !r.invalid)) errors.push("Invalid addresses");
    if (!license.contributors.every(r => !r.invalid)) errors.push("Invalid addresses");
    if (!(license.title && license.title.trim() != "")) errors.push("Title is required");
    return errors;
  }

  app.post('/license/distributeBalance', isLoggedIn, hasProfile, function (req, res) {
    const contractAddress = req.body.contractAddress;
    musicoinApi.distributeBalance(contractAddress)
      .then(tx => {
        console.log(`distributed balance: ${tx}`);
        res.json({success: true});
      })
      .catch(function (err) {
        res.json({success: false, message: err.message});
      });
  })

  app.post('/license/delete', isLoggedIn, hasProfile, function (req, res) {
    // mark release status as deleted
    // remove from playbacks
    const contractAddress = req.body.contractAddress;
    Release.findOne({contractAddress: contractAddress, artistAddress: req.user.profileAddress}).exec()
      .then(function (record) {
        if (!record) {
          console.log(`Failed to delete release: no record found with contractAddress: ${contractAddress}`);
          throw new Error("Could not find record");
        }
        record.state = 'deleted';
        record.save(function (err) {
          if (err) {
            console.log(`Failed to delete release: no record found with contractAddress: ${contractAddress}, error: ${err}`);
            throw new Error("The database responded with an error");
          }
        })
      })
      .then(function () {
        return Playback.find({contractAddress: contractAddress}).remove().exec();
      })
      .then(function () {
        res.json({success: true});
      })
      .catch(function (err) {
        res.json({success: false, message: err.message});
      });
  });

  app.post('/license/release', isLoggedIn, hasProfile, function (req, res) {
    if (req.user && req.user.blocked) {
      return res.redirect("/profile?releaseError=true");
    }

    const form = new Formidable.IncomingForm();
    form.parse(req, (err, fields: any, files: any) => {
      console.log(`Fields: ${JSON.stringify(fields)}`);
      console.log(`Files: ${JSON.stringify(files)}`);
      let tracks = [];
      for (let i = 0; i < 5; i++) {
        const trackData = Object.assign(FormUtils.groupByPrefix(fields, `track${i}.`), FormUtils.groupByPrefix(files, `track${i}.`));
        if (Object.keys(trackData).length > 0) {
          if (!trackData['genres']) trackData['genres'] = "";
          tracks.push(trackData);
        }
      }

      console.log(`tracks: ${JSON.stringify(tracks)}`);
      const selfAddress = req.user.profileAddress;
      const promises = tracks
        .filter(t => t.title)
        .filter(t => t.audio && t.audio.size > 0)
        .map(track => {
          const recipients = FormUtils.extractRecipients(track);
          track.contributors = recipients.contributors;
          track.royalties = recipients.royalties;
          return track;
        })
        .map(track => {
          const key = crypto.randomBytes(16).toString('base64'); // 128-bits
          const a = mediaProvider.upload(track.audio.path, () => key); // encrypted
          const i = track.image && track.image.size > 0
            ? FormUtils.resizeImage(track.image.path, maxImageWidth)
              .then((newPath) => mediaProvider.upload(newPath))
            : Promise.resolve(req.user.draftProfile.ipfsImageUrl);
          track.genreArray = track.genres.split(",").map(s => s.trim()).filter(s => s);
          const metadata = {
            genres: track.genreArray
          };
          const m = mediaProvider.uploadText(JSON.stringify(metadata));
          const c = addressResolver.resolveAddresses(selfAddress, track.contributors);
          const r = addressResolver.resolveAddresses(selfAddress, track.royalties);

          return Promise.join(a, i, m, c, r, function (audioUrl, imageUrl, metadataUrl, contributors, royalties) {
            track.imageUrl = imageUrl;
            return musicoinApi.releaseTrack(
              req.user.profileAddress,
              req.user.draftProfile.artistName,
              track.title,
              imageUrl,
              metadataUrl,
              audioUrl,
              contributors,
              royalties,
              track.audio.type,
              key);
          })
        });

      Promise.all(promises)
        .then(function (txs: string[]) {
          console.log("Got transactions: " + JSON.stringify(txs));
          const releases = [];
          for (let i = 0; i < txs.length; i++) {
            releases.push({
              tx: txs[i],
              title: tracks[i].title,
              imageUrl: tracks[i].imageUrl,
              artistName: req.user.draftProfile.artistName,
              artistAddress: req.user.profileAddress,
              genres: tracks[i].genreArray
            });
          }

          console.log(`Saving ${releases.length} release txs to database ...`);
          return Release.create(releases);
        })
        .then(function (records) {
          // async, fire and forget.  Just log an error if the update doesn't work.
          User.findOne({profileAddress: selfAddress}).exec()
            .then(function (artist) {
              artist.mostRecentReleaseDate = new Date();
              return artist.save();
            })
            .catch(function (err) {
              console.log("Failed to update artist with new release date: " + err);
            });

          return records;
        })
        .then(function (records) {
          console.log(`Saved releases txs to database!`);
          res.redirect("/profile");
        })
        .catch(function (err) {
          console.log(`Saving releases to database failed! ${err}`);
          res.redirect("/profile?releaseError=true");
        });
    });
  });

  // =====================================
  // LOGOUT ==============================
  // =====================================
  app.get('/logout', function (req, res) {
    req.logout();
    res.redirect('/');
  });

  // =====================================
  // GOOGLE ROUTES =======================
  // =====================================
  // send to google to do the authentication
  // profile gets us their basic information including their name
  // email gets their emails
  app.get('/auth/google', passport.authenticate('google', {scope: ['profile', 'email']}));
  app.get('/connect/google', passport.authorize('google', {scope: ['profile', 'email']}));

  // the callback after google has authenticated the user
  app.get('/auth/google/callback',
    passport.authenticate('google', {
      successRedirect: loginRedirect,
      failureRedirect: '/welcome'
    }));

  app.get('/connect/google/callback',
    passport.authorize('google', {
      successRedirect: loginRedirect,
      failureRedirect: '/'
    }));


  app.get('/auth/soundcloud', passport.authenticate('soundcloud'));

  // the callback after google has authenticated the user
  app.get('/auth/soundcloud/callback',
    passport.authenticate('soundcloud', {
      successRedirect: loginRedirect,
      failureRedirect: '/welcome'
    }));

  app.get('/auth/facebook', passport.authenticate('facebook', {scope: ['public_profile', 'email']}));
  app.get('/connect/facebook', passport.authorize('facebook', {scope: ['public_profile', 'email']}));

  // handle the callback after twitter has authenticated the user
  app.get('/auth/facebook/callback',
    passport.authenticate('facebook', {
      successRedirect: loginRedirect,
      failureRedirect: '/welcome'
    }));

  // handle the callback after twitter has authenticated the user
  app.get('/connect/facebook/callback',
    passport.authenticate('facebook', {
      successRedirect: loginRedirect,
      failureRedirect: '/welcome'
    }));

  app.get('/auth/twitter', passport.authenticate('twitter', {scope: 'email'}));
  app.get('/connect/twitter', passport.authorize('twitter', {scope: 'email'}));

  // handle the callback after twitter has authenticated the user
  app.get('/auth/twitter/callback',
    passport.authenticate('twitter', {
      successRedirect: loginRedirect,
      failureRedirect: '/welcome'
    }));

  app.get('/connect/twitter/callback',
    passport.authenticate('twitter', {
      successRedirect: loginRedirect,
      failureRedirect: '/welcome'
    }));

  // =============================================================================
  // UNLINK ACCOUNTS =============================================================
  // =============================================================================
  // used to unlink accounts. for social accounts, just remove the token
  // for local account, remove email and password
  // user account will stay active in case they want to reconnect in the future
  // google ---------------------------------
  app.post('/unlink/google', function (req, res) {
    unlinkProvider('google', req, res);
  });

  app.post('/unlink/twitter', function (req, res) {
    unlinkProvider('twitter', req, res);
  });

  app.post('/unlink/facebook', function (req, res) {
    unlinkProvider('facebook', req, res);
  });

  app.post('/unlink/local', function (req, res) {
    unlinkProvider('local', req, res);
  });

  function unlinkProvider(provider, req, res) {
    if (!req.isAuthenticated()) {
      return res.json({success: false, message: "You must be logged in to unlink an account"});
    }
    if (!req.user[provider] || !req.user[provider].id) {
      return res.json({success: false, message: `No ${provider} account is linked.`});
    }
    if (getLoginMethodCount(req.user) < 2) {
      return res.json({success: false, message: "You cannot remove your only authentication method."});
    }

    req.user[provider] = {};
    req.user.save(function (err) {
      return res.json({success: true, message: `Your ${provider} account has been unlinked from this account`});
    });
  }

  function getLoginMethodCount(user) {
    let total = 0;
    if (user.google.id) total++;
    if (user.facebook.id) total++;
    if (user.twitter.id) total++;
    if (user.local.id) total++;
    return total;
  }

  function getPlaybackEligibility(req) {
    if (!req.isAuthenticated()) {
      console.log("Rejecting unauthorized user: " + req.session.id);
      return Promise.resolve({success: false, message: "You must be logged in"});
    }
    else {
      const address = req.body && req.body.address ? req.body.address : req.params.address;

      // if the request if for their current track AND the current playback isn't expired
      // short circuit these checks
      const canUseCache = req.user.currentPlay
        && req.user.currentPlay.licenseAddress == address
        && UrlUtils.resolveExpiringLink(req.user.currentPlay.encryptedKey);
      if (canUseCache) return Promise.resolve({success: true, canUseCache: true});

      return Release.findOne({contractAddress: address, state: "published"}).exec()
        .then(release => {
          if (!release) {
            return {success: false, skip: true, message: "Sorry, the track you requested was not found"};
          }
          if (release.markedAsAbuse) {
            return {success: false, skip: true, message: "Sorry, this track was marked as abuse"};
          }

          return User.findOne({profileAddress: release.artistAddress})
            .then(artist => {
              const verifiedArtist = artist && artist.verified;
              const hasNoFreePlays  = req.user.freePlaysRemaining <= 0;
              const payFromProfile = hasNoFreePlays || !verifiedArtist;
              let p = payFromProfile
                ? jsonAPI.getPendingPPPPayments(req.user._id)
                : Promise.resolve([]);
              const b = payFromProfile
                ? musicoinApi.getAccountBalance(req.user.profileAddress)
                : Promise.resolve(null);

              const l = musicoinApi.getLicenseDetails(address);
              return Promise.join(p, b, l, (pendingPayments, profileBalance, license) => {
                if (payFromProfile) {
                  let totalCoinsPending = 0;
                  pendingPayments.forEach(r => totalCoinsPending += r.coins);
                  console.log("Pending ppp payments: " + totalCoinsPending);
                  if (profileBalance.musicoins - totalCoinsPending < license.coinsPerPlay)
                    return {success: false, skip: false, message: "Sorry, it looks like you don't have enough coins."}
                }
                else {
                  const diff = new Date(req.user.nextFreePlayback).getTime() - Date.now();
                  if (diff > 0 && diff < config.freePlayDelay) {
                    return {success: false, skip: false, message: "Sorry, wait a few more seconds for your next free play."}
                  }
                }
                const unit = req.user.freePlaysRemaining-1 == 1 ? "play" : "plays";
                return {
                  success: true,
                  payFromProfile: payFromProfile,
                  message: payFromProfile
                    ? hasNoFreePlays
                      ? "This playback was paid for by you. Thanks!"
                      : "This playback was paid for by you, because this artist is not yet verified and is therefore not eligible for free plays."
                    : `This playback was paid for by Musicoin.org, you have ${req.user.freePlaysRemaining-1} free ${unit} left`
                };
              })
            })
        });
    }
  }


  // convenience method for the UI so it can give a good message to the user about the play
  // ultimately, the ppp route has the final say about whether the playback
  app.post('/user/canPlay', function (req, res) {
    getPlaybackEligibility(req)
      .then(result => {
        res.json(result);
      })
  });

  function resolveExpiringLink(req, res, next) {
    const resolved = UrlUtils.resolveExpiringLink(req.params.address);
    if (!resolved) {
      console.log(`Got ppp request for expired URL: authenticated=${req.isAuthenticated()}, profile: ${req.isAuthenticated() ? req.user.profileAddress : ""}, session: ${req.session.id}`);
      return res.send(new Error("Expired linked: " + req.session.id));
    }
    else {
      const userName = req.user && req.user.draftProfile
        ? req.user.draftProfile.artistName
        : req.user ? req.user._id : "(anonymous)";
      const profileAddress = req.user ? req.user.profileAddress : "";
      console.log(`Resolve ppp request for ${resolved}, ip: ${req.ip}, session: ${req.session.id}, user: ${profileAddress} (${userName})`);
    }
    req.params.address = resolved;
    next();
  }

  function payForPPPKey(user, release, license, payFromProfile) : Promise<any> {
    const ttl = config.playbackLinkTTLMillis;
    const userName = user.draftProfile ? user.draftProfile.artistName : user._id;
    const licenseAddress = release.contractAddress;
    let paymentPromise;

    if (payFromProfile) {
      // user pays.  In this case, we need to track the payment tx to make sure they don't double spend
      paymentPromise = musicoinApi.pppFromProfile(user.profileAddress, licenseAddress)
        .then(keyResponse => {
          console.log("Adding pending tx: " + keyResponse.transactions.paymentToHotWalletTx);
          return jsonAPI.addPendingPPPTransaction(
            user._id,
            release._id,
            license.coinsPerPlay,
            keyResponse.transactions.paymentToHotWalletTx)
            .then(() => {
              return keyResponse;
            });
        })
    }
    else {
      // free play.  in this case, just deduct 1 from the number of remaining free plays
      paymentPromise = musicoinApi.getKey(licenseAddress)
        .then(keyResponse => {
          user.freePlaysRemaining--;
          user.nextFreePlayback = Date.now() + config.freePlayDelay;
          console.log(`User ${userName} has ${user.freePlaysRemaining} free plays remaining, next free play in ${ttl}ms`);
          return keyResponse;
        });
    }

    // once the payment is initiated, update the release stats
    return paymentPromise.then(keyResponse => {
      return jsonAPI.addToReleasePlayCount(user._id, release._id)
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

  function getPPPKeyForUser(user, release, license, playbackEligibility) {
    const cachedKey = user.currentPlay
      ? UrlUtils.resolveExpiringLink(user.currentPlay.encryptedKey)
      : null;

    return playbackEligibility.canUseCache && cachedKey
      ? Promise.resolve({key: cachedKey, cached: true})
      : payForPPPKey(user, release, license, playbackEligibility.payFromProfile);
  }

  app.get('/ppp/:address', (req, res, next) => {
    console.log("Range: " + req.headers.range);
    next();
  }, sendSeekable, resolveExpiringLink, function (req, res) {
    getPlaybackEligibility(req)
      .then(playbackEligibility => {
        if (!playbackEligibility.success) {
          console.log("Rejecting ppp request: " + JSON.stringify(playbackEligibility));
          return res.send(new Error("PPP request failed: " + playbackEligibility.message));
        }

        const context = {contentType: "audio/mpeg"};
        const l = musicoinApi.getLicenseDetails(req.params.address);
        const r = Release.findOne({contractAddress: req.params.address, state: "published"}).exec();

        return Promise.join(l, r, (license, release) => {
          return getPPPKeyForUser(req.user, release, license, playbackEligibility)
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

  app.get('/media/:encryptedHash', function (req, res) {
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

  app.get('/rss/daily-top-tipped', (req, res) => {
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

  app.get('/rss/new-releases', (req, res) => {
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

  app.get('/ipfs/hashes', function(req, res) {
    const since = new Date(parseInt(req.query.since));
    console.log(since);
    const offset = req.query.offset ? parseInt(req.query.offset) : 0;
    const limit = req.query.limit ? Math.min(100, parseInt(req.query.limit)) : 100;
    mediaProvider.getKnownIPFSHashes(since, offset, limit)
      .then(result => {
        res.json(result)
      })
      .catch(function (err) {
        console.error(err.stack);
        res.status(500);
        res.send(err);
      });
  });
}

function isAdmin(user) {
  return (user && user.google && user.google.email && user.google.email.endsWith("@berry.ai"));
}
function canInvite(user) {
  return user.invitesRemaining > 0 || isAdmin(user);
}

function unauthRedirect(dest: string) {
  return function (req, res, next) {
    // if (true) return next();
    // if user is authenticated in the session, carry on
    if (req.isAuthenticated())
      return next();

    console.log(`User is not logged in, redirecting to ${dest}`);

    // if they aren't logged in, redirect them
    res.redirect(dest);
  }
}

function redirectIfLoggedIn(dest) {
  return function(req, res, next) {
    if (req.isAuthenticated()) {
      return res.redirect(dest);
    }
    return next();
  }
}

function isLoggedInOrIsPublic(req, res, next) {
  if (publicPagesEnabled) return next();
  return isLoggedIn(req, res, next);
}

// route middleware to make sure a user is logged in
function isLoggedIn(req, res, next) {

  // if (true) return next();
  // console.log(`Checking is user isAuthenticated: ${req.isAuthenticated()}, ${req.originalUrl}, session:${req.sessionID}`);

  // if user is authenticated in the session, carry on
  if (req.isAuthenticated())
    return next();

  // console.log(`User is not logged in, redirecting`);

  // if they aren't redirect them to the home page
  req.session.destinationUrl = req.originalUrl;
  res.redirect(notLoggedInRedirect);
}

// used only when processing the login success redirect page.  Google, Twitter, Facebook
// will always redirect to the same page.  If we captured the where they were trying to
// go before the were redirected to the auth provider, then when they come back we can
// send them to their intended destination.
// e.g. User goes to /xyz
// User is not logged in, so save "/xyz" in the session
// User is redirected for auth, and sent to /auth/success by passport
// when
function checkLoginRedirect(req, res, next) {
  if (req.session && req.session.destinationUrl) {
    const dest = req.session.destinationUrl;
    delete req.session.destinationUrl;
    return res.redirect(dest);
  }
  next();
}

function debug(msg) {
  return function(req, res, next) {
    console.log(msg);
    return next();
  }
}

function adminOnly(req, res, next) {

  // if user is authenticated in the session, carry on
  if (isAdmin(req.user))
    return next();

  // if they aren't redirect them to the error page
  res.redirect('/error');
}

function hasProfile(req, res, next) {
  if (req.user.profileAddress)
    return next();
  res.redirect('/');
}

function checkInviteCode(req, res, next) {
  const user = req.user;
  if (user && !user.reusableInviteCode) {
    user.reusableInviteCode = crypto.randomBytes(4).toString('hex');
    return user.save()
      .then(() => {
        console.log(`Updated user invite link: ${user.reusableInviteCode}`);
        next();
      })
      .catch(err => {
        console.log(`Failed to create invite link: ${err}`);
        next();
      })
  }
  next();
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
      if(req.user.pendingInitialization) {
        return jsonAPI.setupNewUser(user)
          .then(() => {
            return res.redirect(loginRedirect);
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
        user.canInvite = canInvite(user);
        user.isAdmin = isAdmin(user);
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
            .catch((err)=> {
              console.log("failed to update social urls: " + err);
              return next();
            })
        }
      }
    }
    next();
  }
}
