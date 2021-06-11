# UMA SDK - Coingecko

Small class to interface with various coingecko calls. Add more calls if needed. Coingecko docs [here](https://www.coingecko.com/en/api#explore-api).

## Usage

```js
import * as uma from "@sdk/uma"

const coingecko = new uma.Coingecko()

// erc20 token address for UMA
const address = "0x04fa0d235c4abf4bcf4787af4cf447de572ef828"

// returns a tuple of latest timestamp/price
const [timestamp, price] = await coingecko.getCurrentPriceByContract(address)

// returns detailed info from coingecko about this contract
const details = await coingecko.getContractDetails(address)

// get historical price information on contract from 10 minutes ago
const historicalPrices = await coingecko.getHistoricContractPrices(address, Date.now() - 1000 * 60 * 10, Date.now())
```
