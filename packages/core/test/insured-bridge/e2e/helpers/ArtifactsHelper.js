const hre = require("hardhat");

const { findArtifactFromPath } = require("@uma/common");

function getProviders() {
  return {
    l1RpcProvider: new hre.ethers.providers.JsonRpcProvider(getProviderUrls().l1RpcProviderUrl),
    l2RpcProvider: new hre.ethers.providers.JsonRpcProvider(getProviderUrls().l2RpcProviderUrl),
  };
}

function getProviderUrls() {
  return { l1RpcProviderUrl: "http://localhost:9545", l2RpcProviderUrl: "http://localhost:8545" };
}

function getOptimismArtifact(contractName) {
  const optimismContractsPath = findPathToRootOfPackage("@eth-optimism/contracts");
  const artifactsPath = `${optimismContractsPath}/artifacts`;

  return findArtifactFromPath(contractName, artifactsPath);
}

function getLocalArtifact(contractName) {
  const coreContractsPath = findPathToRootOfPackage("@uma/core");
  const artifactsPath = `${coreContractsPath}artifacts`;

  return findArtifactFromPath(contractName, artifactsPath);
}

function findPathToRootOfPackage(packageName) {
  const packagePath = require.resolve(`${packageName}/package.json`);
  return packagePath.slice(0, packagePath.indexOf("package.json"));
}

function createLocalEthersFactory(contractName) {
  const artifact = getLocalArtifact(contractName);
  return new hre.ethers.ContractFactory(artifact.abi, artifact.bytecode);
}

function createOptimismEthersFactory(contractName) {
  const artifact = getOptimismArtifact(contractName);
  return new hre.ethers.ContractFactory(artifact.abi, artifact.bytecode);
}

module.exports = {
  getProviderUrls,
  getProviders,
  createLocalEthersFactory,
  createOptimismEthersFactory,
  getLocalArtifact,
  getOptimismArtifact,
};
