import * as mongoose from 'mongoose';

module.exports = mongoose.model('EmailConfirmation', mongoose.Schema({
  email: String,
  code: String,
  date: {
    type: Date,
    default: Date.now
  }
}));