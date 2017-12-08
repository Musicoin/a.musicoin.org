import * as mongoose from 'mongoose';

const SongVote = module.exports = mongoose.model('SongVote', mongoose.Schema({
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
}));

SongVote.index({ user: 1, songAddress: 1 });