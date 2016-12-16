module.exports = {
  port: 3000,
  sessionSecret: process.env.SESSION_SECRET || '329nsdvkjns9081234)(*)(*#(',
  loggingConfig: {
    logDirectory: 'logs',
    logFileName: 'musicoin.log',
    rotationConfig: {
      schedule: '5m',
      size: '10m',
      compress: true,
      count: 3
    }
  }
};