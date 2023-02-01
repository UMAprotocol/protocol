import { getGckmsSigner } from "@uma/common";
import { getContractInstance, hre, ProposerEthers, Signer } from "./common";

import { Wallet } from "ethers";

// Import Provider from ethers
import { Provider } from "@ethersproject/providers";
import { VotingTokenEthers } from "@uma/contracts-node";

// PARAMETERS
const proposerWallet = "0x2bAaA41d155ad8a4126184950B31F50A1513cE25";

async function main() {
  const proposerSigner: Wallet = await getGckmsSigner("deployer");

  // Create a connected Signer from Wallet using the provider
  const signer: Signer = proposerSigner.connect(hre.ethers.provider as Provider);

  const proposer = await getContractInstance<ProposerEthers>("Proposer");
  const votingToken = await getContractInstance<VotingTokenEthers>("VotingToken");

  signer.getAddress().then((address: string) => {
    console.log("Using address", address);
    console.log("Is proposer wallet? ", address === proposerWallet);
  });

  const allowance = await votingToken.allowance(proposerWallet, proposer.address);
  console.log("Allowance", allowance.toString());

  const requiredAmount = hre.ethers.utils.parseEther("10000.0");

  console.log("Required amount", requiredAmount.toString());
  console.log("Is enough? ", allowance.gte(requiredAmount));

  // Test sending a transaction
  await signer.sendTransaction({
    to: proposerWallet, // dev wallet
    value: 0,
  });

  console.log("Sent transaction");
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
