const request = require('request');

let appConfig = null;

const loadConfig = function (argsv) {

  if (appConfig) {
    return Promise.resolve(appConfig);
  }

  return getDefaultKeyValueConfig()
    .then(config => {

      const cmdLineOverrides = convertArgsToKeyValuePairs(argsv);

      // Override defaults
      Object.assign(config, cmdLineOverrides);

      // Allow computed values to be overridden directly from the command line
      Object.assign(config, cmdLineOverrides);

      appConfig = getStructuredConfig(config);

      return appConfig;
    })
};

function getConfig() {
  return appConfig;
}

function getStructuredConfig(keyValueConfig) {
  return {
    hostname: process.env.NODE_ENV === 'production' ? 'musicoin.org' : 'localhost',
    port: keyValueConfig.port,
    publicPagesEnabled: keyValueConfig.publicPagesEnabled,
    sessionSecret: keyValueConfig.sessionSecret,
    sessionDomain: keyValueConfig.sessionDomain,
    serverEndpoint: keyValueConfig.authCallbackEndpoint,
    autoFollowUserId: keyValueConfig.musicoinAutoFollowUserId,
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
    ipSessionChangeTimeout: 1000 * 30,
    playbackLinkTTLMillis: 3000 * 60,
    freePlayDelay: 1000 * 60, //let's increase the free play delay to a few more seconds so that people don't switch as often
    musicoinAdminProfile: keyValueConfig.musicoinAdminProfile,
    termsOfUseVersion: keyValueConfig.termsOfUseVersion,
    database: {
      url: `${keyValueConfig.mongoEndpoint}/musicoin-org`,
      pendingReleaseIntervalMs: 3000
    },
    redis: {
      url: `${keyValueConfig.redisEndpoint}?db=0`,
    },
    streaming: {
      tracks: keyValueConfig.streamingTracksLocation,
      org: keyValueConfig.streamingOrgFiles,
      segments: keyValueConfig.streamingSegments,
      legacyToken: keyValueConfig.legacyToken
    },
    ipfs: {
      ipfsHost: keyValueConfig.ipfsReadEndpoint,
      ipfsAddUrl: `${keyValueConfig.ipfsAddEndpoint}/api/v0/add`,
    },
    ui: {
      admin: {
        markAsAbuse: `This track was reported as abuse and is temporarily locked.  Please contact copyright@musicoin.org.ai with any relevant documentation to resolve.`,
        unmarkAsAbuse: `The abuse flag on this track has been removed.`
      },
      thread: {
        newMessages: 100,
      },
      feed: {
        newMessages: 24,
        newReleases: 9,
        topPlayLastWeek: 10,
        topTippedLastWeek: 10,
        newArtists: 12,
        myPlays: 3
      },
      home: {
        newReleases: 6,
        newArtists: 6,
        topPlayLastWeek: 6,
        topTippedLastWeek: 6,
      },
      rss: {
        newReleases: {
          title: 'Musicoin - New Releases',
          items: 10,
          description: 'Find new music on Musicoin.org',
          id: 'https://musicoin.org/',
          link: 'https://musicoin.org/',
          image: 'https://musicoin.org/images/thumbnail.png',
          copyright: 'All rights reserved 2017, Musicoin.org',
          author: {
            name: 'Musicoin.org',
            link: 'https://musicoin.org'
          }
        },
        dailyTopTipped: {
          title: 'Musicoin - Daily Top Tipped',
          items: 10,
          description: 'Find new music on Musicoin.org',
          id: 'https://musicoin.org/',
          link: 'https://musicoin.org/',
          image: 'https://musicoin.org/images/thumbnail.png',
          copyright: 'All rights reserved 2017, Musicoin.org',
          author: {
            name: 'Musicoin.org',
            link: 'https://musicoin.org'
          }
        }
      }
    },
    musicoinApi: {
      ipfsHost: keyValueConfig.ipfsReadEndpoint,
      apiHost: keyValueConfig.musicoinApiEndpoint,
      getProfile: `${keyValueConfig.musicoinApiEndpoint}/artist/profile`,
      getLicenseDetails: `${keyValueConfig.musicoinApiEndpoint}/license/detail`,
      getKey: `${keyValueConfig.musicoinApiEndpoint}/license/ppp`,
      distributeLicenseBalance: `${keyValueConfig.musicoinApiEndpoint}/license/distributeBalance`,
      getTransactionStatus: `${keyValueConfig.musicoinApiEndpoint}/tx/status`,
      publishProfile: `${keyValueConfig.musicoinApiEndpoint}/artist/profile`,
      sendFromProfile: `${keyValueConfig.musicoinApiEndpoint}/artist/send`,
      pppFromProfile: `${keyValueConfig.musicoinApiEndpoint}/artist/ppp`,
      sendRewardMin: `${keyValueConfig.musicoinApiEndpoint}/rewardmin `,
      sendRewardMax: `${keyValueConfig.musicoinApiEndpoint}/rewardmax`,
      sendRewardExtraPPP: `${keyValueConfig.musicoinApiEndpoint}/rewardppp`,
      releaseLicense: `${keyValueConfig.musicoinApiEndpoint}/license`,
      updateLicense: `${keyValueConfig.musicoinApiEndpoint}/license/update`,
      getClientBalance: `${keyValueConfig.musicoinApiEndpoint}/client/balance`,
      getAccountBalance: `${keyValueConfig.musicoinApiEndpoint}/balance`,
      clientID: keyValueConfig.musicoinApiClientId,
      defaultProfileIPFSImage: keyValueConfig.defaultProfileIPFSImage,
      messagebirdID: keyValueConfig.messagebirdID,
      bootSession: keyValueConfig.bootSession,
      whiteLocalIpList: keyValueConfig.whiteLocalIpList,
      baseUrl: keyValueConfig.baseUrl,
      regionalAccount: keyValueConfig.regionalAccount
    },
    exchangeRateService: {
      endpoint: "https://api.coinmarketcap.com/v1/ticker/musicoin/",
      link: "https://coinmarketcap.com/currencies/musicoin/",
      cacheTTL: 1000 * 60 * 5,
      disclaimer: "For informational purposes only, based on current price reported by coinmarketcap.com. Does not represent a promise by Musicoin to buy/sell at this price."
    },
    trackingAccounts: [
      { name: "Miner-1 (Dev Fund)", address: "0x13559ecbdbf8c32d6a86c5a277fd1efbc8409b5b" },
      { name: "Miner-2", address: "0x55a00bc3b44e84728091d0a8c80400a08bcb6a43" },
      { name: "Miner-3", address: "0x25025d5299df92bea6256f35758275c606156253" },
      { name: "Miner-4 (im)", address: "0xf9ef1d523a204ea9e8f695dbd83513cd27791502" },
      { name: "Miner-5 (dp)", address: "0x473ac76523d7ae51b77b2f25542eb5c4c63950c9" },
      { name: "Miner-6 (bb)", address: "0x7ef7dc5f996b21588fa6cb726a29a8296b28bf08" },
      { name: "Hot wallet (PPP)", address: "0xfef55843244453abc7e183d13139a528bdfbcbed" },
      { name: "Publisher", address: "0x6e1d33f195e7fadcc6da8ca9e36d6d4d717cf504" },
      { name: "Test Publisher and Hot Wallet", address: "0xf527a9a52b77f6c04471914ad57c31a8ae104d71" },

    ],
    auth: {
      'googleAuth': {
        'clientID': keyValueConfig.googleClientId,
        'clientSecret': keyValueConfig.googleClientSecret,
        'callbackURL': `${keyValueConfig.authCallbackEndpoint}/auth/google/callback`
      },
      'twitterAuth': {
        'consumerKey': keyValueConfig.twitterClientId,
        'consumerSecret': keyValueConfig.twitterClientSecret,
        'callbackURL': `${keyValueConfig.authCallbackEndpoint}/auth/twitter/callback`
      },
      'soundcloudAuth': {
        'clientID': keyValueConfig.soundcloudClientId,
        'clientSecret': keyValueConfig.soundcloudClientSecret,
        'callbackURL': keyValueConfig.soundcloudCallbackEndpoint
      },
      'facebookAuth': {
        'clientID': keyValueConfig.facebookClientId,
        'clientSecret': keyValueConfig.facebookClientSecret,
        'callbackURL': `${keyValueConfig.authCallbackEndpoint}/auth/facebook/callback`
      },
      passwordResetLinkTimeout: 1000 * 60 * 60
    },
    captcha: {
      secret: keyValueConfig.captchaSecret,
      url: "https://www.google.com/recaptcha/api/siteverify"
    },
    certificate: {
      approveDomains: keyValueConfig.domains.split(',').map(s => s.trim()).filter(s => s)
    },
    cors: {
      origin: keyValueConfig.corsDomains
    },
    emailVerificationLinkTimeout: 60 * 60 * 24 * 3 // in seconds, for redis
  };
}

