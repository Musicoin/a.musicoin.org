import * as pino from 'pino';
import * as mongoose from 'mongoose';

import { songVote as songVoteService } from '../../rest-api/services';
import serviceEventEmitter from '../../rest-api/eventing';
import { SONG_VOTE_ADDED, SONG_VOTE_REMOVED } from '../../rest-api/eventing/events';


const Release = require('../../models/release');
const logger = pino().child({ module: 'SongService' });

export default class SongService {

  constructor() {

    serviceEventEmitter.on(SONG_VOTE_ADDED, (data) => this.incrementVoteCount(data));
    serviceEventEmitter.on(SONG_VOTE_REMOVED, (data) => this.decrementVoteCount(data));

  }

  incrementVoteCount(options) {

    logger.info('#incrementVoteCount', options);

    let updates = {
      $inc: {
        up: 0,
        down: 0
      }
    };

    if (options.type === 'UP_VOTE') {
      updates.$inc.up = 1;
    } else {
      updates.$inc.down = 1;
    }

    return Release.update({
        contractAddress: options.songAddress
      }, updates)
      .then((result) => {

        logger.info('#incrementVoteCount done', options, result);

        return result;

      }, (error) => {

        logger.error('#incrementVoteCount', options, error);

        return Promise.reject('Server Error. Please try again.');

      });

  }

  decrementVoteCount(options) {

    logger.info('#decrementVoteCount', options);

    let updates = {
      $inc: {
        up: 0,
        down: 0
      }
    };

    if (options.type === 'UP_VOTE') {
      updates.$inc.up = -1;
    } else {
      updates.$inc.down = -1;
    }

    return Release.update({
        contractAddress: options.songAddress
      }, updates)
      .then((result) => {

        logger.info('#decrementVoteCount done', options, result);

        return result;

      }, (error) => {

        logger.error('#decrementVoteCount', options, error);

        return Promise.reject('Server Error. Please try again.');

      });

  }

  getVoteStats(options: { songAddress: string, viewer: string }) {

    logger.info('#getVoteStats', options);

    let votesPromise = Release.findOne({ contractAddress: options.songAddress }).select('votes').then(null, (error) => {

      logger.error('#getVoteStats', options, error);

      return Promise.reject('Server Error. Please try again.');

    });

    let userVotePromise = options.viewer ? songVoteService.getVoteByUser({ user: options.viewer, songAddress: options.songAddress }) : Promise.resolve(null);

    return Promise.all([votesPromise, userVotePromise]).then((results) => {

      let voteStats = results[0].votes || { up: 0, down: 0 };
      let userVote = results[1];

      if (userVote) {
        voteStats.viewerVote = userVote.type;
      }

      logger.info('#getVoteStats done', options, results);

      return voteStats;

    });

  }

}