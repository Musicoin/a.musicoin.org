import * as mongoose from 'mongoose';

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
  },
  votesCount: {
    type: Number,
    default: 1
  }
});

SongVoteSchema.index({ user: 1, songAddress: 1 }, { unique: true });

const SongVote = module.exports = mongoose.model('SongVote', SongVoteSchema);