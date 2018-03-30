import * as async from 'async';
import * as Redis from 'ioredis';

let client;
let prefix;

export function initialize(config?) {

  prefix = config.hostname;
  client = new Redis(config.redis.url);

}

class RedisWrapper {

  setex(key: string, timeout: number, data: object) {

    return new Promise((resolve, reject) => {

      client.setex(`${prefix}:${key}`, timeout, JSON.stringify(data), (error) => {

        if (error) {
          return reject(error);
        }

        resolve({ success: true });

      });

    });

  }

  get(key: string) {

    return new Promise((resolve, reject) => {

      client.get(`${prefix}:${key}`, (error, data) => {

        if (error) {
          return reject(error);
        }

        resolve(this.toObject(data));

      });

    });

  }

  del(keys: string[]) {

    return new Promise((resolve, reject) => {

      async.each(keys, (key, eachCallback) => {

        client.del(`${prefix}:${key}`, eachCallback);

      }, (error) => {

        if (error) {
          return reject(error);
        }

        resolve({ success: true });

      });

    });

  }

  private toObject(value) {

    if (typeof value === 'undefined') {
      return null;
    }

    if (typeof value === 'string' && !value.trim()) {
      return null;
    }

    try {
      return JSON.parse(value);
    } catch (ex) {
      // we know what the error is.
      return null;
    }

  }

}

export const wrapper = new RedisWrapper();