import * as mongoose from 'mongoose';

// create the model for users and expose it to our app
module.exports = mongoose.model('TrackMessage', mongoose.Schema({
  artistAddress: {
    type: String,
    index: true,
  },
  contractAddress: {
    type: String,
    index: true,
  },
  senderAddress: {
    type: String,
    index: true,
  },
  threadId: {
    type: String,
    index: true
  },
  sender: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  release: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Release'
  },
  artist: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  replyToMessage: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'TrackMessage'
  },
  repostMessage: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'TrackMessage'
  },
  repostOriginalSender: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  replyToSender: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  message: String,
  messageType: String,
  tips: {
    type: Number,
    default: 0
  },
  timestamp: {
    type: Date,
    default: Date.now,
    index: true
  }
}));