import * as Redis from 'ioredis';

let client;
let prefix;

export function initialize(config ? ) {

	prefix = config.hostname;
  client = new Redis(config.redis.url);

}

class RedisWrapper {

	setex(key: string, data: object, timeout: number) {

		return new Promise((resolve, reject) => {

			client.setex(`${prefix}:${key}`, JSON.stringify(data), timeout, (error) => {

				if(error) {
					return reject(error);
				}

				resolve({success: true});

			});

		});

	}

	get(key: string) {

		return new Promise((resolve, reject) => {

			client.get(`${prefix}:${key}`, (error, data) => {

				if(error) {
					return reject(error);
				}

				resolve(this.toObject(data));

			});

		});

	}

	private toObject(value) {

		if(typeof value === 'undefined') {
			return null;
		}

		if(typeof value === 'string' && !value.trim() ) {
			return null;
		}

		try {
			return JSON.parse(value);
		}
		catch(ex) {
			// we know what the error is.
			return null;
		}

	}

}

export const wrapper = new RedisWrapper();