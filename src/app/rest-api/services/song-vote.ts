import ServiceBase from './service-base';
import MusicoinError from '../../../error';
import { toObjectId } from '../../../db';
import serviceEventEmitter from '../../rest-api/eventing';
import { SONG_VOTE_ADDED, SONG_VOTE_REMOVED } from '../../rest-api/eventing/events';
import { getLogger, getMethodEndLogger } from '../../../logger';


const SongVote = require('../../models/song-vote');
const User = require('../../models/user');
const logger = getLogger('SongVoteService');

export default class SongVoteService implements ServiceBase {

  constructor() {

  }

  add(options: { user: string, songAddress: string, type: string }) {

    let methodEndLogger = getMethodEndLogger(logger, '#add', options);

    if (typeof options.user !== 'string' || !options.user.trim()) {
      return methodEndLogger(new MusicoinError('Invalid user id'));
    }

    if (typeof options.songAddress !== 'string' || !options.songAddress.trim()) {
      return methodEndLogger(new MusicoinError('Invalid track address'));
    }

    return User.findOne({ _id: toObjectId(options.user.toString()) }, { voteMultiplier: 1 })
      .then((user) => {

        if (!user) {
          return Promise.reject(new MusicoinError('User not found'));
        }

        return SongVote.create({
          user: user._id,
          songAddress: options.songAddress,
          type: options.type,
          votesCount: user.voteMultiplier
        });

      })
      .then((vote) => {

        serviceEventEmitter.emit(SONG_VOTE_ADDED, vote);

        return methodEndLogger(vote);

      }, (error) => {

        if (error.message.indexOf('E11000 duplicate key error index') !== -1) {
          return this.update(options).then(methodEndLogger, methodEndLogger);
        }

        return methodEndLogger(error, new MusicoinError('Server Error. Please try again.'));

      });

  }

  remove(options: { user: string, songAddress: string }) {

    let methodEndLogger = getMethodEndLogger(logger, '#remove', options);

    if (typeof options.user !== 'string' || !options.user.trim()) {
      return methodEndLogger(new MusicoinError('Invalid user id'));
    }

    if (typeof options.songAddress !== 'string' || !options.songAddress.trim()) {
      return methodEndLogger(new MusicoinError('Invalid track address'));
    }

    return SongVote.findOneAndRemove({
      user: toObjectId(options.user.toString()),
      songAddress: options.songAddress
    }).then((vote) => {

      serviceEventEmitter.emit(SONG_VOTE_REMOVED, vote);

      return methodEndLogger(vote);

    }, (error) => methodEndLogger(error, new MusicoinError('Server Error. Please try again.')));

  }

  getVoteByUser(options: { user: string, songAddress: string }) {

    let methodEndLogger = getMethodEndLogger(logger, '#getVoteByUser', options);

    if (options.user && (typeof options.user !== 'string' || !options.user.trim())) {
      return methodEndLogger(new MusicoinError('Invalid user id'));
    }

    if (typeof options.songAddress !== 'string' || !options.songAddress.trim()) {
      return methodEndLogger(new MusicoinError('Invalid track address'));
    }

    SongVote.findOne({
        user: toObjectId(options.user.toString()),
        songAddress: options.songAddress
      }).select('type', 'user').exec()
      .then(methodEndLogger, (error) => methodEndLogger(error, new MusicoinError('Server Error. Please try again.')));

  }

  private update(options: { user: string, songAddress: string, type: string }) {

    let methodEndLogger = getMethodEndLogger(logger, '#update', options);

    return SongVote.findOneAndUpdate({
        user: toObjectId(options.user.toString()),
        songAddress: options.songAddress
      }, { type: options.type })
      .then((result) => {

        let vote = result._doc;

        if (vote.type !== options.type) {
          serviceEventEmitter.emit(SONG_VOTE_REMOVED, vote);
          serviceEventEmitter.emit(SONG_VOTE_ADDED, { ...vote, type: options.type });
        }

        return methodEndLogger(options);

      }, (error) => methodEndLogger(error, new MusicoinError('Server Error. Please try again.')));

  }

}