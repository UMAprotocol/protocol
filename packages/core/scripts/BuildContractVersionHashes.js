const assert = require("assert");
const path = require("path");
const fs = require("fs");

const hre = require("hardhat");

const { web3, getContract } = hre;

const { toWei, utf8ToHex, padRight, soliditySha3 } = web3.utils;

const { createConstructorParamsForContractVersion, interfaceName } = require("@uma/common");

const buildVersion = "2.5.0"; // this is the version that will be built and appended to the FindContractVersion util.

async function buildHashes(contractType) {
  assert(contractType == "Perpetual" || contractType == "ExpiringMultiParty", "Invalid contract type defined!");

  const contractCreator = (await web3.eth.getAccounts())[0];

  const FinancialContract = getContract(contractType);
  const Finder = getContract("Finder");
  const IdentifierWhitelist = getContract("IdentifierWhitelist");
  const AddressWhitelist = getContract("AddressWhitelist");
  const MockOracle = getContract("MockOracle");
  const Token = getContract("ExpandedERC20");
  const SyntheticToken = getContract("SyntheticToken");
  const Timer = getContract("Timer");
  const Store = getContract("Store");
  const ConfigStore = getContract("ConfigStore");
  const OptimisticOracle = getContract("OptimisticOracle");

  const identifier = "TEST_IDENTIFIER";
  const fundingRateIdentifier = "TEST_FUNDING_IDENTIFIER";

  const finder = await Finder.new().send({ from: contractCreator });

  const identifierWhitelist = await IdentifierWhitelist.new().send({ from: contractCreator });
  await identifierWhitelist.methods.addSupportedIdentifier(utf8ToHex(identifier)).send({ from: contractCreator });

  await finder.methods
    .changeImplementationAddress(utf8ToHex(interfaceName.IdentifierWhitelist), identifierWhitelist.options.address)
    .send({
      from: contractCreator,
    });

  const timer = await Timer.new().send({ from: contractCreator });

  const mockOracle = await MockOracle.new(finder.options.address, timer.options.address).send({
    from: contractCreator,
  });
  await finder.methods.changeImplementationAddress(utf8ToHex(interfaceName.Oracle), mockOracle.options.address).send({
    from: contractCreator,
  });

  const store = await Store.new({ rawValue: "0" }, { rawValue: "0" }, timer.options.address).send({
    from: contractCreator,
  });
  await finder.methods
    .changeImplementationAddress(utf8ToHex(interfaceName.Store), store.options.address)
    .send({ from: contractCreator });

  await finder.methods
    .changeImplementationAddress(utf8ToHex(interfaceName.FinancialContractsAdmin), contractCreator)
    .send({
      from: contractCreator,
    });

  const syntheticToken = await SyntheticToken.new("Test Synthetic Token", "SYNTH", 18).send({ from: contractCreator });
  const collateralToken = await Token.new("Wrapped Ether", "WETH", 18).send({ from: contractCreator });

  const collateralWhitelist = await AddressWhitelist.new().send({ from: contractCreator });
  await finder.methods
    .changeImplementationAddress(utf8ToHex(interfaceName.CollateralWhitelist), collateralWhitelist.options.address)
    .send({
      from: contractCreator,
    });
  await collateralWhitelist.methods.addToWhitelist(collateralToken.options.address).send({ from: contractCreator });

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
      timer.options.address
    ).send({ from: contractCreator });

    await identifierWhitelist.methods.addSupportedIdentifier(padRight(utf8ToHex(fundingRateIdentifier))).send({
      from: contractCreator,
    });
    optimisticOracle = await OptimisticOracle.new(7200, finder.options.address, timer.options.address).send({
      from: contractCreator,
    });
    await finder.methods
      .changeImplementationAddress(utf8ToHex(interfaceName.OptimisticOracle), optimisticOracle.options.address)
      .send({
        from: contractCreator,
      });
  }

  const constructorParams = await createConstructorParamsForContractVersion(
    { contractVersion: "latest", contractType },
    {
      convertSynthetic: toWei,
      finder,
      collateralToken,
      syntheticToken,
      identifier,
      fundingRateIdentifier,
      timer,
      store,
      configStore: configStore || {},
    },
    { expirationTimestamp: parseInt(await timer.methods.getCurrentTime().call()) + 100 } // config override expiration time.
  );

  const financialContract = await FinancialContract.new(constructorParams).send({ from: contractCreator });
  const contractCode = await web3.eth.getCode(financialContract.options.address);

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
