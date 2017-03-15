import {MusicoinAPI} from './musicoin-api';
import {Promise} from 'bluebird';
import * as Formidable from 'formidable';
import * as crypto from 'crypto';
import {MusicoinHelper} from "./musicoin-helper";
import * as FormUtils from "./form-utils";
import {MusicoinOrgJsonAPI, ArtistProfile} from "./rest-api/json-api";
import {MusicoinRestAPI} from "./rest-api/rest-api";
import {AddressResolver} from "./address-resolver";
import {MailSender} from "./mail-sender";
import {PendingTxDaemon} from './tx-daemon';
const Playback = require('../app/models/playback');
const Release = require('../app/models/release');
const TrackMessage = require('../app/models/track-message');
const EmailConfirmation = require('../app/models/email-confirmation');
const User = require('../app/models/user');
const ErrorReport = require('../app/models/error-report');
const loginRedirect = "/nav/feed";
const notLoggedInRedirect = "/welcome"
const maxImageWidth = 400;
const maxHeroImageWidth = 1300;
const defaultProfileIPFSImage = "ipfs://QmQTAh1kwntnDUxf8kL3xPyUzpRFmD3GVoCKA4D37FK77C";
const MAX_MESSAGE_LENGTH = 1000;
const MAX_MESSAGES = 50;
let publicPagesEnabled = false;

const MESSAGE_TYPES = {
  comment: "comment",
  release: "release",
  donate: "donate",
  follow: "follow",
  tip: "tip",
}

