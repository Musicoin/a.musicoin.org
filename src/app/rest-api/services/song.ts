import ServiceBase from './service-base';
import MusicoinError from '../../../error';
import { toObjectId } from '../../../db';
import serviceEventEmitter from '../../rest-api/eventing';
import { SONG_VOTE_ADDED, SONG_VOTE_REMOVED } from '../../rest-api/eventing/events';
import { getLogger, getMethodEndLogger } from '../../../logger';
import { songVote as songVoteService } from '../../rest-api/services';

const logger = getLogger('SongService');
const Release = require('../../models/release');

export default class SongService implements ServiceBase {

  constructor() {

    serviceEventEmitter.on(SONG_VOTE_ADDED, (data) => this.incrementVoteCount(data));
    serviceEventEmitter.on(SONG_VOTE_REMOVED, (data) => this.decrementVoteCount(data));

  }

  incrementVoteCount(options) {

    let methodEndLog = getMethodEndLogger(logger, '#incrementVoteCount', options);

    let updates = {
      $inc: {
        'votes.up': 0,
        'votes.down': 0
      }
    };

    if (options.type === 'UP_VOTE') {
      updates.$inc['votes.up'] = options.votesCount;
    } else {
      updates.$inc['votes.down'] = options.votesCount;
    }

    return Release.update({
        contractAddress: options.songAddress
      }, updates)
      .then(methodEndLog, (error) => methodEndLog(error, new MusicoinError('Server Error. Please try again.')));

  }

  decrementVoteCount(options) {

    let methodEndLog = getMethodEndLogger(logger, '#decrementVoteCount', options);

    let updates = {
      $inc: {
        'votes.up': 0,
        'votes.down': 0
      }
    };

    if (options.type === 'UP_VOTE') {
      updates.$inc['votes.up'] = -options.votesCount;
    } else {
      updates.$inc['votes.down'] = -options.votesCount;
    }

    return Release.update({
        contractAddress: options.songAddress
      }, updates)
      .then(methodEndLog, (error) => methodEndLog(error, new MusicoinError('Server Error. Please try again.')));

  }

  getVoteStats(options: { songAddress: string, viewer: string }) {

    let methodEndLog = getMethodEndLogger(logger, '#getVoteStats', options);

    let votesPromise = Release.findOne({ contractAddress: options.songAddress }).select('votes');
    let userVotePromise = options.viewer ? songVoteService.getVoteByUser({ user: options.viewer, songAddress: options.songAddress }) : Promise.resolve(null);

    return Promise.all([votesPromise, userVotePromise]).then((results) => {

      let voteStats = results[0].votes || { up: 0, down: 0 };
      let userVote = results[1];

      if (userVote) {
        voteStats.viewerVote = userVote.type;
      }

      return methodEndLog(voteStats);

    }, (error) => methodEndLog(error, new MusicoinError('Server Error. Please try again.')));

  }

}