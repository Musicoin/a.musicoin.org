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
    email: String,
    password: String,
  },
  facebook: {
    id: String,
    token: String,
    email: String,
    name: String
  },
  twitter: {
    id: String,
    token: String,
    displayName: String,
    username: String,
    picture: String
  },
  google: {
    id: String,
    token: String,
    email: String,
    name: String,
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
    genres: [String],
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
  invite: {
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
    claimed: {
      type: Boolean,
      default: false
    }
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