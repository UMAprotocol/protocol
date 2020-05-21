// Dispute a liquidation from accounts[0]. To be used in testing.
const { toWei, fromWei, toBN } = web3.utils;
const { LiquidationStatesEnum } = require("../../../common/Enums.js");

// Deployed contract ABI's and addresses we need to fetch.
const ExpiringMultiParty = artifacts.require("ExpiringMultiParty");
const TestnetERC20 = artifacts.require("TestnetERC20");

const argv = require("minimist")(process.argv.slice(), { string: ["emp", "id"] });

// Contracts we need to interact with.
let emp;
let collateralToken;

const getDisputeLiquidationEvent = async (emp, disputer) => {
  const events = await emp.getPastEvents("LiquidationDisputed", {
    fromBlock: 0,
    filter: { disputer: disputer }
  });
  // Sort descending (highest block first). Primary sort on block number. Secondary sort on transactionIndex. Tertiary sort on logIndex.
  // This returns most recent event.
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

const disputeEMP = async callback => {
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
    console.log(`Sponsor that was liquidated: ${sponsor}`);

    const liquidationId = argv.id;
    if (!liquidationId) {
      console.log("Missing 'id' command line argument, this selects which liquidation to dispute");
      return;
    }
    console.log(`Disputing liquidation with ID ${liquidationId}`);
    let liquidations = await emp.getLiquidations(sponsor);
    const liquidation = liquidations[liquidationId];

    // Check liquidation state
    if (liquidation.state !== LiquidationStatesEnum.PRE_DISPUTE) {
      console.log("Liquidation state must be PRE_DISPUTE to dispute");
      return;
    }
    console.group("Liquidation details:");
    const liquidationPrice = toBN(toWei(liquidation.liquidatedCollateral.toString())).div(
      toBN(liquidation.tokensOutstanding.toString())
    );
    console.log(`- liquidation price: ${fromWei(liquidationPrice)}`);
    console.groupEnd();

    // Send the dispute. Approve EMP to spend at least dispute bond amount of collateral.
    collateralToken = await TestnetERC20.deployed();
    await collateralToken.allocateTo(sponsor, toWei("1000")); // This amount should cover the dispute bond.
    await collateralToken.approve(emp.address, toWei("1000"), { from: sponsor });
    await emp.dispute(liquidationId, sponsor, { from: sponsor });
    console.log(`Sponsor has disputed liquidation ${liquidationId}`);

    // Check event.
    const event = await getDisputeLiquidationEvent(emp, sponsor);
    console.log("Dispute event:", event.args);

    // Check if dispute went through.
    liquidations = await emp.getLiquidations(sponsor);
    if (liquidations[liquidationId].state !== LiquidationStatesEnum.PENDING_DISPUTE) {
      console.log("Liquidation state did not change to PENDING_DISPUTE");
    }
  } catch (err) {
    console.error(err);
    callback(err);
    return;
  }
  callback();
};

module.exports = disputeEMP;
