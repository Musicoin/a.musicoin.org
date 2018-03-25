import * as crypto from 'crypto';
import * as qr from 'qr-image';

import { ExchangeRateProvider } from '../../extra/exchange-service';
import { MailSender } from '../../extra/mail-sender';
import { MusicoinAPI } from '../../internal/musicoin-api';
import { MusicoinHelper } from '../../internal/musicoin-helper';
import { MusicoinOrgJsonAPI } from '../../rest-api/json-api';
import { RequestCache } from '../../utils/cached-request';
import * as FormUtils from '../../utils/form-utils';
import * as passport from 'passport';
var express = require('express');
var router = express.Router();
var functions = require('../routes');
const mailSender = new MailSender();
const cachedRequest = new RequestCache();
const exchangeRateProvider = new ExchangeRateProvider(config.exchangeRateService, cachedRequest);
const musicoinApi = new MusicoinAPI(config.musicoinApi);
let mcHelper = new MusicoinHelper(musicoinApi, mediaProvider, config.playbackLinkTTLMillis);
const jsonAPI = new MusicoinOrgJsonAPI(musicoinApi, mcHelper, mediaProvider, mailSender, exchangeRateProvider, config);
const messagebird = require('messagebird')(process.env.MESSAGEBIRD_ID);
const baseUrl = process.env.BASE_URL;
const EmailConfirmation = require('./models/email-confirmation');
const User = require('./models/user');

router.get('/login', function (req, res) {
    if (req.user) {
        console.log("User is already logged in, redirecting away from login page");
        return res.redirect('/loginRedirect');
    }
    if (req.query.returnTo) {
        req.session.destinationUrl = req.query.returnTo;
    }
    // render the page and pass in any flash data if it exists
    const message = req.flash('loginMessage');
    functions.doRender(req, res, 'landing.ejs', {
        message: message,
    });
    //functions.doRender(req, res, 'landing.ejs', { message: req.flash('loginMessage') });
});

router.get('/login-musician', function (req, res) {
    if (req.user) {
        console.log("User is already logged in, redirecting away from login page");
        return res.redirect('/loginRedirect');
    }
    // render the page and pass in any flash data if it exists
    const message = req.flash('loginMessage');
    functions.doRender(req, res, 'landing_musicians.ejs', {
        message: message,
    });
    //functions.doRender(req, res, 'landing.ejs', { message: req.flash('loginMessage') });
});

router.get('/connect/email', function (req, res) {
    // render the page and pass in any flash data if it exists
    const message = req.flash('loginMessage');
    functions.doRender(req, res, 'landing.ejs', {
        message: message,
    });
});

router.post('/qr-code', function (req, res) {
    //var qr_svg = qr.image('Custom Message', { type: 'svg' });
    var qr_svg = qr.image(baseUrl + '/artist/' + req.body.profileAddress, { type: 'png' });
    var x = qr_svg.pipe(require('fs').createWriteStream(__dirname + '/qr_musicoin.png'));
    x.on('finish', function (err) {
        if (err) {
            console.log(err);
            return;
        }
        res.download(__dirname + '/qr_musicoin.png');
    });
});

