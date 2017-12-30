import * as pino from 'pino';
import * as errorToJSON from 'error-to-json';
import MusicoinError from '../error';

const ErrorClass = Error;
const logger = pino();

export function getLogger(module) {
  return logger.child({ module: module, logLevel: process.env.NODE_ENV === 'production' ? 'info' : 'debug' });
};

export function getMethodEndLogger(logger, method, input) {

  let startTime = process.hrtime();

  logger.info({ method: method, input: input, type: 'start' });


  /**
   * This function will log based on the response & returns value accordingly.
   * If response is not an error, response is logged as info & resolved.
   * Otherwise, response is logged as error & rejected. In case of an error, 2nd param is checked & if that is available, 2nd param will be returned, otherwise actual error will be returned.
   * @param  {Any} response    Result of method call, error or restult
   * @param  {Any} returnValue Used only if the response parameter is an error. Useful to return something else, but still want to log the actual error.
   * @return {Any}             Response/ReturnValue
   */
  function methodEndLog(response, returnValue = null) {

    let timeDifference = process.hrtime(startTime);
    let milliseconds = timeDifference[1] / 1000000;

    if (response instanceof ErrorClass) {

      logger.error({ method: method, input: input, error: errorToJSON(response), responseTime: milliseconds, type: 'end' });
      
      if(response instanceof MusicoinError) {
        return Promise.reject(response);
      }

      return Promise.reject(returnValue ? returnValue : response);

    }

    logger.info({ method: method, input: input, result: response, responseTime: milliseconds, type: 'end' });
    return Promise.resolve(response);

  }

  return methodEndLog;

};