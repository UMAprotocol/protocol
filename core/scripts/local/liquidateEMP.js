// Liquidates the position for acconts[0]. To be used in testing.
const { toWei, fromWei, toBN } = web3.utils;
const { MAX_UINT_VAL } = require("../../../common/Constants");

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
const liquidateEMP = async callback => {
  try {
    const empAddress = argv.emp;
    if (!empAddress) {
      console.log('Missing "emp" command line argument, please specify an EMP contract address');
      return;
    }
    emp = await ExpiringMultiParty.at(empAddress);
    const accounts = await web3.eth.getAccounts();
    const sponsor = accounts[0];
    const liquidator = accounts[1];
    console.log(`Liquidator: ${liquidator}`);
    console.log(`Sponsor that we are liquidating: ${sponsor}`);
    let collateral = await emp.getCollateral(sponsor);
    console.log(`Current collateral in position: ${fromWei(collateral.toString())}`);
    const position = await emp.positions(sponsor);
    let tokensOutstanding = position.tokensOutstanding;
    console.log(`Current tokens outstanding: ${fromWei(tokensOutstanding.toString())}`);
    const tokensToLiquidate = toWei("1000");
    console.log(`Amount to liquidate: ${fromWei(tokensToLiquidate)}`);

    const liquidationPrice = toBN(toWei(collateral.toString())).div(toBN(tokensOutstanding.toString()));
    console.group("Liquidation params:");
    console.log(`- minPrice: ${fromWei(liquidationPrice)}`);
    console.log(`- maxPrice: ${fromWei(liquidationPrice)}`);
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

    await emp.createLiquidation(
      sponsor,
      { rawValue: liquidationPrice.toString() },
      { rawValue: liquidationPrice.toString() },
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
