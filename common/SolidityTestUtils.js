async function didContractThrow(promise) {
  try {
    await promise;
  } catch (error) {
    return error.message.match(/[invalid opcode|out of gas|revert]/, "Expected throw, got '" + error + "' instead");
  }
  return false;
}

module.exports = {
  didContractThrow
};
