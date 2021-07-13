function validateAddress(address) {
  return address.substring(0, 2) == "0x" || address.length == 42;
}

module.exports = { validateAddress };
