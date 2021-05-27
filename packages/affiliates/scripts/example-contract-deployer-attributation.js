// TODO: use this to design a nice library call to handle params and output
const { BigQuery } = require("@google-cloud/bigquery");
const Queries = require("../libs/bigquery");
const moment = require("moment");
const highland = require("highland");
const { DecodeLog } = require("../libs/contracts");
const empAbi = require("../../core/build/contracts/ExpiringMultiParty");
const empCreatorAbi = require("../../core/build/contracts/ExpiringMultiPartyCreator");
const { EmpBalancesHistory } = require("../libs/processors");
const Coingecko = require("../libs/coingecko");
const coingecko = Coingecko();
const ethers = require("ethers");
const { delay } = require("@uma/financial-templates-lib");

const client = new BigQuery();
const queries = Queries({ client });

const empCreator = "0x9A077D4fCf7B26a0514Baa4cff0B481e9c35CE87";

const empContracts = ["0xaBBee9fC7a882499162323EEB7BF6614193312e3", "0x3605Ec11BA7bD208501cbb24cd890bC58D2dbA56"];

// todo: refactor syntheticTokens & decimals to be pulled from the empContract instances
const syntheticTokens = ["0xF06DdacF71e2992E2122A1a0168C6967aFdf63ce", "0xD16c79c8A39D44B2F3eB45D2019cd6A42B03E2A9"];
const syntheticTokenDecimals = [18, 18];

const startingBlock = 11043617;
const startingTimestamp = moment("9/20/2020 23:00:00", "MM/DD/YYYY  HH:mm z").valueOf(); // utc timestamp

const endingBlock = 11089341;
const endingTimestamp = moment("10/19/2020 23:00:00", "MM/DD/YYYY HH:mm z").valueOf();

const devRewardsToDistribute = 50000;

const rewardsPerBlock = devRewardsToDistribute / (endingBlock - startingBlock);

// returns array of EmpBalancesHistory objects for all provided empContracts over time.
async function getEmpBalances(
  empContracts,
  start = moment("9/20/2020", "MM/DD/YYYY").valueOf(),
  end = moment("10/20/2020", "MM/DD/YYYY").valueOf()
) {
  // query starting before emp launch
  const empBalanceHistories = empContracts.map(async (empContract) => {
    const streamEmpEvents = await queries.streamLogsByContract(empContract, start, end);

    const decode = DecodeLog(empAbi.abi);
    const balancesHistory = EmpBalancesHistory();

    await highland(streamEmpEvents)
      // .doto(console.log)
      .map((log) => {
        try {
          return decode(log, {
            blockNumber: log.block_number,
            blockTimestamp: moment(log.block_timestamp.value).valueOf(),
          });
        } catch (err) {
          // decoding log error, abi probably missing an event
          console.log("error decoding log:", err);
        }
      })
      .compact()
      .doto((log) => {
        try {
          balancesHistory.handleEvent(log.blockNumber, log);
        } catch (err) {
          console.log(err, log);
        }
      })
      .last()
      .toPromise(Promise);
    return balancesHistory;
  });
  return empBalanceHistories;
}

// returns a mapping between an emp address and the emp deployer
async function getEmpDeployers(
  empContracts,
  start = moment("9/20/2020", "MM/DD/YYYY").valueOf(),
  end = moment("10/20/2020", "MM/DD/YYYY").valueOf()
) {
  const streamQueryDeployer = await queries.streamLogsByContract(empCreator, start, end);
  // Get the contract deployer for each EMP.
  const decode = DecodeLog(empCreatorAbi.abi);
  const empCreateLogs = await highland(streamQueryDeployer)
    .map((log) => {
      try {
        return decode(log, { blockNumber: log.block_number });
      } catch (err) {
        // decoding log error, abi probably missing an event
        console.log("error decoding log:", err);
      }
    })
    .compact()
    .collect()
    .toPromise(Promise);

  let empCreators = {};
  empCreateLogs.forEach((log) => {
    const empIndex = empContracts.indexOf(log.args.expiringMultiPartyAddress);
    if (empIndex != -1) {
      empCreators[empContracts[empIndex]] = log.args.deployerAddress;
    } else {
      empCreators[empContracts[empIndex]] = null;
    }
  });
  return empCreators;
}

