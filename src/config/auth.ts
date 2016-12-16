module.exports = {
  'googleAuth' : {
    'clientID'      : process.env.GOOGLE_CLIENT_ID || "yourClientId", // your App ID
    'clientSecret'  : process.env.GOOGLE_SECRET || "yourClientSecret", // your App Secret
    'callbackURL'   : 'http://localhost:3000/auth/google/callback'
  },

  'facebookAuth' : {
    'clientID'      : process.env.FACEBOOK_CLIENT_ID, // your App ID
    'clientSecret'  : process.env.FACEBOOK_SECRET, // your App Secret
    'callbackURL'   : 'http://localhost:3000/auth/facebook/callback'
  },

  'twitterAuth' : {
    'consumerKey'       : 'your-consumer-key-here',
    'consumerSecret'    : 'your-client-secret-here',
    'callbackURL'       : 'http://localhost:3000/auth/twitter/callback'
  }
};