// Only the browser-safe modules.
module.exports = {
  ...require("./src/AbiUtils"),
  ...require("./src/AdminUtils"),
  ...require("./src/Constants"),
  ...require("./src/ContractUtils"),
  ...require("./src/Crypto"),
  ...require("./src/EmpUtils"),
  ...require("./src/EncryptionHelper"),
  ...require("./src/Enums"),
  ...require("./src/FormattingUtils"),
  ...require("./src/ObjectUtils"),
  ...require("./src/PublicNetworks"),
  ...require("./src/Random"),
  ...require("./src/SolcoverConfig"),
  ...require("./src/SolidityTestUtils"),
  ...require("./src/TimeUtils"),
  ...require("./src/VotingUtils"),
  ...require("./src/PriceIdentifierUtils"),
  ...require("./src/FindContractVersion"),
  ...require("./src/MultiVersionTestHelpers.js")
};
