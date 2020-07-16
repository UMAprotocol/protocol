const Web3 = require("web3");

const erc20Abi = require("./abi/IERC20.json");

const oneSplitAbi = require("./abi/OneSplit.json");
const oneSplitAddress = "0xC586BeF4a0992C495Cf22e1aeEE4E446CECDee0E";

// As defined in 1inch
const ETH_ADDRESS = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";

class OneInchExchange {
  /**
   * @notice Creates OneInchExchange client
   * @param {Object} web3 Web3 instance
   * */
  constructor({ web3 }) {
    this.web3 = web3;
    this.web3.currentProvider.timeout = 120000;
    this.oneSplitContract = new web3.eth.Contract(oneSplitAbi, oneSplitAddress);

    this.toBN = web3.utils.toBN;
  }

  /**
   * @notice Swaps token on one inch
   * @param {string} fromToken Address of token to swap from
   * @param {string} toToken Address of token to swap to.
   * @param {string} amountWei String amount to swap, in Wei.
   * @param {Object} options Web3 options to supply to send, e.g.
   *      { from: '0x0...',
            value: '1000',
            gasPrice: '... }
   */
  async swap({ fromToken, toToken, amountWei }, options = {}) {
    if (!options.from) {
      throw new Error("Missing from key in options");
    }

    // Need to approve ERC20 tokens
    if (fromToken !== ETH_ADDRESS) {
      const erc20Contract = new this.web3.eth.Contract(erc20Abi, fromToken);
      await erc20Contract.methods.approve(oneSplitAddress, amountWei).send({
        from: options.from
      });
    }

    // 1 Split config
    const flags = 0; // Enables all exchanges
    const parts = 2;

    const expectedReturn = await this.oneSplitContract.methods
      .getExpectedReturn(fromToken, toToken, amountWei, parts, flags)
      .call();

    const { returnAmount, distribution } = expectedReturn;

    const tx = await this.oneSplitContract.methods
      .swap(fromToken, toToken, amountWei, returnAmount, distribution, flags)
      .send({ ...options, gas: 8000000 });

    return tx;
  }
}

const main = async () => {
  const web3 = new Web3(new Web3.providers.HttpProvider("http://localhost:9545", { timeout: 120000 }));
  const { toWei, toBN } = web3.utils;

  const accounts = await web3.eth.getAccounts();
  const user = accounts[0];

  const ETH_ADDRESS = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";
  const DAI_ADDRESS = "0x6b175474e89094c44da98b954eedeac495271d0f";
  const BAT_ADDRESS = "0x0d8775f648430679a709e98d2b0cb6250d2887ef";

  const oneInch = new OneInchExchange({ web3 });

  const getBalance = async ({ tokenAddress, userAddress }) => {
    if (tokenAddress === ETH_ADDRESS) {
      return web3.eth.getBalance(userAddress);
    }

    const contract = new web3.eth.Contract(erc20Abi, tokenAddress);
    return contract.methods.balanceOf(userAddress).call();
  };

  const assertBNGreaterThan = (a, b) => {
    const [aBN, bBN] = [a, b].map(x => toBN(x));
    if (!aBN.gt(bBN)) throw new Error(`${aBN.toString()} is not greater than ${bBN.toString()}`);
  };

  const swapAndCheck = async ({ fromToken, toToken, amountWei }) => {
    const initialBal = await getBalance({ tokenAddress: toToken, userAddress: user });

    await oneInch.swap(
      {
        fromToken,
        toToken,
        amountWei
      },
      fromToken === ETH_ADDRESS ? { value: amountWei, from: user } : { from: user }
    );

    const finalBal = await getBalance({ tokenAddress: toToken, userAddress: user });

    assertBNGreaterThan(finalBal, initialBal);
  };

  // await swapAndCheck({
  //   fromToken: ETH_ADDRESS,
  //   toToken: DAI_ADDRESS,
  //   amountWei: toWei("5")
  // });
  // console.log("Swapped ETH for DAI!");

  // await swapAndCheck({
  //   fromToken: DAI_ADDRESS,
  //   toToken: BAT_ADDRESS,
  //   amountWei: toWei("5")
  // });
  // console.log("Swapped DAI for BAT!");

  // await swapAndCheck({
  //   fromToken: DAI_ADDRESS,
  //   toToken: ETH_ADDRESS,
  //   amountWei: toWei("10")
  // });
  console.log(web3.currentProvider);
};

// main();

module.exports = {
  OneInchExchange
};
