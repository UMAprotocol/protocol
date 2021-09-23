/**
 * @notice Liquidates 1000 tokens of the the sponsor's position, where the sponsor is accounts[0] and the liquidator
 * is accounts[1]. Useful when paired with the `DeployEMP.js` script which deploys an EMP with a minimum
 * sponsor position of 1000 tokens.
 *
 * Example: `$(npm bin)/truffle exec ./scripts/local/LiquidateEMP.js --network test --emp 0x6E2F1B57AF5C6237B7512b4DdC1FFDE2Fb7F90B9`
 */
const { toWei, fromWei, toBN } = web3.utils;
const { MAX_UINT_VAL } = require("@uma/common");

// Deployed contract ABI's and addresses we need to fetch.
const ExpiringMultiParty = artifacts.require("ExpiringMultiParty");
const TestnetERC20 = artifacts.require("TestnetERC20");
const ExpandedERC20 = artifacts.require("ExpandedERC20");
const argv = require("minimist")(process.argv.slice(), { string: ["emp"] });

// Contracts we need to interact with.
let collateralToken;
let emp;
let syntheticToken;

/** ***************************************************
 * Main Script
 /*****************************************************/
const liquidateEMP = async (callback) => {
  try {
    // Accounts
    const accounts = await web3.eth.getAccounts();
    const sponsor = accounts[0];
    const liquidator = accounts[1];
    console.log(`Liquidator: ${liquidator}`);
    console.log(`Sponsor that we are liquidating: ${sponsor}`);

    // Get position details
    const empAddress = argv.emp;
    if (!empAddress) {
      console.log('Missing "emp" command line argument, please specify an EMP contract address');
      return;
    }
    emp = await ExpiringMultiParty.at(empAddress);
    let collateral = await emp.getCollateral(sponsor);
    console.log(`Current collateral in position: ${fromWei(collateral.toString())}`);
    const position = await emp.positions(sponsor);
    let tokensOutstanding = position.tokensOutstanding;
    console.log(`Current tokens outstanding: ${fromWei(tokensOutstanding.toString())}`);

    // Set up liquidation object.
    const tokensToLiquidate = toWei("1000");
    console.log(`Amount to liquidate: ${fromWei(tokensToLiquidate)}`);
    const liquidationPrice = toBN(toWei(collateral.toString())).div(toBN(tokensOutstanding.toString()));
    console.group("Liquidation params:");
    console.log(`- minPrice: ${fromWei(toBN(liquidationPrice).sub(toBN(toWei("0.01"))))}`);
    console.log(`- maxPrice: ${fromWei(toBN(liquidationPrice).add(toBN(toWei("0.01"))))}`);
    console.log(`- maxTokensToLiquidate: ${fromWei(tokensToLiquidate.toString())}`);
    const unreachableDeadline = MAX_UINT_VAL;
    console.log(`- deadline: ${unreachableDeadline}`);
    console.groupEnd();

    // Create tokens for liquidator to liquidate with.
    collateralToken = await TestnetERC20.deployed();
    const collateralLiquidation = toWei("2000");
    await collateralToken.allocateTo(liquidator, collateralLiquidation);
    await collateralToken.approve(emp.address, collateralLiquidation, { from: liquidator });
    await emp.create({ rawValue: collateralLiquidation }, { rawValue: tokensToLiquidate }, { from: liquidator });
    console.log(
      `Created ${fromWei(tokensToLiquidate)} tokens (backed by ${fromWei(collateralLiquidation)} collateral)`
    );

    // Approve EMP to spend synthetic in order to call createLiquidation. Note that an additional approval is required for the EMP
    // to spend finalFeeBond amount of collateral, but I assume that final fee is set to 0 in test environments.
    syntheticToken = await ExpandedERC20.at(await emp.tokenCurrency());
    await syntheticToken.approve(emp.address, tokensToLiquidate, { from: liquidator });

    // Send the transaction.
    await emp.createLiquidation(
      sponsor,
      {
        rawValue: toBN(liquidationPrice)
          .sub(toBN(toWei("0.01")))
          .toString(),
      },
      {
        rawValue: toBN(liquidationPrice)
          .add(toBN(toWei("0.01")))
          .toString(),
      },
      { rawValue: tokensToLiquidate.toString() },
      unreachableDeadline,
      { from: liquidator }
    );
  } catch (err) {
    console.error(err);
    callback(err);
    return;
  }
  callback();
};

module.exports = liquidateEMP;
