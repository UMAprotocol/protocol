const hre = require("hardhat");

const { findArtifactFromPath } = require("@uma/common");

function getProviders() {
  return {
    l1RpcProvider: new hre.ethers.providers.JsonRpcProvider("http://localhost:9545"),
    l2RpcProvider: new hre.ethers.providers.JsonRpcProvider("http://localhost:8545"),
  };
}

function getOptimismArtifact(contractName, ovm = false) {
  const optimismContractsPath = findPathToRootOfPackage("@eth-optimism/contracts");
  const artifactsPath = ovm ? `${optimismContractsPath}/artifacts-ovm` : `${optimismContractsPath}/artifacts`;

  return findArtifactFromPath(contractName, artifactsPath);
}

function getLocalArtifact(contractName, ovm = false) {
  const coreContractsPath = findPathToRootOfPackage("@uma/core");
  const artifactsPath = ovm ? `${coreContractsPath}artifacts-ovm` : `${coreContractsPath}artifacts`;

  return findArtifactFromPath(contractName, artifactsPath);
}

function findPathToRootOfPackage(packageName) {
  const packagePath = require.resolve(`${packageName}/package.json`);
  return packagePath.slice(0, packagePath.indexOf("package.json"));
}

function createLocalEthersFactory(contractName, ovm = false) {
  const artifact = getLocalArtifact(contractName, ovm);
  return new hre.ethers.ContractFactory(artifact.abi, artifact.bytecode);
}

function createOptimismEthersFactory(contractName, ovm = false) {
  const artifact = getOptimismArtifact(contractName, ovm);
  return new hre.ethers.ContractFactory(artifact.abi, artifact.bytecode);
}

module.exports = {
  getProviders,
  createLocalEthersFactory,
  createOptimismEthersFactory,
  getLocalArtifact,
  getOptimismArtifact,
};