function convertArgsToKeyValuePairs(argsv) {
  const config = {};
  if (argsv) {
    argsv.forEach(function (val, index, array) {
      if (val.startsWith("--")) {
        config[val.substr(2)] = array[index + 1];
      }
    });
  }
  return config;
}

function getInstanceVariables() {
  // curl "http://metadata.google.internal/computeMetadata/v1/instance/attributes/?recursive=true" -H "Metadata-Flavor: Google" | less
  return new Promise(function (resolve, reject) {
    request({
      url: "http://metadata.google.internal/computeMetadata/v1/instance/attributes/?recursive=true&alt=json",
      json: true,
      headers: {
        "Metadata-Flavor": "Google"
      }
    }, function (error, response, result) {
      if (error) {
        reject(new Error(`Failed to load instance variables: ${error}`));
      }
      else if (response.statusCode != 200) {
        reject(new Error(`Failed to load instance variables: ${response}`));
      }
      else {
        console.log(`Successfully retrieved values from google metadata service: ${JSON.stringify(result, null, 2)}`);
        resolve(result);
      }
    })
  }.bind(this))
    .catch(err => {
      console.log(`Error getting instance variables: ${err}`)
      return {}
    });
}

function getDefaultKeyValueConfig() {
  return getInstanceVariables()
    .then(instanceVars => {
      let env = Object.assign(instanceVars, process.env);
      return {
        port: env.PORT || 3000,
        publicPagesEnabled: env.PUBLIC_PAGES_ENABLED || false,
        musicoinAdminProfile: env.MUSICOIN_ADMIN_PROFILE || "0x65e7175dfcc9d1806863e989a347bf269df973b6",
        musicoinAutoFollowUserId: env.MUSICOIN_AUTO_FOLLOW_USER_ID || "5920465fb96d777b14888cad",

        musicoinApiEndpoint: env.MUSICOIN_API_ENDPOINT || "http://localhost:8082",
        musicoinApiClientId: env.MUSICOIN_CLIENT_ID || "clientID",

        mongoEndpoint: env.MONGO_ENDPOINT || "mongodb://localhost",

        ipfsReadEndpoint: env.IPFS_READ_ENDPOINT || "http://localhost:8080",
        ipfsAddEndpoint: env.IPFS_ADD_ENDPOINT || 'http://localhost:5001',

        sessionSecret: env.SESSION_SECRET || '329nsdvkjns9081234)(*)(*#(',

        captchaSecret: env.CAPTCHA_SECRET || 'captchaSecret',

        authCallbackEndpoint: env.AUTH_CALLBACK_ENDPOINT || "http://localhost:3000",
        googleClientId: env.GOOGLE_CLIENT_ID || "yourClientId",
        googleClientSecret: env.GOOGLE_SECRET || "yourClientSecret",

        twitterClientId: env.TWITTER_CLIENT_ID || "yourClientId",
        twitterClientSecret: env.TWITTER_SECRET || "yourClientSecret",

        facebookClientId: env.FACEBOOK_CLIENT_ID || "yourClientId",
        facebookClientSecret: env.FACEBOOK_SECRET || "yourClientSecret",

        soundcloudClientId: env.SOUNDCLOUD_CLIENT_ID || "yourClientId",
        soundcloudClientSecret: env.SOUNDCLOUD_SECRET || "yourClientSecret",
        soundcloudCallbackEndpoint: env.SOUNDCLOUD_CALLBACK_ENDPOINT || `http://alpha.musicoin.org/auth/soundcloud/callback`,

        domains: env.CERTIFICATE_DOMAINS || "musicoin.org,orbiter.musicoin.org",

        termsOfUseVersion: env.TERMS_OF_USE_VERSION || "1.0",

        redisEndpoint: env.REDIS_ENDPOINT || "redis://localhost:6379",

        defaultProfileIPFSImage: env.IPSFS_IMAGE || "ipfs://QmQTAh1kwntnDUxf8kL3xPyUzpRFmD3GVoCKA4D37FK77C",

        messagebirdID: env.MESSAGEBIRD_ID || "G9U8C06UgzptD0AmsnuL1E8En",

        bootSession: env.BOOTSESSION || ["4i_eBdaFIuXXnQmPcD-Xb5e1lNSmtb8k", "Et_OEXYXR0ig-8yLmXWkVLSr8T7HM_y1"],

        whiteLocalIpList: env.LOCAL_IP || ['127.0.0.1', 'localhost', '10.0.2.2'],

        baseUrl: env.BASE_URL || 'https://musicoin.org',

        sessionDomain: env.SESSION_DOMAIN || '.musicoin.org',

        corsDomains: env.CORS || ['https://musicoin.org', 'https://www.musicoin.org', 'https://www.twitter.com', 'https://twitter.com', 'https://staging.musicoin.org', 'https://forum.musicoin.org'],

        streamingTracksLocation: env.STREAMING_TRACKS || '/var/www/mcorg/streaming-storage/tracks',

        streamingSegments: env.STREAMING_SEGMENTS || '23',

        streamingOrgFiles: env.STREAMING_ORG_FILES || '/var/www/mcorg/streaming-storage/org',

        regionalAccount: env.REGIONAL_ACCOUNT || ['0x9fa5bd7c26e9dfc0e17846866389aca200c4e941', '0x610ec47329c28a85f006b236e433b4f98074ba60'],

        legacyToken: env.LEGACY_TOKEN || 'lonuy4Suzahghiech3ung0eiRuMax5'

      };
    });
}

module.exports.loadConfig = loadConfig;
module.exports.getConfig = getConfig;
