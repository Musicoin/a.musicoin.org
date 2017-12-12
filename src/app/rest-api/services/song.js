"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const pino = require("pino");
const services_1 = require("../../rest-api/services");
const eventing_1 = require("../../rest-api/eventing");
const events_1 = require("../../rest-api/eventing/events");
const Release = require('../../models/release');
const logger = pino().child({ module: 'SongService' });
class SongService {
    constructor() {
        eventing_1.default.on(events_1.SONG_VOTE_ADDED, (data) => this.incrementVoteCount(data));
        eventing_1.default.on(events_1.SONG_VOTE_REMOVED, (data) => this.decrementVoteCount(data));
    }
    incrementVoteCount(options) {
        logger.info('#incrementVoteCount', options);
        let updates = {
            $inc: {
                'votes.up': 0,
                'votes.down': 0
            }
        };
        if (options.type === 'UP_VOTE') {
            updates.$inc['votes.up'] = 1;
        }
        else {
            updates.$inc['votes.down'] = 1;
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
                'votes.up': 0,
                'votes.down': 0
            }
        };
        if (options.type === 'UP_VOTE') {
            updates.$inc['votes.up'] = -1;
        }
        else {
            updates.$inc['votes.down'] = -1;
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
    getVoteStats(options) {
        logger.info('#getVoteStats', options);
        let votesPromise = Release.findOne({ contractAddress: options.songAddress }).select('votes').then(null, (error) => {
            logger.error('#getVoteStats', options, error);
            return Promise.reject('Server Error. Please try again.');
        });
        let userVotePromise = options.viewer ? services_1.songVote.getVoteByUser({ user: options.viewer, songAddress: options.songAddress }) : Promise.resolve(null);
        return Promise.all([votesPromise, userVotePromise]).then((results) => {
            let voteStats = results[0].votes || { up: 0, down: 0 };
            let userVote = results[1];
            if (userVote) {
                voteStats.viewerVote = userVote.type;
            }
            logger.info('#getVoteStats done', options, voteStats);
            return voteStats;
        });
    }
}
exports.default = SongService;
//# sourceMappingURL=song.js.map