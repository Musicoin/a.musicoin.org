const chai = require('chai');
const sinon = require('sinon');
const request = require('request');
const assert = chai.assert;
const expect = chai.expect;
const RequestCache = require('../src/app/cached-request').RequestCache;
const requestCache = new RequestCache();
chai.use(require('chai-fs'));
chai.use(require('chai-as-promised'));
const os = require("os");
const cacheDir = os.tmpdir() + '/request-cache';
const fs = require("fs-extra");

var resultData = {
  testKey: "testValue"
}
var properties = {
  propTestKey: "propTestValue"
}
// could not stub caching directory, lets just make sure this never runs on production
if (process.env.NODE_ENV === 'production') {
 process.exit(); 
}

describe('Cached Request', function() {
  var url = 'www.google.com';
  var requestStub = sinon.stub(request, 'get');

  before(function() {
    if (fs.existsSync(cacheDir)){
      fs.removeSync(cacheDir);
    }
    fs.mkdirSync(cacheDir);
  });

  afterEach(function() {
    requestStub.restore();
    requestStub = sinon.stub(request, 'get');
  });
  
	describe('getJson', function() {
    it('should write cache file when called with cacheTTL set to 30 seconds and no cache file present', (done) => {
      let cacheTTL = 30;
      let error = null;
      let response = { statusCode: 200 };

      requestStub.yields(error, response, JSON.stringify(resultData));

      requestCache.getJson(url, cacheTTL, properties).then((result) => {
        assert.equal(JSON.stringify(resultData), result);
        assert.notIsEmptyDirectory(cacheDir, 'make sure directory contains a file');
        done();
      });
    });

    it('should read from cache file and not make a request and properties are the same', (done) => {
      let cacheTTL = 30;
      let error = null;
      let response = { statusCode: 400 };

      requestStub.yields(error, response, JSON.stringify(resultData));

      requestCache.getJson(url, cacheTTL, properties).then((result) => {
        assert.equal(JSON.stringify(resultData), result);
        done();
      });
    });

    it('should write a new cache file when the properties change', (done) => {
      let cacheTTL = true;
      let error = null;
      let response = { statusCode: 200 };

      requestStub.yields(error, response, JSON.stringify(resultData));

      properties.newPropTestKey = 'newPropTestValue1';

      requestCache.getJson(url, cacheTTL, properties).then((result) => {
        assert.equal(JSON.stringify(resultData), result);
        expect(cacheDir).to.be.a.directory().and.files.have.lengthOf(2);
        done();
      });
    });

    it('should send back a promise rejection with error request returns non-200 response code', () => {
      let cacheTTL = true;
      let error = null;
      let response = { statusCode: 400 };

      properties.newPropTestKey = 'newPropTestValue2';

      requestStub.yields(error, response, JSON.stringify(resultData));
      assert.isRejected(requestCache.getJson(url, cacheTTL, properties), /Request failed with status code 400/, 'request should return an error');
    });

    it('should not create a new cache file if cacheTTL is false and properties are different', (done) => {
      let cacheTTL = false;
      let error = null;
      let response = { statusCode: 200 };

      properties.newPropTestKey = 'newPropTestValue3';

      requestStub.yields(error, response, JSON.stringify(resultData));
      requestCache.getJson(url, cacheTTL, properties).then((result) => {
        assert.equal(JSON.stringify(resultData), result);
        expect(cacheDir).to.be.a.directory().and.files.have.lengthOf(3);
        done();
      });
    });
  });
});