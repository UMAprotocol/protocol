const ethers = require("ethers");
const assert = require("assert");
function DecodeLog(abi, meta = {}) {
  assert(abi, "requries abi");
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
  assert(abi, "requries abi");
  const iface = new ethers.utils.Interface(abi);
  return (transaction, props = {}) => {
    return {
      ...iface.parseTransaction({ data: transaction.input }),
      ...meta,
      ...props
    };
  };
}

function decodeAttribution(data,delimiter="ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff000000000000000000000000"){
  return data.split(delimiter)[1]
}

module.exports = {
  DecodeLog,
  DecodeTransaction,
  decodeAttribution,
};
