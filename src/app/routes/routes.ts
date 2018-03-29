import { Promise } from 'bluebird';
import * as crypto from 'crypto';

import { ExchangeRateProvider } from '../extra/exchange-service';
import { MailSender } from '../extra/mail-sender';
import { AddressResolver } from '../internal/address-resolver';
import { MusicoinAPI } from '../internal/musicoin-api';
import { MusicoinHelper } from '../internal/musicoin-helper';
import { PendingTxDaemon } from '../internal/tx-daemon';
import { MusicoinOrgJsonAPI } from '../rest-api/json-api';
import { MusicoinRestAPI } from '../rest-api/rest-api';
import { DashboardRouter } from '../routes/admin/admin-dashboard-routes';
import { AdminRoutes } from '../routes/admin/admin-routes';
import { ExtendedRouter } from '../routes/extended-routes/extended';
import { IpfsRouter } from '../routes/extended-routes/ipfs';
import { PlayerRouter } from '../routes/extended-routes/player';
import { FrontRouter } from '../routes/front-parts/front-routes';
import { HomeRouter } from '../routes/home-page/home';
import { ProfileRouter } from '../routes/profile/profile';
import { ReleaseManagerRouter } from '../routes/release/release-manager-routes';
import { SocialRouter } from '../routes/social/social';
import { RequestCache } from '../utils/cached-request';
import * as FormUtils from '../utils/form-utils';
import { AuthRouter } from './auth/auth';

const maxHeroImageWidth = 1300;
const EmailConfirmation = require('../models/email-confirmation');
const User = require('../models/user');

var functions = require('./routes-functions');
const AnonymousUser = require('../models/anonymous-user');
const bootSession = process.env.BOOTSESSION;
const maxImageWidth = 400;

let publicPagesEnabled = false;

const MESSAGE_TYPES = {
  admin: "admin",
  comment: "comment",
  release: "release",
  donate: "donate",
  follow: "follow",
  tip: "tip",
};