export function configure(app, passport, musicoinApi: MusicoinAPI, mediaProvider, config: any) {

  const serverEndpoint = config.serverEndpoint;
  publicPagesEnabled = config.publicPagesEnabled;
  let mcHelper = new MusicoinHelper(musicoinApi, mediaProvider);
  const mailSender = new MailSender();
  let jsonAPI = new MusicoinOrgJsonAPI(musicoinApi, mcHelper, mediaProvider, mailSender, config);
  let restAPI = new MusicoinRestAPI(jsonAPI);
  const addressResolver = new AddressResolver();

  const newProfileListener = p => {
    jsonAPI.sendRewardsForInvite(p)
      .then((results) => console.log(`Rewards sent for inviting ${p._id} profile=${p.profileAddress}, txs: ${JSON.stringify(results)}`))
      .catch(err => console.log(`Failed to send invite rewards: ${err}`));
  };

  const newReleaseListener = r => {
    jsonAPI.postLicenseMessages(r.contractAddress, null, r.artistAddress, "New release!", MESSAGE_TYPES.release)
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

  app.get('/eplayer', isLoggedInOrIsPublic, (req, res) => {
    if (req.query.track) {
      const l = jsonAPI.getLicense(req.query.track);
      const r = Release.findOne({contractAddress: req.query.track});

      Promise.join(l, r, (license, release) => {
        return User.findOne({profileAddress: license.artistProfileAddress}).exec()
          .then(artist => {
            doRender(req, res, "eplayer.ejs", {
              artist: artist,
              license: license,
              releaseId: release._id,
              description: release.description,
            });
          })
      })
        .catch(err => {
          console.log(`Failed to load embedded player for license: ${req.params.address}, err: ${err}`);
          res.render('not-found.ejs');
        });
    }
  });

  app.use('/json-api', restAPI.getRouter());
  app.use('/', preProcessUser(mediaProvider, jsonAPI));
  app.use('/admin/*', isLoggedIn, adminOnly);

  function doRender(req, res, view, context) {
    const defaultContext = {
      user: req.user,
      isAuthenticated: req.isAuthenticated(),
      isAdmin: isAdmin(req.user),
      hasInvite: !req.isAuthenticated()
      && req.session
      && req.session.inviteCode
      && req.session.inviteCode.trim().length > 0,
      inviteClaimed: req.query.inviteClaimed == "true"
    };
    res.render(view, Object.assign({}, defaultContext, context));
  }

  function _formatNumber(value: any, decimals?: number) {
    var raw = parseFloat(value).toFixed(decimals ? decimals : 0);
    var parts = raw.toString().split(".");
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    return parts.join(".");
  }

  function _formatDate(timestamp) {
    // TODO: Locale
    var options = {year: 'numeric', month: 'short', day: 'numeric'};
    return new Date(timestamp * 1000).toLocaleDateString('en-US', options);
  }

  app.get('/', (req, res) => doRender(req, res, 'info.ejs', {}));
  // app.get('/', unauthRedirect("/info"), checkLoginRedirect, function (req, res) {
  //   res.render('index-frames.ejs', {mainFrameLocation: "/main"});
  // });

  app.get('/accept/:code', (req, res) => {
    console.log("host: " + req.get('host'));
    if (req.get('host') == 'alpha.musicoin.org') {
      return res.redirect("https://musicoin.org/accept/" + req.params.code);
    }
    User.findOne({"invite.inviteCode": req.params.code}).exec()
      .then((record) => {
        delete req.session.inviteCode;
        let inviteClaimed = false;
        if (record) {
          if (!record.invite.claimed) {
            record.invite.clicked = true;
            record.save();
            req.session.inviteCode = req.params.code;
          }
          res.redirect("/welcome?inviteClaimed=" + record.invite.claimed);
        }
        else {
          res.redirect("/info");
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
        res.render('index-frames.ejs', {
          license: license,
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
    const h  = jsonAPI.getHero();
    const b = musicoinApi.getMusicoinAccountBalance().catchReturn(0);
    Promise.join(rs, fa, b, h, function (releases, artists, balance, hero) {
      doRender(req, res, "index-new.ejs", {
        musicoinClientBalance: balance,
        hero: hero,
        releases: releases,
        featuredArtists: artists,
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
    const rs = jsonAPI.getNewReleases(config.ui.feed.newReleases).catchReturn([]);
    const fa = jsonAPI.getFeaturedArtists(config.ui.feed.newArtists).catchReturn([]);
    const h  = jsonAPI.getHero();

    Promise.join(m, rs, h, fa, function (messages, releases, hero, artists) {
      doRender(req, res, "feed.ejs", {
        messages: messages,
        releases: releases,
        hero: hero,
        featuredArtists: artists,
        ui: config.ui.feed
      });
    })
      .catch(function (err) {
        console.log(err);
        res.redirect('/error');
      });
  });

  function handleBrowseRequest(req, res, search, genre) {
    const maxGroupSize = req.query.maxGroupSize ? parseInt(req.query.maxGroupSize) : 8;
    const rs = jsonAPI.getNewReleasesByGenre(100, maxGroupSize, search, genre).catchReturn([]);
    const as = jsonAPI.getNewArtists(maxGroupSize, search, genre).catchReturn([]);
    Promise.join(rs, as, function (releases, artists) {
      doRender(req, res, "browse.ejs", {
        searchTerm: search,
        genreFilter: genre,
        releases: releases,
        maxItemsPerGroup: maxGroupSize,
        artists: artists,
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

  app.post('/elements/track-messages', function (req, res) {
    // don't redirect if they aren't logged in, this is just page section
    const post = (req.isAuthenticated() && req.body.message && req.user.profileAddress && req.body.message.length < MAX_MESSAGE_LENGTH)
      ? jsonAPI.postLicenseMessages(req.body.address, null, req.user.profileAddress, req.body.message, MESSAGE_TYPES.comment, req.body.replyto)
        .then(() => {
          return jsonAPI.addToReleaseCommentCount(req.body.address);
        })
      : Promise.resolve(null);
    const limit = req.body.limit && req.body.limit > 0 && req.body.limit < MAX_MESSAGES ? parseInt(req.body.limit) : 20;
    const showTrack = req.body.showtrack ? req.body.showtrack == "true" : false;
    post.then(() => jsonAPI.getLicenseMessages(req.body.address, limit))
      .then(messages => {
        doRender(req, res, "partials/track-messages.ejs", {messages: messages, showTrack: showTrack});
      })
      .catch(err => {
        console.log("Failed to load track messages: " + err);
        doRender(req, res, "partials/track-messages.ejs", {messages: []});
      })
  });

  app.post('/elements/user-messages', function (req, res) {
    const post = (req.isAuthenticated() && req.body.message && req.user.profileAddress && req.body.message.length < MAX_MESSAGE_LENGTH)
      ? jsonAPI.postLicenseMessages(req.body.address, null, req.user.profileAddress, req.body.message, req.body.replyto)
        .then(() => {
          return jsonAPI.addToReleaseCommentCount(req.body.address);
        })
      : Promise.resolve(null);
    const limit = req.body.limit && req.body.limit > 0 && req.body.limit < MAX_MESSAGES ? parseInt(req.body.limit) : 20;
    const showTrack = req.body.showtrack ? req.body.showtrack == "true" : false;
    post.then(() => jsonAPI.getUserMessages(req.body.user, limit))
      .then(messages => {
        doRender(req, res, "partials/track-messages.ejs", {messages: messages, showTrack: showTrack});
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

    const post = (req.body.message && req.user.profileAddress && req.body.message.length < MAX_MESSAGE_LENGTH)
      ? jsonAPI.postLicenseMessages(req.body.address, null, req.user.profileAddress, req.body.message, req.body.replyto)
      : Promise.resolve(null);
    const limit = req.body.limit && req.body.limit > 0 && req.body.limit < MAX_MESSAGES ? parseInt(req.body.limit) : 20;
    const showTrack = req.body.showtrack ? req.body.showtrack == "true" : false;
    post.then(() => jsonAPI.getFeedMessages(req.user._id, limit))
      .then(messages => {
        doRender(req, res, "partials/track-messages.ejs", {
          messages: messages,
          showTrack: showTrack,
          noContentMessage: req.body.nocontent
        });
      })
      .catch(err => {
        console.log("Failed to load track messages: " + err);
        doRender(req, res, "partials/track-messages.ejs", {messages: []});
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
          h.formattedDate = _formatDate(h.timestamp);
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
  app.get('/welcome', (req, res) => doRender(req, res, 'welcome.ejs', {}));
  app.get('/invite', (req, res) => {
    const musician = req.query.type == "musician";
    doRender(req, res, 'invite.ejs', {
      musician: musician
    });
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

  app.post('/preferences/update', isLoggedIn, function(req, res) {
    if (!req.user.preferences) {
      req.user.preferences = {};
    }
    const originalValue = req.user.preferences.notifyOnComment || false;
    req.user.preferences.notifyOnComment = req.body.notifyOnComment == "true";
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
    musicoinApi.getAccountBalances(config.trackingAccounts.map(ta => ta.address))
      .then(function (balances) {
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
        return doRender(req, res, 'admin-overview.ejs', {accounts: output});
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
    jsonAPI.getUserStatsReport(req.params.profileAddress, Date.now(), duration)
      .then(report => {
        report.actionUrl = config.serverEndpoint + loginRedirect;
        report.baseUrl = config.serverEndpoint;
        report.description = `Musicoin ${durationAdj} report`;
        report.duration = duration;
        res.render("mail/activity-report.ejs", {report: report});
      })
  }

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
    jsonAPI.getAllUsers(req.query.search, start, length)
      .then(users => {
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
              console.log(`Sent email confirmation code to ${req.body.email}: ${code}`)
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

  function validateLoginEmail(req, res, next) {
    if (req.body.email) req.body.email = req.body.email.trim();
    if (!FormUtils.validateEmail(req.body.email)) {
      doRender(req, res, 'login.ejs', {
        message: `The email address you entered '${req.body.email}' does not appear to be valid`,
      });
    }

    // in cases where the user is creating/linking an email address, check the password
    const isLinking = req.isAuthenticated();
    const isNewAccount = (!req.isAuthenticated() && req.session && req.session.inviteCode);
    if (isLinking || isNewAccount) {
      // passwords must match (also check client side, but don't count on it)
      if (req.body.password != req.body.password2) {
        return doRender(req, res, 'login.ejs', {
          message: `Your passwords did not match`,
        });
      }

      if (isNewAccount && (!req.body.name || req.body.name.trim().length == 0)) {
        return doRender(req, res, 'login.ejs', {
          message: `Please enter a screen name`,
        });
      }

      // minimum password strength
      const error = FormUtils.checkPasswordStrength(req.body.password);
      if (error) {
        return doRender(req, res, 'login.ejs', {
          message: error,
        });
      }

      return EmailConfirmation.findOne({email: req.body.email, code: req.body.confirmation})
        .then(record => {
          if (record) {
            next();
          }
          else {
            return doRender(req, res, 'login.ejs', {
              message: "The confirmation code provided did not match the email address provided.",
            });
          }
        })
    }
    return next();
  }

  app.post('/connect/email', validateLoginEmail, passport.authenticate('local', {
    successRedirect : loginRedirect, // redirect to the secure profile section
    failureRedirect : '/connect/email', // redirect back to the signup page if there is an error
    failureFlash : true // allow flash messages
  }));

  app.post('/login', validateLoginEmail, passport.authenticate('local', {
    successRedirect : loginRedirect, // redirect to the secure profile section
    failureRedirect : '/login', // redirect back to the signup page if there is an error
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
    Promise.join(a, m, h, (output, messages, hero) => {
        if (!output) return res.redirect("/not-found");
        output.messages = messages;
        hero.description = output.artist.description;
        output.hero = hero;
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
    const r = Release.findOne({contractAddress: req.params.address});

    Promise.join(l, ms, r, (license, messages, release) => {
      jsonAPI.getArtist(license.artistProfileAddress, false, false)
        .then(response => {
          doRender(req, res, "track.ejs", {
            artist: response.artist,
            license: license,
            releaseId: release._id,
            description: release.description,
            messages: messages,
            isArtist: req.user && req.user.profileAddress == license.artistProfileAddress
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
          error: req.query.sendError
        };
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
                    MESSAGE_TYPES.follow
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
                  MESSAGE_TYPES.follow)
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
    const units = req.body.amount == 1 ? " coin" : "coins";
    const amount = parseInt(req.body.amount);
    musicoinApi.sendFromProfile(req.user.profileAddress, req.body.recipient, req.body.amount)
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
                  MESSAGE_TYPES.tip)
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
                  MESSAGE_TYPES.tip)
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
            MESSAGE_TYPES.donate)
        }
      })
      .catch(function (err) {
        console.log(err);
        res.json({success: false});
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

      Promise.join(uploadImage, uploadHeroImage, (imageUrl, heroImageUrl) => {
        req.user.draftProfile = {
          artistName: fields.artistName,
          description: fields.description,
          social: socialData,
          ipfsImageUrl: imageUrl,
          heroImageUrl: heroImageUrl,
          genres: genres.split(",").map(s => s.trim()).filter(s => s),
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
    jsonAPI.getLicense(req.body.address)
      .then(function (license) {
        return Promise.join(
          addressResolver.resolveAddresses(req.user.profileAddress, license.contributors),
          function (contributors) {
            license.contributors = contributors;
            doRender(req, res, 'license.ejs', {showRelease: false, license: license});
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
      failureRedirect: '/invite'
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
      failureRedirect: '/invite'
    }));

  app.get('/auth/facebook', passport.authenticate('facebook', {scope: ['public_profile', 'email']}));
  app.get('/connect/facebook', passport.authorize('facebook', {scope: ['public_profile', 'email']}));

  // handle the callback after twitter has authenticated the user
  app.get('/auth/facebook/callback',
    passport.authenticate('facebook', {
      successRedirect: loginRedirect,
      failureRedirect: '/invite'
    }));

  // handle the callback after twitter has authenticated the user
  app.get('/connect/facebook/callback',
    passport.authenticate('facebook', {
      successRedirect: loginRedirect,
      failureRedirect: '/invite'
    }));

  app.get('/auth/twitter', passport.authenticate('twitter', {scope: 'email'}));
  app.get('/connect/twitter', passport.authorize('twitter', {scope: 'email'}));

  // handle the callback after twitter has authenticated the user
  app.get('/auth/twitter/callback',
    passport.authenticate('twitter', {
      successRedirect: loginRedirect,
      failureRedirect: '/invite'
    }));

  app.get('/connect/twitter/callback',
    passport.authenticate('twitter', {
      successRedirect: loginRedirect,
      failureRedirect: '/invite'
    }));

  // =============================================================================
  // UNLINK ACCOUNTS =============================================================
  // =============================================================================
  // used to unlink accounts. for social accounts, just remove the token
  // for local account, remove email and password
  // user account will stay active in case they want to reconnect in the future
  // google ---------------------------------
  app.get('/unlink/google', function (req, res) {
    var user = req.user;
    user.google.token = undefined;
    user.save(function (err) {
      res.redirect('/profile');
    });
  });

  app.get('/unlink/twitter', function (req, res) {
    var user = req.user;
    user.twitter.token = undefined;
    user.save(function (err) {
      res.redirect('/profile');
    });
  });

  app.get('/unlink/facebook', function (req, res) {
    var user = req.user;
    user.facebook.token = undefined;
    user.save(function (err) {
      res.redirect('/profile');
    });
  });

  app.get('/ppp/:address', (req, res, next) => {
    console.log("(pre login check): Got ppp request for " + req.params.address);
    next();
  }, isLoggedInOrIsPublic, function (req, res) {
    console.log("Got ppp request for " + req.params.address);
    const k = musicoinApi.getKey(req.params.address);
    const l = musicoinApi.getLicenseDetails(req.params.address);
    const r = Release.findOne({contractAddress: req.params.address, state: "published"}).exec();
    const context = {contentType: "audio/mpeg"};
    Promise.join(k, l, r, function (keyResponse, license, release) {
      if (!release) throw new Error("Could not find contract in database (maybe it was deleted)");
      console.log("Content type from license: " + license.contentType);
      // context.contentType = license.contentType && !license.contentType.startsWith("0x") ? license.contentType : context.contentType;
      return mediaProvider.getIpfsResource(license.resourceUrl, () => keyResponse.key)
        .then(function (result) {
          // try to update stats, but don't fail if update fails
          return jsonAPI.addToReleasePlayCount(release.contractAddress)
            .then(() => result)
            .catch(err => {
              console.log(`Failed to update stats for release: ${err}`);
              return result;
            });
        });
    })
      .then(function (result) {
        const headers = {};
        console.log(`Responding with content type ${context.contentType}`);
        headers['Content-Type'] = context.contentType;
        headers['Accept-Ranges'] = 'none';
        headers['Content-Length'] = result.headers['content-length'];
        res.writeHead(200, headers);
        result.stream.pipe(res);
      })
      .catch(function (err) {
        console.error(err.stack);
        res.status(500);
        res.send(err);
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
    console.log(`Checking is user isAuthenticated: ${req.isAuthenticated()}, ${req.originalUrl}, session:${req.sessionID}`);

    // if user is authenticated in the session, carry on
    if (req.isAuthenticated())
      return next();

    console.log(`User is not logged in, redirecting to ${dest}`);

    // if they aren't logged in, redirect them
    res.redirect(dest);
  }
}

function isLoggedInOrIsPublic(req, res, next) {
  if (publicPagesEnabled) return next();
  return isLoggedIn(req, res, next);
}

// route middleware to make sure a user is logged in
function isLoggedIn(req, res, next) {

  // if (true) return next();
  console.log(`Checking is user isAuthenticated: ${req.isAuthenticated()}, ${req.originalUrl}, session:${req.sessionID}`);

  // if user is authenticated in the session, carry on
  if (req.isAuthenticated())
    return next();

  console.log(`User is not logged in, redirecting`);

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

function preProcessUser(mediaProvider, jsonAPI) {
  return function preProcessUser(req, res, next) {
    const user = req.user;
    if (user) {
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
        if (user.following && user.following.length > 0) {
          return jsonAPI.migrateUserFollowing(user._id)
            .then(() => {
              console.log("Successfully migrated user");
            })
            .catch((err) => {
              console.log("Failed to migrate user: " + err);
              return next();
            })
        }
      }
    }
    next();
  }
}
