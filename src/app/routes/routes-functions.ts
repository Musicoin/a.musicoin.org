import { Promise } from 'bluebird';
import * as crypto from 'crypto';

import * as FormUtils from '../utils/form-utils';

var smsCodeVal = crypto.randomBytes(4).toString('hex');
const EmailConfirmation = require('../models/email-confirmation');
const User = require('../models/user');
let publicPagesEnabled = false;
var numberOfPhoneUsedTimesVal = 0;
var phoneNumberVal = 0;
module.exports = {
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


    adminOnly: function (req, res, next) {

        // if user is authenticated in the session, carry on
        if (this.isAdmin(req.user))
            return next();

        // if they aren't redirect them to the error page
        res.redirect('/error');
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