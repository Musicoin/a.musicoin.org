import * as mongoose from 'mongoose';
// const mongoose1 = require('mongoose');

// create the model for users and expose it to our app
module.exports = mongoose.model('TrackMessage', mongoose.Schema({
  artistAddress: {
    type: String,
    index: true,
  },
  contractAddress: {
    type: String,
    index: true,
  },
  sender: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  release: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Release'
  },
  message: String,
  tips: {
    type: Number,
    default: 0
  },
  timestamp: {
    type: Date,
    default: Date.now,
    index: true
  }
}));