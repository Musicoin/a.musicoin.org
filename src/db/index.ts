import * as mongoose from 'mongoose';
import * as mongodbErrorHandler from 'mongoose-mongodb-errors';

const defaultObjectId = mongoose.Types.ObjectId(); // used as return value for invalid id strings.

export function initialize(app, config) {

  mongoose.Promise = require('bluebird');
  mongoose.connect(config.database.url, {
    autoIndex: app.get('env') === 'development',
    bufferMaxEntries: 0,
    reconnectInterval: 500,
    poolSize: 10,
    reconnectTries: Number.MAX_VALUE
  });
  mongoose.plugin(mongodbErrorHandler);

  mongoose.connection.on('connected', () => {
  });

  mongoose.connection.on('reconnected', () => {
  });

  mongoose.connection.on('disconnected', () => {
  });

  mongoose.connection.on('close', () => {
  });

  mongoose.connection.on('error', (error) => {
  });

  return mongoose;
};

export function toObjectId(idString) {

  if(typeof idString !== 'string' || idString.length !== 24) {
    return defaultObjectId;
  }

  return mongoose.Types.ObjectId(idString);
};