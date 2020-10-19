const ethers = require('ethers')
const assert = require("assert")
function DecodeLog(abi,meta={}){
  assert(abi,'requries abi')
  const iface = new ethers.utils.Interface(abi)
  return log => {
    return {
      ...iface.parseLog(log),
      ...meta,
    }
  }
}

module.exports = {
  DecodeLog
}
