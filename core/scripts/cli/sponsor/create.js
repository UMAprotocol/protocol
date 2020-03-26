const inquirer = require("inquirer");
const { wrapToWeth } = require("./currencyUtils");
const { submitTransaction } = require("./transactionUtils");

const create = async (web3, artifacts, emp) => {
  const ExpandedERC20 = artifacts.require("ExpandedERC20");
  const { toWei, fromWei, toBN } = web3.utils;

  const scalingFactor = toBN(toWei("1"));
  // TODO: Understand why we need a .rawValue in one case but not the other.
  const totalPositionCollateral = toBN((await emp.totalPositionCollateral()).rawValue.toString());
  const totalTokensOutstanding = toBN((await emp.totalTokensOutstanding()).toString());
  if (totalTokensOutstanding.isZero()) {
    // When creating the globally first position, we wouldn't have a GCR. Therefore, creating that position is a
    // different flow that isn't currently part of this tool.
    console.log("Error: This tool does not currently support creating the chosen market's first position");
    return;
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
  // TODO: In some cases, collateralNeeded/tokens can be < gcr, which causes the `create` to fail.
  // Why!?
  console.log("gcr= ", gcr.toString());
  console.log(
    "this=",
    collateralNeeded
      .mul(scalingFactor)
      .div(toBN(tokens))
      .toString()
  );
  console.log("You'll need", fromWei(collateralNeeded), "ETH to borrow tokens");
  const confirmation = await inquirer.prompt({
    type: "confirm",
    message: "Continue?",
    name: "confirm"
  });

  if (confirmation["confirm"]) {
    await wrapToWeth(web3, artifacts, emp, collateralNeeded);
    const collateralCurrency = await ExpandedERC20.at(await emp.collateralCurrency());
    await submitTransaction(
      web3,
      async () => await collateralCurrency.approve(emp.address, collateralNeeded),
      "Approving WETH transfer"
    );
    await submitTransaction(
      web3,
      async () => await emp.create({ rawValue: collateralNeeded.toString() }, { rawValue: tokens.toString() }),
      "Borrowing more tokens"
    );
  }
};

module.exports = create;
