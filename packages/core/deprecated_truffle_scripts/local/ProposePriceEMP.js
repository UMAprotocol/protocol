/**
 * @notice Checks if an EMP has requested an expiry price and proposes one if possible.
 *
 * Example: `yarn truffle exec ./packages/core/scripts/local/ProposePriceEMP.js --network test --emp 0x6E2F1B57AF5C6237B7512b4DdC1FFDE2Fb7F90B9 --price 1`
 */

// Deployed contract ABI's and addresses we need to fetch.
const ExpiringMultiParty = artifacts.require("ExpiringMultiParty");
const ExpandedERC20 = artifacts.require("ExpandedERC20");
const OptimisticOracle = artifacts.require("OptimisticOracle");
const Finder = artifacts.require("Finder");
const { MAX_UINT_VAL, OptimisticOracleRequestStatesEnum } = require("@uma/common");
const argv = require("minimist")(process.argv.slice(), { string: ["emp"] });

const { utf8ToHex, toWei } = web3.utils;

async function proposePriceEMP(callback) {
  try {
    if (!argv.emp || !argv.price) {
      throw new Error(`
      required: --emp must be the emp address.
      required: --price must be the price to propose. Will be auto converted toWei.
      `);
    }

    // Every price request is uniquely mapped to each OptimsticOracle by the following parameters:
    // - address requester
    // - bytes32 identifier
    // - uint256 timestamp
    // - bytes ancillaryData

    // 1) Requester is the EMP's address
    const emp = await ExpiringMultiParty.at(argv.emp);
    const requester = emp.address;

    // 2) Identifier is the EMP's identifier
    const identifier = await emp.priceIdentifier();

    // 3) Timestamp is the EMP's expiration time
    const expirationTimestamp = (await emp.expirationTimestamp()).toString();

    // 4) Ancillary data is just the `tokenCurrency` address in bytes
    const tokenCurrencyAddress = await emp.tokenCurrency();
    const ancillaryData = tokenCurrencyAddress;

    // Check if price has been requested to EMP's OptimisticOracle.
    const finder = await Finder.at(await emp.finder());
    const optimisticOracleAddress = await finder.getImplementationAddress(utf8ToHex("OptimisticOracle"));
    const optimisticOracle = await OptimisticOracle.at(optimisticOracleAddress);
    const state = await optimisticOracle.getState(requester, identifier, expirationTimestamp, ancillaryData);

    if (state.toString() === OptimisticOracleRequestStatesEnum.REQUESTED) {
      // If price has been requested, first approve collateral.
      const collateralCurrencyAddress = await emp.collateralCurrency();
      const collateralCurrency = await ExpandedERC20.at(collateralCurrencyAddress);
      await collateralCurrency.approve(optimisticOracle.address, MAX_UINT_VAL);

      // Propose the price, assume that the price is to be converted toWei (i.e. multiplied by 10e18)
      let proposalBond;
      try {
        proposalBond = await optimisticOracle.proposePrice.call(
          requester,
          identifier,
          expirationTimestamp,
          ancillaryData,
          toWei(argv.price.toString())
        );
        console.log(`Proposal bond will be ${proposalBond.toString()}`);

        const receipt = await optimisticOracle.proposePrice(
          requester,
          identifier,
          expirationTimestamp,
          ancillaryData,
          toWei(argv.price.toString())
        );
        console.log(`Proposal transaction: ${receipt.tx}`);
      } catch (err) {
        console.error("Proposal failed for unknown reason: ", err);
      }
    }
  } catch (err) {
    callback(err);
    return;
  }
  callback();
}

module.exports = proposePriceEMP;