async function getEmpPriceHistories(
  empContracts,
  currency = "usd",
  start = moment("9/20/2020", "MM/DD/YYYY").valueOf()
) {
  const daysBetween = moment().diff(start, "days");
  const coinHistories = await Promise.all(
    empContracts.map((contract) => coingecko.chart(contract.toLowerCase(), currency, daysBetween))
  );
  return coinHistories.map((historyObject) => {
    return historyObject.prices;
  });
}

// Finds the closest needle value within an array haystack.
// TODO: add this to prices model
function closest(needle, haystack) {
  return haystack.reduce((a, b) => {
    const aDiff = Math.abs(a - needle);
    const bDiff = Math.abs(b - needle);

    if (aDiff == bDiff) {
      return a > b ? a : b;
    } else {
      return bDiff < aDiff ? b : a;
    }
  });
}

async function runTest() {
  // Get all EMP balance histories for the array of white listed empContracts.
  const empBalanceHistories = await getEmpBalances(empContracts, startingTimestamp, endingTimestamp);

  // Get the addresses of the EMP contract deployers to send developer mining rewards to
  const empCreators = await getEmpDeployers(empContracts);

  // Get historic prices from an emp from coingecko
  const priceHistories = await getEmpPriceHistories(syntheticTokens);

  // Iterate over balance information over block range and calculate pro-rata $ contribution to each EMP and
  // attribute to devs who deployed the respective EMP
  const snapshotSteps = 64; // this is set to speed up the script. can be set to 1 to make per-block precision.

  let cumulativeValueLocked = {}; // store all EMP's total value locked within the EMP at a given point in time.
  for (let blockNum = startingBlock; blockNum < endingBlock; blockNum = blockNum + snapshotSteps) {
    // at each block compute the sum value of token debt for each empContract
    empContracts.map((empContract, empContractIndex) => {
      empBalanceHistories[empContractIndex].then((balanceHistory) => {
        // calculate the total token debt at the current block for the emp.
        const totalTokenDebtAtBlockForEmp = Object.values(balanceHistory.history.lookup(blockNum).tokens)
          .map((val) => Number(ethers.utils.formatUnits(val, syntheticTokenDecimals[empContractIndex])))
          .reduce((a, b) => a + b, 0);

        // find the closest price information from the congecko data set at the current block timestamp
        const closestPriceToBlockTimestamp = closest(
          balanceHistory.history.lookup(blockNum).blockTimestamp,
          priceHistories[empContractIndex]
        )[1];

        // calculate the value of the token debt as the number of tokens minted times the total price of each token.
        const tokenDebtValueAtBlockForEmp = totalTokenDebtAtBlockForEmp * closestPriceToBlockTimestamp;

        // Store this inforamtion in the cumulativeValueLocked for the current block
        if (!cumulativeValueLocked[blockNum]) cumulativeValueLocked[blockNum] = {};
        cumulativeValueLocked[blockNum][empContract] = tokenDebtValueAtBlockForEmp;
      });
    });
  }

  await delay(5); // HACK to deal with the promises not resolving correctly from the highland stream

  const payoutPerSnapshot = rewardsPerBlock * snapshotSteps;

  // loop over each snapshot generated in the cumulativeValueLocked data set and compute the pro-rata contribution of
  // each developer by dividing their contribution against the total at each snapshot.
  let finalDevPayouts = {};
  Object.values(cumulativeValueLocked).forEach((snapShot) => {
    const totalLiquidAtSnapshot = Object.values(snapShot).reduce((a, b) => a + b, 0);
    Object.keys(snapShot).forEach((empContractAddress) => {
      const empContribuationAtSnapshot = snapShot[empContractAddress] / totalLiquidAtSnapshot;
      const empRewards = empContribuationAtSnapshot * payoutPerSnapshot;
      if (!finalDevPayouts[empCreators[empContractAddress]]) finalDevPayouts[empCreators[empContractAddress]] = 0;
      finalDevPayouts[empCreators[empContractAddress]] = finalDevPayouts[empCreators[empContractAddress]] + empRewards;
    });
  });

  // Lot the final outputs. this should be saved to a file to define the devs entitled to payouts.
  console.log("finalDevPayouts", finalDevPayouts);
}

runTest().then(console.log).catch(console.error);
