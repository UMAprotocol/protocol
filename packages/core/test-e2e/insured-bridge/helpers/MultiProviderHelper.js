const hre = require("hardhat");

const fs = require("fs");
const path = require("path");

function getProviders() {
  return {
    l1RpcProvider: new hre.ethers.providers.JsonRpcProvider("http://localhost:9545"),
    l2RpcProvider: new hre.ethers.providers.JsonRpcProvider("http://localhost:8545"),
  };
}

function getAllFiles(dirPath, arrayOfFiles = []) {
  const files = fs.readdirSync(dirPath);

  arrayOfFiles = arrayOfFiles || [];

  files.forEach((file) => {
    if (fs.statSync(dirPath + "/" + file).isDirectory()) arrayOfFiles = getAllFiles(dirPath + "/" + file, arrayOfFiles);
    else arrayOfFiles.push(path.join(dirPath, "/", file));
  });

  return arrayOfFiles;
}

function findArtifactFromPaths(contractName, artifactsPath) {
  const allArtifactsPaths = getAllFiles(artifactsPath);
  const desiredArtifactPaths = allArtifactsPaths.filter((a) => a.endsWith(`/${contractName}.json`));

  if (desiredArtifactPaths.length !== 1)
    throw new Error(`Couldn't find desired artifact or found too many for ${contractName}`);
  return JSON.parse(fs.readFileSync(desiredArtifactPaths[0], "utf-8"));
}

function getOptimismArtifact(contractName, ovm = false) {
  const artifactsPath = ovm
    ? path.resolve(__dirname, "../../../../../node_modules/@eth-optimism/contracts/artifacts-ovm")
    : path.resolve(__dirname, "../../../../../node_modules/@eth-optimism/contracts/artifacts");

  return findArtifactFromPaths(contractName, artifactsPath);
}

function getLocalArtifact(contractName, ovm = false) {
  const artifactsPath = ovm
    ? path.resolve(__dirname, "../../../artifacts-ovm")
    : path.resolve(__dirname, "../../../artifacts");

  return findArtifactFromPaths(contractName, artifactsPath);
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
