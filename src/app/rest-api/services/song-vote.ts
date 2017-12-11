import * as pino from 'pino';
import * as mongoose from 'mongoose';

import * as SongVote from 'app/models/song-vote';
import * as serviceEventEmitter from 'app/rest-api/eventing';
import { SONG_VOTE_ADDED, SONG_VOTE_REMOVED } from 'app/rest-api/eventing/events';


const SongVote = require('../../models/song-vote');
const logger = pino().child({ module: 'SongVoteService' });

export default class SongVoteService {

  add(options: { user: string, songAddress: string, type: string }) {

    logger.info('#add', options);

    if (typeof options.user !== 'string' || !options.user.trim()) {
      return Promise.reject({ message: 'Invalid user id' });
    }

    if (typeof options.songAddress !== 'string' || !options.songAddress.trim()) {
      return Promise.reject({ message: 'Invalid track address' });
    }

    return SongVote.create({
      user: mongoose.Types.ObjectId(options.user.toString()),
      songAddress: options.songAddress,
      type: options.type
    }).then((vote) => {

      serviceEventEmitter.emit(SONG_VOTE_ADDED, options);

      return vote;

    }, (error) => {

      logger.error('#add', options, error);

      if (error.message.indexOf('E11000 duplicate key error index') !== -1) {
        return this.update(options);
      }

      return Promise.reject({ message: 'Server Error. Please try again.' });

    });

  }

  remove(options: { user: string, songAddress: string }) {

    logger.info('#remove', options);

    if (typeof options.user !== 'string' || !options.user.trim()) {
      return Promise.reject({ message: 'Invalid user id' });
    }

    if (typeof options.songAddress !== 'string' || !options.songAddress.trim()) {
      return Promise.reject({ message: 'Invalid track address' });
    }

    return SongVote.findOneAndRemove({
      user: mongoose.Types.ObjectId(options.user.toString()),
      songAddress: options.songAddress
    }).then((vote) => {

      serviceEventEmitter.emit(SONG_VOTE_REMOVED, vote);

      return vote;

    }, (error) => {

      logger.error('#remove', options, error);

      return Promise.reject({ message: 'Server Error. Please try again.' });

    });

  }

  getVoteByUser(options: { user: string, songAddress: string }) {

    logger.info('#getVoteByUser', options);

    if (options.user && (typeof options.user !== 'string' || !options.user.trim())) {
      return Promise.reject({ message: 'Invalid user id' });
    }

    if (typeof options.songAddress !== 'string' || !options.songAddress.trim()) {
      return Promise.reject({ message: 'Invalid track address' });
    }

    SongVote.findOne({
        user: mongoose.Types.ObjectId(options.user.toString()),
        songAddress: options.songAddress
      }).select('type', 'user').exec()
      .then(null, (error) => {

        logger.error('#getVoteByUser', options, error);

        return Promise.reject({ message: 'Server Error. Please try again.' });

      });

  }

  private update(options: { user: string, song: string, type: string }) {

    logger.info('#update', options);

    return SongVote.findOneAndUpdate({
        user: mongoose.Types.ObjectId(options.user.toString()),
        songAddress: options.songAddress
      }, { type: options.type })
      .then((vote) => {

        if (vote.type !== options.type) {
          serviceEventEmitter.emit(SONG_VOTE_REMOVED, vote);
          serviceEventEmitter.emit(SONG_VOTE_ADDED, options);
        }

        return options;

      }, (error) => {

        logger.error('#update', options, error);

        return Promise.reject({ message: 'Server Error. Please try again.' });

      });

  }

}