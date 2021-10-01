// Usage: $(npm bin)/truffle exec ./scripts/ClaimAllRewards.js --batcherAddress 0x82458d1C812D7c930Bb3229c9e159cbabD9AA8Cb --network mainnet_mnemonic
// Other optional args:
// --round <round id> Example: `--round 9344 --round 9342`. This only considers rewards for rounds 9344 and 9342.
// --claimAddress <address> Example: `--claimAddress 0x1234 --claimAddress 0x5678`. This only considers rewards for
//   0x1234 and 0x5678. Defaults to claiming for _all_ addresses.
// --excludeAddress <address> Example: `--excludeAddress 0x1234 --excludeAddress 0x5678`. This excludes addresses
//   0x1234 and 0x5678. Defaults to excluding no addresses.
// --onlyPrint. This flag takes no arguments. It tells the script to just print out the available rewards rather than
//   trying to claim them. Default off.
// --version <version string>. Example: `--version 1.2.2 --version latest` DVM versions to consider when claiming.
//   Since a new Voting contract was deployed in version 2.0.0, that version will only claim for that contract, not
//   older ones. Defaults to 1.2.2 and latest.

const { getAbi, getAddress } = require("../../dist/index");
const TransactionBatcher = artifacts.require("TransactionBatcher");
const lodash = require("lodash");
const winston = require("winston");
const { GasEstimator } = require("@uma/financial-templates-lib");

const argv = require("minimist")(process.argv.slice(), {
  string: ["round", "batcherAddress", "claimAddress", "excludeAddress", "version"],
  boolean: "onlyPrint",
});

const { toBN, toWei, toChecksumAddress } = web3.utils;

