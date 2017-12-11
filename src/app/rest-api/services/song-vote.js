"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const pino = require("pino");
const mongoose = require("mongoose");
const eventing_1 = require("../../rest-api/eventing");
const events_1 = require("../../rest-api/eventing/events");
const SongVote = require('../../models/song-vote');
const logger = pino().child({ module: 'SongVoteService' });
class SongVoteService {
    add(options) {
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
            eventing_1.default.emit(events_1.SONG_VOTE_ADDED, options);
            return vote;
        }, (error) => {
            logger.error('#add', options, error);
            if (error.message.indexOf('E11000 duplicate key error index') !== -1) {
                return this.update(options);
            }
            return Promise.reject({ message: 'Server Error. Please try again.' });
        });
    }
    remove(options) {
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
            eventing_1.default.emit(events_1.SONG_VOTE_REMOVED, vote);
            return vote;
        }, (error) => {
            logger.error('#remove', options, error);
            return Promise.reject({ message: 'Server Error. Please try again.' });
        });
    }
    getVoteByUser(options) {
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
    update(options) {
        logger.info('#update', options);
        return SongVote.findOneAndUpdate({
            user: mongoose.Types.ObjectId(options.user.toString()),
            songAddress: options.songAddress
        }, { type: options.type })
            .then((vote) => {
            if (vote.type !== options.type) {
                eventing_1.default.emit(events_1.SONG_VOTE_REMOVED, vote);
                eventing_1.default.emit(events_1.SONG_VOTE_ADDED, options);
            }
            return options;
        }, (error) => {
            logger.error('#update', options, error);
            return Promise.reject({ message: 'Server Error. Please try again.' });
        });
    }
}
exports.default = SongVoteService;
//# sourceMappingURL=song-vote.js.map