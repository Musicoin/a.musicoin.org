import * as express from 'express';
import * as passport from 'passport';
import * as qr from 'qr-image';

import { ExchangeRateProvider } from '../../extra/exchange-service';
import { MailSender } from '../../extra/mail-sender';
import { AddressResolver } from '../../internal/address-resolver';
import { MusicoinAPI } from '../../internal/musicoin-api';
import { MusicoinOrgJsonAPI } from '../../rest-api/json-api';
import { RequestCache } from '../../utils/cached-request';

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
            doRender(req, res, "password-forgot.ejs", {});
        });

        router.get('/login/reset', functions.redirectIfLoggedIn('/loginRedirect'), (req, res) => {
            // if the code is expired, take them back to the login
            const code = req.query.code;
            const failMessage = "Your password reset code is invalid or has expired";
            if (!code) return doRender(req, res, "landing.ejs", { message: failMessage });
            User.findOne({ "local.resetCode": code }).exec()
                .then(user => {
                    // code does not exist, just go to the login page
                    if (!user || !user.local || !user.local.resetExpiryTime) return doRender(req, res, "landing.ejs", { message: failMessage });

                    // make sure code is not expired
                    const expiry = new Date(user.local.resetExpiryTime).getTime();
                    if (Date.now() > expiry) return doRender(req, res, "landing.ejs", { message: failMessage });

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

        setInterval(function () {
            var numberOfPhoneUsedTimesVal = 0;
        }, 3600000);
    }
    getRouter() {
        return router;
    }
}