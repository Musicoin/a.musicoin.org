import {MusicoinAPI} from './musicoin-api';
import {Promise} from 'bluebird';
import * as Formidable from 'formidable';
import * as crypto from 'crypto';
import {MusicoinHelper} from "./musicoin-helper";
const User = require('../app/models/user');
const Release = require('../app/models/release');

export function configure(app, passport, musicoinApi: MusicoinAPI, mediaProvider) {

  let mcHelper = new MusicoinHelper(musicoinApi, mediaProvider);

  // =====================================
  // HOME PAGE (with login links) ========
  // =====================================
  app.get('/', function (req, res) {
    res.render('index.ejs'); // load the index.ejs file
  });

  app.get('/not-found', function (req, res) {
    res.render('not-found.ejs');
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
    User.findOne({profileAddress: req.params.address}).exec()
      .then(function(artist) {
        if (!artist) return res.redirect("/not-found");
        Release.find({artistAddress: artist.profileAddress, state: 'published'}).exec()
          .then(function(releases) {
            mcHelper.getArtistProfileAndTracks(req.params.address, releases.map(item => item.contractAddress))
              .then(function(artist) {
                res.render('artist.ejs', {artist: artist});
              })
          })
      })
      .catch(function(err) {
        next(err);
      })
  });


  // =====================================
  // PROFILE SECTION =====================
  // =====================================
  // we will want this protected so you have to be logged in to visit
  // we will use route middleware to verify this (the isLoggedIn function)
  app.get('/profile', isLoggedIn, preProcessUser(mediaProvider), function (req, res) {
    Release.find({artistAddress: req.user.profileAddress, state: 'published'}).exec()
      .then(function(releases) {
        const a = mcHelper.getArtistProfileAndTracks(req.user.profileAddress, releases.map(item => item.contractAddress));
        const p = Release.find({artistAddress: req.user.profileAddress, state: 'pending'}).exec();
        Promise.join(a, p, function(artist, pending) {
          res.render('profile.ejs', {user: req.user, artist: artist, pendingReleases: pending});
        })
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
        .filter(t => t.image.size > 0)
        .map(track => {
          const key = crypto.randomBytes(16).toString('base64'); // 128-bits
          const a = mediaProvider.upload(track.audio.path, () => key); // encrypted
          const i = mediaProvider.upload(track.image.path); // unencrypted
          const m = mediaProvider.uploadText(JSON.stringify(metadata))
          return Promise.join(a, i, m, function(audioUrl, imageUrl, metadataUrl) {
            track.imageUrl = imageUrl;
            return musicoinApi.releaseTrack(req.user.profileAddress, track.title, imageUrl, metadataUrl, audioUrl, key);
          })
      });

      interface TxResult {
        tx: string
      }

      Promise.all(promises)
        .then(function (txs: TxResult[]) {
          console.log("Got transactions: " + JSON.stringify(txs));
          const releases = [];
          for (let i=0; i < txs.length; i++) {
            releases.push({
              tx: txs[i].tx,
              title: tracks[i].title,
              imageUrl: tracks[i].imageUrl,
              artistName: req.user.artistName,
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
    const k = musicoinApi.getKey(req.params.address);
    const l = musicoinApi.getLicenseDetails(req.params.address);
    Promise.join(k, l, function(keyResponse, license) {
      return mediaProvider.getIpfsResource(license.resourceUrl, () => keyResponse.key);
    })
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
