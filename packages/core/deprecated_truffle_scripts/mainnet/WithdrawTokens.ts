// This script a withdrawal transaction that will pull funds out of a specified wallet. The wallet you run the script
// from should be the wallet you're withdrawing tokens from.
// To execute the script, from core, run: yarn truffle exec ./scripts/mainnet/WithdrawTokens.ts --network mainnet_mnemonic --tokenAddress 0x... --amount max --recipientAddress 0x...
// Note:
// 1) the script will use the address of the wallet used to run the script as the from address.
// 2) if you provide max for amount then the script will take all tokens. If you provide a specific number, it is assumed
// to be a string. No internal scaling is done on the number. 1 eth should be therefore represented as 1000000000000000000

async function WithdrawTokens() {
  const winston = require("winston");
  const assert = require("assert");
  const argv = require("minimist")(process.argv.slice(), {
    string: ["tokenAddress", "amount", "recipientAddress"],
  });

  const { getWeb3 } = require("@uma/common");
  const web3 = getWeb3();

  const { getTruffleContract } = require("@uma/core");
  const { GasEstimator } = require("@uma/financial-templates-lib");

  assert(
    argv.tokenAddress && argv.amount && argv.recipientAddress,
    "Provide `tokenAddress`, `recipientAddress`, and `amount`. Amount can be `max` to pull all tokens."
  );
  assert(web3.utils.isAddress(argv.tokenAddress), "`tokenAddress` needs to be a valid address");
  assert(web3.utils.isAddress(argv.recipientAddress), "`recipientAddress` needs to be a valid address");
  console.log("Running Token withdrawal script 💰");

  const ExpandedERC20 = getTruffleContract("ExpandedERC20", web3, "latest");

  const [accounts, networkId] = await Promise.all([web3.eth.getAccounts(), web3.eth.net.getId()]);
  console.log("Connected to network id:", networkId);
  console.log("Unlocked account:", accounts[0]);

  const logger = winston.createLogger({
    level: "debug",
    transports: [new winston.transports.Console()],
  });
  const gasEstimator = new GasEstimator(logger);
  await gasEstimator.update();

  const token = await ExpandedERC20.at(argv.tokenAddress);
  const balance = await token.balanceOf(accounts[0]);
  console.log("Balance:", balance.toString());

  // Figure out how many tokens to withdraw. If max, then query the full balance of the unlocked account. Else, use specified.
  const amountToWithdraw = (argv.amount == "max" ? await token.balanceOf(accounts[0]) : argv.amount).toString();

  // Send the transaction against the DSProxy manager.
  const tx = await token.transfer(argv.recipientAddress, amountToWithdraw, {
    from: accounts[0],
    ...gasEstimator.getCurrentFastPrice(),
  });

  console.log(`Sent ${amountToWithdraw} ${await token.symbol()} to ${argv.recipientAddress}.`);
  console.log(tx.transactionHash);
}

const run = async function (callback) {
  try {
    await WithdrawTokens();
  } catch (err) {
    console.error(err);
    callback(err);
    return;
  }
  callback();
};

run.WithdrawTokens = WithdrawTokens;
module.exports = run;
