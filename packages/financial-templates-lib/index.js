module.exports = {
  ...require("./src/clients/ExpiringMultiPartyClient"),
  ...require("./src/clients/ExpiringMultiPartyEventClient"),
  ...require("./src/clients/TokenBalanceClient"),
  ...require("./src/helpers/delay"),
  ...require("./src/helpers/GasEstimator"),
  ...require("./src/logger/Logger"),
  ...require("./src/logger/SpyTransport"),
  ...require("./src/price-feed/CreatePriceFeed"),
  ...require("./src/price-feed/Networker"),
  ...require("./src/price-feed/PriceFeedMock"),
  ...require("./src/price-feed/PriceFeedMockScaled")
};
