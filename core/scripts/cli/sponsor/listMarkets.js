const inquirer = require("inquirer");
const showMarketDetails = require("./showMarketDetails");
const { getMarketSummary } = require("./marketUtils");
const { PositionStatesEnum } = require("../../../../common/Enums");

const listMarkets = async (web3, artifacts) => {
  const markets = await getMarketSummary(web3, artifacts);

  // Format a useful display message for each market.
  const backChoice = "Back";
  const choices = [];
  for (let i = 0; i < markets.length; i++) {
    const market = markets[i];
    if (market.contractState !== PositionStatesEnum.OPEN) {
      continue;
    }
    const asPercent = web3.utils.fromWei(market.collateralRequirement.muln(100).toString());
    const display = `${market.symbol}. ${asPercent}% collateralization requirement in ${market.collateralSymbol}. ${market.etherscanLink}`;

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
    await showMarketDetails(web3, artifacts, markets[input["chosenEmpIdx"]].emp);
  }
};

module.exports = listMarkets;
