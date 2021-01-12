const ethers = require("ethers");
const assert = require("assert");
const { getAbi } = require("@uma/core");
const Web3 = require("web3");
const web3 = new Web3();

function toChecksumAddress(addr) {
  return web3.utils.toChecksumAddress(addr);
}
function isAddress(addr) {
  return web3.utils.isAddress(addr);
}

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

function GetInputLength(abi) {
  // returns length in bits of solidity type. not exhaustive but covers common params.
  // see more: https://docs.soliditylang.org/en/v0.5.3/abi-spec.html#argument-encoding
  function typeToLength(type) {
    if (type === "uint") return 256;
    if (type === "int") return 256;
    if (type.includes("uint")) {
      return parseInt(type.slice(4));
    }
    if (type.includes("int")) {
      return parseInt(type.slice(3));
    }
    if (type.includes("bool")) return 8;
    if (type == "address") {
      return 160;
    }
    throw new Error("Unknown type specified: " + type);
  }
  function componentLength(component) {
    return typeToLength(component.type);
  }
  function componentsLength(components = []) {
    return components.reduce((sum, component) => {
      return sum + componentLength(component);
    }, 0);
  }
  return name => {
    const find = abi.find(x => x.name === name);
    assert(find, "unable to find name in abi: " + name);
    if (find.inputs == null || find.inputs.length == 0) return 0;
    return find.inputs.reduce((length, input) => {
      return length + componentsLength(input.components);
    }, 32); // 4 bytes always added as function name header hash
  };
}

// Given a transaction, decode the attribution tag from the function. By default only suppports create.
const DecodeAttribution = (abi, name = "create") => {
  // convert bits to hex (div by 4) and add 2 for 0x
  const inputLength = GetInputLength(abi)(name) / 4 + 2;
  return transaction => {
    // tagged transactions are assumed to exist when there is more data than the required inputLength
    // in this case we may return nothing if no tag was added
    return transaction.input.slice(inputLength);
  };
};

// appends attribiion tag to the data or input of a transaction
const encodeAttribution = (data, tag) => {
  assert(data, "requires data string");
  assert(tag, "requires tag string");
  return data.concat(web3.utils.toHex(tag).slice(2));
};

// Utility for encoding data for a transaction
const EncodeCallData = abi => {
  const contract = new web3.eth.Contract(abi);
  return (name, ...args) => {
    return contract.methods[name](...args).encodeABI();
  };
};

// Just wraps abi to pass through to contract Lookup by erc20 address
function Erc20({ abi = getAbi("ERC20"), web3 }) {
  assert(abi, "requires abi for erc20");
  const contract = new web3.eth.Contract(abi);
  function decimals(tokenAddress) {
    assert(tokenAddress, "requires tokenAddress");
    contract.options.address = tokenAddress;
    return contract.methods.decimals().call();
  }
  return {
    decimals
  };
}

// Wrapper for some basic emp functionality.  Currently we just need token and collateral info Lookup by emp address
function Emp({ abi = getAbi("ExpiringMultiParty"), web3 } = {}) {
  assert(abi, "requires abi for expiring multi party");
  const contract = new web3.eth.Contract(abi);
  const erc20 = Erc20({ web3 });
  function tokenCurrency(empAddress) {
    assert(empAddress, "requires empAddress");
    contract.options.address = empAddress;
    return contract.methods.tokenCurrency().call();
  }
  function collateralCurrency(empAddress) {
    assert(empAddress, "requires address");
    contract.options.address = empAddress;
    return contract.methods.collateralCurrency().call();
  }
  async function tokenInfo(empAddress) {
    const tokenAddress = await tokenCurrency(empAddress);
    return {
      address: tokenAddress,
      decimals: await erc20.decimals(tokenAddress)
    };
  }
  async function collateralInfo(empAddress) {
    const tokenAddress = await collateralCurrency(empAddress);
    return {
      address: tokenAddress,
      decimals: await erc20.decimals(tokenAddress)
    };
  }
  async function info(empAddress) {
    return {
      address: empAddress,
      token: await tokenInfo(empAddress),
      collateral: await collateralInfo(empAddress)
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
  DecodeAttribution,
  encodeAttribution,
  Emp,
  Erc20,
  GetInputLength,
  toChecksumAddress,
  isAddress,
  EncodeCallData
};
