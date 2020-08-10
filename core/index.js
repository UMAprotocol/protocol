const fs = require("fs");
const path = require("path");

function getArtifact(contract) {
  const filePath = path.join(__dirname, "build", "contracts", `${contract}.json`);
  if (!fs.existsSync(filePath)) {
    return null;
  }

  return JSON.parse(fs.readFileSync(filePath));
}

function getAbi(contract) {
  const artifact = getArtifact(contract);
  return artifact && artifact.abi;
}

function getAddress(contract, networkId) {
  const artifact = getArtifact(contract);
  return artifact && artifact.networks[networkId] && artifact.networks[networkId].address;
}

module.exports = {
  getArtifact,
  getAbi,
  getAddress
};
