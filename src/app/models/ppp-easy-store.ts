import * as mongoose from 'mongoose';

module.exports = mongoose.model('EasyStore', mongoose.Schema({
  ip: {
    type: String,
    index: true
  },
  user: {
    type: String,
    index: true
  },
  wallet: {
    type: String,
    index: true
  },
  track: {
    type: String,
    index: true
  },
  agent: {
    type: String,
    index: true
  },
  date: {
    type: Date,
    default: Date.now,
    index: true
  }
}));