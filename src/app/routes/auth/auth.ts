import * as crypto from 'crypto';
import * as express from 'express';
import * as passport from 'passport';
import * as qr from 'qr-image';

import { ExchangeRateProvider } from '../../extra/exchange-service';
import { MailSender } from '../../extra/mail-sender';
import { AddressResolver } from '../../internal/address-resolver';
import { MusicoinAPI } from '../../internal/musicoin-api';
import { MusicoinOrgJsonAPI } from '../../rest-api/json-api';
import { RequestCache } from '../../utils/cached-request';
import * as FormUtils from '../../utils/form-utils';

const User = require('../../models/user');


const get_ip = require('request-ip');

let Validator = require("fastest-validator");
let v = new Validator();
let emailSchema = {
    email: { type: "email" }
};
const router = express.Router();
var functions = require('../routes-functions');
const mailSender = new MailSender();
const cachedRequest = new RequestCache();
export class AuthRouter {
    constructor(musicoinApi: MusicoinAPI,
        jsonAPI: MusicoinOrgJsonAPI,
        addressResolver: AddressResolver,
        exchangeRateProvider: ExchangeRateProvider,
        config: any,
        doRender: any) {
        const messagebird = require('messagebird')(config.musicoinApi.messagebirdID);
        const baseUrl = config.musicoinApi.baseUrl;
        const User = require('../../models/user');

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

        router.post('/login/confirm-phone', function (req, res) {
            if (req.body.phone) req.body.phone = req.body.phone.trim();
            var params = {
                'body': 'Verification code: ' + functions.smsCodeReturnVal(),
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
            if (functions.numberOfPhoneUsedTimesReturnVal() >= 2) {
                console.log("Sms Verification abuse for " + req.body.phone + " detected!");
            } else if (functions.phoneNumberVal == req.body.phone) {
                functions.numberOfPhoneUsedTimes();
                console.log(functions.phoneNumberVal + " used " + functions.numberOfPhoneUsedTimesReturnVal() + " times");
                setTimeout(smsBird, 60000);
            } else {
                smsBird();
            }
        });

        router.post('/signin/newroutethat', functions.setSignUpFlag(false), functions.validateLoginEmail('/welcome'), passport.authenticate('local', {
            failureRedirect: '/welcome', // redirect back to the signup page if there is an error
            failureFlash: true // allow flash messages
        }), functions.SetSessionAfterLoginSuccessfullyAndRedirect, sendLoginEmail);

        router.post('/signup', functions.setSignUpFlag(true), functions.validateNewAccount('/welcome'), passport.authenticate('local', {
            failureRedirect: '/welcome', // redirect back to the signup page if there is an error
            failureFlash: true // allow flash messages
        }), functions.SetSessionAfterLoginSuccessfullyAndRedirect);

        router.get('/login/forgot', functions.redirectIfLoggedIn('/loginRedirect'), (req, res) => {
            doRender(req, res, "password-forgot.ejs", {});
        });

        router.post('/connect/email', functions.setSignUpFlag(true), functions.validateNewAccount('/connect/email'), passport.authenticate('local', {
            failureRedirect: '/connect/email', // redirect back to the signup page if there is an error
            failureFlash: true // allow flash messages
        }), functions.SetSessionAfterLoginSuccessfullyAndRedirectProfile);

        router.post('/login/music', (req, res) => {
            const email = req.body.email || "";
            if (v.validate({ email: req.body.email }, emailSchema) == false)
                return doRender(req, res, "landing-login.ejs", { message: "Invalid email address: " + req.body.email });

            return doRender(req, res, "landing-login-final.ejs", { email: req.body.email });
        });

        router.post('/login/forgot', (req, res) => {
            const email = req.body.email || "";
            if (v.validate({ email: email }, emailSchema) == false) return doRender(req, res, "password-forgot.ejs", { message: "Invalid email address: " + email });

            functions.checkCaptcha(req)
                .then(captchaOk => {
                    if (!captchaOk) {
                        return
                    } else {
                        User.findOne({ "local.email": email }).exec()
                            .then(user => {
                                if (user == null) return doRender(req, res, "password-reset.ejs", { message: "User not found or probably you used email that is used for google authentification: " + email });
                                user.local.resetExpiryTime = Date.now() + config.auth.passwordResetLinkTimeout;
                                user.local.resetCode = "MUSIC" + crypto.randomBytes(11).toString('hex');
                                return user.save()
                                    .then(user => {
                                        if (!user) {
                                            console.log("user.save() during password reset did not return a user record");
                                            return doRender(req, res, "landing-musician-vs-listener.ejs", { message: "An internal error occurred, please try again later" });
                                        }
                                        return mailSender.sendPasswordReset(user.local.email, config.serverEndpoint + "/login/reset?code=" + user.local.resetCode)
                                            .then(() => {
                                                return doRender(req, res, "password-forgot-restored-link.ejs", { recipient: email });
                                            })
                                    })
                                    .catch(err => {
                                        console.log(`An error occurred when sending the pasword reset email for ${email}: ${err}`);
                                        return doRender(req, res, "landing-musician-vs-listener.ejs", { message: "An internal error occurred, please try again later" });
                                    })
                            })
                    }
                });

        });

        router.post('/login/reset', (req, res) => {
            const code = String(req.body.code);
            if (!code) return doRender(req, res, "password-forgot.ejs", { message: "User not found or probably you used email that is used for google authentification" });

            const error = FormUtils.checkPasswordStrength(req.body.password);
            if (error) {
                return doRender(req, res, "password-reset.ejs", { message: error });
            }

            User.findOne({ "local.resetCode": code }).exec()
                .then(user => {
                    // code does not exist or is expired, just go to the login page
                    if (!user || !user.local || !user.local.resetExpiryTime)
                        return doRender(req, res, "password-forgot.ejs", { message: "The password reset link has expired" });

                    // make sure code is not expired
                    const expiry = new Date(user.local.resetExpiryTime).getTime();
                    console.log(expiry);
                    if (Date.now() > expiry)
                        return doRender(req, res, "password-forgot.ejs", { message: "The password reset link has expired" });

                    user.local.password = user.generateHash(req.body.password);
                    user.local.resetCode = null;
                    user.local.resetExpiryTime = null;

                    return user.save()
                        .then(() => {
                            return doRender(req, res, "landing-login.ejs", { message: "Your password has been reset. Please use new password for login." });
                        })
                })
        });



        router.get('/login/reset', functions.redirectIfLoggedIn('/loginRedirect'), (req, res) => {
            // if the code is expired, take them back to the login
            const code = req.query.code;
            const failMessage = "Your password reset code is invalid or has expired";
            if (!code) res.redirect("/welcome");
            User.findOne({ "local.resetCode": code }).exec()
                .then(user => {
                    // code does not exist, just go to the login page
                    if (!user || !user.local || !user.local.resetExpiryTime) return doRender(req, res, "landing-musician-vs-listener.ejs", { message: failMessage });

                    // make sure code is not expired
                    const expiry = new Date(user.local.resetExpiryTime).getTime();
                    if (Date.now() > expiry) return doRender(req, res, "landing-musician-vs-listener.ejs", { message: failMessage });

                    return doRender(req, res, "password-reset.ejs", { code: code });
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

        function sendLoginEmail(req, res) {
            let loginTime = new Date().toISOString().replace(/T/, ' ').replace(/\..+/, '');
            let ip = get_ip.getClientIp(req);
            let uAgent = req.headers['user-agent'];
            mailSender.sendLoginNotification(req.user.primaryEmail, loginTime, ip, uAgent)
                .then(() => console.log("Message notification sent to " + req.user.primaryEmail))
                .catch(err => `Failed to send message to ${req.user.primaryEmail}, error: ${err}`);
        }

        setInterval(function () {
            var numberOfPhoneUsedTimesVal = 0;
        }, 3600000);
    }
    getRouter() {
        return router;
    }
}