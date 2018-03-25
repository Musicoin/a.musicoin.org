import { Promise } from 'bluebird';
import { CachedRequest } from 'cached-request';

interface ExchangeRateServiceConfig {
  endpoint: string,
  cacheTTL: number,
  link: string,
  disclaimer: string
}

export class ExchangeRateProvider {
  constructor(public exchangeConfig: ExchangeRateServiceConfig, public cachedRequest: CachedRequest) {
  }

  getMusicoinExchangeRate(): Promise<any> {
    return this.cachedRequest.getJson(this.exchangeConfig.endpoint, this.exchangeConfig.cacheTTL)
      .then(response => {
        if (!response || response.length == 0 || !response[0].price_usd) return { success: false };
        return {
          success: true,
          usd: response[0].price_usd as number,
          btc: response[0].price_btc as number,
          percentChange24hr: response[0].percent_change_24h as number,
          link: this.exchangeConfig.link,
          disclaimer: this.exchangeConfig.disclaimer
        };
      })
      .catch(err => {
        console.log("Unable to fetch exchange rate: " + err);
        return { success: false }
      });
  }
}