import * as mongoose from 'mongoose';
// const mongoose1 = require('mongoose');

// create the model for users and expose it to our app
module.exports = mongoose.model('Release', mongoose.Schema({
  tx: String,
  state: {
    type: String,

    enum: ['pending', 'published', 'error', 'deleted'],
    default: 'pending',
    index: true
  },
  artistName: String,
  artistAddress: String,
  title: String,
  imageUrl: String,
  canReceiveFunds: Boolean,
  releaseDate: {
    type: Date,
    default: Date.now
  },

  contractAddress: String, // non-null iff state=published
  errorMessage: String // non-null iff state=error
}));