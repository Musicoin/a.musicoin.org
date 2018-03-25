const logrotator = require('logrotator');
const morgan = require('morgan');
const fs = require('fs');
const path = require('path');

// check file rotation every 5 minutes, and rotate the file if its size exceeds 10 mb.
// keep only 3 rotated files and compress (gzip) them.
const defaultRotationConfig = { schedule: '5m', size: '10m', compress: true, count: 3 };

interface RotationConfig {
  schedule: string,
  size: string,
  compress: boolean,
  count: number
}

interface LogConfig {
  logDirectory: string,
  logFileName: string,
  rotationConfig: RotationConfig
}

/**
 *
 * @param app
 * @param config A JSON config:
 * {
 *    logDirectory: path
 *    logFileName: filename, to be created in logDirectory
 *    rotationConfig: logrotator config, eg. {schedule: '5m', size: '10m', compress: true, count: 3}
 * }
 */
// use the global rotator
export function configure(app, config: LogConfig) {
  const logDirectory = config.logDirectory;
  const logFileName = config.logFileName;
  const logFile = path.join(logDirectory, logFileName);
  const rotationConfig = config.rotationConfig || defaultRotationConfig;
  const rotator = logrotator.rotator;

  rotator.register(logFile, rotationConfig);
  rotator.on('error', function (err) {
    console.log('oops, an error occured!');
  });

  // 'rotate' event is invoked whenever a registered file gets rotated
  rotator.on('rotate', function (file) {
    console.log('file ' + file + ' was rotated!');
  });

  // ensure log directory exists
  fs.existsSync(logDirectory) || fs.mkdirSync(logDirectory)
  // create a write stream (in append mode)
  const accessLogStream = fs.createWriteStream(logFile, { flags: 'a' })

  // setup the logger
  app.use(morgan('combined', { stream: accessLogStream }))
}