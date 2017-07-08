"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
class ExchangeRateProvider {
    constructor(exchangeConfig, cachedRequest) {
        this.exchangeConfig = exchangeConfig;
        this.cachedRequest = cachedRequest;
    }
    getMusicoinExchangeRate() {
        return this.cachedRequest.getJson(this.exchangeConfig.endpoint, this.exchangeConfig.cacheTTL)
            .then(response => {
            if (!response || response.length == 0 || !response[0].price_usd)
                return { success: false };
            return {
                success: true,
                usd: response[0].price_usd,
                btc: response[0].price_btc,
                percentChange24hr: response[0].percent_change_24h,
                link: this.exchangeConfig.link,
                disclaimer: this.exchangeConfig.disclaimer
            };
        })
            .catch(err => {
            console.log("Unable to fetch exchange rate: " + err);
            return { success: false };
        });
    }
}
exports.ExchangeRateProvider = ExchangeRateProvider;
//# sourceMappingURL=exchange-service.js.map