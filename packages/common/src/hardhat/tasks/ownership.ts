import { task } from "hardhat/config";
import type { CombinedHRE } from "./types";

function getAbi(hre: CombinedHRE, contractName: string) {
  const artifact = hre.artifacts.readArtifactSync(contractName);
  return artifact.abi;
}

// Determines if contract is Ownable by trying to call owner() method on it.
async function isOwnable(hre: CombinedHRE, contractAddress: string): Promise<boolean> {
  const { web3 } = hre;
  const contract = new web3.eth.Contract(getAbi(hre, "Ownable"), contractAddress);
  try {
    await contract.methods.owner().call();
    return true;
  } catch {
    return false;
  }
}

async function transferOwnable(hre: CombinedHRE, contractAddress: string, oldOwner: string, newOwner: string) {
  const { web3 } = hre;
  const contract = new web3.eth.Contract(getAbi(hre, "Ownable"), contractAddress);

  console.log(`Transferring owner on ${contractAddress} to ${newOwner}...`);
  const tx = await contract.methods.transferOwnership(newOwner).send({ from: oldOwner });
  console.log(`...txn: ${tx.transactionHash}`);
}

async function transferMultiRole(hre: CombinedHRE, contractAddress: string, oldOwner: string, newOwner: string) {
  const { web3 } = hre;
  const contract = new web3.eth.Contract(getAbi(hre, "MultiRole"), contractAddress);

  console.log(`Resetting owner role on ${contractAddress} to ${newOwner}...`);
  const tx = await contract.methods.resetMember(0, newOwner).send({ from: oldOwner });
  console.log(`...txn: ${tx.transactionHash}`);
}

task("transfer-owner", "Transfers contract ownership from deployer")
  .addParam("contract", "Contract that should have its ownership transferred")
  .addParam("owner", "Address of new owner")
  .setAction(async function (taskArguments, hre_) {
    const hre = hre_ as CombinedHRE;
    const { getNamedAccounts } = hre;
    const { deployer } = await getNamedAccounts();
    const { contract, owner } = taskArguments;

    if (await isOwnable(hre, contract)) {
      await transferOwnable(hre, contract, deployer, owner);
    } else {
      await transferMultiRole(hre, contract, deployer, owner);
    }
  });
