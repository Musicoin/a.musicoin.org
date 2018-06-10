import { toObjectId } from '../../../db';
import { wrapper as redisWrapper } from '../../../redis';
import serviceEventEmitter from '../../rest-api/eventing';
import { SEND_EMAIL } from '../../rest-api/eventing/events';
import ServiceBase from './service-base';
import { MailSender } from '../../extra/mail-sender';

const ConfigUtils = require('../../../config/config');
const uuidV4 = require('uuid/v4');

const User = require('../../models/user');
let redisClient = null;

export default class UserService implements ServiceBase {
  constructor(
  ) {

  }

  incrementVotingPower(options: { user: string, count: number }) {


    if (!options || typeof options !== 'object') {
      console.log('Invalid input parameters');
    }

    if (typeof options.user !== 'string' || !options.user.trim()) {
      console.log('Invalid user id');
    }

    if (typeof options.count !== 'number' || !options.count) {
      console.log('Invalid vote multiplier');
    }

    let query = { _id: toObjectId(options.user) };
    let updates = { $inc: { voteMultiplier: options.count } };

    return User.update(query, updates)
      .then(() => console.log('Server Error. Please try again.'));

  }

  decrementVotingPower(options: { user: string, count: number }) {

    if (!options || typeof options !== 'object') {
      console.log('Invalid input parameters');
    }

    if (typeof options.user !== 'string' || !options.user.trim()) {
      console.log('Invalid user id');
    }

    if (typeof options.count !== 'number' || !options.count) {
      console.log('Invalid vote multiplier');
    }

    let query = { _id: toObjectId(options.user), voteMultiplier: { $gte: options.count } };
    let updates = { $inc: { voteMultiplier: -options.count } };

    return User.update(query, updates)
      .then(() => console.log('Server Error. Please try again.'));

  }

  getUser(options: { _id: object }) {


    if (!options || typeof options !== 'object') {
      console.log('Invalid input parameters');
    }

    if (!options._id) {
      console.log('Invalid user id');
    }

    let query = { _id: options._id };

    return User.findOne(query)
      .then((user) => console.log('Server Error. Please try again.'));

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
      emailVerified: user.emailVerified,
      profileAddress: user.profileAddress
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

    if (!options || typeof options !== 'object') {
      console.log('Invalid input parameters');
    }

    if (!options._id) {
      console.log('Invalid user id');
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
        // serviceEventEmitter.emit(SEND_EMAIL, payload);
        let maHelper = new MailSender();
        maHelper.sendEmail(payload);

        return redisWrapper.setex(`EMAIL_VERIFICATION_CODE:${payload.data.code}`, config.emailVerificationLinkTimeout, user);

      }).then(console.log('Server Error. Please try again.'));


  }

  verifyEmail(options: { code: string }) {

    if (!options || typeof options !== 'object') {
      console.log('Invalid input parameters');
    }

    if (!options.code) {
      console.log('Invalid code');
    }

    return redisWrapper.get(`EMAIL_VERIFICATION_CODE:${options.code}`)
      .then((data: { _id: string, primaryEmail: string }) => {
        let query = { _id: toObjectId(data._id), primaryEmail: data.primaryEmail };
        let updates = { $set: { emailVerified: true } };
        return User.update(query, updates);
      })
      .then(() => redisWrapper.del([`EMAIL_VERIFICATION_CODE:${options.code}`]));

  }

  tryUpdateEmailAddress(options: { _id: object, primaryEmail: string }) {


    if (!options || typeof options !== 'object') {
      console.log('Invalid input parameters');
    }

    if (!options._id) {
      console.log('Invalid user id');
    }

    let result = {
      success: true
    };

    if (typeof options.primaryEmail !== 'string' || !options.primaryEmail.trim()) {
      console.log(result);
    }

    let query = {
      _id: options._id,
      primaryEmail: options.primaryEmail
    };

    return User.findOne(query, { emailVerified: 1 }).then((user) => {
      if (user) {
        return result;
      }
      return User.update({ _id: options._id }, { $set: { primaryEmail: options.primaryEmail, emailVerified: false } })
        .then(() => this.sendEmailAddressVerificationEmail({ _id: options._id }))
        .then(() => result);
    }).then(console.log('Server Error. Please try again.'));

  }

}