const chai = require('chai');
const sinon = require('sinon');
const assert = chai.assert;
const AddressResolver = require('../src/app/address-resolver').AddressResolver;
const addressResolver = new AddressResolver();
const mongoose = require('mongoose');

var addressData = {
	self: '0x65bf8086765b6e9d472c7c56e91a45efea1071ec',
	missing: '65bf8086765b6e9d472c7c56e91a45efea1071ec'
}

var recipients = getRecipients();

function getRecipients() {
  return [
    {
      address: '0x65bf8086765b6e9d472c7c56e91a45efea1071ea',
      alternateAddress: '',
      type: ''
    },
    {
      address: '0x65bf8086765b6e9d472c7c56e91a45efea1071eb',
      alternateAddress: '',
      type: ''
    },
    {
      address: '0x65Abf8086765b6e9d472c7c56e91a45efea1071ec',
      alternateAddress: '',
      type: ''
    }
  ]
}

function getExecMethod(value) {
  return function(){ 
    return new Promise((resolve, reject) => {
      resolve(value);
    });
  }
}

describe('Address Resolver', function() {
  var findOneStub = sinon.stub(mongoose.Model, 'findOne');

  afterEach(function() {
    recipients = getRecipients();
    findOneStub.restore();
    findOneStub = sinon.stub(mongoose.Model, 'findOne');
  });

	describe('resolveAddresses', function() {

		it('should set alternateAddress and type for each recipient when address starts with 0x and selfAddress matches', (done) => {
			let alternateAddress = 'my wallet';
			let type = 'artist';

			recipients[0]['address'] = addressData.self;
			recipients[1]['address'] = addressData.self;
			recipients[2]['address'] = addressData.self;

			addressResolver.resolveAddresses(addressData.self, recipients).then((recipients) => {
				assert.lengthOf(recipients, 3, 'recipients should have length of 3');
				recipients.forEach((recipient) => {
					assert.equal(recipient.alternateAddress, alternateAddress, 'alternateAddress should match ' + alternateAddress);
					assert.equal(recipient.type, type, 'type should match ' + type);
				});
				done();
			});
		});

	});

  describe('resolveAddress', function() {
    it('should set artist user type and artistName', (done) => {
      let user = { draftProfile: { artistName: 'John Lennon' } };
      user.exec = getExecMethod(user);
      findOneStub.returns(user);

      addressResolver.resolveAddress(addressData.self, recipients[0]).then((recipient) => {
        assert.equal(recipient.alternateAddress, user.draftProfile.artistName, 'artistName should match alternateAddress')
        assert.equal(recipient.type, 'artist', 'type should be set to artist');
        done();
      });
    });

    it('should set alternateAddress and type for a contract address', (done) => {
      let contract = { canReceiveFunds: true , title: 'Super'};
      let user = {};
      user.exec = getExecMethod(false);
      contract.exec = getExecMethod(contract);

      findOneStub.onCall(0).returns(user);
      findOneStub.onCall(1).returns(contract);

      addressResolver.resolveAddress(addressData.self, recipients[0]).then((recipient) => {
        assert.equal(recipient.alternateAddress, contract.title, 'alternateAddress should match contract.title')
        assert.equal(recipient.type, 'license', 'type should be set to license');
        done();
      });
    });

    it('should set address to invalid and set address msg if canReceiveFunds is false', (done) => {
      let addressMsg = 'This license does not support direct payment (must be v0.7 or newer)';
      let contract = { canReceiveFunds: false , title: 'Super'};
      let user = {};
      user.exec = getExecMethod(false);
      contract.exec = getExecMethod(contract);

      findOneStub.onFirstCall().returns(user);
      findOneStub.onSecondCall().returns(contract);

      addressResolver.resolveAddress(addressData.self, recipients[0]).then((recipient) => {
        assert.equal(recipient.alternateAddress, contract.title, 'alternateAddress should match contract.title')
        assert.equal(recipient.type, '', 'type should not be set');
        assert.equal(recipient.invalid, true, 'invalid should be true');
        assert.equal(recipient.address, addressMsg, 'address should match does not support message');
        done();
      });
    });

    it('should set address to invalid if email is not found', (done) => {
      recipients[0].address = 'test@test.org'
      let addressMsg = `Could not find address for "${recipients[0].address}"`
      let email = {};
      email.exec = getExecMethod(false);

      findOneStub.onFirstCall().returns(email);

      addressResolver.resolveAddress(addressData.self, recipients[0]).then((recipient) => {
        assert.equal(recipient.type, '', 'type should not be set');
        assert.equal(recipient.invalid, true, 'invalid should be true');
        assert.equal(recipient.address, addressMsg, 'address should match could not find message');
        done();
      });
    });

    it('should set address and alternateAddress if record for email is found', (done) => {
      recipients[0].address = 'test@test.org'
      let record = { profileAddress: recipients[1].address};
      record.exec = getExecMethod(record);

      findOneStub.onFirstCall().returns(record);

      addressResolver.resolveAddress(addressData.self, recipients[0]).then((recipient) => {
        assert.equal(recipient.alternateAddress, 'test@test.org', 'alternateAddress should match email');
        assert.equal(recipient.address, record.profileAddress, 'address should match profileAddress');
        done();
      });
    });

    it('should set address to invalid if address given does not match 0x or @', (done) => {
      recipients[0].address = '65bf8086765b6e9d472c7c56e91a45efea1071eb';
      let addressMsg = `Invalid address "${recipients[0].address}"`;

      addressResolver.resolveAddress(addressData.self, recipients[0]).then((recipient) => {
        assert.equal(recipient.invalid, true, 'invalid should be true');
        assert.equal(recipient.address, addressMsg, 'address should match invalid address message');
        done();
      });
    });
  });

  describe('lookupAddress', function() {
    it('should return my wallet if selfAddress and recipient address are the same', (done) => {
      addressResolver.lookupAddress(addressData.self, addressData.self).then((recipient) => {
        assert.equal(recipient, 'my wallet', 'recipient should match my wallet');
        done();
      });
    });

    it('should return artist name when user is found', (done) => {
      let user = { draftProfile: { artistName: 'John Lennon' } };
      user.exec = getExecMethod(user);
      findOneStub.returns(user);

      addressResolver.lookupAddress(addressData.self, recipients[0]).then((recipient) => {
        assert.equal(recipient, user.draftProfile.artistName, 'recipient should match artistName');
        done();
      });
    });

    it('should return contract title when contract is found', (done) => {
      let contract = { title: 'Super' };
      let user = {};
      user.exec = getExecMethod(false);
      contract.exec = getExecMethod(contract);

      findOneStub.onFirstCall().returns(user);
      findOneStub.onSecondCall().returns(contract);

      addressResolver.lookupAddress(addressData.self, recipients[0]).then((recipient) => {
        assert.equal(recipient, contract.title, 'alternateAddress should match contract.title')
        done();
      });
    });
  });
});