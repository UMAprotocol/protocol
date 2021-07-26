const { contract } = require("hardhat");
const hre = require("hardhat");

const { join } = require("path");
const { readFileSync } = require("fs");

function getProviders() {
  return { l1Web3: new hre.Web3("http://localhost:9545"), l2Web3: new hre.Web3("http://localhost:8545") };
}

async function deployContractOnProvider(contractInstance, web3Instance, props, account) {
  console.log("web3Instance", web3Instance);
  // if (!(await web3Instance.eth.getAccounts()).includes(account)) throw new Error("account requested is not unlocked");

  return await new web3Instance.eth.Contract(contractInstance.abi, undefined)
    .deploy({ data: contractInstance.bytecode, arguments: props })
    .send({ from: (await web3Instance.eth.getAccounts())[0], gasLimit: 814200000000000, gasPrice: 15000000 });
}

async function deployContractUsingEthers(contractName, web3Instance, props, account) {
  if (!(await web3Instance.eth.getAccounts()).includes(account)) throw new Error("account requested is not unlocked");

  const factory = await getL2Factory(contractName);

  const provider = new hre.ethers.providers.Web3Provider(web3Instance.currentProvider);
  console.log("provider", provider);

  const signer = new hre.ethers.Wallet("0xdf57089febbacf7ba0bc227dafbffa9fc08a93fdc68e1e42411a14efcf23656e", provider);
  console.log("signer", signer);

  const contractFactory = new hre.ethers.ContractFactory(factory.interface, factory.bytecode, signer);
  console.log("...props", ...props);
  const contractDeployed = await contractFactory.deploy(...props);
  console.log("b");
  try {
    await contractDeployed.deployed();
  } catch (error) {
    console.log("c");
  }

  return contractDeployed;
}

async function getL2Factory(contractName) {
  console.log("contractName", contractName);
  const l1ArtifactPaths = await hre.artifacts.getArtifactPaths();
  const desiredArtifacts = l1ArtifactPaths.filter((a) => a.endsWith(`/${contractName}.json`));
  console.log("desiredArtifacts", desiredArtifacts);
  if (desiredArtifacts.length !== 1) throw new Error("Couldn't find desired artifact or found too many");

  const l1ArtifactPath = desiredArtifacts[0];
  const artifactRootPath = join(__dirname, "../../artifacts");
  const artifactOvmRootPath = join(__dirname, "../../artifacts-ovm");
  const l2ArtifactPath = l1ArtifactPath.replace(artifactRootPath, artifactOvmRootPath);

  const artifact = JSON.parse(readFileSync(l2ArtifactPath, "utf-8"));

  return new hre.ethers.ContractFactory(artifact.abi, artifact.bytecode);
}

module.exports = { getProviders, deployContractOnProvider, deployContractUsingEthers };
