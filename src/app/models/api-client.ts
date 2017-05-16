import * as mongoose from 'mongoose';

module.exports = mongoose.model('APIClient', mongoose.Schema({
  name: String,
  clientId: {
    type: String,
    index: true
  },
  domains: [String],
  methods: [String],
  accountLocked: Boolean
}));