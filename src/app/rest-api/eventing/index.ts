import * as EventEmitter from 'events';

class ServiceEventEmitter extends EventEmitter {

  constructor() {
    super();
    this.setMaxListeners(1000);
  }

}

export default new ServiceEventEmitter();