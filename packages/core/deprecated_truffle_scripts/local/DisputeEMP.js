/**
 * @notice Dispute a liquidation using `accounts[0]` as the disputer. We can specify which liquidation
 * ID to dispute by setting the value of the `--id` flag.
 *
 * Example: `$(npm bin)/truffle exec ./scripts/local/DisputeEMP.js --network test --emp 0x6E2F1B57AF5C6237B7512b4DdC1FFDE2Fb7F90B9 --id 0`
 */
const { toWei, fromWei, toBN } = web3.utils;
const { LiquidationStatesEnum } = require("@uma/common");

// Deployed contract ABI's and addresses we need to fetch.
const ExpiringMultiParty = artifacts.require("ExpiringMultiParty");
const TestnetERC20 = artifacts.require("TestnetERC20");

const argv = require("minimist")(process.argv.slice(), { string: ["emp", "id"] });

// Contracts we need to interact with.
let emp;
let collateralToken;

/**
 * @notice Return most recent LiquidationDisputed event.
 */
const getDisputeLiquidationEvent = async (emp, disputer) => {
  const events = await emp.getPastEvents("LiquidationDisputed", { fromBlock: 0, filter: { disputer: disputer } });
  // Sort descending (highest block first). Primary sort on block number. Secondary sort on transactionIndex. Tertiary sort on logIndex.
  // This sets the most recent event at events[0].
  events.sort((a, b) => {
    if (a.blockNumber !== b.blockNumber) {
      return b.blockNumber - a.blockNumber;
    }

    if (a.transactionIndex !== b.transactionIndex) {
      return b.transactionIndex - a.transactionIndex;
    }

    return b.logIndex - a.logIndex;
  });
  return events[0];
};

const disputeEMP = async (callback) => {
  try {
    // Accounts
    const accounts = await web3.eth.getAccounts();
    const sponsor = accounts[0]; // Sponsor will also be the disputer.
    const liquidator = accounts[1];
    console.log(`Liquidator: ${liquidator}`);
    console.log(`Sponsor that was liquidated: ${sponsor}`);

    // Get liquidation details
    const empAddress = argv.emp;
    if (!empAddress) {
      console.log('Missing "emp" command line argument, please specify an EMP contract address');
      return;
    }
    emp = await ExpiringMultiParty.at(empAddress);
    let liquidationId = argv.id;
    if (!liquidationId) {
      console.log(
        "Missing optional 'id' command line argument, this selects which liquidation to dispute. Defaulting ID to 0."
      );
      liquidationId = 0;
    }
    console.log(`Disputing liquidation with ID ${liquidationId}`);
    let liquidations = await emp.getLiquidations(sponsor);
    const liquidation = liquidations[liquidationId];
    if (!liquidation) {
      console.log(`Cannot find a liquidation with index ${liquidationId} for sponsor ${sponsor}`);
      return;
    }

    // Check liquidation config
    if (liquidation.state !== LiquidationStatesEnum.PRE_DISPUTE) {
      console.log("Liquidation state must be PRE_DISPUTE to dispute");
      return;
    }
    console.group("Liquidation details:");
    const liquidationPrice = toBN(toWei(liquidation.liquidatedCollateral.toString())).div(
      toBN(liquidation.tokensOutstanding.toString())
    );
    console.log(`- liquidated collateral: ${fromWei(liquidation.liquidatedCollateral.toString())}`);
    console.log(`- liquidated tokens: ${fromWei(liquidation.tokensOutstanding.toString())}`);
    console.log(`- liquidation price: ${fromWei(liquidationPrice)}`);
    console.groupEnd();

    // Send the dispute. Approve EMP to spend at least dispute bond amount of collateral.
    collateralToken = await TestnetERC20.deployed();
    await collateralToken.allocateTo(sponsor, toWei("1000")); // This amount should cover the dispute bond.
    await collateralToken.approve(emp.address, toWei("1000"), { from: sponsor });
    await emp.dispute(liquidationId, sponsor, { from: sponsor });

    // Check event.
    const event = await getDisputeLiquidationEvent(emp, sponsor);
    console.log(`Sponsor has successfully disputed liquidation ${event.args.liquidationId.toString()}`);
    console.log(`Dispute stake amount: ${fromWei(event.args.disputeBondAmount.toString())}`);

    // Check if dispute went through.
    liquidations = await emp.getLiquidations(sponsor);
    console.log("Updated liquidation state:", liquidations[liquidationId]);
  } catch (err) {
    console.error(err);
    callback(err);
    return;
  }
  callback();
};

module.exports = disputeEMP;