router.post('/login/confirm', function (req, res) {
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
router.post('/login/confirm-phone', function (req, res) {
    if (req.body.phone) req.body.phone = req.body.phone.trim();
    var params = {
        'body': 'Verification code: ' + functions.smsCodeReturnVal,
        'originator': 'Musicoin',
        'recipients': [
            req.body.phone
        ]
    };
    function smsBird() {
        messagebird.messages.create(params, function (err, response) {
            if (err) {
                console.log("Failed to send phone verification confirmation code.");
                console.log(err);
            }
            console.log("Sent phone verification code!");
            console.log(response);
            functions.phoneNumber(req);
        });
    }
    if (functions.numberOfPhoneUsedTimesReturnVal >= 2) {
        console.log("Sms Verification abuse for " + req.body.phone + " detected!");
    } else if (functions.phoneNumberVal == req.body.phone) {
        functions.numberOfPhoneUsedTimes();
        console.log(functions.phoneNumberVal + " used " + functions.numberOfPhoneUsedTimesReturnVal + " times");
        setTimeout(smsBird, 60000);
    } else {
        smsBird();
    }
});

router.post('/connect/email', functions.setSignUpFlag(false), functions.validateLoginEmail('/connect/email'), passport.authenticate('local', {
    failureRedirect: '/connect/email', // redirect back to the signup page if there is an error
    failureFlash: true // allow flash messages
}), functions.SetSessionAfterLoginSuccessfullyAndRedirect);

router.post('/login', functions.setSignUpFlag(false), functions.validateLoginEmail('/login'), passport.authenticate('local', {
    failureRedirect: '/login', // redirect back to the signup page if there is an error
    failureFlash: true // allow flash messages
}), functions.SetSessionAfterLoginSuccessfullyAndRedirect);

router.post('/signin/newroutethat', functions.setSignUpFlag(false), functions.validateLoginEmail('/welcome'), passport.authenticate('local', {
    failureRedirect: '/welcome', // redirect back to the signup page if there is an error
    failureFlash: true // allow flash messages
}), functions.SetSessionAfterLoginSuccessfullyAndRedirect);

router.post('/signup', functions.setSignUpFlag(true), functions.validateNewAccount('/welcome'), passport.authenticate('local', {
    failureRedirect: '/welcome', // redirect back to the signup page if there is an error
    failureFlash: true // allow flash messages
}), functions.SetSessionAfterLoginSuccessfullyAndRedirect);

router.get('/login/forgot', functions.redirectIfLoggedIn('/loginRedirect'), (req, res) => {
    functions.doRender(req, res, "password-forgot.ejs", {});
});

router.post('/login/forgot', (req, res) => {
    var re = /^(([^<>()\[\]\.,;:\s@\"]+(\.[^<>()\[\]\.,;:\s@\"]+)*)|(\".+\"))@(([^<>()[\]\.,;:\s@\"]+\.)+[^<>()[\]\.,;:\s@\"]{2,})$/i;

    const email = req.body.email || "";
    if (re.test(email.trim()) == false)  /// a@b.c is the smallest possible email address (5 chars)
        return functions.doRender(req, res, "landing.ejs", { message: "Invalid email address: " + req.body.email });

    functions.checkCaptcha(req)
        .then(captchaOk => {
            if (!captchaOk) {
                req.flash('loginMessage', `The captcha check failed`);
                return
            } else {
                User.findOne({ "local.email": req.body.email }).exec()
                    .then(user => {
                        if (!user) return functions.doRender(req, res, "password-reset.ejs", { message: "User not found: " + req.body.email });
                        user.local.resetExpiryTime = Date.now() + config.auth.passwordResetLinkTimeout;
                        user.local.resetCode = "MUSIC" + crypto.randomBytes(11).toString('hex');
                        return user.save()
                            .then(user => {
                                if (!user) {
                                    console.log("user.save() during password reset did not return a user record");
                                    return functions.doRender(req, res, "landing.ejs", { message: "An internal error occurred, please try again later" });
                                }
                                return mailSender.sendPasswordReset(user.local.email, config.serverEndpoint + "/login/reset?code=" + user.local.resetCode)
                                    .then(() => {
                                        return functions.doRender(req, res, "landing.ejs", { message: "An email has been sent to " + req.body.email });
                                    })
                            })
                            .catch(err => {
                                console.log(`An error occurred when sending the pasword reset email for ${email}: ${err}`);
                                return functions.doRender(req, res, "landing.ejs", { message: "An internal error occurred, please try again later" });
                            })
                    })
            }
        });

});

router.get('/login/reset', functions.redirectIfLoggedIn('/loginRedirect'), (req, res) => {
    // if the code is expired, take them back to the login
    const code = req.query.code;
    const failMessage = "Your password reset code is invalid or has expired";
    if (!code) return functions.doRender(req, res, "landing.ejs", { message: failMessage });
    User.findOne({ "local.resetCode": code }).exec()
        .then(user => {
            // code does not exist, just go to the login page
            if (!user || !user.local || !user.local.resetExpiryTime) return functions.doRender(req, res, "landing.ejs", { message: failMessage });

            // make sure code is not expired
            const expiry = new Date(user.local.resetExpiryTime).getTime();
            if (Date.now() > expiry) return functions.doRender(req, res, "landing.ejs", { message: failMessage });

            return functions.doRender(req, res, "password-reset.ejs", { code: code });
        })
});

router.get('/verify-email/:code', (req, res) => {
    // if the code is expired, take them back to the login
    const code = req.params.code;

    jsonAPI.userService.verifyEmail(req.params).then(() => res.redirect('/'), (error) => {
        res.render('mail/email-verification-link-expired.ejs', {});
    }).catch((exception) => {
        res.render('error.ejs', {});
    });

});

router.post('/login/reset', (req, res) => {
    const code = String(req.body.code);
    if (!code)
        return functions.doRender(req, res, "landing.ejs", { message: "There was a problem resetting your password" });

    const error = FormUtils.checkPasswordStrength(req.body.password);
    if (error) {
        return functions.doRender(req, res, "password-reset.ejs", { code: code, message: error });
    }

    if (req.body.password != req.body.password2) {
        return functions.doRender(req, res, "password-reset.ejs", { code: code, message: "Passwords did not match" });
    }

    if (typeof code != "string") {
        return functions.doRender(req, res, "landing.ejs", { message: "The password reset link has expired" });
    }

    User.findOne({ "local.resetCode": code }).exec()
        .then(user => {
            // code does not exist or is expired, just go to the login page
            if (!user || !user.local || !user.local.resetExpiryTime)
                return functions.doRender(req, res, "landing.ejs", { message: "The password reset link has expired" });

            // make sure code is not expired
            const expiry = new Date(user.local.resetExpiryTime).getTime();
            if (Date.now() > expiry)
                return functions.doRender(req, res, "password-reset.ejs", { code: code, message: "Passwords did not match" });

            const error = FormUtils.checkPasswordStrength(req.body.password);
            if (error) {
                return functions.doRender(req, res, "password-reset.ejs", { code: code, message: error });
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

setInterval(function () {
    functions.numberOfPhoneUsedTimesReturnVal = 0;
}, 3600000);

module.exports.router = router;