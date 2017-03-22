import * as mongoose from 'mongoose';

// create the model for users and expose it to our app
module.exports = mongoose.model('IPFSResource', mongoose.Schema({
  hash: String,
  dateAdded: {
    type: Date,
    default: Date.now,
    index: true
  }
}));