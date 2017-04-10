import * as mongoose from 'mongoose';
module.exports = mongoose.model('PendingPlayback', mongoose.Schema({
  release: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Release',
    index: true
  },
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    index: true
  },
  coins: Number,
  tx: String,
  playbackDate: {
    type: Date,
    default: Date.now,
    index: true
  },
  missingCount: {
    type: Number,
    default: 0
  }
}));