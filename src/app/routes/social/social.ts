import * as express from 'express';
import * as passport from 'passport';

const router = express.Router();
export class SocialRouter {
    constructor(passport: any) {
        router.get('/signup/google', setSignUpFlag(true), passport.authenticate('google', { scope: ['profile', 'email'] }));
        router.get('/auth/google', setSignUpFlag(false), passport.authenticate('google', { scope: ['profile', 'email'] }));
        router.get('/connect/google', setSignUpFlag(false), passport.authorize('google', { scope: ['profile', 'email'] }));

        // the callback after google has authenticated the user
        router.get('/auth/google/callback',
            passport.authenticate('google', {
                failureRedirect: '/welcome'
            }), SetSessionAfterLoginSuccessfullyAndRedirect);

        router.get('/connect/google/callback',
            passport.authorize('google', {
                failureRedirect: '/'
            }), SetSessionAfterLoginSuccessfullyAndRedirect);


        router.get('/signup/facebook', setSignUpFlag(true), passport.authenticate('facebook', { scope: ['public_profile', 'email'] }));
        router.get('/auth/facebook', setSignUpFlag(false), passport.authenticate('facebook', { scope: ['public_profile', 'email'] }));
        router.get('/connect/facebook', setSignUpFlag(false), passport.authorize('facebook', { scope: ['public_profile', 'email'] }));

        // handle the callback after twitter has authenticated the user
        router.get('/auth/facebook/callback',
            passport.authenticate('facebook', {
                failureRedirect: '/welcome'
            }), SetSessionAfterLoginSuccessfullyAndRedirect);

        // handle the callback after twitter has authenticated the user
        router.get('/connect/facebook/callback',
            passport.authenticate('facebook', {
                failureRedirect: '/welcome'
            }), SetSessionAfterLoginSuccessfullyAndRedirect);

        router.get('/signup/twitter', setSignUpFlag(true), passport.authenticate('twitter', { scope: 'email' }));
        router.get('/auth/twitter', setSignUpFlag(false), passport.authenticate('twitter', { scope: 'email' }));
        router.get('/connect/twitter', setSignUpFlag(false), passport.authorize('twitter', { scope: 'email' }));

        // handle the callback after twitter has authenticated the user
        router.get('/auth/twitter/callback',
            passport.authenticate('twitter', {
                failureRedirect: '/welcome'
            }), SetSessionAfterLoginSuccessfullyAndRedirect);

        router.get('/connect/twitter/callback',
            passport.authenticate('twitter', {
                failureRedirect: '/welcome'
            }), SetSessionAfterLoginSuccessfullyAndRedirect);

        // =============================================================================
        // UNLINK ACCOUNTS =============================================================
        // =============================================================================
        router.post('/unlink/google', function (req, res) {
            unlinkProvider('google', req, res);
        });

        router.post('/unlink/twitter', function (req, res) {
            unlinkProvider('twitter', req, res);
        });

        router.post('/unlink/facebook', function (req, res) {
            unlinkProvider('facebook', req, res);
        });

        function setSignUpFlag(isSignup) {
            return function (req, res, next) {
                req.session.signup = isSignup;
                if(req.query.isMusician) {
                    req.session.isMusician=true;
                }
                next();
            }
        }

        function SetSessionAfterLoginSuccessfullyAndRedirect(req, res) {
            //user loggined succesfully, then redirect to '/loginRedirect' URL
            if (req.user) {
                if (req.user.profileAddress && req.user.profileAddress !== '') {
                    req.session.userAccessKey = req.user.profileAddress; //set session value as user.profileAddress;
                } else if (req.user.id && req.user.id !== '') {
                    req.session.userAccessKey = req.user.id;  //set session value as user.id
                }
            }
            res.redirect('/loginRedirect'); // redirect to the secure profile section
        }

        function unlinkProvider(provider, req, res) {
            if (!req.isAuthenticated()) {
                return res.json({ success: false, message: "You must be logged in to unlink an account" });
            }
            if (!req.user[provider] || !req.user[provider].id) {
                return res.json({ success: false, message: `No ${provider} account is linked.` });
            }
            if (getLoginMethodCount(req.user) < 2) {
                return res.json({ success: false, message: "You cannot remove your only authentication method." });
            }

            req.user[provider] = {};
            req.user.save(function (err) {
                if (err) {
                    console.log("Failed to save user record: " + err);
                    res.json({ success: false, message: "An internal error occurred" });
                }
                return res.json({ success: true, message: `Your ${provider} account has been unlinked from this account` });
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
    }
    getRouter() {
        return router;
    }
}
