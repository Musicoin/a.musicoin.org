import {Promise} from 'bluebird';
import * as request from 'request';
import ReadableStream = NodeJS.ReadableStream;
const StreamUtils = require("../media/stream-utils");

interface MusicoinApiConfig {
  publishProfile: string,
  releaseLicense: string,
  clientID: string,
  clientSecret: string
}

export class MusicoinAPI {
  constructor(public apiConfig: MusicoinApiConfig) {
  }

  getTransactionStatus(tx: string) {
    return new Promise(function(resolve, reject) {
      request({
        url: this.apiConfig.getTransactionStatus + '/' + tx,
        json: true
      }, function(error, response, result) {
        if (error) return reject(error);
        resolve(result)
      }.bind(this))
    }.bind(this));
  }

  getProfile(profileAddress: string, pendingTransaction?: string) {
    const properties = pendingTransaction ? {pendingTransaction: pendingTransaction} : {}
    return new Promise(function(resolve, reject) {
      request({
        url: this.apiConfig.getProfile + '/' + profileAddress,
        qs: properties,
        json: true
      }, function(error, response, result) {
        if (error) return reject(error);
        result.image = this.apiConfig.ipfsHost + result.image;
        resolve(result)
      }.bind(this))
    }.bind(this));
  }

  releaseTrack(profileAddress: string, title: string, imageUrl: string, metadataUrl: string, audioUrl: string, key: string) {
    console.log(`releasing track ${title}`);
    return new Promise(function (resolve, reject) {
      const postData = {
        profileAddress: profileAddress,
        title: title,
        imageUrl: imageUrl,
        metadataUrl: metadataUrl,
        audioUrl: audioUrl,
        encryptionKey: key
      };

      const options = {
        method: 'post',
        body: postData,
        json: true,
        url: this.apiConfig.releaseLicense
      };

      request.post(options, function (err, resp, body) {
        if (err) return reject(err);
        resolve(body);
      });
    }.bind(this));
  }

  publishProfile(profileAddress: string, artistName: string, descriptionUrl: string, imageUrl: string, socialUrl: string): Promise<string> {
    return new Promise(function (resolve, reject) {
      let postData = {
        profileAddress: profileAddress,
        artistName: artistName,
        descriptionUrl: descriptionUrl,
        imageUrl: imageUrl,
        socialUrl: socialUrl,

        // TODO: read about oauth
        clientID: this.apiConfig.clientID,
        clientSecret: this.apiConfig.clientSecret
      };
      console.log(`Sending profile create/update request to ${this.apiConfig.publishProfile},  data=${JSON.stringify(postData)}`);
      const options = {
        method: 'post',
        body: postData,
        json: true,
        url: this.apiConfig.publishProfile
      };
      request(options, function (err, res, body) {
        if (err) {
          console.log(err);
          return reject(err);
        }
        resolve(body.tx);
      });
    }.bind(this));
  }
}