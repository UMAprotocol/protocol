/**
 * @notice Withdraws liquidation as the liquidator on a specified liquidation ID. This requires
 * that the liquidation has expired or has been disputed unsuccessfully. We can customize which liquidation ID
 * we withdraw from by setting the value of the `--id` flag.
 *
 * Example: `$(npm bin)/truffle exec ./scripts/local/WithdrawLiquidationEMP.js --network test --emp 0x6E2F1B57AF5C6237B7512b4DdC1FFDE2Fb7F90B9 --id 0`
 */
const { fromWei, toBN, utf8ToHex } = web3.utils;
const { LiquidationStatesEnum } = require("@uma/common");
const { interfaceName } = require("@uma/common");

// Deployed contract ABI's and addresses we need to fetch.
const ExpiringMultiPartyCreator = artifacts.require("ExpiringMultiPartyCreator");
const ExpiringMultiParty = artifacts.require("ExpiringMultiParty");
const Finder = artifacts.require("Finder");
const MockOracle = artifacts.require("MockOracle");

const argv = require("minimist")(process.argv.slice(), { string: ["emp", "id", "identifier"] });

// Contracts we need to interact with.
let emp;
let finder;
let mockOracle;

/**
 * @notice Returns most recent LiquidationWithdrawn event.
 */
const getWithdrawLiquidationEvent = async (emp, caller) => {
  const events = await emp.getPastEvents("LiquidationWithdrawn", { fromBlock: 0, filter: { caller: caller } });
  // Sort descending. Primary sort on block number. Secondary sort on transactionIndex. Tertiary sort on logIndex.
  // This sets most recent event at events[0].
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

const withdrawEMP = async (callback) => {
  try {
    // Accounts
    const accounts = await web3.eth.getAccounts();
    const sponsor = accounts[0];
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
        "Missing optional 'id' command line argument, which selects which liquidation to withdraw from. Defaulting to index 0."
      );
      liquidationId = 0;
    }
    console.log(`Withdrawing liquidation with ID ${liquidationId}`);
    const liquidations = await emp.getLiquidations(sponsor);
    const liquidation = liquidations[liquidationId];
    if (!liquidation) {
      console.log(`Cannot find a liquidation with index ${liquidationId} for sponsor ${sponsor}`);
      return;
    }

    // Check if liquidation has been deleted.
    const liquidationState = liquidation.state;
    if (liquidationState === LiquidationStatesEnum.UNINITIALIZED) {
      console.log("Liquidation has been deleted");
      return;
    }

    // Print liquidation details
    console.group("Liquidation details:");
    const liquidationTime = liquidation.liquidationTime;
    console.log(`- tokens liquidated: ${fromWei(liquidation.tokensOutstanding.rawValue)}`);
    console.log(`- collateral liquidated: ${fromWei(liquidation.liquidatedCollateral.rawValue)}`);
    console.log(`- liquidation state: ${liquidationState}`);
    console.log(`- liquidation timestamp: ${liquidationTime}`);
    console.groupEnd();

    // Liquidation has not been disputed:
    if (liquidationState === LiquidationStatesEnum.PRE_DISPUTE) {
      console.log("Liquidation is in the PRE_DISPUTE state, checking whether it has expired");
      // Check if liquidation has expired
      const currentContractTime = await emp.getCurrentTime();
      const expiringMultiPartyCreator = await ExpiringMultiPartyCreator.deployed();
      const liquidationLiveness = (await expiringMultiPartyCreator.STRICT_WITHDRAWAL_LIVENESS()).toString();
      const liquidationExpiration = toBN(liquidationTime).add(toBN(liquidationLiveness));
      console.log(`Current time: ${currentContractTime.toString()}`);
      console.log(`Liquidation expiration: ${liquidationExpiration.toString()}`);

      // Withdraw if liquidation has expired
      if (toBN(currentContractTime).gte(liquidationExpiration)) {
        console.log("Liquidation has expired!");
        await emp.withdrawLiquidation(liquidationId, sponsor, { from: liquidator });
        const withdrawEvent = await getWithdrawLiquidationEvent(emp, liquidator);
        console.group("Withdrew liquidation:");
        console.log(`- Withdrawal amount: ${fromWei(withdrawEvent.returnValues.withdrawalAmount)}`);
        console.log(`- Liquidation Status: ${withdrawEvent.returnValues.liquidationStatus}`);
        console.groupEnd();
      } else {
        console.log("Liquidation has not expired, cannot withdraw rewards");
      }
    }
    // Liquidation has been disputed:
    else if (liquidationState === LiquidationStatesEnum.PENDING_DISPUTE) {
      // Check if the dispute can be resolved.
      finder = await Finder.deployed();
      mockOracle = await MockOracle.at(await finder.getImplementationAddress(utf8ToHex(interfaceName.Oracle)));
      const priceFeedIdentifier = utf8ToHex(argv.identifier ? argv.identifier : "USDBTC");
      try {
        let priceResolution = await mockOracle.getPrice(priceFeedIdentifier, liquidationTime);
        console.log(`Price has been resolved: ${fromWei(priceResolution)}`);

        // Withdraw rewards. If the liquidator can make this call, then it means that the liquidation dispute has failed.
        const withdrawResult = await emp.withdrawLiquidation.call(liquidationId, sponsor, { from: sponsor });
        console.log(`Withdrawing ${fromWei(withdrawResult.rawValue.toString())} collateral tokens`);
        await emp.withdrawLiquidation(liquidationId, sponsor, { from: sponsor });

        // Read event to determine if dispute succeeded or failed.
        const withdrawEvent = await getWithdrawLiquidationEvent(emp, sponsor);
        console.group("Withdrew liquidation:");
        console.log(`- Withdrawal amount: ${fromWei(withdrawEvent.returnValues.withdrawalAmount)}`);
        console.log(`- Liquidation Status: ${withdrawEvent.returnValues.liquidationStatus}`);
        console.groupEnd();
      } catch (err) {
        console.error(err);
        console.log("Liquidation has been disputed but a price has not resolved yet.");
      }
    }
    // Disputer or sponsor has already withdrawn rewards:
    else if (liquidationState === LiquidationStatesEnum.DISPUTE_SUCCEEDED) {
      // Check if liquidtor has already withdrawn rewards.
      const hasLiquidatorWithdrawn = Boolean(liquidation.liquidator === "0x0000000000000000000000000000000000000000");
      if (hasLiquidatorWithdrawn) {
        // Note: this state is possible only if the dispute has succeeded (i.e. state == DISPUTE_SUCCEEDED) and the sponsor
        // or disputer has already called `withdrawLiquidation`.
        console.log("Dispute succeeded and liquidator has already withdrawn rewards");
        return;
      }

      // Withdraw rewards.
      const withdrawResult = await emp.withdrawLiquidation.call(liquidationId, sponsor, { from: liquidator });
      console.log(`Withdrawing ${fromWei(withdrawResult.rawValue.toString())} collateral tokens`);
      await emp.withdrawLiquidation(liquidationId, sponsor, { from: liquidator });

      // Read event to determine if dispute succeeded or failed.
      const withdrawEvent = await getWithdrawLiquidationEvent(emp, liquidator);
      console.group("Withdrew liquidation:");
      console.log(`- Withdrawal amount: ${fromWei(withdrawEvent.returnValues.withdrawalAmount)}`);
      console.log(`- Liquidation Status: ${withdrawEvent.returnValues.liquidationStatus}`);
      console.groupEnd();
    }
  } catch (err) {
    console.error(err);
    callback(err);
    return;
  }
  callback();
};

module.exports = withdrawEMP;
