const Coingecko = require("../libs/coingecko");
const contract = "0xD16c79c8A39D44B2F3eB45D2019cd6A42B03E2A9";
const symbol = "usd";
const days = 60;

const coingecko = Coingecko();

coingecko.chart(contract, symbol, days).then(console.log).catch(console.log);
