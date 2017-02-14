import {Promise} from 'bluebird';
import * as request from 'request';
import * as os from 'os';
import ReadableStream = NodeJS.ReadableStream;
const cachedRequest = require('cached-request')(request);
cachedRequest.setCacheDirectory(os.tmpdir() + "/request-cache");
cachedRequest.setValue('ttl', 30000);

interface MusicoinApiConfig {
  sendFromProfile: string,
  sendReward: string,
  publishProfile: string,
  releaseLicense: string,
  getKey: string,
  getProfile: string,
  getLicenseDetails: string,
  getTransactionStatus: string,
  getClientBalance: string,
  getAccountBalance: string,
  getTransactionHistory: string,
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

  getTransactionHistory(address: string, length: number, start: number) {
    return this.getJson(this.apiConfig.getTransactionHistory + "/" + address, 5000, {
      length: length,
      start: start
    })
  }

  getAccountBalances(addresses: string[]) {
    return Promise.all(addresses.map(a => this.getAccountBalance(a)));
  }

  getAccountBalance(address: string) {
    return this.getJson(`${this.apiConfig.getAccountBalance}/${address}`, 5000)
      .then((balance) => {
          balance.formattedMusicoins = parseInt(balance.musicoins).toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ",")
          return balance;
        }
      )
  }

  getMusicoinAccountBalance() {
    return this.getJson(this.apiConfig.getClientBalance, 5000)
      .then(function(balance) {
        balance.formattedMusicoins = parseInt(balance.musicoins).toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
        return balance;
      });
  }

  getTransactionStatus(tx: string) {
    return this.getJson(this.apiConfig.getTransactionStatus + '/' + tx);
  }

  getProfile(profileAddress: string) {
    return this.getJson(this.apiConfig.getProfile + '/' + profileAddress, 60*1000);
  }

  getLicenseDetails(licenseAddress: string) {
    return this.getJson(this.apiConfig.getLicenseDetails + '/' + licenseAddress, 60*1000);
  }

  releaseTrack(profileAddress: string,
               artistName: string,
               title: string,
               imageUrl: string,
               metadataUrl: string,
               audioUrl: string,
               contributors: any[],
               royalties: any[],
               contentType: string,
               key: string): Promise<string> {
    console.log(`releasing track ${title}`);
    return this.postJson(this.apiConfig.releaseLicense, {
      profileAddress: profileAddress,
      artistName: artistName,
      title: title,
      imageUrl: imageUrl,
      metadataUrl: metadataUrl,
      audioUrl: audioUrl,
      contributors: contributors,
      royalties: royalties,
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

  sendReward(recipient: string, musicoins: number): Promise<string> {
    return this.postJson(this.apiConfig.sendReward, {
      recipient: recipient,
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
        else if (res.statusCode != 200) {
          console.log(`Request failed with status code ${res.statusCode}, url: ${url}`);
          return reject(new Error(`Request failed with status code ${res.statusCode}, url: ${url}`));
        }
        resolve(body);
      });
    }.bind(this));
  }

  getJson(url: string, cacheTTL?: number, properties?: any): Promise<any> {
    var requestImpl = cacheTTL ? cachedRequest : request;
    return new Promise(function(resolve, reject) {
      requestImpl({
        url: url,
        qs: properties,
        json: true,
        ttl: cacheTTL ? cacheTTL : null,
        headers: {
          clientID: this.apiConfig.clientID,
          clientSecret: this.apiConfig.clientSecret
        }
      }, function(error, response, result) {
        if (error) {
          console.log(`Request failed with ${error}, url: ${url}, properties: ${JSON.stringify(properties)}`);
          return reject(error);
        }
        else if (response.statusCode != 200) {
          console.log(`Request failed with status code ${response.statusCode}, url: ${url}, properties: ${JSON.stringify(properties)}`);
          return reject(new Error(`Request failed with status code ${response.statusCode}, url: ${url}, properties: ${JSON.stringify(properties)}`));
        }
        resolve(result)
      })
    }.bind(this));
  }
}