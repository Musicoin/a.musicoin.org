import {MusicoinAPI} from './musicoin-api';
import {Promise} from 'bluebird';
import * as Formidable from 'formidable';
import * as crypto from 'crypto';
import {MusicoinHelper} from "./musicoin-helper";
import * as FormUtils from "./form-utils";
import {MusicoinOrgJsonAPI, ArtistProfile} from "./rest-api/json-api";
import {MusicoinRestAPI} from "./rest-api/rest-api";
import {AddressResolver} from "./address-resolver";
const Invite = require('../app/models/invite');
const Playback = require('../app/models/playback');
const Release = require('../app/models/release');
const loginRedirect = "/";
const maxImageWidth = 400;

export function configure(app, passport, musicoinApi: MusicoinAPI, mediaProvider) {

  let mcHelper = new MusicoinHelper(musicoinApi, mediaProvider);
  let jsonAPI = new MusicoinOrgJsonAPI(musicoinApi, mcHelper);

  let restAPI = new MusicoinRestAPI(jsonAPI);
  const addressResolver = new AddressResolver();
  app.use('/json-api', restAPI.getRouter());
  app.use('/', preProcessUser(mediaProvider));

  function doRender(req, res, view, context) {
    const defaultContext = {user: req.user, isAuthenticated: req.isAuthenticated()};
    res.render(view, Object.assign({}, defaultContext, context));
  }

  function _formatDate(timestamp) {
    // TODO: Locale
    var options = { year: 'numeric', month: 'short', day: 'numeric' };
    return new Date(timestamp*1000).toLocaleDateString('en-US', options);
  }

  function _formatNumber(value:any, decimals?:number) {
    var raw = parseFloat(value).toFixed(decimals ? decimals : 0);
    var parts = raw.toString().split(".");
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    return parts.join(".");
  }

  app.get('/', isLoggedIn, function (req, res) {
    res.render('index-frames.ejs');
  });

  app.get('/player', isLoggedIn, (req, res) => {
    res.render('player-frame.ejs');
  });

  // =====================================
  // HOME PAGE (with login links) ========
  // =====================================
  app.get('/main', isLoggedIn, function (req, res) {
    const rs = jsonAPI.getNewReleases(6);
    const na = jsonAPI.getNewArtists(12);
    const fa = jsonAPI.getFeaturedArtists(12);
    const ps = jsonAPI.getRecentPlays(6);
    const tp = jsonAPI.getTopPlayed(6);
    const b = musicoinApi.getMusicoinAccountBalance();
    Promise.join(rs, na, fa, ps, tp, b, function(releases, artists, featuredArtists, recent, topPlayed, balance) {
      balance.formattedMusicoins = parseInt(balance.musicoins).toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
      doRender(req, res, "index.ejs", {
        musicoinClientBalance: balance,
        releases: releases,
        artists: artists,
        featuredArtists: featuredArtists,
        topPlayed: topPlayed,
        recent: recent});
    })
      .catch(function(err) {
        console.log(err);
        res.redirect('/error');
      });
  });

  app.get('/browse', isLoggedIn, function (req, res) {
    const maxGroupSize = 8;
    const rs = jsonAPI.getNewReleasesByGenre(100, maxGroupSize);
    Promise.join(rs, function(releases) {
      doRender(req, res, "browse.ejs", {
        releases: releases, maxItemsPerGroup: maxGroupSize});
    })
      .catch(function(err) {
        console.log(err);
        res.redirect('/error');
      });
  });

  app.post('/elements/pending-releases', function(req, res) {
    jsonAPI.getArtist(req.user.profileAddress, true, true)
      .then(function(output) {
        res.render('partials/pending-releases.ejs', output);
      });
  });

  app.post('/elements/release-list', function(req, res) {
    jsonAPI.getArtist(req.user.profileAddress, true, true)
      .then(function(output) {
        res.render('partials/release-list.ejs', output);
      });
  });

  app.post('/elements/featured-artists', function(req, res) {
    const iconSize = req.body.iconSize ? req.body.iconSize : "large";
    jsonAPI.getFeaturedArtists(12)
      .then(function(artists) {
        res.render('partials/featured-artist-list.ejs', {artists: artists, iconSize: iconSize});
      });
  });

  app.post('/elements/new-artists', function(req, res) {
    const iconSize = req.body.iconSize ? req.body.iconSize : "small";
    jsonAPI.getNewArtists(12)
      .then(function(artists) {
        res.render('partials/featured-artist-list.ejs', {artists: artists, iconSize: iconSize});
      });
  });

  app.post('/elements/new-releases', function(req, res) {
    jsonAPI.getNewReleases(6)
      .then(function(releases) {
        res.render('partials/track-list.ejs', {releases: releases});
      });
  });

  app.post('/elements/recently-played', function(req, res) {
    jsonAPI.getRecentPlays(6)
      .then(function(releases) {
        res.render('partials/track-list.ejs', {releases: releases});
      });
  });

  app.post('/elements/top-played', function(req, res) {
    jsonAPI.getTopPlayed(6)
      .then(function(releases) {
        res.render('partials/track-list.ejs', {releases: releases});
      });
  });

  app.get('/not-found', function (req, res) {
    res.render('not-found.ejs');
  });

  app.get('/tx/history/:address', isLoggedIn, function (req, res) {
    const length = typeof req.query.length != "undefined" ? parseInt(req.query.length) : 20;
    const start = typeof req.query.start != "undefined" ? parseInt(req.query.start) : 0;
    const previous = Math.max(0, start-length);
    const url = `/tx/history/${req.params.address}`;

    Promise.join(
      musicoinApi.getTransactionHistory(req.params.address, length, start),
      addressResolver.lookupAddress(req.user.profileAddress, req.params.address),
      function(history, name){
        history.forEach(h => {
          h.formattedDate = _formatDate(h.timestamp);
          h.musicoins = _formatNumber(h.musicoins, 5);
        });
        doRender(req, res, 'history.ejs', {
          address: req.params.address,
          name: name ? name : "Transaction History",
          history: history,
          navigation: {
            description: `Showing ${start+1} to ${start+length}`,
            start: previous > 0 ? `${url}?length=${length}` : null,
            back: previous >= 0 && previous < start ? `${url}?length=${length}&start=${start-length}` : null,
            next: `${url}?length=${length}&start=${start+length}`,
          }
        });
      });
  });

  app.get('/faq', (req, res) => doRender(req, res, 'faq.ejs', {}));
  app.get('/info', (req, res) => doRender(req, res, 'info.ejs', {}));
  app.get('/invite', (req, res) => doRender(req, res, 'invite.ejs', {}));
  app.get('/terms', (req, res) => doRender(req, res, 'terms.ejs', {}));
  app.get('/error', (req, res) => doRender(req, res, 'error.ejs', {}));

  app.get('/api', (req, res) => doRender(req, res, 'api.ejs', {}));
  app.post('/invite', isLoggedIn, function(req, res) {
    if (canInvite(req.user)) {
      Invite.create({email: req.body.email.toLowerCase(), invitedBy: req.user._id}, function(err, record) {
        if (err) {
          console.log(err);
          res.redirect('profile?invited=' + req.body.email + "&success=false");
        }
        res.redirect('profile?invited=' + req.body.email + "&success=true");
      });
    }
    else {
      throw new Error("Not authorized");
    }
  });

  // =====================================
  // LOGIN ===============================
  // =====================================
  // show the login form
  app.get('/admin/su', isLoggedIn, adminOnly, function (req, res) {
    // render the page and pass in any flash data if it exists
    res.render('su.ejs', {message: req.flash('loginMessage')});
  });

  // process the login form
  // process the login form
  app.post('/admin/su', isLoggedIn, adminOnly, passport.authenticate('local-su', {
    successRedirect : '/profile', // redirect to the secure profile section
    failureRedirect : '/admin/su', // redirect back to the signup page if there is an error
    failureFlash : true // allow flash messages
  }));

  // =====================================
  // SIGNUP ==============================
  // =====================================
  // show the signup form
  /*
  app.get('/signup', function (req, res) {

    // render the page and pass in any flash data if it exists
    res.render('signup.ejs', {message: req.flash('signupMessage')});
  });

  // process the signup form
  app.post('/signup', passport.authenticate('local-signup', {
    successRedirect : '/', // redirect to the secure profile section
    failureRedirect : '/signup', // redirect back to the signup page if there is an error
    failureFlash : true // allow flash messages
  }));

  // process the signup form
  // app.post('/signup', do all our passport stuff here);
  */
  // =====================================
  // PUBLIC ARTIST PROFILE SECTION =====================
  // =====================================
  app.get('/artist/:address', isLoggedIn, function (req, res, next) {
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
  app.get('/profile', isLoggedIn, function (req, res) {
    jsonAPI.getArtist(req.user.profileAddress, true, true)
      .then((output: ArtistProfile) => {
        output['invited'] = {
          email: req.query.invited,
          success: req.query.success
        };
        output.artist.formattedBalance = _formatNumber(output.artist.balance);
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
      const socialData = FormUtils.groupByPrefix(fields, prefix);

      const profile = req.user.draftProfile;
      const i = files.photo.size == 0
        ? Promise.resolve(profile.ipfsImageUrl)
        : FormUtils.resizeImage(files.photo.path, maxImageWidth)
          .then((newPath) => mediaProvider.upload(newPath));
      const d = mediaProvider.uploadText(fields.description);
      const s = mediaProvider.uploadText(JSON.stringify(socialData));
      return Promise.join(i, d, s, function (imageUrl, descriptionUrl, socialUrl) {
        req.user.draftProfile = {
          artistName: fields.artistName,
          description: fields.description,
          social: socialData,
          ipfsImageUrl: imageUrl,
          genres: fields.genres.split(",").map(s => s.trim()).filter(s => s)
        };
        console.log(`Sending updated profile to blockchain...`);
        musicoinApi.publishProfile(req.user.profileAddress, fields.artistName, descriptionUrl, imageUrl, socialUrl)
          .then(function(tx) {
            console.log(`Transaction submitted! Profile tx : ${tx}`);
            req.user.pendingTx = tx;
            req.user.updatePending = true;
            req.user.hideProfile = !!fields.hideProfile;
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

  app.post('/license/preview/', (req, res) => {
    console.log("Getting license preview");
    convertFormToLicense(req.user.draftProfile.artistName, req.user.profileAddress, req.body)
      .then(function(license) {
        doRender(req, res, 'license.ejs', {showRelease: true, license: license});
      })
  });

  app.post('/license/view/', (req, res) => {
    jsonAPI.getLicense(req.body.address)
      .then(function (license) {
        return Promise.join(
          addressResolver.resolveAddresses(req.user.profileAddress, license.contributors),
          function(contributors) {
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
      function(resolvedContributors, resolveRoyalties) {
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

  app.post('/license/delete', isLoggedIn, hasProfile, function(req, res) {
    // mark release status as deleted
    // remove from playbacks
    const contractAddress = req.body.contractAddress;
    Release.findOne({contractAddress: contractAddress, artistAddress: req.user.profileAddress}).exec()
      .then(function(record) {
        if (!record) {
          console.log(`Failed to delete release: no record found with contractAddress: ${contractAddress}`);
          throw new Error("Could not find record");
        }
        record.state = 'deleted';
        record.save(function(err) {
          if (err) {
            console.log(`Failed to delete release: no record found with contractAddress: ${contractAddress}, error: ${err}`);
            throw new Error("The database responded with an error");
          }
        })
      })
      .then(function() {
        return Playback.find({contractAddress: contractAddress}).remove().exec();
      })
      .then(function() {
        res.json({success: true});
      })
      .catch(function (err) {
        res.json({success: false, message: err.message});
      });
  });

  app.post('/license/release', isLoggedIn, hasProfile, function(req, res) {
    const form = new Formidable.IncomingForm();
    form.parse(req, (err, fields:any, files:any) => {
      console.log(`Fields: ${JSON.stringify(fields)}`);
      console.log(`Files: ${JSON.stringify(files)}`);
      let tracks = [];
      for (let i = 0; i < 5; i++) {
        const trackData = Object.assign(FormUtils.groupByPrefix(fields, `track${i}.`), FormUtils.groupByPrefix(files, `track${i}.`));
        if (Object.keys(trackData).length > 0) {
          tracks.push(trackData);
        }
      }

      console.log(`tracks: ${JSON.stringify(tracks)}`);
      const metadata = {}; // TODO: allow metadata
      const selfAddress = req.user.profileAddress;
      const promises = tracks
        .filter(t => t.title)
        .filter(t => t.audio.size > 0)
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
          for (let i=0; i < txs.length; i++) {
            releases.push({
              tx: txs[i],
              title: tracks[i].title,
              imageUrl: tracks[i].imageUrl,
              artistName: req.user.draftProfile.artistName,
              artistAddress: req.user.profileAddress,
              genres: tracks[i].genres.split(",").map(s => s.trim()).filter(s => s)
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
      successRedirect : loginRedirect,
      failureRedirect : '/invite'
    }));

  app.get('/auth/twitter', passport.authenticate('twitter', { scope : 'email' }));

  // handle the callback after twitter has authenticated the user
  app.get('/auth/twitter/callback',
    passport.authenticate('twitter', {
      successRedirect : '/',
      failureRedirect : '/invite'
    }));

  // =============================================================================
  // AUTHORIZE (ALREADY LOGGED IN / CONNECTING OTHER SOCIAL ACCOUNT) =============
  // =============================================================================

  // locally --------------------------------
  /*
  app.get('/connect/local', function(req, res) {
    res.render('connect-local.ejs', { message: req.flash('loginMessage') });
  });

  app.post('/connect/local', passport.authenticate('local-signup', {
    successRedirect : loginRedirect, // redirect to the secure profile section
    failureRedirect : '/connect/local', // redirect back to the signup page if there is an error
    failureFlash : true // allow flash messages
  }));
  */

  // send to google to do the authentication
  app.get('/connect/google', passport.authorize('google', { scope : ['profile', 'email'] }));

  // the callback after google has authorized the user
  app.get('/connect/google/callback',
    passport.authorize('google', {
      successRedirect : loginRedirect,
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

  app.get('/ppp/:address', isLoggedIn, function(req, res) {
    console.log("Got ppp request for " + req.params.address);
    const k = musicoinApi.getKey(req.params.address);
    const l = musicoinApi.getLicenseDetails(req.params.address);
    const r = Release.findOne({contractAddress: req.params.address, state: "published"}).exec();
    const context = {contentType: "audio/mpeg"};
    Promise.join(k, l, r, function(keyResponse, license, release) {
      if (!release) throw new Error("Could not find contract in database (maybe it was deleted)");
      context.contentType = license.contentType ? license.contentType : context.contentType;
      return mediaProvider.getIpfsResource(license.resourceUrl, () => keyResponse.key)
        .then(function(result) {
          Playback.create({contractAddress: req.params.address}); // async, not checking result
          release.directPlayCount = release.directPlayCount ? release.directPlayCount+1 : 1;
          release.save(function(err) {
            if (err) console.warn("Failed to update playcount: " + err);
          });

          return result;
        });
    })
      .then(function(result) {
        result.headers['Content-Type'] = context.contentType;
        result.headers['Accept-Ranges'] = 'none';
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
}

function isAdmin(user) {
  return (user.google && user.google.email && user.google.email.endsWith("@berry.ai"));
}
function canInvite(user) {
  return user.canInvite || isAdmin(user);
}

// route middleware to make sure a user is logged in
function isLoggedIn(req, res, next) {

  // if user is authenticated in the session, carry on
  if (req.isAuthenticated())
    return next();

  // if they aren't redirect them to the home page
  res.redirect('/info');
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

function preProcessUser(mediaProvider) {
  return function preProcessUser(req, res, next) {
    const user = req.user;
    if (user) {
      if (user.profile) {
        user.profile.image = user.profile.ipfsImageUrl
          ? mediaProvider.resolveIpfsUrl(user.profile.ipfsImageUrl)
          : user.profile.image;
      }
      user.canInvite = canInvite(user);
      user.isAdmin = isAdmin(user);
    }
    next();
  }
}
