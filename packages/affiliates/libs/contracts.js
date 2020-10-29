const ethers = require("ethers");
const assert = require("assert");
const { getAbi } = require("@uma/core");
function DecodeLog(abi, meta = {}) {
  assert(abi, "requires abi");
  const iface = new ethers.utils.Interface(abi);
  return (log, props = {}) => {
    return {
      ...iface.parseLog(log),
      ...meta,
      ...props
    };
  };
}
function DecodeTransaction(abi, meta = {}) {
  assert(abi, "requires abi");
  const iface = new ethers.utils.Interface(abi);
  return (transaction, props = {}) => {
    return {
      ...iface.parseTransaction({ data: transaction.input }),
      ...meta,
      ...props
    };
  };
}

function decodeAttribution(
  data,
  delimiter = "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff000000000000000000000000"
) {
  assert(data, "requires data to decode");
  return data.split(delimiter)[1];
}

// Just wraps abi to pass through to contract
// Lookup by erc20 address
function Erc20({ abi = getAbi("ERC20"), web3 }) {
  assert(abi, "requires abi for erc20");
  const contract = new web3.eth.Contract(abi);
  function decimals(address) {
    assert(address, "requires address");
    contract.options.address = address;
    return contract.methods.decimals().call();
  }
  return {
    decimals
  };
}

// Wrapper for some basic emp functionality.
// Currently we just need token and collateral info
// Lookup by emp address
function Emp({ abi = getAbi("ExpiringMultiParty"), web3 } = {}) {
  assert(abi, "requires abi for expiring multi party");
  const contract = new web3.eth.Contract(abi);
  const erc20 = Erc20({ web3 });
  function tokenCurrency(address) {
    assert(address, "requires address");
    contract.options.address = address;
    return contract.methods.tokenCurrency().call();
  }
  function collateralCurrency(address) {
    assert(address, "requires address");
    contract.options.address = address;
    return contract.methods.collateralCurrency().call();
  }
  async function tokenInfo(address) {
    const tokenAddress = await tokenCurrency(address);
    return {
      address: tokenAddress,
      decimals: await erc20.decimals(tokenAddress)
    };
  }
  async function collateralInfo(address) {
    const tokenAddress = await collateralCurrency(address);
    return {
      address: tokenAddress,
      decimals: await erc20.decimals(tokenAddress)
    };
  }
  async function info(address) {
    return {
      address,
      token: await tokenInfo(address),
      collateral: await collateralInfo(address)
    };
  }
  return {
    tokenCurrency,
    collateralCurrency,
    collateralInfo,
    tokenInfo,
    info
  };
}

module.exports = {
  DecodeLog,
  DecodeTransaction,
  decodeAttribution,
  Emp,
  Erc20
};
