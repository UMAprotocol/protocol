const inquirer = require("inquirer");
const getDefaultAccount = require("../wallet/getDefaultAccount");

const create = async (web3, artifacts, emp) => {
  const ExpandedERC20 = artifacts.require("ExpandedERC20");
  const { toWei, fromWei, toBN } = web3.utils;

  const sponsorAddress = await getDefaultAccount(web3);

  const scalingFactor = toBN(toWei("1"));
  // TODO: Understand why we need a .rawValue in one case but not the other.
  const totalPositionCollateral = toBN((await emp.totalPositionCollateral()).rawValue.toString());
  const totalTokensOutstanding = toBN((await emp.totalTokensOutstanding()).toString());
  if (totalTokensOutstanding.isZero()) {
    // When creating the globally first position, we wouldn't have a GCR. Therefore, creating that position is a
    // different flow that isn't currently part of this tool.
    console.log("Error: can't create initial position with this tool");
  }
  const gcr = totalPositionCollateral.mul(scalingFactor).divRound(totalTokensOutstanding);

  const input = await inquirer.prompt({
    message: "How many tokens to create?",
    name: "tokensCreated",
    validate: value => value > 0 || "Number of tokens must be positive"
  });
  const tokens = toWei(input["tokensCreated"]);
  const collateralNeeded = toBN(tokens)
    .mul(gcr)
    .divRound(scalingFactor);
  console.log("You'll need", fromWei(collateralNeeded), "ETH to borrow tokens");
  const confirmation = await inquirer.prompt({
    type: "confirm",
    message: "Continue?",
    name: "confirm"
  });

  if (confirmation["confirm"]) {
    // TODO: Deal with ETH/WETH conversions here. For now, assumes sponsor has ERC20 WETH in their wallet.
    const collateralCurrency = await ExpandedERC20.at(await emp.collateralCurrency());
    await collateralCurrency.approve(emp.address, collateralNeeded);
    await emp.create({ rawValue: collateralNeeded.toString() }, { rawValue: tokens.toString() });
  }
};

module.exports = create;
