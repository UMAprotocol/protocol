const { getAbi } = require("@uma/core");
const { getWeb3 } = require("@uma/common");
const web3 = getWeb3();

async function run() {
  console.log("running on", web3.version);

  const accounts = await web3.eth.getAccounts();
  console.log({ accounts });

  const tkn = new web3.eth.Contract(getAbi("TestnetERC20"), "0xbF7A7169562078c96f0eC1A8aFD6aE50f12e5A99");

  //   let tx = await tkn.methods
  //     .approve("0xe101B874431B5dc96f6d19fC1DE16eAD922D639b", 100)
  //     .send({ from: accounts[0], type: "0x2", maxPriorityFeePerGas: 1e9, maxFeePerGas: 10e9 });

  let tx = await web3.eth.sendTransaction({
    from: accounts[0],
    to: tkn.options.address,
    data: tkn.methods.approve("0x9A8f92a830A5cB89a3816e3D267CB7791c16b04D", 100).encodeABI(),
    maxFeePerGas: 10e9,
    maxPriorityFeePerGas: 1e9,
    type: 0x2,
  });

  console.log("tx", tx);
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
      process.exit(1);
    });
}
main();
