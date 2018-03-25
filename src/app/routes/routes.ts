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
import { ReleaseManagerRouter } from '../routes/release/release-manager-routes';
import { RequestCache } from '../utils/cached-request';
import * as FormUtils from '../utils/form-utils';

const AnonymousUser = require('../models/anonymous-user');

const ConfigUtils = require('../../../config/config');
var config = ConfigUtils.loadConfig();
const bootSession = process.env.BOOTSESSION;
const maxImageWidth = 400;

const EmailConfirmation = require('../models/email-confirmation');
const User = require('../models/user');
var numberOfPhoneUsedTimesVal = 0;
var smsCodeVal = crypto.randomBytes(4).toString('hex');
var phoneNumberVal = 0;
const musicoinApi = new MusicoinAPI(config.musicoinApi);

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
    module.exports.doRender);

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

  app.use('/', require('./routes/front-parts/front-routes').router);
  app.use('/', require('./routes/home-page/home').router);
  app.use('/', require('./routes/profile/profile').router);
  app.use('/', require('./routes/social/social').router);
  app.use('/', require('./routes/social/social').router);
  app.use('/', require('./routes/extended-routes/extended').router);
  app.use('/', require('./routes/extended-routes/ipfs').router);
  app.use('/', require('./routes/extended-routes/player').router);
  app.use('/', require('./routes/auth/auth').router);
  app.use('/', require('./routes/admin/admin-routes').router);
  app.use('/', restAPI.getRouter());
  app.use('/json-api', restAPI.getRouter());
  app.use('/', preProcessUser(mediaProvider, jsonAPI), module.exports.checkInviteCode);
  app.use('/release-manager', module.exports.isLoggedIn, releaseManager.getRouter());

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
}

