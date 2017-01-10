import {MusicoinAPI} from './musicoin-api';
import {Promise} from 'bluebird';
import * as Formidable from 'formidable';
import * as crypto from 'crypto';
import {MusicoinHelper} from "./musicoin-helper";
import {MusicoinOrgJsonAPI, ArtistProfile} from "./rest-api/json-api";
import {MusicoinRestAPI} from "./rest-api/rest-api";
const User = require('../app/models/user');
const Playback = require('../app/models/playback');
const Release = require('../app/models/release');

export function configure(app, passport, musicoinApi: MusicoinAPI, mediaProvider) {

  let mcHelper = new MusicoinHelper(musicoinApi, mediaProvider);
  let jsonAPI = new MusicoinOrgJsonAPI(musicoinApi, mcHelper);

  let restAPI = new MusicoinRestAPI(jsonAPI);
  app.use('/json-api', restAPI.getRouter());

  function doRender(req, res, view, context) {
    const defaultContext = {user: req.user, isAuthenticated: req.isAuthenticated()};
    res.render(view, Object.assign({}, defaultContext, context));
  }

  // =====================================
  // HOME PAGE (with login links) ========
  // =====================================
  app.get('/', function (req, res) {
    const rs = jsonAPI.getNewReleases(6);
    const as = jsonAPI.getNewArtists(12);
    const ps = Promise.resolve(jsonAPI.getRecentPlays(6));

    Promise.join(rs, as, ps, function(releases, artists, recent) {
      doRender(req, res, "index.ejs", {
        releases: releases,
        artists: artists,
        featuredArtists: artists, // HACK, for now
        recent: recent});
    });
  });

  app.get('/not-found', function (req, res) {
    res.render('not-found.ejs');
  });

  app.get('/faq', function (req, res) {
    doRender(req, res, 'faq.ejs', {});
  });

  // =====================================
  // LOGIN ===============================
  // =====================================
  // show the login form
  app.get('/login', function (req, res) {
    // render the page and pass in any flash data if it exists
    res.render('login.ejs', {message: req.flash('loginMessage')});
  });

  // process the login form
  // process the login form
  app.post('/login', passport.authenticate('local-login', {
    successRedirect : '/profile', // redirect to the secure profile section
    failureRedirect : '/login', // redirect back to the signup page if there is an error
    failureFlash : true // allow flash messages
  }));

  // =====================================
  // SIGNUP ==============================
  // =====================================
  // show the signup form
  app.get('/signup', function (req, res) {

    // render the page and pass in any flash data if it exists
    res.render('signup.ejs', {message: req.flash('signupMessage')});
  });

  // process the signup form
  app.post('/signup', passport.authenticate('local-signup', {
    successRedirect : '/profile', // redirect to the secure profile section
    failureRedirect : '/signup', // redirect back to the signup page if there is an error
    failureFlash : true // allow flash messages
  }));

  // process the signup form
  // app.post('/signup', do all our passport stuff here);


  // =====================================
  // PUBLIC ARTIST PROFILE SECTION =====================
  // =====================================
  app.get('/artist/:address', function (req, res, next) {
    // find tracks for artist
    jsonAPI.getArtist(req.params.address, true, false)
      .then((output: ArtistProfile) => {
        if (!output) return res.redirect("/not-found");
        doRender(req, res, "artist.ejs", output);
      })
  });

  // =====================================
  // PROFILE SECTION =====================
  // =====================================
  // we will want this protected so you have to be logged in to visit
  // we will use route middleware to verify this (the isLoggedIn function)
  app.get('/profile', isLoggedIn, preProcessUser(mediaProvider), function (req, res) {
    jsonAPI.getArtist(req.user.profileAddress, true, true)
      .then((output: ArtistProfile) => {
        doRender(req, res, "profile.ejs", output);
      });
  });

  app.post('/send', isLoggedIn, function (req, res) {
    musicoinApi.sendFromProfile(req.user.profileAddress, req.body.recipient, req.body.amount)
      .then(function(tx) {
        console.log(`Payment submitted! tx : ${tx}`);
        res.redirect("/profile");
      })
      .catch(function(err) {
        console.log(err);
        throw err;
      })
  });

  app.post('/profile/save', isLoggedIn, function(req, res) {
    const form = new Formidable.IncomingForm();
    form.parse(req, (err, fields:any, files:any) => {
      console.log(`Fields: ${JSON.stringify(fields)}`);
      console.log(`Files: ${JSON.stringify(files)}`);

      const prefix = "social.";
      const socialData = groupByPrefix(fields, prefix);

      const profile = req.user.draftProfile;
      const i = files.photo.size == 0 ? Promise.resolve(profile.ipfsImageUrl) : mediaProvider.upload(files.photo.path);
      const d = mediaProvider.uploadText(fields.description);
      const s = mediaProvider.uploadText(JSON.stringify(socialData));
      return Promise.join(i, d, s, function (imageUrl, descriptionUrl, socialUrl) {
        req.user.draftProfile = {
          artistName: fields.artistName,
          description: fields.description,
          social: socialData,
          ipfsImageUrl: imageUrl
        };
        console.log(`Sending updated profile to blockchain...`);
        musicoinApi.publishProfile(req.user.profileAddress, fields.artistName, descriptionUrl, imageUrl, socialUrl)
          .then(function(tx) {
            console.log(`Transaction submitted! Profile tx : ${tx}`);
            req.user.pendingTx = tx;
            req.user.updatePending = true;
            console.log(`Saving updated profile to database...`);
            req.user.save(function (err) {
              if (err) {
                console.log(`Saving profile to database failed! ${err}`);
                res.send(500);
              }
              else {
                console.log(`Saving profile to database ok!`);
                res.redirect("/profile");
              }
            });
          })
          .catch(function(err) {
            console.log("Something went wrong: " + err);
          })
      }.bind(this));
    });
  });


  app.post('/tracks/release', isLoggedIn, hasProfile, function(req, res) {
    const form = new Formidable.IncomingForm();
    form.parse(req, (err, fields:any, files:any) => {
      console.log(`Fields: ${JSON.stringify(fields)}`);
      console.log(`Files: ${JSON.stringify(files)}`);
      let tracks = [];
      for (let i = 0; i < 5; i++) {
        const trackData = Object.assign(groupByPrefix(fields, `track${i}.`), groupByPrefix(files, `track${i}.`));
        if (Object.keys(trackData).length > 0) {
          tracks.push(trackData);
        }
      }

      console.log(`tracks: ${JSON.stringify(tracks)}`);
      const metadata = {}; // TODO: allow metadata

      const promises = tracks
        .filter(t => t.title)
        .filter(t => t.audio.size > 0)
        .map(track => {
          const key = crypto.randomBytes(16).toString('base64'); // 128-bits
          const a = mediaProvider.upload(track.audio.path, () => key); // encrypted
          const i = track.image && track.image.size > 0
            ? mediaProvider.upload(track.image.path) // unencrypted
            : Promise.resolve(req.user.draftProfile.ipfsImageUrl);
          const m = mediaProvider.uploadText(JSON.stringify(metadata));
          return Promise.join(a, i, m, function(audioUrl, imageUrl, metadataUrl) {
            track.imageUrl = imageUrl;
            return musicoinApi.releaseTrack(req.user.profileAddress, track.title, imageUrl, metadataUrl, audioUrl, track.audio.type, key);
          })
      });

      Promise.all(promises)
        .then(function (txs: string[]) {
          console.log("Got transactions: " + JSON.stringify(txs));
          const releases = [];
          for (let i=0; i < txs.length; i++) {
            releases.push({
              tx: txs[i],
              title: tracks[i].title,
              imageUrl: tracks[i].imageUrl,
              artistName: req.user.draftProfile.artistName,
              artistAddress: req.user.profileAddress,
            });
          }

          console.log(`Saving ${releases.length} release txs to database ...`);
          return Release.create(releases);
        })
        .then(function(records) {
          console.log(`Saved releases txs to database!`);
          res.redirect("/profile");
        })
        .catch(function (err) {
          console.log(`Saving releases to database failed! ${err}`);
          res.send(500);
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
  app.get('/auth/google', passport.authenticate('google', { scope : ['profile', 'email'] }));

  // the callback after google has authenticated the user
  app.get('/auth/google/callback',
    passport.authenticate('google', {
      successRedirect : '/profile',
      failureRedirect : '/'
    }));

  // =============================================================================
  // AUTHORIZE (ALREADY LOGGED IN / CONNECTING OTHER SOCIAL ACCOUNT) =============
  // =============================================================================

  // locally --------------------------------
  app.get('/connect/local', function(req, res) {
    res.render('connect-local.ejs', { message: req.flash('loginMessage') });
  });

  app.post('/connect/local', passport.authenticate('local-signup', {
    successRedirect : '/profile', // redirect to the secure profile section
    failureRedirect : '/connect/local', // redirect back to the signup page if there is an error
    failureFlash : true // allow flash messages
  }));

  // send to google to do the authentication
  app.get('/connect/google', passport.authorize('google', { scope : ['profile', 'email'] }));

  // the callback after google has authorized the user
  app.get('/connect/google/callback',
    passport.authorize('google', {
      successRedirect : '/profile',
      failureRedirect : '/'
    }));

  // =============================================================================
  // UNLINK ACCOUNTS =============================================================
  // =============================================================================
  // used to unlink accounts. for social accounts, just remove the token
  // for local account, remove email and password
  // user account will stay active in case they want to reconnect in the future
  // google ---------------------------------
  app.get('/unlink/google', function(req, res) {
    var user          = req.user;
    user.google.token = undefined;
    user.save(function(err) {
      res.redirect('/profile');
    });
  });

  app.get('/ppp/:address', function(req, res) {
    console.log("Got ppp request for " + req.params.address);
    const k = musicoinApi.getKey(req.params.address);
    const l = musicoinApi.getLicenseDetails(req.params.address);
    const context = {contentType: "audio/mpeg"};
    Promise.join(k, l, function(keyResponse, license) {
      context.contentType = license.contentType ? license.contentType : context.contentType;
      return mediaProvider.getIpfsResource(license.resourceUrl, () => keyResponse.key);
    })
      .then(function(result) {
        Playback.create({contractAddress: req.params.address}); // async, not checking result
        return result;
      })
      .then(function(result) {
        result.headers['content-type'] = context.contentType;
        res.writeHead(200, result.headers);
        result.stream.pipe(res);
      })
      .catch(function(err) {
        console.error(err.stack);
        res.status(500);
        res.send(err);
      });
  });

  app.get('/media/:encryptedHash', function(req, res) {
    // Hash is encrypted to avoid being a global proxy for IPFS.  This should ensure we are only proxying the URLs
    // we are giving out.
    mediaProvider.getRawIpfsResource(req.params.encryptedHash)
      .then(function(result) {
        res.writeHead(200, result.headers);
        result.stream.pipe(res);
      })
      .catch(function(err) {
        console.error(err.stack);
        res.status(500);
        res.send(err);
      });
  });

  function groupByPrefix(fields: any, prefix: string) {
    return Object.keys(fields)
      .filter(f => f.length > prefix.length && f.substring(0, prefix.length) == prefix)
      .filter(f => fields[f])
      .map(f => f.substring(prefix.length))
      .reduce((o, k) => {
        o[k] = fields[prefix + k];
        return o;
      }, {});
  }
}

// route middleware to make sure a user is logged in
function isLoggedIn(req, res, next) {

  // if user is authenticated in the session, carry on
  if (req.isAuthenticated())
    return next();

  // if they aren't redirect them to the home page
  res.redirect('/');
}

function hasProfile(req, res, next) {
  if (req.user.profileAddress)
    return next();
  res.redirect('/');
}

function preProcessUser(mediaProvider) {
  return function preProcessUser(req, res, next) {
    const user = req.user;
    user.profile.image = user.profile.ipfsImageUrl
      ? mediaProvider.resolveIpfsUrl(user.profile.ipfsImageUrl)
      : user.profile.image;
    next();
  }
}
