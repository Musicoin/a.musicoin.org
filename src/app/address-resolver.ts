import {Promise} from 'bluebird';
import ReadableStream = NodeJS.ReadableStream;
const User = require('../app/models/user');
const Release = require('../app/models/release');

export class AddressResolver {
  constructor() {
  }

  resolveAddresses(selfAddress, recipients) {
    return Promise.all(recipients.map(r => this.resolveAddress(selfAddress, r)));
  }

  resolveAddress(selfAddress, recipient) {
    if (recipient.address.startsWith("0x")) {
      if (recipient.address.trim() == selfAddress) {
        recipient.alternateAddress = "my wallet";
        return Promise.resolve(recipient);
      }
      const u = User.findOne({"profileAddress": recipient.address}).exec();
      const c = Release.findOne({"contractAddress": recipient.address}).exec();
      return Promise.join(u, c, function (user, contract) {
        if (user) {
          if (user.draftProfile && user.draftProfile.artistName)
            recipient.alternateAddress = user.draftProfile.artistName;
        }
        else if (contract) {
          recipient.invalid = true;
          recipient.address = "Cannot send to another contract (yet)";
          recipient.alternateAddress = contract.title;
        }
        return recipient;
      });
    }
    else if (recipient.address.indexOf("@") != -1) {
      return User.findOne({"google.email": recipient.address.toLowerCase().trim()}).exec()
        .then(function (record) {
          if (!record || !record.profileAddress) {
            recipient.address = `Could not find address for "${recipient.address}"`;
            recipient.invalid = true;
            return recipient;
          }
          recipient.alternateAddress = recipient.address;
          recipient.address = record.profileAddress;
          return recipient;
        })
    }
    recipient.address = `Invalid address "${recipient.address}"`;
    recipient.invalid = true;
    return Promise.resolve(recipient);
  }
}