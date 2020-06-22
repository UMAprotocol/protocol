function delay(ms) {
  return new Promise(r => setTimeout(r, ms));
}

module.exports = {
  delay
};
