const mongoose = require('mongoose');
const bcrypt   = require('bcrypt-nodejs');

// define the schema for our user model
const userSchema = mongoose.Schema({
  profileAddress: String,
  updatePending: {
    type: Boolean,
    index: true,
    default: false
  },
  pendingTx: String,
  local: {
    id: String,
    email: String,
    username: String,
    password: String,
  },
  facebook: {
    id: String,
    token: String,
    email: String,
    username: String,
    name: String,
    url: String,
    urlIsPublic: {
      type: Boolean,
      default: true
    }
  },
  twitter: {
    id: String,
    token: String,
    displayName: String,
    username: String,
    picture: String,
    url: String,
    urlIsPublic: {
      type: Boolean,
      default: true
    }
  },
  google: {
    id: String,
    token: String,
    email: String,
    name: String,
    url: String,
    picture: String
  },
  soundcloud: {
    id: String,
    token: String,
    name: String,
    username: String,
    picture: String
  },
  draftProfile: {
    artistName: String,
    description: String,
    social: Object,
    ipfsImageUrl: String,
    heroImageUrl: String,
    genres: [String],
    regions: [String],
    version: Number
  },
  hideProfile: Boolean,
  joinDate: {
    type: Date,
    default: Date.now
  },
  mostRecentReleaseDate: Date,
  invitesRemaining: {
    type: Number,
    default: 5
  },
  reusableInviteCode: String,
  following: [String],
  invite: {
    noReward: {
      type: Boolean,
      default: false
    },
    invitedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    invitedAs: String,
    invitedOn: {
      type: Date,
      default: Date.now
    },
    inviteCode: String,
    groupInviteCode: String,
    claimed: {
      type: Boolean,
      default: false
    },
    clicked: {
      type: Boolean,
      default: false
    }
  },
  preferences: {
    notifyOnComment: {
      type: Boolean,
      default: true
    },
    minimizeHeroInFeed: Boolean,
    activityReporting: {
      type: String,
      default: 'week'
    },
    feedFilter: String
  },
  directTipCount: {
    type: Number,
    default: 0
  },
  followerCount: {
    type: Number,
    default: 0
  },
  termsOfUseVersion: String,
  pendingInitialization: Boolean,
  blocked: Boolean,
  verified: Boolean,
  accountLocked: Boolean,
  freePlaysRemaining: {
    type: Number,
    default: 100
  },
  nextFreePlayback: Date,
  currentPlay: {
    licenseAddress: String,
    release: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Release'
    },
    encryptedKey: String
  }
});

// methods ======================
// generating a hash
userSchema.methods.generateHash = function(password) {
  return bcrypt.hashSync(password, bcrypt.genSaltSync(8), null);
};

// checking if password is valid
userSchema.methods.validPassword = function(password) {
  return bcrypt.compareSync(password, this.local.password);
};

// create the model for users and expose it to our app
module.exports = mongoose.model('User', userSchema);