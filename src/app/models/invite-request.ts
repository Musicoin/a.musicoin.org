import * as mongoose from 'mongoose';
// const mongoose1 = require('mongoose');

// create the model for users and expose it to our app
module.exports = mongoose.model('InviteRequest', mongoose.Schema({
  email: String,
  requestDate: {
    type: Date,
    default: Date.now
  }
}));