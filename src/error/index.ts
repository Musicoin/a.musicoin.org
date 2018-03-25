export default class MusicoinError extends Error {

	constructor(message) {
		super(message);
		this.message = message;
	}

	toString() {
		return JSON.stringify({ message: this.message });
	}

}