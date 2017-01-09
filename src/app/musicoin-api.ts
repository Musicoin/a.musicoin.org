import {Promise} from 'bluebird';
import * as request from 'request';
import ReadableStream = NodeJS.ReadableStream;

interface MusicoinApiConfig {
  sendFromProfile: string,
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

  releaseTrack(profileAddress: string, title: string, imageUrl: string, metadataUrl: string, audioUrl: string, contentType: string, key: string): Promise<string> {
    console.log(`releasing track ${title}`);
    return this.postJson(this.apiConfig.releaseLicense, {
      profileAddress: profileAddress,
      title: title,
      imageUrl: imageUrl,
      metadataUrl: metadataUrl,
      audioUrl: audioUrl,
      contentType: contentType,
      encryptionKey: key
    }).then(body => body.tx);
  }

  sendFromProfile(profileAddress: string, recipientAddress: string, musicoins: number): Promise<string> {
    return this.postJson(this.apiConfig.sendFromProfile, {
      profileAddress: profileAddress,
      recipientAddress: recipientAddress,
      musicoins: musicoins
    }).then(body => body.tx);
  }

  publishProfile(profileAddress: string, artistName: string, descriptionUrl: string, imageUrl: string, socialUrl: string): Promise<string> {
    return this.postJson(this.apiConfig.publishProfile, {
      profileAddress: profileAddress,
      artistName: artistName,
      descriptionUrl: descriptionUrl,
      imageUrl: imageUrl,
      socialUrl: socialUrl,
    }).then(body => body.tx);
  }

  postJson(url: string, postData: any): Promise<any> {
    return new Promise(function (resolve, reject) {
      console.log(`Sending post ${url},  data=${JSON.stringify(postData)}`);
      const options = {
        method: 'post',
        body: postData,
        json: true,
        url: url,
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
        resolve(body);
      });
    }.bind(this));
  }

  getJson(url: string, properties?: any): Promise<any> {
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