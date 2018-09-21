import * as mongoose from 'mongoose';

module.exports = mongoose.model('EasyStore', mongoose.Schema({
  full: {
    type: Object,
    index: true
  },
  ip: {
    type: String,
    index: true
  },
  wallet: {
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