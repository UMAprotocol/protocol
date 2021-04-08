const ERC20 = artifacts.require("ERC20");
const { toBN, fromWei } = web3.utils;

// Run: `yarn truffle exec ./packages/core/scripts/local/getAllUmaVoters.js --network mainnet_mnemonic`
async function run() {
  const uma = await ERC20.at("0x04Fa0d235C4abf4BcF4787aF4CF447DE572eF828");

  // Get all Transfer events
  const transfers = await uma.getPastEvents("Transfer", {
    // Usual LM payer:
    filter: { from: "0x2c0c74201d1ed3fd6d208af4be922f6fb5c9cdcf" },
    fromBlock: 0,
    toBlock: "latest"
  });
  console.log(`Transfer count: ${transfers.length}`);

  // Looping through each transfer event, create unique set of UMA holders who have hever held UMA.
  const recipients = {};
  for (let transfer of transfers) {
    const recipient = transfer.returnValues.to.toLowerCase();

    // If we haven't seen recipient before, instantiate their balances:
    if (!recipients[recipient]) {
      recipients[recipient] = {
        receivedBalance: toBN(transfer.returnValues.value),
        currentBalance: await uma.balanceOf(recipient)
      };
    } else {
      // If we have seen them before, increment their received balance.
      recipients[recipient] = {
        ...recipients[recipient],
        receivedBalance: recipients[recipient]["receivedBalance"].add(toBN(transfer.returnValues.value))
      };
    }
  }

  // Sort by total received:
  Object.keys(recipients).map(address => {
    console.log(
      `${address}: ${fromWei(recipients[address].receivedBalance.toString())} [${fromWei(
        recipients[address].currentBalance.toString()
      )}]`
    );
  });
}

async function wrapper(callback) {
  try {
    await run();
  } catch (e) {
    // Forces the script to return a nonzero error code so failure can be detected in bash.
    callback(e);
    return;
  }

  callback();
}

module.exports = wrapper;
