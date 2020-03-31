const listMarkets = require("./sponsor/listMarkets");

const sponsorMenu = async (web3, artifacts) => {
  // Pass through directly to `listMarkets` until we have additional options at this top level.
  await listMarkets(web3, artifacts);
};

module.exports = sponsorMenu;
