import ServiceBase from './service-base';
import MusicoinError from '../../../error';
import { toObjectId } from '../../../db';
import { getLogger, getMethodEndLogger } from '../../../logger';
import { wrapper as redisWrapper } from '../../../redis';
import serviceEventEmitter from '../../rest-api/eventing';
import { SEND_EMAIL } from '../../rest-api/eventing/events';

const ConfigUtils = require('../../../config/config');
const uuidV4 = require('uuid/v4');

const logger = getLogger('UserService');
const User = require('../../models/user');
let redisClient = null;

export default class UserService implements ServiceBase {

  constructor() {

  }

  incrementVotingPower(options: { user: string, count: number }) {

    let methodEndLogger = getMethodEndLogger(logger, '#incrementVotingPower', options);

    if (!options || typeof options !== 'object') {
      return methodEndLogger(new MusicoinError('Invalid input parameters'));
    }

    if (typeof options.user !== 'string' || !options.user.trim()) {
      return methodEndLogger(new MusicoinError('Invalid user id'));
    }

    if (typeof options.count !== 'number' || !options.count) {
      return methodEndLogger(new MusicoinError('Invalid vote multiplier'));
    }

    let query = { _id: toObjectId(options.user) };
    let updates = { $inc: { voteMultiplier: options.count } };

    return User.update(query, updates)
      .then(() => methodEndLogger({ success: true }), (error) => methodEndLogger(error, new MusicoinError('Server Error. Please try again.')));

  }

  decrementVotingPower(options: { user: string, count: number }) {

    let methodEndLogger = getMethodEndLogger(logger, '#decrementVotingPower', options);

    if (!options || typeof options !== 'object') {
      return methodEndLogger(new MusicoinError('Invalid input parameters'));
    }

    if (typeof options.user !== 'string' || !options.user.trim()) {
      return methodEndLogger(new MusicoinError('Invalid user id'));
    }

    if (typeof options.count !== 'number' || !options.count) {
      return methodEndLogger(new MusicoinError('Invalid vote multiplier'));
    }

    let query = { _id: toObjectId(options.user), voteMultiplier: { $gte: options.count } };
    let updates = { $inc: { voteMultiplier: -options.count } };

    return User.update(query, updates)
      .then(() => methodEndLogger({ success: true }), (error) => methodEndLogger(error, new MusicoinError('Server Error. Please try again.')));

  }

  getUser(options: { _id: object }) {

    let methodEndLogger = getMethodEndLogger(logger, '#getUser', options);

    if (!options || typeof options !== 'object') {
      return methodEndLogger(new MusicoinError('Invalid input parameters'));
    }

    if (!options._id) {
      return methodEndLogger(new MusicoinError('Invalid user id'));
    }

    let query = { _id: options._id };

    return User.findOne(query)
      .then((user) => methodEndLogger(this.formatUserObject(user)), (error) => methodEndLogger(error, new MusicoinError('Server Error. Please try again.')));

  }

  formatUserObject(user) {

    if (!user) {
      return null;
    }

    // This method will be used in all APIs.
    // Filter out all sensitive data.
    // Private information of an user, only goes out with for the same user credentials.

    let result = {
      _id: user.id,
      isMusician: user.isMusician !== 'listener',
      isListener: user.isMusician === 'listener',
      followers: user.followerCount,
      tips: user.directTipCount,
      fullname: null,
      username: user.primaryEmail,
      picture: null,
      freePlaysRemaining: user.freePlaysRemaining,
      primaryEmail: user.primaryEmail,
      emailVerified: user.emailVerified
    };

    if (user.google && Object.keys(user.google).length > 0) {
      result.fullname = user.google.name;
      result.username = result.username || user.google.email;
      result.picture = user.google.picture ? user.google.picture : null;
    }
    // post this line, update fullname, username & picture only if not preset already
    if (user.twitter && Object.keys(user.twitter).length > 0) {
      result.fullname = result.fullname || user.twitter.displayName;
      result.username = result.username || user.twitter.username;
      result.picture = result.picture || user.twitter.picture;
    }

    if (user.facebook && Object.keys(user.facebook).length > 0) {
      result.fullname = result.fullname || user.facebook.name;
      result.username = result.username || user.facebook.email;
      result.picture = result.picture || `https://graph.facebook.com/${user.facebook.id}/picture?type=large`;
    }

    return result;

  }

  sendEmailAddressVerificationEmail(options: { _id: object }) {

    let methodEndLogger = getMethodEndLogger(logger, '#sendEmailAddressVerificationEmail', options);

    if (!options || typeof options !== 'object') {
      return methodEndLogger(new MusicoinError('Invalid input parameters'));
    }

    if (!options._id) {
      return methodEndLogger(new MusicoinError('Invalid user id'));
    }

    let query = { _id: options._id, emailVerified: false };

    return User.findOne(query, { primaryEmail: 1, emailVerified: 1 })
      .then((user) => {

        if (!user) {
          return Promise.resolve({ alreadyVerified: true });
        }

        let config = ConfigUtils.getConfig();
        let payload = {
          template: 'mail/email-verification.ejs',
          recipient: user.primaryEmail,
          subject: 'Verify your email!',
          data: { code: uuidV4(), hostname: config.hostname }
        };

        serviceEventEmitter.emit(SEND_EMAIL, payload);

        return redisWrapper.setex(`EMAIL_VERIFICATION_CODE:${payload.data.code}`, user, config.emailVerificationLinkTimeout);

      }).then(methodEndLogger, (error) => methodEndLogger(error, new MusicoinError('Server Error. Please try again.')));


  }

  verifyEmail(options: { code: string }) {

    let methodEndLogger = getMethodEndLogger(logger, '#verifyEmail', options);

    if (!options || typeof options !== 'object') {
      return methodEndLogger(new MusicoinError('Invalid input parameters'));
    }

    if (!options.code) {
      return methodEndLogger(new MusicoinError('Invalid code'));
    }

    return redisWrapper.get(options.code)
      .then((data: { _id: string }) => {
        let query = { _id: toObjectId(data._id) };
        let updates = { $set: { emailVerified: true } };
        let result = { success: true };
        return User.update(query, updates).then(() => result)
      }).then(methodEndLogger, (error) => methodEndLogger(error, new MusicoinError('Server Error. Please try again.')));

  }

  tryUpdateEmailAddress(options: { _id: object, primaryEmail: string }) {

    let methodEndLogger = getMethodEndLogger(logger, '#tryUpdateEmailAddress', options);

    if (!options || typeof options !== 'object') {
      return methodEndLogger(new MusicoinError('Invalid input parameters'));
    }

    if (!options._id) {
      return methodEndLogger(new MusicoinError('Invalid user id'));
    }

    let result = {
      success: true
    };

    if (typeof options.primaryEmail !== 'string' || !options.primaryEmail.trim()) {
      return methodEndLogger(result);
    }

    let query = {
      _id: options._id,
      primaryEmail: options.primaryEmail
    };

    return User.findOne(query, { emailVerified: 1 }).then((user) => {
      if (user) {
        return result;
      }
      return User.update({ _id: options._id }, { $set: { primaryEmail: options.primaryEmail, emailVerified: false } }).then(() => result)
    }).then(methodEndLogger, (error) => methodEndLogger(error, new MusicoinError('Server Error. Please try again.')));

  }

}