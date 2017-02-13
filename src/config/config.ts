const keyValueConfig = {
  port: process.env.PORT || 3000,

  musicoinApiEndpoint: process.env.MUSICOIN_API_ENDPOINT || "http://localhost:8082",
  musicoinApiClientId: process.env.MUSICOIN_CLIENT_ID || "clientID",
  musicoinApiClientSecret: process.env.MUSICOIN_CLIENT_SECRET || "clientSecret",

  mongoEndpoint: process.env.MONGO_ENDPOINT || "mongodb://localhost",

  ipfsReadEndpoint: process.env.IPFS_READ_ENDPOINT || "http://localhost:8080",
  ipfsAddEndpoint: process.env.IPFS_ADD_ENDPOINT || 'http://localhost:5001',

  sessionSecret: process.env.SESSION_SECRET || '329nsdvkjns9081234)(*)(*#(',

  authCallbackEndpoint: process.env.AUTH_CALLBACK_ENDPOINT || "http://localhost:3000",
  googleClientId: process.env.GOOGLE_CLIENT_ID || "yourClientId",
  googleClientSecret: process.env.GOOGLE_SECRET || "yourClientSecret",

  twitterClientId: process.env.TWITTER_CLIENT_ID || "yourClientId",
  twitterClientSecret: process.env.TWITTER_SECRET || "yourClientSecret",

  soundcloudClientId: process.env.SOUNDCLOUD_CLIENT_ID || "yourClientId",
  soundcloudClientSecret: process.env.SOUNDCLOUD_SECRET || "yourClientSecret",
  soundcloudCallbackEndpoint: process.env.SOUNDCLOUD_CALLBACK_ENDPOINT || `https://alpha.musicoin.org/auth/soundcloud/callback`,

  domains: process.env.CERTIFICATE_DOMAINS || "alpha.musicoin.org,musicoin.org,orbiter.musicoin.org"

};


const config = {
  port: keyValueConfig.port,
  sessionSecret: keyValueConfig.sessionSecret,
  serverEndpoint: keyValueConfig.authCallbackEndpoint,
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
    url : `${keyValueConfig.mongoEndpoint}/musicoin-org`,
    pendingReleaseIntervalMs: 30*1000
  },
  ipfs: {
    ipfsHost: keyValueConfig.ipfsReadEndpoint,
    ipfsAddUrl: `${keyValueConfig.ipfsAddEndpoint}/api/v0/add`,
  },
  musicoinApi: {
    ipfsHost: keyValueConfig.ipfsReadEndpoint,
    apiHost: keyValueConfig.musicoinApiEndpoint,
    getProfile: `${keyValueConfig.musicoinApiEndpoint}/artist/profile`,
    getLicenseDetails: `${keyValueConfig.musicoinApiEndpoint}/license/detail`,
    getKey: `${keyValueConfig.musicoinApiEndpoint}/license/ppp`,
    getTransactionStatus: `${keyValueConfig.musicoinApiEndpoint}/tx/status`,
    getTransactionHistory: `${keyValueConfig.musicoinApiEndpoint}/tx/history`,
    publishProfile: `${keyValueConfig.musicoinApiEndpoint}/artist/profile`,
    sendFromProfile: `${keyValueConfig.musicoinApiEndpoint}/artist/send`,
    sendReward: `${keyValueConfig.musicoinApiEndpoint}/reward`,
    releaseLicense: `${keyValueConfig.musicoinApiEndpoint}/license`,
    getClientBalance: `${keyValueConfig.musicoinApiEndpoint}/client/balance`,
    clientID: keyValueConfig.musicoinApiClientId,
    clientSecret: keyValueConfig.musicoinApiClientSecret
  },
  rewards: {
    sentInvite: 10,
    inviteAccepted: 100
  },
  auth: {
    'googleAuth' : {
      'clientID'      : keyValueConfig.googleClientId,
      'clientSecret'  : keyValueConfig.googleClientSecret,
      'callbackURL'   : `${keyValueConfig.authCallbackEndpoint}/auth/google/callback`
    },
    'twitterAuth' : {
      'consumerKey'   : keyValueConfig.twitterClientId,
      'consumerSecret': keyValueConfig.twitterClientSecret,
      'callbackURL'   : `${keyValueConfig.authCallbackEndpoint}/auth/twitter/callback`
    },
    'soundcloudAuth' : {
      'clientID'   : keyValueConfig.soundcloudClientId,
      'clientSecret': keyValueConfig.soundcloudClientSecret,
      'callbackURL' : keyValueConfig.soundcloudCallbackEndpoint
    }
  },
  certificate: {
    approveDomains: keyValueConfig.domains.split(',').map(s => s.trim()).filter(s => s)
  }
};
module.exports = config;