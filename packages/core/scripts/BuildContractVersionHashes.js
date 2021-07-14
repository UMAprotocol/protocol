const assert = require("assert");
const path = require("path");
const fs = require("fs");

const { toWei, utf8ToHex, padRight, soliditySha3 } = web3.utils;

const { createConstructorParamsForContractVersion, interfaceName } = require("@uma/common");
const { getTruffleContract } = require("../dist/index.js");

const buildVersion = "2.0.1"; // this is the version that will be built and appended to the FindContractVersion util.

async function buildHashes(contractType) {
  assert(contractType == "Perpetual" || contractType == "ExpiringMultiParty", "Invalid contract type defined!");

  const contractCreator = (await web3.eth.getAccounts())[0];

  const FinancialContract = getTruffleContract(contractType, web3, buildVersion);
  const Finder = getTruffleContract("Finder", web3, buildVersion);
  const IdentifierWhitelist = getTruffleContract("IdentifierWhitelist", web3, buildVersion);
  const AddressWhitelist = getTruffleContract("AddressWhitelist", web3, buildVersion);
  const MockOracle = getTruffleContract("MockOracle", web3, buildVersion);
  const Token = getTruffleContract("ExpandedERC20", web3, buildVersion);
  const SyntheticToken = getTruffleContract("SyntheticToken", web3, buildVersion);
  const Timer = getTruffleContract("Timer", web3, buildVersion);
  const Store = getTruffleContract("Store", web3, buildVersion);
  const ConfigStore = getTruffleContract("ConfigStore", web3, buildVersion);
  const OptimisticOracle = getTruffleContract("OptimisticOracle", web3, buildVersion);

  const identifier = "TEST_IDENTIFIER";
  const fundingRateIdentifier = "TEST_FUNDING_IDENTIFIER";

  const finder = await Finder.new({ from: contractCreator });

  const identifierWhitelist = await IdentifierWhitelist.new({ from: contractCreator });
  await identifierWhitelist.addSupportedIdentifier(utf8ToHex(identifier), { from: contractCreator });

  await finder.changeImplementationAddress(utf8ToHex(interfaceName.IdentifierWhitelist), identifierWhitelist.address, {
    from: contractCreator,
  });

  const timer = await Timer.new({ from: contractCreator });

  const mockOracle = await MockOracle.new(finder.address, timer.address, { from: contractCreator });
  await finder.changeImplementationAddress(utf8ToHex(interfaceName.Oracle), mockOracle.address, {
    from: contractCreator,
  });

  const store = await Store.new({ rawValue: "0" }, { rawValue: "0" }, timer.address, { from: contractCreator });
  await finder.changeImplementationAddress(utf8ToHex(interfaceName.Store), store.address, { from: contractCreator });

  await finder.changeImplementationAddress(utf8ToHex(interfaceName.FinancialContractsAdmin), contractCreator, {
    from: contractCreator,
  });

  const syntheticToken = await SyntheticToken.new("Test Synthetic Token", "SYNTH", 18, { from: contractCreator });
  const collateralToken = await Token.new("Wrapped Ether", "WETH", 18, { from: contractCreator });

  const collateralWhitelist = await AddressWhitelist.new({ from: contractCreator });
  await finder.changeImplementationAddress(utf8ToHex(interfaceName.CollateralWhitelist), collateralWhitelist.address, {
    from: contractCreator,
  });
  await collateralWhitelist.addToWhitelist(collateralToken.address, { from: contractCreator });

  let configStore, optimisticOracle;
  if (contractType == "Perpetual") {
    configStore = await ConfigStore.new(
      {
        timelockLiveness: 86400, // 1 day
        rewardRatePerSecond: { rawValue: "0" },
        proposerBondPercentage: { rawValue: "0" },
        maxFundingRate: { rawValue: toWei("0.00001") },
        minFundingRate: { rawValue: toWei("-0.00001") },
        proposalTimePastLimit: 0,
      },
      timer.address,
      { from: contractCreator }
    );

    await identifierWhitelist.addSupportedIdentifier(padRight(utf8ToHex(fundingRateIdentifier)), {
      from: contractCreator,
    });
    optimisticOracle = await OptimisticOracle.new(7200, finder.address, timer.address, { from: contractCreator });
    await finder.changeImplementationAddress(utf8ToHex(interfaceName.OptimisticOracle), optimisticOracle.address, {
      from: contractCreator,
    });
  }

  const constructorParams = await createConstructorParamsForContractVersion(
    { contractVersion: "latest", contractType },
    {
      convertDecimals: toWei,
      finder,
      collateralToken,
      syntheticToken,
      identifier,
      fundingRateIdentifier,
      timer,
      store,
      configStore: configStore || {},
    },
    { expirationTimestamp: (await timer.getCurrentTime()).toNumber() + 100 }, // config override expiration time.
    { from: contractCreator }
  );

  const financialContract = await FinancialContract.new(constructorParams, { from: contractCreator });
  const contractCode = await web3.eth.getCode(financialContract.address);

  return soliditySha3(contractCode);
}

function saveContractHashArtifacts(contractHashes) {
  const savePath = `${path.resolve(__dirname)}/../build/contract-type-hash-map.json`;
  fs.writeFileSync(savePath, JSON.stringify(contractHashes));
}

async function main() {
  const contractHashesToGenerate = ["Perpetual", "ExpiringMultiParty"];
  let versionMap = {};
  for (const contractType of contractHashesToGenerate) {
    const contractHash = await buildHashes(contractType);
    versionMap[contractHash] = { contractType, contractVersion: buildVersion };
  }
  console.log("versionMap", versionMap);
  saveContractHashArtifacts(versionMap);
}

main().then(
  () => {
    process.exit(0);
  },
  (err) => {
    console.error(err.stack);
    process.exit(1);
  }
);
