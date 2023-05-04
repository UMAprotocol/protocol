// This script deploys the OriginValidator.
// This script can be run against a mainnet fork by spinning a node in a separate terminal with:
// HARDHAT_CHAIN_ID=1 yarn hardhat node --fork https://mainnet.infura.io/v3/<YOUR-INFURA-KEY> --port 9545 --no-deploy
// and then running this script with:
// yarn hardhat run ./src/upgrade-tests/sherlock-update/0_Deploy.ts --network localhost

const hre = require("hardhat");
const { getContractFactory } = hre.ethers;

async function main() {
  console.log("DEPLOYING ORIGIN VALIDATOR");

  const originValidator = await getContractFactory("OriginValidator");
  const originValidatorContract = await originValidator.deploy();

  console.log("Deployed Origin Validator: ", originValidatorContract.address);
}

main().then(
  () => {
    process.exit(0);
  },
  (err) => {
    console.error(err);
    process.exit(1);
  }
);