// This script claims all voter's rewards for the round provided.
async function claimRewards() {
  const rounds = argv.round ? lodash.castArray(argv.round) : [];
  const excludeAddresses = argv.excludeAddress ? lodash.castArray(argv.excludeAddress).map(toChecksumAddress) : [];
  const claimAddresses = argv.claimAddress ? lodash.castArray(argv.claimAddress).map(toChecksumAddress) : [];
  const versions = argv.version ? lodash.castArray(argv.version) : ["latest", "1.2.2"];

  const account = (await web3.eth.getAccounts())[0];
  const networkId = await web3.eth.net.getId();

  const votingContracts = versions.map((version) => {
    if (version.startsWith("1")) {
      return new web3.eth.Contract(getAbi("Voting", version), getAddress("Voting", networkId, version));
    } else {
      // This uses the VotingAncillaryInterfaceTesting to create a voting contract that has _only_ the ancillary
      // functions and events. This interface also includes almost all the regular voting methods that are unrelated
      // to the ancillary data change. Using this interface effectively avoids the overload problem.
      return new web3.eth.Contract(getAbi("VotingAncillaryInterfaceTesting"), getAddress("Voting", networkId, version));
    }
  });

  const events = lodash.flatten(
    await Promise.all(
      votingContracts.map((voting) =>
        voting.getPastEvents("VoteRevealed", {
          filter: { roundId: rounds, voter: claimAddresses },
          fromBlock: 0,
          toBlock: "latest",
        })
      )
    )
  );

  const priceRequestMap = {};
  for (const event of events) {
    const voter = event.returnValues.voter;
    const round = event.returnValues.roundId;
    const contractAddress = event.address;
    const key = [voter, round, contractAddress].join("|");
    if (excludeAddresses.includes(toChecksumAddress(voter))) {
      console.log("Found noclaim voter", voter);
      continue;
    }
    const newPriceRequest = {
      identifier: event.returnValues.identifier,
      time: event.returnValues.time,
      ancillaryData: event.returnValues.ancillaryData === null ? "0x" : event.returnValues.ancillaryData,
    };
    if (priceRequestMap[key]) {
      priceRequestMap[key].push(newPriceRequest);
    } else {
      priceRequestMap[key] = [newPriceRequest];
    }
  }

  const retrievableRewards = (
    await Promise.all(
      Object.entries(priceRequestMap).map(async ([key, priceRequests]) => {
        const [voter, round, contractAddress] = key.split("|");
        const voting = votingContracts.find(
          (contract) => toChecksumAddress(contract.options.address) === toChecksumAddress(contractAddress)
        );
        if (!voting) throw `Couldn't find voting contract for ${contractAddress}`;
        const fullVotingContract = new web3.eth.Contract(getAbi("Voting"), voting.options.address);
        const migratedAddress = await fullVotingContract.methods.migratedAddress().call();
        try {
          const output = await voting.methods
            .retrieveRewards(voter, round, priceRequests)
            .call({ from: migratedAddress });
          if (output.toString() === "0") {
            return null;
          } else if (toBN(output.toString()).gt(toBN(toWei("100000000")))) {
            // If the output is bigger than 100MM tokens, that means this is _really_ a revert.
            return null;
          } else {
            console.log("Found Rewards for voter", voter);
            return { voter, priceRequests, round, voting, rewards: toBN(output.toString()) };
          }
        } catch (error) {
          console.error(error);
          return null;
        }
      })
    )
  ).filter((element) => element !== null);

  if (argv.onlyCompute) {
    const groupedByVoter = lodash.groupBy(retrievableRewards, (el) => el.voter);
    Object.entries(groupedByVoter).forEach(([voter, rewardArray]) => {
      console.group(`Reward details for voter ${voter}:`);
      rewardArray.forEach(({ priceRequests, round, voting, rewards }) => {
        console.group(`Reward from voting contract ${voting.options.address}:`);
        console.log(`Round: ${round} has ${priceRequests.length} rewards to claim.`);
        priceRequests.forEach(({ identifier, time, ancillaryData }, i) => {
          console.group(`Price Request ${i}`);
          console.log(`Identifier: ${identifier} (${web3.utils.hexToUtf8(identifier)})`);
          console.log(`Time: ${time}`);
          if (ancillaryData) console.log(`Ancillary data: ${ancillaryData}`);
          console.groupEnd();
        });
        console.log(`Total Rewards: ${web3.utils.fromWei(rewards.toString())}`);
        console.groupEnd();
      });
      console.groupEnd();
    });
    const rewardSummary = Object.fromEntries(
      Object.entries(groupedByVoter).map(([voter, rewardArray]) => {
        const totalRewards = rewardArray.reduce((sum, { rewards }) => sum.add(rewards), toBN("0"));
        return [voter, web3.utils.fromWei(totalRewards.toString())];
      })
    );
    console.group("Per-voter reward summary:");
    console.log(rewardSummary);
    console.groupEnd();
    return;
  }

  const dataArray = retrievableRewards.map(({ voter, priceRequests, round, voting }) => {
    return voting.methods.retrieveRewards(voter, round, priceRequests).encodeABI();
  });

  const valuesArray = retrievableRewards.map(() => "0");
  const targetArray = retrievableRewards.map(({ voting }) => voting.options.address);

  const transactionBatcher = await TransactionBatcher.at(argv.batcherAddress);

  const gasEstimator = new GasEstimator(
    winston.createLogger({ silent: true }),
    60, // Time between updates.
    networkId
  );

  // These nested calls just chunk up the above arrays into 30 transaction chunks, then organize them in groups for
  // sending on-chain.
  await Promise.all(
    lodash
      .zip(...[targetArray, valuesArray, dataArray].map((arr) => lodash.chunk(arr, 30)))
      .map(async ([chunkedTargetArray, chunkedValueArray, chunkedDataArray]) => {
        const txn = transactionBatcher.contract.methods.batchSend(
          chunkedTargetArray,
          chunkedValueArray,
          chunkedDataArray
        );
        const gasEstimate = await txn.estimateGas({ from: account });

        if (gasEstimate > 6000000) {
          throw "The transaction requires too much gas. Will need to be split up.";
        }
        await gasEstimator.update();

        const receipt = await txn.send({ ...gasEstimator.getCurrentFastPrice(), gas: gasEstimate * 2, from: account });

        console.log("Transaction hash", receipt.transactionHash);
      })
  );
}

async function wrapper(callback) {
  try {
    await claimRewards();
  } catch (e) {
    // Forces the script to return a nonzero error code so failure can be detected in bash.
    callback(e);
    return;
  }

  callback();
}

module.exports = wrapper;
