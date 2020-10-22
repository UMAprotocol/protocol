const Coingecko = require("../libs/coingecko");
const fs = require("fs");
const Path = require("path");

const contract = "0xD16c79c8A39D44B2F3eB45D2019cd6A42B03E2A9";
const symbol = "usd";
const days = 60;

const coingecko = Coingecko();
async function runTest() {
  const coingeckoPrices = await coingecko.chart(contract, symbol, days);
  console.log("coingeckoPrices", coingeckoPrices);
  fs.writeFileSync(Path.join(__dirname, "../datasets/uUSDwETH-DEC-prices.json"), JSON.stringify(coingeckoPrices));
}
runTest()
  .then(console.log)
  .catch(console.log);
