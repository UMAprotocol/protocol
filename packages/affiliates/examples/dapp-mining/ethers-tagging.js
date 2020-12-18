const { ethers } = require("ethers");
const { getAbi } = require("@uma/core");
const argv = require("minimist")(process.argv.slice(), { string: ["emp", "tag", "tokens", "collateral"] });

const {
  // example emp for uusd weth
  emp = "0x3605Ec11BA7bD208501cbb24cd890bC58D2dbA56",
  // this should technically be a legit payout address for dapp mining rewards
  tag = "0xa0dfF1F09a0DCEda7641b7eB07c3BDbe66a06C35",
  // how many tokens to mint
  tokens = "100",
  // how much collateral to back the tokens
  collateral = "100000"
} = argv;

// This is an example of creating a position in an EMP, the only function which needs to be tagged with your address
function createData(empAddress, collateralToSend, tokensToCreate) {
  const emp = new ethers.utils.Interface(getAbi("ExpiringMultiParty"));
  return emp.encodeFunctionData("create", [
    { rawValue: ethers.utils.parseUnits(collateralToSend) },
    { rawValue: ethers.utils.parseUnits(tokensToCreate) }
  ]);
}

// This takes encoded data field and just appends the tag
// The tag must be valid hex
function tagData(data, tag) {
  return ethers.utils.hexConcat([data, tag]);
}

// Example of how you would construct the transaction with data field to be signed by private key
function makeTransaction(data) {
  return {
    from: tag,
    to: emp,
    data
  };
}

function runExample() {
  console.log("Running example with the following parameters:");
  console.table({
    emp,
    tag,
    tokens,
    collateral
  });
  const data = createData(emp, collateral, tokens);
  const taggedData = tagData(data, tag);
  const transaction = makeTransaction(taggedData);
  console.log("Example Transaction:");
  console.table(transaction);
}

runExample();