module.exports = {

  doRender: function (req, res, view, context) {
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
  },

  canInvite: function (user) {
    return user.invitesRemaining > 0 || this.isAdmin(user);
  },

  setSignUpFlag: function (isSignup) {
    return function (req, res, next) {
      req.session.signup = isSignup;
      next();
    }
  },

  smsCode: function () {
    smsCodeVal = crypto.randomBytes(4).toString('hex');
  },

  numberOfPhoneUsedTimes: function () {
    numberOfPhoneUsedTimesVal = numberOfPhoneUsedTimesVal + 1;
  },

  numberOfPhoneUsedTimesReturnVal: function () {
    return numberOfPhoneUsedTimesVal;
  },

  smsCodeReturnVal: function () {
    return smsCodeVal;
  },

  phoneNumber: function (req) {
    phoneNumberVal = req.body.phone.trim();
  },

  validateLoginEmail: function (errRedirect) {
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

        return EmailConfirmation.findOne({ email: req.body.email, code: req.body.confirmation })
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

      return this.checkCaptcha(req)
        .then(captchaOk => {
          if (!captchaOk) {
            const smsConfirmationCode = req.body.confirmationphone;
            if (smsCodeVal == smsConfirmationCode) {
              this.smsCode();
            } else {
              this.smsCode();
              req.flash('loginMessage', "Incorrect captcha or phone verification code");
              return res.redirect(errRedirect);
            }
          }
          return next();
        });
    }
  },

  checkCaptcha: function (req) {
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
  },

  SetSessionAfterLoginSuccessfullyAndRedirect: function (req, res) {
    //user loggined succesfully, then redirect to '/loginRedirect' URL
    if (req.user) {
      if (req.user.profileAddress && req.user.profileAddress !== '') {
        req.session.userAccessKey = req.user.profileAddress; //set session value as user.profileAddress;
      } else if (req.user.id && req.user.id !== '') {
        req.session.userAccessKey = req.user.id;  //set session value as user.id
      }
    }
    res.redirect('/loginRedirect'); // redirect to the secure profile section
  },

  redirectIfLoggedIn: function (dest) {
    return function (req, res, next) {
      if (req.isAuthenticated()) {
        return res.redirect(dest);
      }
      return next();
    }
  },

  _formatNumber: function (value: any, decimals?: number) {
    const raw = parseFloat(value).toFixed(decimals ? decimals : 0);
    const parts = raw.toString().split(".");
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    return parts.join(".");
  },

  _formatAsISODateTime: function (timestamp) {
    const iso = new Date(timestamp * 1000).toISOString();
    return `${iso.substr(0, 10)} ${iso.substr(11, 8)} UTC`;
  },

  _formatDate: function (timestamp) {
    // TODO: Locale
    const options = { year: 'numeric', month: 'short', day: 'numeric' };
    return new Date(timestamp * 1000).toLocaleDateString('en-US', options);
  },

  isLoggedIn: function (req, res, next) {

    // if (true) return next();
    // console.log(`Checking is user isAuthenticated: ${req.isAuthenticated()}, ${req.originalUrl}, session:${req.sessionID}`);

    // if user is authenticated in the session, carry on
    if (req.isAuthenticated())
      return next();

    // console.log(`User is not logged in, redirecting`);

    // if they aren't redirect them to the home page
    req.session.destinationUrl = req.originalUrl;
    res.redirect('/welcome');
  },

  isAdmin: function (user) {
    return (user && user.google && user.google.email && user.google.email.endsWith("@musicoin.org"));
  },

  hasProfile: function (req, res, next) {
    if (req.user.profileAddress)
      return next();
    res.redirect('/');
  },

  SearchById: function (userAccessKey, callback) {
    var resultMessage = {};
    User.findOne({
      $or: [
        { local: { id: userAccessKey } },
        { facebook: { id: userAccessKey } },
        { twitter: { id: userAccessKey } },
        { google: { id: userAccessKey } },
        { soundcloud: { id: userAccessKey } }
      ]
    }, function (err, user) {
      //database error

      if (err) {
        resultMessage = {
          result: false,
          message: 'mongo db error'
        }
        callback(resultMessage);
      } else {
        if (user) {
          //user found
          resultMessage = {
            result: true,
            user: {
              profileAddress: user.profileAddress || '',
              local: {},
              facebook: {},
              twitter: {},
              google: {},
              soundcloud: {}
            },
            authType: 'local' //this value default
          }
          // this will bind user info to resultMessage(object) and call callback function
          this.BindUserDetailToObject(user, resultMessage, callback);

        } else {
          //user not found
          resultMessage = {
            result: false,
            message: 'user not found'
          }
          callback(resultMessage);
        }
      }
    });
  },

  populateAnonymousUser: function (req, res, next) {
    if (!req.isAuthenticated()) {
      return this.getAnonymousUser(req)
        .then(anon => {
          req.anonymousUser = anon;
          next();
        })
    }
    return next();
  },

  getAnonymousUser: function (req) {
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
  },

  isLoggedInOrIsPublic: function (req, res, next) {
    if (publicPagesEnabled) return next();
    return this.isLoggedIn(req, res, next);
  },

  FindUserByIdOrProfileAddress: function (req, callback) {
    var resultMessage = {};
    var userAccessKey = '';
    //this request is local meaning request called by forum.musicoin.org,
    if (req.body && req.body.userAccessKey)
      userAccessKey = req.body.userAccessKey;
    else if (req.params && req.params.userAccessKey) {
      userAccessKey = req.params.userAccessKey;
    }
    if (userAccessKey && userAccessKey.length > 0) {
      if (userAccessKey.startsWith("0x")) {
        //this is profileAddress
        this.SearchByProfileAddress(userAccessKey, function (_result) {
          resultMessage = _result;
          callback(resultMessage);
        });

      } else {
        //this is not updated profile or user who does not have wallet address
        this.SearchById(userAccessKey, function (_result) {
          resultMessage = _result;
          callback(resultMessage);
        });
      }
    } else {
      resultMessage = {
        result: false,
        message: 'No body parameters'
      }
      callback(resultMessage);
    }
  },

  BindUserDetailToObject: function (user, target, callback) {
    if (user.local && user.local.id && user.local.id !== '') {
      //user registered by local auth.
      target.authType = 'local';
      target.user.local = {
        id: user.local.id || '',
        email: user.local.email || '',
        username: user.local.username || '',
        password: user.local.password || '',
        phone: user.local.phone || ''
      }
    } else if (user.facebook && user.facebook.id && user.facebook.id !== '') {
      //user registered by facebook auth.
      target.authType = 'facebook';
      target.user.facebook = {
        id: user.facebook.id || '',
        token: user.facebook.token || '',
        email: user.facebook.email || '',
        username: user.facebook.username || '',
        name: user.facebook.name || '',
        url: user.facebook.url || ''
      }
    } else if (user.twitter && user.twitter.id && user.twitter.id !== '') {
      //user registered by twitter auth.
      target.authType = 'twitter';
      target.user.twitter = {
        id: user.twitter.id || '',
        token: user.twitter.token || '',
        displayName: user.twitter.displayName || '',
        username: user.twitter.username || '',
        url: user.twitter.url || ''
      }
    } else if (user.google && user.google.id && user.google.id !== '') {
      //user registered by google auth.
      target.authType = 'google';
      target.user.google = {
        id: user.google.id || '',
        token: user.google.token || '',
        name: user.google.name || '',
        url: user.google.url || '',
        isAdmin: (user.google.email && user.google.email.endsWith("@musicoin.org"))  //checks admin control
      }
    }
    else if (user.soundcloud && user.soundcloud.id && user.soundcloud !== '') {
      //user soundcloud by google auth.
      target.authType = 'soundcloud';
      target.user.soundcloud = {
        id: user.soundcloud.id || '',
        token: user.soundcloud.token || '',
        name: user.soundcloud.name || '',
        username: user.soundcloud.username || ''
      }
    }
    callback(target);
  },

  checkInviteCode: function (req, res, next) {
    const user = req.user;
    if (user && !user.reusableInviteCode) {
      user.reusableInviteCode = "MUSIC" + crypto.randomBytes(12).toString('hex');
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
  },

  SearchByProfileAddress: function (userAccessKey, callback) {
    var resultMessage = {};
    User.findOne({ "profileAddress": userAccessKey }, function (err, user) {
      //database error
      if (err) {
        resultMessage = {
          result: false,
          message: 'mongo db error'
        }
        callback(resultMessage);
      } else {
        if (user) {
          //user found
          resultMessage = {
            result: true,
            user: {
              profileAddress: user.profileAddress || '',
              local: {},
              facebook: {},
              twitter: {},
              google: {},
              soundcloud: {}
            },
            authType: 'local' //this value default
          }
          // this will bind user info to resultMessage(object) and call callback function
          this.BindUserDetailToObject(user, resultMessage, callback);

        } else {
          //user not found
          resultMessage = {
            result: false,
            message: 'user not found'
          }
          callback(resultMessage);
        }
      }
    });
  },

  validateNewAccount: function (errRedirect) {
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

      if ((!req.body.name || req.body.name.length == 0)) {
        req.flash('loginMessage', `Please enter a screen name`);
        return res.redirect(errRedirect);
      }

      // minimum password strength
      const error = FormUtils.checkPasswordStrength(req.body.password);
      if (error) {
        req.flash('loginMessage', error);
        return res.redirect(errRedirect);
      }

      const cc = EmailConfirmation.findOne({ email: req.body.email, code: req.body.confirmation });
      const eu = User.findOne({ "local.email": req.body.email });
      const cp = this.checkCaptcha(req);
      const smsConfirmationCode = req.body.confirmationphone;

      return Promise.join(cc, eu, cp, smsConfirmationCode, function (confirmation, existingUser, captchaOk) {
        if (!captchaOk) {
          if (smsCodeVal == smsConfirmationCode) {
            this.smsCode();
          } else {
            this.smsCode();
            req.flash('loginMessage', "Incorrect captcha or phone verification code");
            return res.redirect(errRedirect);
          }
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
};