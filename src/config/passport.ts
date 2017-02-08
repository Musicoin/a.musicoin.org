import {Passport} from "passport";
const LocalStrategy = require('passport-local').Strategy;
const GoogleStrategy = require('passport-google-oauth').OAuth2Strategy;
const TwitterStrategy = require('passport-twitter').Strategy;

// load up the user model
const User = require('../app/models/user');
const Invite = require('../app/models/invite');
const InviteRequest = require('../app/models/invite-request');
const defaultProfile = {
  artistName: "",
  description: "Say something interesting about yourself",
  social: {google:"something"},
  image: "/images/default-profile.png"
};

// expose this function to our app using module.exports
export function configure(passport: Passport, mediaProvider, configAuth: any) {

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
    console.log("deserialize user: " + id);
    User.findById(id, function (err, user) {
      if (err) return done(err, null);
      if (user) {
        user.profile = Object.assign({}, defaultProfile, user.draftProfile);
      }
      done(null, user);
    });
  });

  // =========================================================================
  // LOCAL SIGNUP ============================================================
  // =========================================================================
  // we are using named strategies since we have one for login and one for signup
  // by default, if there was no name, it would just be called 'local'

  passport.use('local-signup', new LocalStrategy({
      // by default, local strategy uses username and password, we will override with email
      usernameField: 'email',
      passwordField: 'password',
      passReqToCallback: true // allows us to pass back the entire request to the callback
    },
    function (req, email, password, done) {

      // asynchronous
      // User.findOne wont fire unless data is sent back
      process.nextTick(function () {

        // find a user whose email is the same as the forms email
        // we are checking to see if the user trying to login already exists
        User.findOne({'local.email': email}, function (err, user) {
          // if there are any errors, return the error
          if (err)
            return done(err);

          // check to see if theres already a user with that email
          if (user) {
            return done(null, false, req.flash('signupMessage', 'That email is already taken.'));
          } else {

            // if there is no user with that email
            // create the user
            const newUser = new User();

            // set the user's local credentials
            newUser.local.email = email;
            newUser.local.password = newUser.generateHash(password);

            // save the user
            newUser.save(function (err) {
              if (err)
                throw err;
              return done(null, newUser);
            });
          }

        });

      });

    }));

  // =========================================================================
  // LOCAL LOGIN =============================================================
  // =========================================================================
  // we are using named strategies since we have one for login and one for signup
  // by default, if there was no name, it would just be called 'local'

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

      const condition = req.body.profileAddress
        ? {'profileAddress': req.body.profileAddress}
        : req.body.gmailAddress
          ? {'google.email': req.body.gmailAddress.toLowerCase()}
          : req.body.twitterHandle
            ? {'twitter.username': req.body.twitterHandle.toLowerCase().replace("@", "")}
            : null;

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

        // if the user is found but the password is wrong
        if (!req.user.isAdmin)
          return done(null, false, req.flash('loginMessage', 'Oops! Wrong password.')); // create the loginMessage and save it to session as flashdata

        // all is well, return successful user
        return done(null, user);
      });
    }));


  // =========================================================================
  // GOOGLE ==================================================================
  // =========================================================================
  passport.use(new GoogleStrategy({
      clientID: configAuth.googleAuth.clientID,
      clientSecret: configAuth.googleAuth.clientSecret,
      callbackURL: configAuth.googleAuth.callbackURL,
      passReqToCallback : true // allows us to pass in the req from our route (lets us check if a user is logged in or not)
    },
    function (req, token, refreshToken, profile, done) {

      const asGoogleUser = function(profile) {
        return {
          id: profile.id,
          token: token,
          name: profile.displayName,
          email: profile.emails[0].value,
          picture: profile._json.picture
        };
      };

      // make the code asynchronous
      // User.findOne won't fire until we have all our data back from Google
      process.nextTick(function () {
        if (req.user) {
          return done(null, req.user);
        }

        // try to find the user based on their google id
        const googleInfo = asGoogleUser(profile);
        if (!req.user) {
          const conditions = [
            { 'google.id' : googleInfo.id },
            { 'google.email' : googleInfo.email }
          ];

          // first, check if this user already exists
          User.findOne({ $or : conditions }).exec()
            .then(function(user) {
              if (user) return user;
              if (!req.session || !req.session.inviteCode) return null;

              // if not, look for an unclaimed invite
              return User.findOne({$and: [
                {'invite.inviteCode': req.session.inviteCode},
                {'invite.claimed': false},
              ]}).exec()
            })
            .then(function (user) {
              delete req.session.inviteCode;
              if (user) {
                // if there is a user id already but no token (user was linked at one point and then removed)
                if (!user.google.token || !user.invite.claimed) {
                  user.invite.claimed = true;
                  user.google = googleInfo;

                  return user.save(function (err) {
                    if (err)
                      return done(err);

                    return done(null, user);
                  });
                }

                return done(null, user); // user found, return that user
              }
              else {
                var query = {email: profile.username},
                  update = { expire: new Date() },
                  options = { upsert: true, new: true, setDefaultsOnInsert: true };

                // Find the document
                InviteRequest.findOneAndUpdate(query, update, options, function(error, result) {
                  if (error) return;
                  console.log("Created invite request for user: " + profile.email);
                });
                return done(null, false, req.flash('loginMessage', 'An invite is required'));
              }
            })
            .catch(function(err) {
              console.log(`Failed while trying to login with google: ${err}`);
              done(err);
            });
        }
      });
    }));

  // =========================================================================
  // TWITTER =================================================================
  // =========================================================================
  passport.use(new TwitterStrategy({

      consumerKey     : configAuth.twitterAuth.consumerKey,
      consumerSecret  : configAuth.twitterAuth.consumerSecret,
      callbackURL     : configAuth.twitterAuth.callbackURL,
      passReqToCallback : true // allows us to pass in the req from our route (lets us check if a user is logged in or not)

    },
    function(req, token, tokenSecret, profile, done) {

      // asynchronous
      process.nextTick(function() {
        if (req.user) {
          return done(null, req.user);
        }
        // check if the user is already logged in
        if (!req.user) {
          const conditions = [
            { 'twitter.id' : profile.id },
            { 'twitter.username' : profile.username }
          ];

          // first, check if this user already exists
          User.findOne({ $or : conditions }).exec()
            .then(function(user) {
              if (user) return user;
              if (!req.session || !req.session.inviteCode) return null;

              // if not, look for an unclaimed invite
              return User.findOne({$and: [
                {'invite.inviteCode': req.session.inviteCode},
                {'invite.claimed': false},
              ]}).exec()
            })
            .then(function (user) {
              delete req.session.inviteCode;
              if (user) {
                // if there is a user id already but no token (user was linked at one point and then removed)
                if (!user.twitter.token || !user.invite.claimed) {
                  user.invite.claimed = true;
                  user.twitter.token = token;
                  user.twitter.username = profile.username;
                  user.twitter.displayName = profile.displayName;
                  user.twitter.picture = profile._json.profile_image_url_https;

                  return user.save(function (err) {
                    if (err)
                      return done(err);

                    return done(null, user);
                  });
                }

                return done(null, user); // user found, return that user
              }
              else {
                var query = {email: profile.username},
                  update = { expire: new Date() },
                  options = { upsert: true, new: true, setDefaultsOnInsert: true };

                // Find the document
                InviteRequest.findOneAndUpdate(query, update, options, function(error, result) {
                  if (error) return;
                  console.log("Created invite request for user: " + profile.username);
                });
                return done(null, false, req.flash('loginMessage', 'An invite is required'));
              }
            })
            .catch(function(err) {
              console.log(`Failed while trying to login with twitter: ${err}`);
              done(err);
            });
        }
      });
    }));
}