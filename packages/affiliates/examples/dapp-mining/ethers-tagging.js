const { ethers } = require("ethers");
const { getAbi } = require("@uma/contracts-node");
const argv = require("minimist")(process.argv.slice(), { string: ["emp", "tag", "tokens", "collateral"] });

const {
  // example emp for uusd weth
  emp = "0x3605Ec11BA7bD208501cbb24cd890bC58D2dbA56",
  // this should technically be a legit payout address for dapp mining rewards
  tag = "0xa0dfF1F09a0DCEda7641b7eB07c3BDbe66a06C35",
  // how many tokens to mint
  tokens = "100",
  // how much collateral to back the tokens
  collateral = "100000",
} = argv;

// This is an example of creating a position in an EMP, the only function which needs to be tagged with your address
function createData(empAddress, collateralToSend, tokensToCreate) {
  const emp = new ethers.utils.Interface(getAbi("ExpiringMultiParty"));
  return emp.encodeFunctionData("create", [
    { rawValue: ethers.utils.parseUnits(collateralToSend) },
    { rawValue: ethers.utils.parseUnits(tokensToCreate) },
  ]);
}

// This takes encoded data field and just appends the tag
// The tag must be valid hex
function tagData(data, tag) {
  return ethers.utils.hexConcat([data, tag]);
}

// Example of how you would construct the transaction with data field to be signed by private key
function makeTransaction(data) {
  return { from: tag, to: emp, data };
}

function runExample() {
  console.log("Running example with the following parameters:");
  console.table({ emp, tag, tokens, collateral });
  const data = createData(emp, collateral, tokens);
  const taggedData = tagData(data, tag);
  const transaction = makeTransaction(taggedData);
  console.log("Example Transaction:");
  console.table(transaction);

  // Example of how to send transaction with ethers.  This requires you instanciate ethers with a correct provider
  // and signer which matches the "from" field of the transaction. This example does not instanciate a provider.

  // Docs on provider: https://docs.ethers.io/v5/api/providers/provider/
  // Docs on signer: https://docs.ethers.io/v5/api/signer/
  // Docs on sendTransaction: https://docs.ethers.io/v5/api/signer/#Signer-sendTransaction

  // SENDING TRANSACTION:
  // const provider = new ethers.providers.JsonRpcProvider(providerUrl);
  // const signer = provider.getSigner();
  // await signer.sendTransaction(transaction)
}

runExample();
