"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const mongoose = require("mongoose");
const SongVoteSchema = mongoose.Schema({
    type: {
        type: String,
        enum: ['UP_VOTE', 'DOWN_VOTE']
    },
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },
    songAddress: {
        type: String
    },
    createdAt: {
        type: Date,
        default: Date.now
    }
});
SongVoteSchema.index({ user: 1, songAddress: 1 });
const SongVote = module.exports = mongoose.model('SongVote', SongVoteSchema);
//# sourceMappingURL=song-vote.js.map