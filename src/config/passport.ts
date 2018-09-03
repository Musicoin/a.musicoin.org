import { Promise } from 'bluebird';

import { user as userService } from '../app/rest-api/services';

const LocalStrategy = require('passport-local').Strategy;
const GoogleStrategy = require('passport-google-oauth').OAuth2Strategy;
const TwitterStrategy = require('passport-twitter').Strategy;
const SoundCloudStrategy = require('passport-soundcloud').Strategy;
const FacebookStrategy = require('passport-facebook').Strategy

// load up the user model
const User = require('../app/models/user');
const get_ip = require('request-ip');

const defaultProfile = {
  artistName: "",
  description: "Say something interesting about yourself",
  social: { google: "something" },
  image: "/images/default-profile.png"
};

// expose this function to our app using module.exports
export function configure(passport: any, mediaProvider, configAuth: any) {

  class LoginFailed extends Error {
    constructor(message) {
      super(message);
      this.name = 'LoginFailed';
    }
  }

  class AccountDisabled extends Error {
    constructor(message) {
      super(message);
      this.name = 'AccountDisabled';
    }
  }

  // =========================================================================
  // passport session setup ==================================================
  // =========================================================================
  // required for persistent login sessions
  // passport needs ability to serialize and unserialize users out of session

  // used to serialize the user for the session
  passport.serializeUser(function (user, done) {
    done(null, user.id);
  });

  // used to deserialize the user
  passport.deserializeUser(function (id, done) {
    User.findById(id, function (err, user) {
      if (err) return done(err, null);
      if (user) {
        user.profile = Object.assign({}, defaultProfile, user.draftProfile);
        user.genericProfile = userService.formatUserObject(user);
      }
      done(null, user);
    });
  });

  /**
   * This route supports a switch user option for admin users.  It's a bit of a hack, but it can only be
   * triggered by users that are logged in and considered admin users (gmail authenticated address ending in @berry.ai)
   */
  passport.use('local-su', new LocalStrategy({
    // by default, local strategy uses username and password, we will override with email
    usernameField: 'email',
    passwordField: 'password',
    passReqToCallback: true // allows us to pass back the entire request to the callback
  },
    function (req, email, password, done) { // callback with email and password from our form

      if (!req.isAuthenticated()) {
        console.log(`Anonymous attempt to use admin tools: ip=${get_ip.getClientIp(req)}, session=${req.session.id}`);
        return done(null, false, req.flash('loginMessage', 'You must be logged in to perform this action'));
      }

      // if the user is found but the password is wrong
      if (!req.user.isAdmin) {
        const name = req.user.draftProfile && req.user.draftProfile.artistName ?
          `${req.user.draftProfile.artistName} (${req.user.profileAddress})` :
          req.user.profileAddress;
        console.log(`Unauthorized attempt to use admin tools: ip=${get_ip.getClientIp(req)}, session=${req.session.id}, user._id=${req.user._id}, user=${name}`);
        return done(null, false, req.flash('loginMessage', 'You must be an administrator to perform this action'));
      }

      const condition = req.body.profileAddress ?
        { 'profileAddress': req.body.profileAddress } :
        req.body.gmailAddress ?
          { 'google.email': req.body.gmailAddress } :
          req.body.twitterHandle ?
            { 'twitter.username': req.body.twitterHandle.replace("@", "") } :
            req.body.facebookUsername ?
              { $or: [{ 'facebook.username': req.body.facebookUsername }, { 'facebook.email': req.body.facebookUsername }, { 'facebook.name': req.body.facebookUsername }] } :
              req.body.localEmail ?
                { 'local.email': req.body.localEmail } :
                null;

      if (!condition) {
        return done(null, false, req.flash('loginMessage', 'You must provide a profileAddress, a gmail address, or a twitter handle')); // create the loginMessage and save it to session as flashdata
      }

      // find a user whose email is the same as the forms email
      // we are checking to see if the user trying to login already exists
      User.findOne(condition, function (err, user) {
        // if there are any errors, return the error before anything else
        if (err)
          return done(err);

        // if no user is found, return the message
        if (!user)
          return done(null, false, req.flash('loginMessage', 'No user found.')); // req.flash is the way to set flashdata using connect-flash

        // all is well, return successful user
        return done(null, user);
      });
    }));

  passport.use('local', new LocalStrategy({
    // by default, local strategy uses username and password, we will override with email
    usernameField: 'email',
    passwordField: 'password',
    passReqToCallback: true // allows us to pass back the entire request to the callback
  },
    function (req, email, password, done) {
      // asynchronous
      const newUser = new User();
      process.nextTick(function () {
        const localProfile = {
          id: email,
          email: email,
          username: req.body && req.body.name ? req.body.name : email,
          token: "token", // doesn't matter, just for compatibility with other methods
          password: newUser.generateHash(password),
        };

        return Promise.resolve()
          .delay(2000)
          .then(() => {
            doStandardLogin("local",
              req,
              localProfile,
              done,
              (user) => {
                return user.validPassword(password)
              });
          });
      });
    }));

  // =========================================================================
  // GOOGLE ==================================================================
  // =========================================================================
  passport.use(new GoogleStrategy({
    clientID: configAuth.googleAuth.clientID,
    clientSecret: configAuth.googleAuth.clientSecret,
    callbackURL: configAuth.googleAuth.callbackURL,
    passReqToCallback: true // allows us to pass in the req from our route (lets us check if a user is logged in or not)
  },
    function (req, token, tokenSecret, profile, done) {
      let isRole="listener";
      if(req.session.isMusician)
      {
        isRole="Musician";
      }
      if(req.session.isReviewers)
      {
        isRole="Reviewers";
      }
      // asynchronous
      process.nextTick(function () {
        const localProfile = {
          id: profile.id,
          token: token,
          name: profile.displayName,
          email: profile.emails[0].value,
          username: profile.emails[0].value,
          picture: profile._json.picture,
          url: profile._json.link
        };
        doStandardLogin("google",
          req,
          localProfile,
          done,null,isRole);
      });
    }));

  // =========================================================================
  // FACEBOOK ==================================================================
  // =========================================================================
  passport.use(new FacebookStrategy({
    clientID: configAuth.facebookAuth.clientID,
    clientSecret: configAuth.facebookAuth.clientSecret,
    callbackURL: configAuth.facebookAuth.callbackURL,
    profileFields: ['id', 'displayName', 'email', 'link'],
    passReqToCallback: true // allows us to pass in the req from our route (lets us check if a user is logged in or not)
  },
    function (req, token, tokenSecret, profile, done) {
      let isRole="listener";
      if(req.session.isMusician)
      {
        isRole="Musician";
      }
      if(req.session.isReviewers)
      {
        isRole="Reviewers";
      }
      // asynchronous
      process.nextTick(function () {
        const localProfile = {
          id: profile.id,
          token: token,
          username: profile.displayName,
          name: profile.displayName,
          url: profile._json.link,
          email: profile.emails && profile.emails.length > 0 ? profile.emails[0].value : profile.email
        };

        doStandardLogin("facebook",
          req,
          localProfile,
          done,null,isRole);
      });
    }));

  // =========================================================================
  // TWITTER =================================================================
  // =========================================================================
  passport.use(new TwitterStrategy({

    consumerKey: configAuth.twitterAuth.consumerKey,
    consumerSecret: configAuth.twitterAuth.consumerSecret,
    callbackURL: configAuth.twitterAuth.callbackURL,
    passReqToCallback: true // allows us to pass in the req from our route (lets us check if a user is logged in or not)

  },
    function (req, token, tokenSecret, profile, done) {
      let isRole="listener";
      if(req.session.isMusician)
      {
        isRole="Musician";
      }
      if(req.session.isReviewers)
      {
        isRole="Reviewers";
      }
      // asynchronous
      process.nextTick(function () {
        const localProfile = {
          id: profile.id,
          token: token,
          username: profile.username,
          displayName: profile.displayName,
          url: "https://twitter.com/" + profile.username,
          picture: profile._json.profile_image_url_https
        };

        doStandardLogin("twitter",
          req,
          localProfile,
          done,null,isRole);
      }); 
    }));

  // =========================================================================
  // SOUNDCLOUD =================================================================
  // =========================================================================
  passport.use(new SoundCloudStrategy({

    clientID: configAuth.soundcloudAuth.clientID,
    clientSecret: configAuth.soundcloudAuth.clientSecret,
    callbackURL: configAuth.soundcloudAuth.callbackURL,
    passReqToCallback: true // allows us to pass in the req from our route (lets us check if a user is logged in or not)

  },
    function (req, token, tokenSecret, profile, done) {

      // asynchronous
      process.nextTick(function () {
        const localProfile = {
          id: profile.id,
          token: token,
          username: profile._json.permalink,
          name: profile._json.full_name,
          picture: profile._json.avatar_url
        };

        doStandardLogin("soundcloud",
          req,
          localProfile,
          done);
      });
    }));

  function createUserWithReusableInvite(req) {
    if (!req.session.inviteCode) return Promise.resolve(null);
    return User.findOne({
      $and: [
        { reusableInviteCode: req.session.inviteCode },
        { invitesRemaining: { $gt: 0 } },
      ]
    })
      .then(inviter => {
        if (!inviter) return null;
        const newUser = new User();
        const inviteCode = req.session.inviteCode;
        newUser.invite = {
          noReward: inviter.invite ? !!inviter.invite.noReward : false,
          invitedBy: inviter._id,
          invitedAs: "",
          groupInviteCode: inviteCode,
          invitedOn: Date.now(),
          claimed: true
        };
        inviter.invitesRemaining--;
        return Promise.join(inviter.save(), newUser.save(), (_inviter, _newUser) => {
          return _newUser;
        })
          .catch(err => {
            console.log("Failed to create new user from reusable invite code: " + err);
            return null;
          })
      })
  }

  function createUserWithNoInvite(role:String) {
    const newUser = new User();
    if(role==="Musician") {
      newUser.role="Musician";
    } else if (role==="Reviewers") {
      newUser.role="Reviewers";
    }
    newUser.invite = {
      noReward: false,
      invitedBy: null,
      invitedAs: "",
      groupInviteCode: "",
      invitedOn: Date.now(),
      claimed: true
    };
    return newUser.save()
      .catch(err => {
        console.log("Failed to create new user from reusable invite code: " + err);
        return null;
      })
  }

  function doStandardLogin(authProvider: string,
    req,
    localProfile,
    done,
    validation?,role?) {

    console.log(`Handling login request: ip=${get_ip.getClientIp(req)}, session=${req.session.id}, auth=${authProvider}, id=${localProfile.id}`);
    // if the user is already logged in, see if the account can be linked
    if (req.user) {
      const user = req.user;

      // we can link this new auth method to this account, as long as it isn't linked to
      // another account already.
      const existingUserCondition = {};
      existingUserCondition[authProvider + ".id"] = localProfile.id;
      existingUserCondition["_id"] = { $ne: req.user._id };
      User.findOne(existingUserCondition).exec()
        .then(other => {
          if (!other) {
            user[authProvider] = localProfile;

            if (typeof localProfile.email === 'string' && localProfile.email.trim()) {
              // if email is in social profile, then it is verified for us.
              user.primaryEmail = localProfile.email;
              user.emailVerified = true;
            }
            console.log(`Saving user`, user, localProfile);
            return user.save(function (err) {
              if (err)
                return done(err);

              return done(null, user);
            });
          } else {
            console.log("cannot link account that is already linked to another account! user.id: " + req.user._id + ", other.id: " + other._id);
            return done(null, false, req.flash('loginMessage', 'This address is already linked to another account'));
          }
        })
        .catch(function (err) {
          console.log(`Failed while trying to link an account ${authProvider}: ${err}`);
          done(err);
        });
    } else {
      // check if the user is already logged in
      const condition = {};
      condition[authProvider + ".id"] = localProfile.id;
      const userQuery = User.findOne(condition).exec()
        .then((user) => {
          if (user && validation && !validation(user)) {
            throw new LoginFailed("Password");
          }
          if (user && user.accountLocked) {
            throw new AccountDisabled("Account disabled");
          }
          return user;
        });

      // first, check if this user already exists
      userQuery
        .then(function (user) {
          // existing user, just return
          if (user) return user;

          // do not create new accounts unless we are in the signup flow
          if (!req.session.signup) return null;

          // if not, look for an unclaimed invite
          return User.findOne({
            $and: [
              { 'invite.inviteCode': req.session.inviteCode },
              { 'invite.claimed': false },
              { 'twitter': null },
              { 'google': null },
              { 'facebook': null },
              { 'soundcloud': null },
              { 'local': null },
              { 'profileAddress': null }
            ]
          }).exec()
            .then(user => {
              if (!user) {
                // now check to see if this is a reusable invite
                return createUserWithReusableInvite(req);
              }
              return user;
            })
            .then(user => {
              if (!user) {
                return createUserWithNoInvite(role);
              }
              return user;
            })
            .then(user => {
              if (user) {
                user.pendingInitialization = true;
                if (authProvider == "local") {
                  if (localProfile.email.trim().endsWith("wimsg.com") || localProfile.email.trim().endsWith("vmani.com")) {
                    user.freePlaysRemaining = 10;
                  }
                }
              }
              return user;
            })

        })
        .then(function (user) {
          if (user) {
            // either the user already existed, or we can claim this invite
            delete req.session.inviteCode;
            user.invite.claimed = true;
            user[authProvider] = localProfile;

            if (typeof localProfile.email === 'string' && localProfile.email.trim()) {
              // if email is in social profile, then it is verified for us.
              user.primaryEmail = localProfile.email;
              user.emailVerified = true;
            }
            console.log(`Saving user`, user, localProfile);
            return user.save(function (err) {
              if (err)
                return done(err);

              return done(null, user);
            });
          } else {
            if (req.session && req.session.inviteCode) {
              return done(null, false, req.flash('loginMessage', 'The invite code you are using has already been claimed'));
            }
            return done(null, false, req.flash('loginMessage', 'User account not found.  Click "Sign up" if you need to create a new account.'));
          }
        })
        .catch(function (err) {
          if (err instanceof LoginFailed) {
            console.log(`Login attempt failed due to invalid password ${authProvider}: ${err}`);
            return done(null, false, req.flash('loginMessage', 'User account not found or your password was incorrect.  Click "Sign up" if you need to create a new account.'));
          } else if (err instanceof AccountDisabled) {
            console.log(`Login attempt failed because the account is locked ${authProvider}: ${err}`);
            return done(null, false, req.flash('loginMessage', 'This account has been disabled.'));
          } else {
            console.log(`Failed while trying to login with ${authProvider}: ${err}`);
            done(err);
          }
        });
    }
  };
}