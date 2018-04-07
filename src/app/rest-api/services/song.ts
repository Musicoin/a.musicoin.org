import serviceEventEmitter from '../../rest-api/eventing';
import { SONG_VOTE_ADDED, SONG_VOTE_REMOVED } from '../../rest-api/eventing/events';
import { songVote as songVoteService } from '../../rest-api/services';
import ServiceBase from './service-base';

const Release = require('../../models/release');

export default class SongService implements ServiceBase {

  constructor() {

    serviceEventEmitter.on(SONG_VOTE_ADDED, (data) => this.incrementVoteCount(data));
    serviceEventEmitter.on(SONG_VOTE_REMOVED, (data) => this.decrementVoteCount(data));

  }

  incrementVoteCount(options) {

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
      .then(console.log('Server Error. Please try again.'));

  }

  decrementVoteCount(options) {

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
      .then(console.log('Server Error. Please try again.'));

  }

  getVoteStats(options: { songAddress: string, viewer: string }) {

    let votesPromise = Release.findOne({ contractAddress: options.songAddress }).select('votes');
    let userVotePromise = options.viewer ? songVoteService.getVoteByUser({ user: options.viewer, songAddress: options.songAddress }) : Promise.resolve(null);

    let results = Promise.all([votesPromise, userVotePromise]).then((results) => {

      let voteStats = results[0].votes || { up: 0, down: 0 };
      let userVote = results[1];

      if (userVote) {
        voteStats.viewerVote = userVote.type;
      }

      console.log(voteStats);

    }, (error) => console.log('Server Error. Please try again.'));

  }

}