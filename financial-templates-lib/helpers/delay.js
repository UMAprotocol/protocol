const delay = ms => new Promise(r => setTimeout(r, ms * 1000));

module.exports = {
  delay
};
