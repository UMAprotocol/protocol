const { getContractDefinition, predeploys } = require("@eth-optimism/contracts");
const { smockit } = require("@eth-optimism/smock");

const hre = require("hardhat");
const { ethers } = require("hardhat");
const { formatBytes32String, parseEther } = ethers.utils;

// Change these accordingly. This private key is for account zero on mnemonic "candy maple cake sugar pudding cream honey rich smooth crumble sweet treat"
const jsonRpcUrl = "http://localhost:8545";
const unlockedPrivateKey = "0xc87509a1c067bbde78beb793e6fa76530b6382a4c0241e5e4a9ec0a0f44dc0d3";

const PROXY__OVM_L1_CROSS_DOMAIN_MESSENGER = "0x59b670e9fa9d0a427751af201d676719a970857b";

// Bridge variables
const identifier = formatBytes32String("BRIDGE_TRANSFER_TEST");
const optimisticOracleLiveness = 7200;
const proposerBondPct = parseEther("0.10");
const lpFeeRatePerSecond = parseEther("0.0000015");
const minimumBridgingDelay = 60;

const { getAbi, getBytecode } = require("@uma/contracts-node");
const { interfaceName } = require("@uma/common");

const createEthersFactory = (contractName) => {
  return new hre.ethers.ContractFactory(getAbi(contractName), getBytecode(contractName));
};

const deployContract = async (contractName, wallet, params = []) => {
  const factory = createEthersFactory(contractName);
  const contractInstance = await factory.connect(wallet).deploy(...params);
  return contractInstance;
};

// Deploy contract from @eth-optimism/contracts directory as a smockit
async function deployOptimismContractMock(name, opts) {
  const artifact = getContractDefinition(name);

  const factory = new hre.ethers.ContractFactory(artifact.abi, artifact.bytecode);
  return await smockit(factory, opts);
}

// scripts/index.js
async function main() {
  console.log("Running minimal across deployment script");

  // 1. Setup provider and unlocked wallets
  const provider = new ethers.providers.JsonRpcProvider(jsonRpcUrl);
  const wallet = new ethers.Wallet(unlockedPrivateKey, provider);

  // 2. Deploy UMA ecosystem contracts.
  const finder = await deployContract("Finder", wallet);
  const timer = await deployContract("Timer", wallet);
  const collateralWhitelist = await deployContract("AddressWhitelist", wallet);
  const identifierWhitelist = await deployContract("IdentifierWhitelist", wallet);
  const store = await deployContract("Store", wallet, [{ rawValue: "0" }, { rawValue: "0" }, timer.address]);
  const optimisticOracle = await deployContract("OptimisticOracle", wallet, [7200, finder.address, timer.address]);

  // 3. Register UMA contracts with the finder.
  await finder.changeImplementationAddress(
    formatBytes32String(interfaceName.CollateralWhitelist),
    collateralWhitelist.address
  );

  await finder.changeImplementationAddress(
    formatBytes32String(interfaceName.IdentifierWhitelist),
    identifierWhitelist.address
  );

  await finder.changeImplementationAddress(formatBytes32String(interfaceName.Store), store.address);
  await finder.changeImplementationAddress(
    formatBytes32String(interfaceName.OptimisticOracle),
    optimisticOracle.address
  );

  // 3 Deploy & setup tokens
  const l1Token = await deployContract("ExpandedERC20", wallet, ["L1 ERC20 Token", "L1Tkn", 18]);
  await l1Token.addMember(1, wallet.address);
  const l2Token = await deployContract("ExpandedERC20", wallet, ["L1 ERC20 Token", "L1Tkn", 18]);
  await l2Token.addMember(1, wallet.address);

  // 4. Whitelist l1Token and add identifier
  await identifierWhitelist.addSupportedIdentifier(identifier);
  await collateralWhitelist.addToWhitelist(l1Token.address);
  await store.setFinalFee(l1Token.address, { rawValue: parseEther("1").toString() });

  //5. Deploy optimism mocks
  const l2CrossDomainMessengerMock = await deployOptimismContractMock("OVM_L2CrossDomainMessenger", {
    address: predeploys.OVM_L2CrossDomainMessenger,
  });
  await wallet.sendTransaction({ to: predeploys.OVM_L2CrossDomainMessenger, value: parseEther("1") });

  // 6. Deploy across contracts
  const bridgeAdmin = await deployContract("BridgeAdmin", wallet, [
    finder.address,
    PROXY__OVM_L1_CROSS_DOMAIN_MESSENGER,
    optimisticOracleLiveness,
    proposerBondPct,
    identifier,
  ]);

  const bridgePool = await deployContract("BridgePool", wallet, [
    "LP Token",
    "LPT",
    bridgeAdmin.address,
    l1Token.address,
    lpFeeRatePerSecond,
    timer.address,
  ]);

  const bridgeDepositBox = await deployContract("OVM_BridgeDepositBox", wallet, [
    bridgeAdmin.address,
    minimumBridgingDelay,
    timer.address,
  ]);

  // 7. Whitelist tokens in deposit box.
  l2CrossDomainMessengerMock.smocked.xDomainMessageSender.will.return.with(() => l1Token.address);
  await bridgeDepositBox
    .connect(provider.getSigner(predeploys.OVM_L2CrossDomainMessenger))
    .whitelistToken(l1Token.address, l2Token.address, bridgePool.address);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
