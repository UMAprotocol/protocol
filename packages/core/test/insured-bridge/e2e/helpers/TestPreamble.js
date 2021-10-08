const { interfaceName } = require("@uma/common");

const { ethers } = require("hardhat");

const { OPTIMISM_GAS_OPTS } = require("./OptimismConstants");
const { createLocalEthersFactory } = require("./ArtifactsHelper");

// UMA ecosystem contract factories
const factory__L1_Finder = createLocalEthersFactory("Finder");
const factory__L1_Timer = createLocalEthersFactory("Timer");
const factory__L1_AddressWhitelist = createLocalEthersFactory("AddressWhitelist");
const factory__L1_IdentifierWhitelist = createLocalEthersFactory("IdentifierWhitelist");
const factory__L1_Store = createLocalEthersFactory("Store");
const factory__L1_OptimisticOracle = createLocalEthersFactory("OptimisticOracle");

const factory__L2_Timer = createLocalEthersFactory("Legacy_Timer");

async function setUpUmaEcosystemContracts(l1Wallet, l2Wallet, l1Erc20, identifier) {
  // Set up required UMA L1 ecosystem contracts.
  const l1Finder = await factory__L1_Finder.connect(l1Wallet).deploy();
  await l1Finder.deployTransaction.wait();
  const l1Timer = await factory__L1_Timer.connect(l1Wallet).deploy();
  await l1Timer.deployTransaction.wait();

  const l1CollateralWhitelist = await factory__L1_AddressWhitelist.connect(l1Wallet).deploy();
  await l1CollateralWhitelist.deployTransaction.wait();
  await l1Finder.changeImplementationAddress(
    ethers.utils.formatBytes32String(interfaceName.CollateralWhitelist),
    l1CollateralWhitelist.address
  );
  await l1CollateralWhitelist.addToWhitelist(l1Erc20.address);

  const l1IdentifierWhitelist = await factory__L1_IdentifierWhitelist.connect(l1Wallet).deploy();
  await l1IdentifierWhitelist.deployTransaction.wait();
  await l1Finder.changeImplementationAddress(
    ethers.utils.formatBytes32String(interfaceName.IdentifierWhitelist),
    l1IdentifierWhitelist.address
  );
  await l1IdentifierWhitelist.addSupportedIdentifier(identifier);

  const l1Store = await factory__L1_Store
    .connect(l1Wallet)
    .deploy({ rawValue: "0" }, { rawValue: "0" }, l1Timer.address);
  await l1Store.deployTransaction.wait();
  await l1Finder.changeImplementationAddress(ethers.utils.formatBytes32String(interfaceName.Store), l1Store.address);
  await l1Store.setFinalFee(l1Erc20.address, { rawValue: ethers.utils.parseEther("1").toString() });

  const l1OptimisticOracle = await factory__L1_OptimisticOracle
    .connect(l1Wallet)
    .deploy(7200, l1Finder.address, l1Timer.address);
  await l1OptimisticOracle.deployTransaction.wait();
  await l1Finder.changeImplementationAddress(
    ethers.utils.formatBytes32String(interfaceName.OptimisticOracle),
    l1OptimisticOracle.address
  );

  // Set up required L2 contracts.
  const l2Timer = await factory__L2_Timer.connect(l2Wallet).deploy(OPTIMISM_GAS_OPTS);
  await l2Timer.deployTransaction.wait();

  return { l1Timer, l1Finder, l1CollateralWhitelist, l1IdentifierWhitelist, l1Store, l1OptimisticOracle, l2Timer };
}

module.exports = { setUpUmaEcosystemContracts };
