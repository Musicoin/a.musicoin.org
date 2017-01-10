import * as mongoose from 'mongoose';
// const mongoose1 = require('mongoose');

// create the model for users and expose it to our app
module.exports = mongoose.model('Invite', mongoose.Schema({
  email: String,
  invitedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  inviteDate: {
    type: Date,
    default: Date.now
  }
}));