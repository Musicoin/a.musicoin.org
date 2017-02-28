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

  facebookClientId: process.env.FACEBOOK_CLIENT_ID || "yourClientId",
  facebookClientSecret: process.env.FACEBOOK_SECRET || "yourClientSecret",

  soundcloudClientId: process.env.SOUNDCLOUD_CLIENT_ID || "yourClientId",
  soundcloudClientSecret: process.env.SOUNDCLOUD_SECRET || "yourClientSecret",
  soundcloudCallbackEndpoint: process.env.SOUNDCLOUD_CALLBACK_ENDPOINT || `http://alpha.musicoin.org/auth/soundcloud/callback`,

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
    getAccountBalance: `${keyValueConfig.musicoinApiEndpoint}/balance`,
    clientID: keyValueConfig.musicoinApiClientId,
    clientSecret: keyValueConfig.musicoinApiClientSecret
  },
  rewards: {
    forSendingInvite: 0,
    forAcceptingInvite: 10,
    forInviteeJoining: 10,
    forInviteeReleasing: 0,
  },
  trackingAccounts: [
    {name: "Miner-1 (Dev Fund)", address: "0x13559ecbdbf8c32d6a86c5a277fd1efbc8409b5b"},
    {name: "Miner-2", address: "0x55a00bc3b44e84728091d0a8c80400a08bcb6a43"},
    {name: "Miner-3", address: "0x25025d5299df92bea6256f35758275c606156253"},
    {name: "Miner-4 (im)", address: "0xf9ef1d523a204ea9e8f695dbd83513cd27791502"},
    {name: "Miner-5 (dp)", address: "0x473ac76523d7ae51b77b2f25542eb5c4c63950c9"},
    {name: "Miner-6 (bb)", address: "0x7ef7dc5f996b21588fa6cb726a29a8296b28bf08"},
    {name: "Hot wallet (PPP)", address: "0xfef55843244453abc7e183d13139a528bdfbcbed"},
    {name: "Publisher", address: "0x6e1d33f195e7fadcc6da8ca9e36d6d4d717cf504"},
    {name: "Dev. Publisher and Hot Wallet", address: "0xf527a9a52b77f6c04471914ad57c31a8ae104d71"},

  ],
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
    },
    'facebookAuth'  : {
      'clientID'    : keyValueConfig.facebookClientId,
      'clientSecret': keyValueConfig.facebookClientSecret,
      'callbackURL' : `${keyValueConfig.authCallbackEndpoint}/auth/facebook/callback`
    }
  },
  certificate: {
    approveDomains: keyValueConfig.domains.split(',').map(s => s.trim()).filter(s => s)
  }
};
module.exports = config;