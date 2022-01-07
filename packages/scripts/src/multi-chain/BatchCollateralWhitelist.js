// Simple script to initialize a whitelist on a new L2 chain by mapping the existing L1 whitelist. This script assumes
// that the EOA unlocked on the L2 is currently the owner of both the AddressWhitelist and the Store contracts i.e
// this is a fresh deployment of the L2 chain and ownership has not yet been transferred to the OracleSpoke.

require("dotenv").config();

const { getWeb3ByChainId } = require("@uma/common");

const { getAbi, getAddress } = require("@uma/contracts-node");
const { ZERO_ADDRESS } = require("@uma/common");

const { fetchFullL1Whitelist, findL2TokenForL1Token } = require("./utils");
const argv = require("minimist")(process.argv.slice(), { number: ["l1ChainId", "l2ChainId"] });

async function run() {
  const { l1ChainId, l2ChainId } = argv;

  const l1Web3 = getWeb3ByChainId(l1ChainId);
  const l2Web3 = getWeb3ByChainId(l2ChainId);
  const l1Account = (await l1Web3.eth.getAccounts())[0];

  console.log(`Running OVM Batch Collateral whitelister from ${l1ChainId}->${l2ChainId} with`);

  console.log("Finding L1 whitelist...");
  const l1TokenWhitelistArray = await fetchFullL1Whitelist(l1Web3, l1ChainId);
  console.log("found a total of " + l1TokenWhitelistArray.length + " L1 tokens on the whitelist");

  console.log("Finding associated L2 tokens for whitelisted l1 tokens...");
  const associatedL2Tokens = await Promise.all(
    l1TokenWhitelistArray.map((l1TokenWhitelist) =>
      findL2TokenForL1Token(l2Web3, l2ChainId, l1TokenWhitelist.l1TokenAddress)
    )
  );

  // Remove any tokens that are not found on L2.
  const combineSet = l1TokenWhitelistArray
    .map((l1TokenWhitelist, index) => {
      return { ...l1TokenWhitelist, l2TokenAddress: associatedL2Tokens[index] };
    })
    .filter((tokenList) => tokenList.l2TokenAddress !== ZERO_ADDRESS);

  console.log("Found the following L1->L1 mapping and the associated final fees");
  console.table(combineSet);

  console.log("Adding these tokens the the L2 token whitelist...");
  const l2TokenWhitelist = new l2Web3.eth.Contract(
    getAbi("AddressWhitelist"),
    await getAddress("AddressWhitelist", l2ChainId)
  );
  const l2Store = new l2Web3.eth.Contract(getAbi("Store"), await getAddress("Store", l2ChainId));

  for (let index = 0; index < combineSet.length; index++) {
    console.log(
      `Whitelisting ${combineSet[index].symbol} at ${combineSet[index].l1TokenAddress} with fee ${combineSet[index].finalFee}`
    );
    await l2TokenWhitelist.methods.addToWhitelist(combineSet[index].l2TokenAddress).send({ from: l1Account });
    await l2Store.methods
      .setFinalFee(combineSet[index].l2TokenAddress, { fixedPoint: combineSet[index].finalFee })
      .send({ from: l1Account });
  }
  console.log("DONE!");
}

function main() {
  const startTime = Date.now();
  run()
    .catch((err) => {
      console.error(err);
    })
    .finally(() => {
      const timeElapsed = Date.now() - startTime;
      console.log(`Done in ${(timeElapsed / 1000).toFixed(2)}s`);
    });
}
main();
