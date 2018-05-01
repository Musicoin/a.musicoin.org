import * as mongoose from 'mongoose';

// create the model for users and expose it to our app
module.exports = mongoose.model('BlackList', mongoose.Schema({
  email: String,
  blacklistdate: {
    type: Date,
    default: Date.now
  },
  description: String
}));