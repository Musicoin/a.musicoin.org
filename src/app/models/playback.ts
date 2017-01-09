import * as mongoose from 'mongoose';
// const mongoose1 = require('mongoose');

// create the model for users and expose it to our app
module.exports = mongoose.model('Playback', mongoose.Schema({
  contractAddress: String,
  playbackDate: {
    type: Date,
    default: Date.now
  }
}));