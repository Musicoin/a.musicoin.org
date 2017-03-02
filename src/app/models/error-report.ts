import * as mongoose from 'mongoose';

// create the model for users and expose it to our app
module.exports = mongoose.model('ErrorReport', mongoose.Schema({
  licenseAddress: String,
  userProfileAddress: String,
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  errorCode: String,
  errorContext: String,
  date: {
    type: Date,
    default: Date.now
  }
}));