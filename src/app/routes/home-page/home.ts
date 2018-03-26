import { Promise } from 'bluebird';

import { ExchangeRateProvider } from '../../extra/exchange-service';
import { MailSender } from '../../extra/mail-sender';
import { AddressResolver } from '../../internal/address-resolver';
import { MusicoinAPI } from '../../internal/musicoin-api';
import { MusicoinHelper } from '../../internal/musicoin-helper';
import { MusicoinOrgJsonAPI } from '../../rest-api/json-api';
import { RequestCache } from '../../utils/cached-request';
import * as FormUtils from '../../utils/form-utils';

let publicPagesEnabled = false;
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

var functions = require('../routes-functions');
export function configure(app, passport, musicoinApi: MusicoinAPI, mediaProvider, config: any) {
  const MediaProvider = require('../../../media/media-provider');
  const mailSender = new MailSender();
  const cachedRequest = new RequestCache();
  const addressResolver = new AddressResolver();
  const exchangeRateProvider = new ExchangeRateProvider(config.exchangeRateService, cachedRequest);
  let mcHelper = new MusicoinHelper(musicoinApi, mediaProvider, config.playbackLinkTTLMillis);
  const jsonAPI = new MusicoinOrgJsonAPI(musicoinApi, mcHelper, mediaProvider, mailSender, exchangeRateProvider, config);

  app.get('/main', functions.isLoggedIn, function (req, res) {
    const rs = jsonAPI.getNewReleases(config.ui.home.newReleases).catchReturn([]);
    const fa = jsonAPI.getFeaturedArtists(config.ui.home.newArtists).catchReturn([]);
    const tpw = jsonAPI.getTopPlayedLastPeriod(config.ui.home.topPlayLastWeek, "week").catchReturn([]);
    const ttw = jsonAPI.getTopTippedLastPeriod(config.ui.home.topTippedLastWeek, "week").catchReturn([]);
    const h = jsonAPI.getHero();
    const b = musicoinApi.getMusicoinAccountBalance().catchReturn(0);
    Promise.join(rs, fa, b, h, tpw, ttw, function (releases, artists, balance, hero, topPlayed, topTipped) {
      return doRender(req, res, "index-new.ejs", {
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

  app.get('/feed', functions.isLoggedIn, function (req, res) {
    const messageTypes = req.user && req.user.preferences && req.user.preferences.feedFilter ? req.user.preferences.feedFilter.split("|").filter(v => v) : [];
    const m = jsonAPI.getFeedMessages(req.user._id, config.ui.feed.newMessages, messageTypes);
    const tpw = jsonAPI.getTopPlayedLastPeriod(config.ui.feed.topPlayLastWeek, "week").catchReturn([]);
    const ttw = jsonAPI.getTopTippedLastPeriod(config.ui.feed.topTippedLastWeek, "week").catchReturn([]);
    const h = jsonAPI.getHero();
    const r = jsonAPI.getUserRecentPlays(req.user._id, 0, config.ui.feed.myPlays);

    Promise.join(m, h, tpw, ttw, r, function (messages, hero, topPlayed, topTipped, recentlyPlayed) {
      if (messages.length > 0) {
        console.log("mini: " + req.user.preferences.minimizeHeroInFeed);
        return doRender(req, res, "feed.ejs", {
          showFeedPlayAll: true,
          messages: messages,
          messageTypes: messageTypes,
          topPlayedLastWeek: topPlayed,
          topTippedLastWeek: topTipped,
          recentlyPlayed: recentlyPlayed,
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

  app.post('/browse', function (req, res) {
    handleBrowseRequest(req, res, req.body.search, req.body.genre || req.query.genre);
  });

  app.get('/browse', function (req, res) {
    handleBrowseRequest(req, res, req.query.search, req.query.genre);
  });

  app.post('/elements/musicoin-balance', function (req, res) {
    musicoinApi.getMusicoinAccountBalance()
      .then(function (balance) {
        res.render('partials/musicoin-balance.ejs', { musicoinClientBalance: balance });
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
        res.render('partials/featured-artist-list.ejs', { artists: artists, iconSize: iconSize });
      });
  });

  app.post('/elements/new-artists', function (req, res) {
    const iconSize = req.body.iconSize ? req.body.iconSize : "small";
    jsonAPI.getNewArtists(12)
      .then(function (artists) {
        res.render('partials/featured-artist-list.ejs', { artists: artists, iconSize: iconSize });
      });
  });

  app.post('/elements/artist-events', function (req, res) {
    const limit = req.body.limit && req.body.limit > 0 && req.body.limit < MAX_MESSAGES ? parseInt(req.body.limit) : 20;
    const iconSize = req.body.iconSize ? req.body.iconSize : "small";
    jsonAPI.getFeaturedArtists(limit)
      .then(function (artists) {
        res.render('partials/artist-events.ejs', { artists: artists, iconSize: iconSize });
      });
  });

  app.post('/elements/release-events', function (req, res) {
    const limit = req.body.limit && req.body.limit > 0 && req.body.limit < MAX_MESSAGES ? parseInt(req.body.limit) : 20;
    jsonAPI.getNewReleases(limit)
      .then(function (releases) {
        res.render('partials/release-events.ejs', { releases: releases });
      });
  });

  app.post('/elements/top-played-period', function (req, res) {
    const limit = req.body.limit && req.body.limit > 0 && req.body.limit < MAX_MESSAGES ? parseInt(req.body.limit) : 20;
    const period = req.body.period || 'week';
    jsonAPI.getTopPlayedLastPeriod(limit, period)
      .then(function (releases) {
        res.render('partials/release-events.ejs', { releases: releases });
      });
  });

  app.post('/elements/top-tipped-period', function (req, res) {
    const limit = req.body.limit && req.body.limit > 0 && req.body.limit < MAX_MESSAGES ? parseInt(req.body.limit) : 20;
    const period = req.body.period || 'week';
    jsonAPI.getTopTippedLastPeriod(limit, period)
      .then(function (releases) {
        res.render('partials/release-events.ejs', { releases: releases });
      });
  });

  app.post('/elements/new-releases', function (req, res) {
    jsonAPI.getNewReleases(12)
      .then(function (releases) {
        res.render('partials/track-list.ejs', { releases: releases });
      });
  });

  app.post('/elements/recently-played', function (req, res) {
    jsonAPI.getRecentPlays(12)
      .then(function (releases) {
        res.render('partials/track-list.ejs', { releases: releases });
      });
  });

  app.post('/elements/top-played', function (req, res) {
    jsonAPI.getTopPlayed(12)
      .then(function (releases) {
        res.render('partials/track-list.ejs', { releases: releases });
      });
  });

  app.post('/elements/user-recently-played', function (req, res) {
    const limit = req.body.limit && req.body.limit > 0 ? parseInt(req.body.limit) : 10;
    const start = req.body.start && req.body.start > 0 ? parseInt(req.body.start) : 0;
    jsonAPI.getUserRecentPlays(req.user._id, start, limit)
      .then(function (recentlyPlayed) {
        res.render('partials/release-events.ejs', { releases: recentlyPlayed, elementId: req.body.elementid });
      });
  });

  app.post('/elements/play-queue', function (req, res) {
    res.render('partials/play-queue-active.ejs', {});
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
        return jsonAPI.repostMessages(req.user.profileAddress, req.body.repostMessage);
      }
      else if (req.body.deleteMessage) {
        return jsonAPI.deleteMessage(req.user.profileAddress, req.body.deleteMessage);
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
        return doRender(req, res, "thread.ejs", {
          messages: messages,
          threadId: req.query.thread,
          threadUrl: `${config.serverEndpoint}/thread-page/?thread=${req.query.thread}`,
          showTrack: showTrack,
          ui: config.ui.thread
        });
      })
      .catch(err => {
        console.log("Failed to load thread messages: " + err);
        return doRender(req, res, "thread.ejs", { messages: [] });
      })
  });

  app.post('/thread-view', function (req, res) {
    // don't redirect if they aren't logged in, this is just page section
    const limit = req.body.limit && req.body.limit > 0 && req.body.limit < MAX_MESSAGES ? parseInt(req.body.limit) : config.ui.thread.newMessages;
    const showTrack = req.body.showtrack ? req.body.showtrack == "true" : false;
    handleMessagePost(req).then(() => jsonAPI.getThreadMessages(req.query.thread, limit))
      .then(messages => {
        return doRender(req, res, "thread-view.ejs", {
          messages: messages,
          threadId: req.query.thread,
          threadUrl: `${config.serverEndpoint}/thread-page/?thread=${req.query.thread}`,
          showTrack: showTrack,
          ui: config.ui.thread
        });
      })
      .catch(err => {
        console.log("Failed to load thread messages: " + err);
        return doRender(req, res, "thread-view.ejs", { messages: [] });
      })
  });

  app.post('/elements/thread', function (req, res) {
    // don't redirect if they aren't logged in, this is just page section
    const limit = req.body.limit && req.body.limit > 0 && req.body.limit < MAX_MESSAGES ? parseInt(req.body.limit) : config.ui.thread.newMessages;
    const showTrack = req.body.showtrack ? req.body.showtrack == "true" : false;
    const threadId = FormUtils.defaultString(req.body.thread, "");
    handleMessagePost(req).then(() => jsonAPI.getThreadMessages(threadId, limit))
      .then(messages => {
        return doRender(req, res, "partials/track-messages.ejs", { messages: messages, showTrack: showTrack });
      })
      .catch(err => {
        console.log("Failed to load track messages: " + err);
        return doRender(req, res, "partials/track-messages.ejs", { messages: [] });
      })
  });


  app.post('/elements/track-messages', function (req, res) {
    // don't redirect if they aren't logged in, this is just page section
    const limit = req.body.limit && req.body.limit > 0 && req.body.limit < MAX_MESSAGES ? parseInt(req.body.limit) : 20;
    const showTrack = req.body.showtrack ? req.body.showtrack == "true" : false;
    handleMessagePost(req).then(() => jsonAPI.getLicenseMessages(req.body.address, limit))
      .then(messages => {
        return doRender(req, res, "partials/track-messages.ejs", { messages: messages, showTrack: showTrack });
      })
      .catch(err => {
        console.log("Failed to load track messages: " + err);
        return doRender(req, res, "partials/track-messages.ejs", { messages: [] });
      })
  });

  app.post('/elements/user-messages', function (req, res) {
    const limit = req.body.limit && req.body.limit > 0 && req.body.limit < MAX_MESSAGES ? parseInt(req.body.limit) : 20;
    const showTrack = req.body.showtrack ? req.body.showtrack == "true" : false;
    const noContentMessage = req.body.nocontentmessage ? req.body.nocontentmessage : "No messages";
    const profileAddress = FormUtils.defaultString(req.body.user, "");
    handleMessagePost(req).then(() => jsonAPI.getUserMessages(profileAddress, limit))
      .then(messages => {
        return doRender(req, res, "partials/track-messages.ejs", { messages: messages, showTrack: showTrack, noContentMessage: noContentMessage });
      })
      .catch(err => {
        console.log("Failed to load track messages: " + err);
        return doRender(req, res, "partials/track-messages.ejs", { messages: [] });
      })
  });

  app.post('/elements/feed', function (req, res) {
    // don't redirect if they aren't logged in, this is just page section
    if (!req.isAuthenticated()) {
      return doRender(req, res, "partials/track-messages.ejs", { messages: [] });
    }

    const limit = req.body.limit && req.body.limit > 0 && req.body.limit < MAX_MESSAGES ? parseInt(req.body.limit) : 20;
    const showTrack = req.body.showtrack ? req.body.showtrack == "true" : false;
    const messageTypes = req.body.messagetypes ? req.body.messagetypes.split("|") : [];
    if (req.user && req.user.preferences && req.user.preferences.feedFilter != req.body.messagetypes) {
      req.user.preferences.feedFilter = req.body.messagetypes;
      req.user.save();
    }

    handleMessagePost(req).then(() => jsonAPI.getFeedMessages(req.user._id, limit, messageTypes))
      .then(messages => {
        return doRender(req, res, "partials/track-messages.ejs", {
          messages: messages,
          showTrack: showTrack,
          noContentMessage: req.body.nocontent
        });
      })
      .catch(err => {
        console.log("Failed to load track messages: " + err);
        return doRender(req, res, "partials/track-messages.ejs", { messages: [] });
      })
  });

  app.get('/not-found', function (req, res) {
    res.render('not-found.ejs');
  });

  app.get('/tx/history/:address', functions.isLoggedIn, function (req, res) {
    const length = typeof req.query.length != "undefined" ? parseInt(req.query.length) : 20;
    const start = typeof req.query.start != "undefined" ? parseInt(req.query.start) : 0;
    const previous = Math.max(0, start - length);
    const url = `/tx/history/${req.params.address}`;

    Promise.join(
      musicoinApi.getTransactionHistory(req.params.address, length, start),
      addressResolver.lookupAddress(req.user.profileAddress, req.params.address),
      function (history, name) {
        if (!Array.isArray(history)) {
          history = [];
        }
        history.forEach(h => {
          h.formattedDate = functions._formatAsISODateTime(h.timestamp);
          h.musicoins = functions._formatNumber(h.musicoins, 5);
        });
        // .catch (function(e) {
        //  console.log(e);
        // });
        return doRender(req, res, 'history.ejs', {
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


  // app.get('/landing',  (req, res) => doRender(req, res, 'landing.ejs', {}));
  app.get('/welcome', functions.redirectIfLoggedIn('/loginRedirect'), (req, res) => {
    if (req.user) {
      console.log("User is already logged in, redirecting away from login page");
      return res.redirect('/loginRedirect');
    }
    // render the page and pass in any flash data if it exists
    if (req.query.redirect) {
      console.log(`Session post-login redirect to ${req.query.redirect}, session=${req.session.id}`);
      req.session.destinationUrl = req.query.redirect;
    }
    const message = req.flash('loginMessage');
    return doRender(req, res, 'landing.ejs', {
      message: message,
      code: req.session.inviteCode
    });
  });
  app.get('/welcome-musician', functions.redirectIfLoggedIn('/loginRedirect'), (req, res) => {

    if (req.user) {
      console.log("User is already logged in, redirecting away from login page");
      return res.redirect('/loginRedirect');
    }
    // render the page and pass in any flash data if it exists
    if (req.query.redirect) {
      console.log(`Session post-login redirect to ${req.query.redirect}, session=${req.session.id}`);
      req.session.destinationUrl = req.query.redirect;
    }
    const message = req.flash('loginMessage');
    return doRender(req, res, 'landing_musicians.ejs', {
      message: message,
      code: req.session.inviteCode
    });
  });


  app.get('/terms', (req, res) => doRender(req, res, 'terms.ejs', {}));
  app.get('/error', (req, res) => doRender(req, res, 'error.ejs', {}));

  app.post('/preferences/urlIsPublic', functions.isLoggedIn, function (req, res) {
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

  app.post('/preferences/update', functions.isLoggedIn, function (req, res) {
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
  function handleBrowseRequest(req, res, _search, genre) {
    const search = FormUtils.defaultString(_search, null);
    const maxGroupSize = req.query.maxGroupSize ? parseInt(req.query.maxGroupSize) : 8;
    const sort = req.query.sort || "tips";
    const rs = jsonAPI.getNewReleasesByGenre(150, maxGroupSize, search, genre, sort).catchReturn([]);
    const as = jsonAPI.getNewArtists(maxGroupSize, search, genre).catchReturn([]);
    Promise.join(rs, as, function (releases, artists) {
      return this.doRender(req, res, "browse.ejs", {
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
        isAdmin: this.isAdmin(req.user),
        hasInvite: !req.isAuthenticated()
          && req.session
          && req.session.inviteCode
          && req.session.inviteCode.trim().length > 0,
        inviteClaimed: req.query.inviteClaimed == "true",
      };
      res.render(view, Object.assign({}, defaultContext, context));
    })
  }
}
