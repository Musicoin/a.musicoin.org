import * as mongoose from 'mongoose';

module.exports = mongoose.model('UserStats', mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    index: true
  },
  startDate: {
    type: Date,
    index: true
  },
  duration: {
    type: String,
    index: true
  },
  tipCount: {
    type: Number,
    default: 0
  },
  followCount: {
    type: Number,
    default: 0
  }
}));