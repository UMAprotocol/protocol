function delay(s) {
  return new Promise(r => setTimeout(r, s * 1000));
}

module.exports = {
  delay
};
