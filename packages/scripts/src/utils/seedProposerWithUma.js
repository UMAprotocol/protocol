const hre = require("hardhat");
const Web3 = require("web3");
const { toWei } = Web3.utils;
const { getContract, web3 } = hre;
const { _getContractAddressByName } = require("./index.js");
const { REQUIRED_SIGNER_ADDRESSES } = require("./constants");

const ExpandedERC20 = getContract("ExpandedERC20");

async function _seedProposerWithUma(proposer, amountToSend = toWei("50000")) {
  const uma = new web3.eth.Contract(ExpandedERC20.abi, await _getContractAddressByName("VotingToken", 1));
  console.log(`🧧 Sending ${amountToSend} of UMA to ${proposer} from foundation wallet 🧧`);
  const accounts = await web3.eth.getAccounts();

  await web3.eth.sendTransaction({
    from: accounts[0],
    to: REQUIRED_SIGNER_ADDRESSES["account_with_uma"],
    value: toWei("1"),
  });

  await uma.methods
    .transfer(
      REQUIRED_SIGNER_ADDRESSES["foundation"],
      await uma.methods.balanceOf(REQUIRED_SIGNER_ADDRESSES["account_with_uma"]).call()
    )
    .send({ from: REQUIRED_SIGNER_ADDRESSES["account_with_uma"] });

  await web3.eth.sendTransaction({ from: accounts[0], to: REQUIRED_SIGNER_ADDRESSES["deployer"], value: toWei("10") });

  await web3.eth.sendTransaction({ from: accounts[0], to: REQUIRED_SIGNER_ADDRESSES["foundation"], value: toWei("2") });
  const txn = await uma.methods
    .transfer(proposer, amountToSend)
    .send({ from: REQUIRED_SIGNER_ADDRESSES["foundation"] });
  console.log(`Transaction: ${txn?.transactionHash}`);
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
