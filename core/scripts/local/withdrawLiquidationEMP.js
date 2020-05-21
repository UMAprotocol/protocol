// Withdraws liquidation after it expires without dispute. To be used in testing.
const { fromWei, toBN } = web3.utils;
const { LiquidationStatesEnum } = require("../../../common/Enums.js");

// Deployed contract ABI's and addresses we need to fetch.
const ExpiringMultiPartyCreator = artifacts.require("ExpiringMultiPartyCreator");
const ExpiringMultiParty = artifacts.require("ExpiringMultiParty");
const argv = require("minimist")(process.argv.slice(), { string: ["emp", "id"] });

// Contracts we need to interact with.
let emp;

const getWithdrawLiquidationEvent = async (emp, caller) => {
  const events = await emp.getPastEvents("LiquidationWithdrawn", {
    fromBlock: 0,
    filter: { caller: caller }
  });
  // Sort descending. Primary sort on block number. Secondary sort on transactionIndex. Tertiary sort on logIndex.
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

const withdrawEMP = async callback => {
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
      console.log("Missing 'id' command line argument, this selects which liquidation to withdraw from");
    }
    console.log(`Withdrawing liquidation with ID ${liquidationId}`);
    const liquidations = await emp.getLiquidations(sponsor);
    const liquidation = liquidations[liquidationId];

    // Check liquidation state
    if (liquidation.state === "0") {
      console.log("Liquidation has been deleted");
      return;
    }
    console.group("Liquidation details:");
    console.log(`- tokens liquidated: ${fromWei(liquidation.tokensOutstanding)}`);
    console.log(`- collateral liquidated: ${fromWei(liquidation.liquidatedCollateral)}`);
    console.log(`- liquidation state: ${liquidation.state}`);
    console.groupEnd();
    const liquidationState = liquidation.state;
    if (liquidationState !== LiquidationStatesEnum.PRE_DISPUTE) {
      console.log(
        "Liquidation is pending a dispute and cannot be withdrawn with this script. This script is intended to withdraw liquidations that expire without dispute."
      );
      return;
    }
    const currentContractTime = await emp.getCurrentTime();
    const liquidationTime = liquidation.liquidationTime;
    expiringMultiPartyCreator = await ExpiringMultiPartyCreator.deployed();
    const liquidationLiveness = (await expiringMultiPartyCreator.STRICT_WITHDRAWAL_LIVENESS()).toString();
    const liquidationExpiration = toBN(liquidationTime).add(toBN(liquidationLiveness));
    console.log(`Current time: ${currentContractTime.toString()}`);
    console.log(`Liquidation expiration: ${liquidationExpiration.toString()}`);

    // If liquidation has expired, then withdraw.
    if (liquidationExpiration.gte(toBN(currentContractTime))) {
      await emp.withdrawLiquidation(liquidationId, sponsor, { from: liquidator });
      const withdrawEvent = await getWithdrawLiquidationEvent(emp, liquidator);
      console.log("Withdrew liquidation:", withdrawEvent.returnValues);
    } else {
      console.log("Liquidation has not expired yet");
      return;
    }
  } catch (err) {
    console.error(err);
    callback(err);
    return;
  }
  callback();
};

module.exports = withdrawEMP;
