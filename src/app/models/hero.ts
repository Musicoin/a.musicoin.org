import * as mongoose from 'mongoose';
// const mongoose1 = require('mongoose');

// create the model for users and expose it to our app
module.exports = mongoose.model('Hero', mongoose.Schema({
  subtitle: String,
  subtitleLink: String,
  title: String,
  titleLink: String,
  image: String,
  licenseAddress: String,
  label: String,
  startDate: Date,
  expirationDate: Date
}));