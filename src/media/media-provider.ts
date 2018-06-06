import { Promise } from 'bluebird';

const http = require('http');
const request = require('request');
const fs = require('fs');
const crypto = require('crypto');
const zlib = require('zlib');
const stream = require('stream');
const algorithm = 'aes-256-ctr';
const tmp = require('tmp');
const StreamUtils = require("./stream-utils");
const IPFSResource = require('../app/models/ipfs-resource');

// Supported formats
const RAW = "ipfs://";
const ENCRYPTED = "eipfs://";
const ZIP_ENCRYPTED = "zeipfs://";

function MediaProvider(ipfsHost, ipfsAddUrl) {
  this.ipfsReadEndpoint = ipfsHost;
  this.ipfsAddUrl = ipfsAddUrl;

  // private functions
  this._parseIpfsUrl = function (resourceUrl) {
    if (!resourceUrl) return { err: new Error("Resource URL is empty: " + resourceUrl) };
    if (resourceUrl.startsWith(ZIP_ENCRYPTED)) {
      return this._createIpfsProxyOptions(resourceUrl, ZIP_ENCRYPTED);
    }
    else if (resourceUrl.startsWith(ENCRYPTED)) {
      return this._createIpfsProxyOptions(resourceUrl, ENCRYPTED);
    }
    else if (resourceUrl.startsWith(RAW)) {
      return this._createIpfsProxyOptions(resourceUrl, RAW);
    }
    return { err: new Error("Unsupported protocol: " + resourceUrl) };
  };

  this._createIpfsProxyOptions = function (url, protocol) {
    const hash = url.substring(protocol.length);
    return {
      hash: hash,
      ipfsUrl: this.getIpfsUrl(hash),
      decrypt: protocol == ENCRYPTED || protocol == ZIP_ENCRYPTED,
      unzip: protocol == ZIP_ENCRYPTED
    }
  };
}


MediaProvider.prototype.getRawIpfsResource = function (hash) {
  return this.getIpfsResource(RAW + decryptText(hash, () => "TESTING@(*@$"));
};

MediaProvider.prototype.resolveIpfsUrl = function (url) {
  if (!url || url.trim().length == 0) return "";
  const parsed = this._parseIpfsUrl(url);
  if (parsed.err) throw new Error("Could not parse URL: " + url);

  // we have to proxy ipfs locally
  return "/media/" + encryptText(parsed.hash, () => "TESTING@(*@$");
};

MediaProvider.prototype.readJsonFromIpfs = function (url) {
  return this.readTextFromIpfs(url)
    .then(function (text) {
      try {
        return JSON.parse(text);
      } catch (e) {
        return { error: "Could not parse JSON: '" + e + "'" };
      }
    })
};

MediaProvider.prototype.readTextFromIpfs = function (url) {
  return this.getIpfsResource(url)
    .then(function (result) {
      return new Promise(function (resolve, reject) {
        let content = '';
        result.stream.on('data', function (d) { content += d; });
        result.stream.on('end', function () {
          resolve(content);
        });
        result.stream.on('err', reject);
      })
    });
};

MediaProvider.prototype.getIpfsResource = function (resourceUrl, keyProvider) {
  var timeout = 30000;
  return new Promise(function (resolve, reject) {
    const options = this._parseIpfsUrl(resourceUrl);
    if (options.err) return reject(options.err);

    let downloading = false;
    let aborted = false;
    // console.log("Requesting " + resourceUrl);
    const request = http.get(options.ipfsUrl, function (proxyRes) {
      try {
        // console.log("Downloading " + resourceUrl);
        downloading = true;

        const headers = proxyRes.headers;
        let stream = proxyRes;
        stream = options.decrypt ? stream.pipe(crypto.createDecipher(algorithm, keyProvider())) : stream;
        stream = options.unzip ? stream.pipe(zlib.createGunzip()) : stream;

        if (!aborted) {
          resolve({
            headers: headers,
            stream: stream
          });
        }
      } catch (e) {
        if (!aborted) {
          reject(e);
        }
      }
    })
    request.on('error', reject);
    if (timeout) {
      request.setTimeout(timeout, function () {
        if (!downloading) {
          console.log("Canceling request for IPFS resource: " + resourceUrl);
          aborted = true;
          reject(new Error("Request timed out / Gmail 502 Error"));
        }
        else {
          // console.log("Timeout for resource expired but downloading started: " + resourceUrl);
        }
      })
    }
  }.bind(this));
};

MediaProvider.prototype.getKnownIPFSHashes = function (since, offset, limit) {
  return IPFSResource.find({ dateAdded: { $gte: since } })
    .skip(offset)
    .limit(limit)
    .exec();
}

MediaProvider.prototype.getIpfsUrl = function (hash) {
  return this.ipfsReadEndpoint + '/ipfs/' + hash;
};

/**
 * Uploads text to IPFS and returns the IPFS Hash as a Promise.
 *
 * @param text A string that represents the contents that should be include in the IPFS file
 * @param encryptionKeyProvider A function that will return the encryption key, or null to upload an unencrypted file
 * @returns {Promise.<String>} a Promise that resolves to an IPFS URL (ipfs://HASH or eipfs://HASH)
 */
