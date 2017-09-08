var chai = require('chai');
var chaiHttp = require('chai-http');
var app = require('../src/server.js');
var expect = chai.expect;
chai.use(chaiHttp);

describe('> Main App', function() {
  it('> Main App', function(done) {
    chai.request(app)
      .get('/')
      .end(function(err, res) {
        expect(res).to.have.status(200);
        done();
      });
  });
});
describe('> Sign Up Page', function() {
  it('> Sign Up Page', function(done) {
    chai.request(app)
      .get('/welcome')
      .end(function(err, res) {
        expect(res).to.have.status(200);
        done();
      });
  });
});
describe('> How it Works', function() {
  it('How It Works Page is Up, but this is a static site', function(done) {
    chai.request(app)
      .get('/howitworks.html')
      .end(function(err, res) {
        expect(res).to.have.status(200);
        done();
      });
  });
});
describe('> Password Reset Page', function() {
  it('Password Reset page is up', function(done) {
    chai.request(app)
      .get('/login/forgot')
      .end(function(err, res) {
        expect(res).to.have.status(200);
        done();
      });
  });
});
