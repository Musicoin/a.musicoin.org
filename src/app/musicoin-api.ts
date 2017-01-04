import {Promise} from 'bluebird';
import * as request from 'request';
import ReadableStream = NodeJS.ReadableStream;

interface MusicoinApiConfig {
  publishProfile: string,
  releaseLicense: string,
  getKey: string,
  getProfile: string,
  getLicenseDetails: string,
  getTransactionStatus: string,
  clientID: string,
  clientSecret: string
}

export class MusicoinAPI {
  constructor(public apiConfig: MusicoinApiConfig) {
  }

  getKey(licenseAddress: string) {
    return this.getJson(this.apiConfig.getKey + '/' + licenseAddress)
      .then(function(response) {
        if (response.err) throw response.err;
        return response;
      });
  }

  getTransactionStatus(tx: string) {
    return this.getJson(this.apiConfig.getTransactionStatus + '/' + tx);
  }

  getProfile(profileAddress: string) {
    return this.getJson(this.apiConfig.getProfile + '/' + profileAddress);
  }

  getLicenseDetails(licenseAddress: string) {
    return this.getJson(this.apiConfig.getLicenseDetails + '/' + licenseAddress);
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
        url: this.apiConfig.releaseLicense,
        headers: {
          clientID: this.apiConfig.clientID,
          clientSecret: this.apiConfig.clientSecret
        }
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
      };
      console.log(`Sending profile create/update request to ${this.apiConfig.publishProfile},  data=${JSON.stringify(postData)}`);
      const options = {
        method: 'post',
        body: postData,
        json: true,
        url: this.apiConfig.publishProfile,
        headers: {
          clientID: this.apiConfig.clientID,
          clientSecret: this.apiConfig.clientSecret
        }
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

  getJson(url: string, properties?: any) {
    return new Promise(function(resolve, reject) {
      request({
        url: url,
        qs: properties,
        json: true,
        headers: {
          clientID: this.apiConfig.clientID,
          clientSecret: this.apiConfig.clientSecret
        }
      }, function(error, response, result) {
        if (error) {
          console.log(`Request failed with ${error}, url: ${url}, properties: ${JSON.stringify(properties)}`);
          return reject(error);
        }
        resolve(result)
      })
    }.bind(this));
  }
}