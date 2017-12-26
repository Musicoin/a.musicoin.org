import ServiceBase from './service-base';
import MusicoinError from '../../../error';
import { toObjectId } from '../../../db';
import { getLogger, getMethodEndLogger } from '../../../logger';

const logger = getLogger('UserService');
const User = require('../../models/user');

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

  getUser(options: {_id: string}) {

    let methodEndLogger = getMethodEndLogger(logger, '#getUserById', options);

    if (!options || typeof options !== 'object') {
      return methodEndLogger(new MusicoinError('Invalid input parameters'));
    }

    if (typeof options._id !== 'string' || !options._id.trim()) {
      return methodEndLogger(new MusicoinError('Invalid user id'));
    }

    let query = { _id: toObjectId(options._id)};

    return User.findOne(query)
      .then(methodEndLogger, (error) => methodEndLogger(error, new MusicoinError('Server Error. Please try again.')));

  }

}