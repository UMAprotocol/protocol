const Web3 = require("web3");
const { getAbi } = require("@uma/core");
const argv = require("minimist")(process.argv.slice(), { string: ["emp", "tag", "tokens", "collateral"] });

const web3 = new Web3();

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
  const emp = new web3.eth.Contract(getAbi("ExpiringMultiParty"));
  const encodedData = emp.methods
    .create({ rawValue: web3.utils.toWei(collateralToSend) }, { rawValue: web3.utils.toWei(tokensToCreate) })
    .encodeABI();
  return encodedData;
}

// This takes encoded data field and just appends the tag
function tagData(data, tag) {
  // convert tag to hex and remove the 0x prefix
  return data.concat(web3.utils.toHex(tag).slice(2));
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
  // Example of how to send the transaction with web3. This requires you instanciate it with a valid
  // provider and signer. This example application only shows how to construct the transaction and does not
  // instanciate a provider for you.

  // The signer in this case must match the "from" field of the transaction.
  // See web3 docs https://web3js.readthedocs.io/en/v1.3.0/web3.html#web3-instance
  // https://web3js.readthedocs.io/en/v1.3.0/web3-eth.html#sendtransaction

  // SENDING TRANSACTION:
  // await web3.eth.sendTransaction(transaction)
}

runExample();