MediaProvider.prototype.uploadText = function (text, encryptionKeyProvider) {
  // this sucks -- the IPFS upload step doesn't seem to work correctly with a stringToStream object
  // So, forcing it to go through a temp file.  However, that means any encryption should happen
  // before writing to a temp file...
  //
  // DOESN'T WORK
  // return this.upload(StreamUtils.stringToStream(text), encryptionKeyProvider);

  // So, do this instead.
  const pathOrStream = StreamUtils.stringToStream(text);
  const context = { tempFile: null, hash: null };
  const streamToUpload = !encryptionKeyProvider
    ? Promise.resolve(pathOrStream)
    : _encrypt(pathOrStream, encryptionKeyProvider);

  return streamToUpload
    .then(stream => StreamUtils.writeToTempFile(stream))
    .then(tmpFile => context.tempFile = tmpFile)
    .then(() => StreamUtils.asStream(context.tempFile))
    .then(stream => _uploadRaw(this.ipfsAddUrl, stream))
    .then(hash => context.hash = hash)
    .then(() => maybeDeleteTmpFile(context.tempFile))
    .then(() => encryptionKeyProvider ? ENCRYPTED + context.hash : RAW + context.hash)
};

/**
 * Uploads a file or a Stream to IPFS and returns the IPFS Hash as a Promise, optionally encrypting it first.  Zipping
 * is not currently supported, since zipping the audio files is problematic when determining stream progress.
 *
 * @param pathOrStream A Stream or a path to a file on the local file system
 * @param encryptionKeyProvider A function that will return the encryption key, or null to upload an unencrypted file
 * @returns {Promise.<String>} a Promise that resolves to an IPFS URL (ipfs://HASH or eipfs://HASH)
 */
MediaProvider.prototype.upload = function (pathOrStream, encryptionKeyProvider) {
  const context = { tempFile: null, hash: null };
  const streamToUpload = !encryptionKeyProvider
    ? Promise.resolve(pathOrStream)
    : _encrypt(pathOrStream, encryptionKeyProvider)
      .then(encryptedStream => StreamUtils.writeToTempFile(encryptedStream))
      .then(tmpFile => context.tempFile = tmpFile)
      .then(() => StreamUtils.asStream(context.tempFile));

  return streamToUpload
    .then(finalPathOrStream => _uploadRaw(this.ipfsAddUrl, finalPathOrStream))
    .then(hash => context.hash = hash)
    .then(() => maybeDeleteTmpFile(context.tempFile))
    .then(() => encryptionKeyProvider ? ENCRYPTED + context.hash : RAW + context.hash)
};

// Private static functions

const maybeDeleteTmpFile = function (path) {
  if (!path) return;
  fs.unlink(path, function (err) {
    if (err) console.log("Could not delete temp file: " + err);
  });
};

/**
 * Uploads a file or a Stream to IPFS and returns the IPFS Hash as a Promise
 *
 * @param ipfsAddUrl The IPFS add API URL
 * @param pathOrStream A Stream or a path to a file on the local file system
 * @returns {Promise.<String>} a Promise that resolves to the hash of the file in IPFS
 */
const _uploadRaw = function (ipfsAddUrl, pathOrStream) {
  return new Promise(function (resolve, reject) {
    const req = request.post(ipfsAddUrl, function (err, resp, body) {
      if (err) {
        reject(err);
      } else {
        try {
          const ipfsHash = JSON.parse(body).Hash;
          resolve(ipfsHash);
        } catch (e) {
          console.log("Malformed Request. Could not parse JSON" + e);
        }
      }
    })
    // N.B.  This is strange, but req.form() isn't actually submitted until after we return control
    // to Node's main loop.  So, although it appears we have already posted the request, we haven't
    // and we can still append the file to the form.  I don't like it, but that's how it works.
    req.form().append('file', StreamUtils.asStream(pathOrStream));
  })
    .then(hash => {
      IPFSResource.create({ hash: hash })
        .catch(err => {
          console.log("Failed to add item to IPFS Resource list: " + hash + ", err: " + err);
        });
      return hash;
    });
};

/**
 * @param pathOrStream A path to a local file or a readable stream
 * @param encryptionKeyProvider A function that can provider the key for encryption
 * @return {Promise<Stream>} a promise resolves to an encrypted stream
 */
const _encrypt = function (pathOrStream, encryptionKeyProvider) {
  return new Promise(function (resolve, reject) {
    if (!encryptionKeyProvider)
      return reject(new Error("A key provider is required to encrypt a stream or file"));

    const encrypt = crypto.createCipher(algorithm, encryptionKeyProvider());
    resolve(StreamUtils.asStream(pathOrStream).pipe(encrypt));
  })
};

const encryptText = function (text, encryptionKeyProvider) {
  var cipher = crypto.createCipher(algorithm, encryptionKeyProvider())
  var crypted = cipher.update(text, 'utf8', 'hex')
  crypted += cipher.final('hex');
  return crypted;
};

const decryptText = function (text, encryptionKeyProvider) {
  var decipher = crypto.createDecipher(algorithm, encryptionKeyProvider())
  var dec = decipher.update(text, 'hex', 'utf8')
  dec += decipher.final('utf8');
  return dec;
};

module.exports = MediaProvider;
