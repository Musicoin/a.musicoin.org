import * as mongoose from 'mongoose';

module.exports = mongoose.model('ReportActivity', mongoose.Schema({
  startDate: {
    type: Date,
    index: true
  },
  duration: {
    type: String,
    index: true
  },
  sent: Boolean,
  sentDate: {
    type: Date,
    default: Date.now
  },
  totalSent: Number,
  totalErrors: Number
}));