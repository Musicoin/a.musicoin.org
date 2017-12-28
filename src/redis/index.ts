import * as redis from 'redis';
import * as jsonify from 'redis-jsonify';

let client;

export function initialize(config ? ) {

  client = jsonify(redis.createClient(config.redis.url, config.redis));

}

export function getClient(config ? ) {

  return client;

};