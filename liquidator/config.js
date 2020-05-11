// Configurable liquidator settings.
const config = {
  price_threshold: 0.02
  // Expressed as a percentage. If a position's CR is `price_threshold %` below the minimum CR allowed,
  // then the bot will liquidate the position. This acts as a defensive buffer against sharp price movements
  // delays in transactions getting mined.
};

module.exports = config;
