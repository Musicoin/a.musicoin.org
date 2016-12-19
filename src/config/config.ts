const musicoinApiHost = "http://localhost:8082";
const callbackHost = "http://localhost:3000";
const mongodbHost = "mongodb://localhost";
const ipfsHost = "http://localhost:8080";

const config = {
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
  },
  database: {
    url : `${mongodbHost}/musicoin-org`
  },
  ipfs: {
    ipfsHost: ipfsHost,
    ipfsAddUrl: 'http://localhost:5001/api/v0/add',
  },
  musicoinApi: {
    ipfsHost: ipfsHost,
    apiHost: musicoinApiHost,
    getProfile: `${musicoinApiHost}/artist/profile`,
    getTransactionStatus: `${musicoinApiHost}/tx/status`,
    publishProfile: `${musicoinApiHost}/artist/profile`,
    releaseLicense: `${musicoinApiHost}/license`,
    clientID: process.env.MUSICOIN_CLIENT_ID || "clientId",
    clientSecret: process.env.MUSICOIN_CLIENT_SECRET || "clientSecret"
  },
  auth: {
    'googleAuth' : {
      'clientID'      : process.env.GOOGLE_CLIENT_ID || "yourClientId", // your App ID
      'clientSecret'  : process.env.GOOGLE_SECRET || "yourClientSecret", // your App Secret
      'callbackURL'   : `${callbackHost}/auth/google/callback`
    },

    'facebookAuth' : {
      'clientID'      : process.env.FACEBOOK_CLIENT_ID, // your App ID
      'clientSecret'  : process.env.FACEBOOK_SECRET, // your App Secret
      'callbackURL'   : `${callbackHost}/auth/facebook/callback`
    },

    'twitterAuth' : {
      'consumerKey'       : 'your-consumer-key-here',
      'consumerSecret'    : 'your-client-secret-here',
      'callbackURL'       : `${callbackHost}/auth/twitter/callback`
    }
  }
};
module.exports = config;