export function configure(app, passport, musicoinApi: MusicoinAPI, mediaProvider, config: any) {
  const serverEndpoint = config.serverEndpoint;
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

  const socialRouter = new SocialRouter(passport);
  const frontRouter = new FrontRouter();
  const adminRoutes = new AdminRoutes(musicoinApi,
    jsonAPI,
    addressResolver,
    exchangeRateProvider,
    cachedRequest,
    mediaProvider, // TODO
    passport,
    config,
    doRender);
  const playerRouter = new PlayerRouter(musicoinApi,
    jsonAPI,
    addressResolver,
    exchangeRateProvider,
    mediaProvider, // TODO
    config,
    doRender);

  const dashboardManager = new DashboardRouter(musicoinApi,
    jsonAPI,
    addressResolver,
    maxImageWidth,
    mediaProvider,
    config,
    doRender);

  const homeRouter = new HomeRouter(musicoinApi,
    jsonAPI,
    addressResolver,
    mediaProvider,
    config,
    doRender);

  const extendedRouter = new ExtendedRouter(musicoinApi,
    jsonAPI,
    addressResolver,
    mediaProvider,
    config,
    doRender);

  const authRouter = new AuthRouter(musicoinApi,
    jsonAPI,
    addressResolver,
    exchangeRateProvider,
    config,
    doRender);

  const ipfsRouter = new IpfsRouter(mediaProvider);

  const profileRouter = new ProfileRouter(musicoinApi,
    jsonAPI,
    addressResolver,
    maxImageWidth,
    maxHeroImageWidth,
    mediaProvider, // TODO
    config,
    doRender)

  const newReleaseListener = r => {
    let msgText = r.description ? "[New Release] " + r.description : "New release!";

    // TODO: This should be handled in the UI, but for now just chop the message text
    if (msgText.length > 150) msgText = msgText.substring(0, 150) + "...";
    jsonAPI.postLicenseMessages(r.contractAddress, null, r.artistAddress, msgText, MESSAGE_TYPES.release, null)
      .catch(err => {
        console.log(`Failed to post a message about a new release: ${err}`)
      });
  };

  const newProfileListener = p => {
    jsonAPI.sendRewardsForInvite(p)
      .then((results) => console.log(`Rewards sent for inviting ${p._id} profile=${p.profileAddress}, txs: ${JSON.stringify(results)}`))
      .catch(err => console.log(`Failed to send invite rewards: ${err}`));
  };

  new PendingTxDaemon(newProfileListener, newReleaseListener)
    .start(musicoinApi, config.database.pendingReleaseIntervalMs);
  app.use('/', restAPI.getRouter());
  app.use('/', socialRouter.getRouter());
  app.use('/', adminRoutes.getRouter());
  app.use('/', frontRouter.getRouter());
  app.use('/json-api', restAPI.getRouter());
  app.use('/', preProcessUser(mediaProvider, jsonAPI), module.exports.checkInviteCode);
  app.use('/release-manager', module.exports.isLoggedIn, releaseManager.getRouter());
  app.use('/admin/', dashboardManager.getRouter());
  app.use('/', homeRouter.getRouter());
  app.use('/', extendedRouter.getRouter());
  app.use('/', ipfsRouter.getRouter());
  app.use('/', playerRouter.getRouter());
  app.use('/', authRouter.getRouter());
  app.use('/', profileRouter.getRouter());

  // =====================================
  // ADMIN LOGIN =========================
  // =====================================

  app.get('/admin/su', functions.isLoggedIn, functions.adminOnly, function (req, res) {
    // render the page and pass in any flash data if it exists
    res.render('su.ejs', { message: req.flash('loginMessage') });
  });

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


  // =====================================
  // ADMIN LOGIN =========================
  // =====================================

  app.get('/admin/su', functions.isLoggedIn, functions.adminOnly, function (req, res) {
    // render the page and pass in any flash data if it exists
    res.render('su.ejs', { message: req.flash('loginMessage') });
  });

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

  app.get('/admin/licenses/dump', functions.isLoggedIn, functions.adminOnly, function (req, res) {
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

  app.get('/login', function (req, res) {
    if (req.user) {
      console.log("User is already logged in, redirecting away from login page");
      return res.redirect('/loginRedirect');
    }
    if (req.query.returnTo) {
      req.session.destinationUrl = req.query.returnTo;
    }
    // render the page and pass in any flash data if it exists
    const message = req.flash('loginMessage');
    doRender(req, res, 'landing.ejs', {
      message: message,
    });
    //doRender(req, res, 'landing.ejs', { message: req.flash('loginMessage') });
  });

  app.get('/login-musician', function (req, res) {
    if (req.user) {
      console.log("User is already logged in, redirecting away from login page");
      return res.redirect('/loginRedirect');
    }
    // render the page and pass in any flash data if it exists
    const message = req.flash('loginMessage');
    doRender(req, res, 'landing_musicians.ejs', {
      message: message,
    });
    //doRender(req, res, 'landing.ejs', { message: req.flash('loginMessage') });
  });

  app.get('/connect/email', function (req, res) {
    // render the page and pass in any flash data if it exists
    const message = req.flash('loginMessage');
    doRender(req, res, 'landing.ejs', {
      message: message,
    });
  });

  app.post('/login/reset', (req, res) => {
    const code = String(req.body.code);
    if (!code)
      return doRender(req, res, "landing.ejs", { message: "There was a problem resetting your password" });

    const error = FormUtils.checkPasswordStrength(req.body.password);
    if (error) {
      return doRender(req, res, "password-reset.ejs", { code: code, message: error });
    }

    if (req.body.password != req.body.password2) {
      return doRender(req, res, "password-reset.ejs", { code: code, message: "Passwords did not match" });
    }

    if (typeof code != "string") {
      return doRender(req, res, "landing.ejs", { message: "The password reset link has expired" });
    }

    User.findOne({ "local.resetCode": code }).exec()
      .then(user => {
        // code does not exist or is expired, just go to the login page
        if (!user || !user.local || !user.local.resetExpiryTime)
          return doRender(req, res, "landing.ejs", { message: "The password reset link has expired" });

        // make sure code is not expired
        const expiry = new Date(user.local.resetExpiryTime).getTime();
        if (Date.now() > expiry)
          return doRender(req, res, "password-reset.ejs", { code: code, message: "Passwords did not match" });

        const error = FormUtils.checkPasswordStrength(req.body.password);
        if (error) {
          return doRender(req, res, "password-reset.ejs", { code: code, message: error });
        }

        user.local.password = user.generateHash(req.body.password);
        user.local.resetCode = null;
        user.local.resetExpiryTime = null;

        return user.save()
          .then(() => {
            req.flash('loginMessage', "Your password has been reset.  Please login with your new password");
            return res.redirect("/welcome");
          })
      })
  });

  app.post('/login/confirm', function (req, res) {
    if (req.body.email) req.body.email = req.body.email.trim();
    if (!FormUtils.validateEmail(req.body.email)) {
      res.json({
        success: false,
        email: req.body.email,
        reason: "The email address does not routerear to be valid"
      });
    }
    else {
      const code = "MUSIC" + crypto.randomBytes(11).toString('hex');
      EmailConfirmation.create({ email: req.body.email, code: code })
        .then(() => {
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
          console.log(`Failed to send email confirmation code ${code}: ${err}`);
          res.json({
            success: false,
            email: req.body.email,
            reason: "An internal error occurred.  Please try again later."
          });
        });
    }
  });

  app.post('/login/forgot', (req, res) => {
    var re = /^(([^<>()\[\]\.,;:\s@\"]+(\.[^<>()\[\]\.,;:\s@\"]+)*)|(\".+\"))@(([^<>()[\]\.,;:\s@\"]+\.)+[^<>()[\]\.,;:\s@\"]{2,})$/i;

    const email = req.body.email || "";
    if (re.test(email.trim()) == false)  /// a@b.c is the smallest possible email address (5 chars)
      return doRender(req, res, "landing.ejs", { message: "Invalid email address: " + req.body.email });

    checkCaptcha(req)
      .then(captchaOk => {
        if (!captchaOk) {
          req.flash('loginMessage', `The captcha check failed`);
          return
        } else {
          User.findOne({ "local.email": req.body.email }).exec()
            .then(user => {
              if (!user) return doRender(req, res, "password-reset.ejs", { message: "User not found: " + req.body.email });
              user.local.resetExpiryTime = Date.now() + config.auth.passwordResetLinkTimeout;
              user.local.resetCode = "MUSIC" + crypto.randomBytes(11).toString('hex');
              return user.save()
                .then(user => {
                  if (!user) {
                    console.log("user.save() during password reset did not return a user record");
                    return doRender(req, res, "landing.ejs", { message: "An internal error occurred, please try again later" });
                  }
                  return mailSender.sendPasswordReset(user.local.email, config.serverEndpoint + "/login/reset?code=" + user.local.resetCode)
                    .then(() => {
                      return doRender(req, res, "landing.ejs", { message: "An email has been sent to " + req.body.email });
                    })
                })
                .catch(err => {
                  console.log(`An error occurred when sending the pasword reset email for ${email}: ${err}`);
                  return doRender(req, res, "landing.ejs", { message: "An internal error occurred, please try again later" });
                })
            })
        }
      });

  });

  function checkCaptcha(req) {
    const userResponse = req.body['g-recaptcha-response'];
    const url = config.captcha.url;
    return new Promise(function (resolve, reject) {
      const verificationUrl = `${url}?secret=${config.captcha.secret}&response=${userResponse}&remoteip=${req.ip}`;
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
          user.canInvite = module.exports.canInvite(user);
          user.isAdmin = module.exports.isAdmin(user);
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
}