import * as mongoose from 'mongoose';
import * as mongodbErrorHandler from 'mongoose-mongodb-errors';
import * as pino from 'pino';

const logger = pino().child({ module: 'Database' });

module.exports = function initialize(app, config) {

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
    logger.info('Connection Established');
  });

  mongoose.connection.on('reconnected', () => {
    logger.info('Connection Reestablished');
  });

  mongoose.connection.on('disconnected', () => {
    logger.error('Connection Disconnected');
  });

  mongoose.connection.on('close', () => {
    logger.error('Connection Closed');
  });

  mongoose.connection.on('error', (error) => {
    logger.error('Connection error', error);
  });

  return mongoose;
};