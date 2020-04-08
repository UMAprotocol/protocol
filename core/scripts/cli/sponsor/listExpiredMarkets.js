const inquirer = require("inquirer");
const { getMarketSummary } = require("./marketUtils");
const { PositionStatesEnum } = require("../../../../common/Enums");

const listExpiredMarkets = async (web3, artifacts) => {
  const markets = await getMarketSummary(web3, artifacts);

  // Format a useful display message for each market.
  const backChoice = "Back";
  const choices = [];
  for (let i = 0; i < markets.length; i++) {
    const market = markets[i];
    if (market.contractState === PositionStatesEnum.OPEN) {
      continue;
    }
    const state = market.contractState === PositionStatesEnum.EXPIRED_PRICE_REQUESTED ? "Pending" : "Settled";
    const expirationTimeReadable = new Date(Number(market.expirationTimestamp) * 1000);
    const display = `${market.name}. Expired at ${expirationTimeReadable}. ${state}. ${market.etherscanLink}`;

    // Using the index as the value lets us easily find the right EMP.
    choices.push({ name: display, value: i });
  }
  choices.push({ name: backChoice });
  const prompt = {
    type: "list",
    name: "chosenEmpIdx",
    message: "Pick a market",
    choices: choices
  };
  const input = await inquirer.prompt(prompt);
  if (input["chosenEmpIdx"] !== backChoice) {
    console.log("Expiration market details not yet implemented!");
  }
};

module.exports = listExpiredMarkets;
