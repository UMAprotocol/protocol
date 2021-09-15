require("dotenv").config();
const { Emp } = require("../libs/contracts");
const { getAbi } = require("@uma/contracts-node");
const address = "0x45788a369f3083c02b942aEa02DBa25C466a773F";
const Web3 = require("web3");
// this was added to figure out why contract calls were failing. it turns out it was due to importing web3 from getWeb3 in common
async function run() {
  const web3 = new Web3(process.env.CUSTOM_NODE_URL);
  const abi = getAbi("ExpiringMultiParty");
  const emp = Emp({ web3, abi });
  return emp.collateralInfo(address);
}

run().then(console.log).catch(console.error);
