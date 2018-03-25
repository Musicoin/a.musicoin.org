import { toObjectId } from '../../../db';
import MusicoinError from '../../../error';
import serviceEventEmitter from '../../rest-api/eventing';
import { SONG_VOTE_ADDED, SONG_VOTE_REMOVED } from '../../rest-api/eventing/events';
import ServiceBase from './service-base';


const SongVote = require('../../models/song-vote');
const User = require('../../models/user');

export default class SongVoteService implements ServiceBase {

  constructor() {

  }

  add(options: { user: string, songAddress: string, type: string }) {


    if (typeof options.user !== 'string' || !options.user.trim()) {
      console.log('Invalid user id');
    }

    if (typeof options.songAddress !== 'string' || !options.songAddress.trim()) {
      console.log('Invalid track address');
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

        console.log(vote);

      }, (error) => {

        if (error.message.indexOf('E11000 duplicate key error index') !== -1) {
          return this.update(options);
        }

        console.log('Server Error. Please try again.');

      });

  }

  remove(options: { user: string, songAddress: string }) {

    if (typeof options.user !== 'string' || !options.user.trim()) {
      console.log('Invalid user id');
    }

    if (typeof options.songAddress !== 'string' || !options.songAddress.trim()) {
      console.log('Invalid track address');
    }

    return SongVote.findOneAndRemove({
      user: toObjectId(options.user.toString()),
      songAddress: options.songAddress
    }).then((vote) => {

      serviceEventEmitter.emit(SONG_VOTE_REMOVED, vote);

      console.log(vote);

    }, (error) => console.log('Server Error. Please try again.'));

  }

  getVoteByUser(options: { user: string, songAddress: string }) {

    if (options.user && (typeof options.user !== 'string' || !options.user.trim())) {
      console.log('Invalid user id');
    }

    if (typeof options.songAddress !== 'string' || !options.songAddress.trim()) {
      console.log('Invalid track address');
    }

    SongVote.findOne({
      user: toObjectId(options.user.toString()),
      songAddress: options.songAddress
    }).select('type', 'user').exec()
      .then(console.log('Server Error. Please try again.'));

  }

  private update(options: { user: string, songAddress: string, type: string }) {

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

        console.log(options);

      }, (error) => console.log('Server Error. Please try again.'));

  }

}