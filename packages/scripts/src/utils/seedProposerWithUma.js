const hre = require("hardhat");
const Web3 = require("web3");
const { toWei } = Web3.utils;
const { getContract, web3 } = hre;
const { _getContractAddressByName } = require("./index.js");
const { REQUIRED_SIGNER_ADDRESSES } = require("./constants");
const { getAddress } = require("@uma/contracts-node");

const ExpandedERC20 = getContract("ExpandedERC20");

async function _seedProposerWithUma(proposer, amountToSend = toWei("50000")) {
  const uma = new web3.eth.Contract(ExpandedERC20.abi, await _getContractAddressByName("VotingToken", 1));
  console.log(`🧧 Sending ${amountToSend} of UMA to ${proposer} from foundation wallet 🧧`);
  const accounts = await web3.eth.getAccounts();
  await web3.eth.sendTransaction({
    from: accounts[0],
    to: REQUIRED_SIGNER_ADDRESSES["foundation"],
    value: toWei("10"),
  });
  const txn = await uma.methods
    .transfer(proposer, amountToSend)
    .send({ from: REQUIRED_SIGNER_ADDRESSES["foundation"] });
  console.log(`Transaction: ${txn?.transactionHash}`);

  const votingV2Address = await getAddress("VotingV2", 1);
  const etherAmount = hre.ethers.utils.parseEther("10.0").toHexString();
  await hre.network.provider.send("hardhat_setBalance", [votingV2Address, etherAmount]);
  await hre.network.provider.request({
    method: "hardhat_impersonateAccount",
    params: [votingV2Address],
  });
  await uma.methods.mint(REQUIRED_SIGNER_ADDRESSES["foundation"], toWei("50000000")).send({
    from: votingV2Address,
  });

  console.log(
    "Balance UMA foundation wallet:",
    await uma.methods.balanceOf(REQUIRED_SIGNER_ADDRESSES["foundation"]).call()
  );
}

async function run() {
  await _seedProposerWithUma(REQUIRED_SIGNER_ADDRESSES["deployer"]);
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
