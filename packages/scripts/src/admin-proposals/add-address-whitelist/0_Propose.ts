// This script can be run against a mainnet fork by spinning a node in a separate terminal with:
// HARDHAT_CHAIN_ID=1 yarn hardhat node --fork https://mainnet.infura.io/v3/<YOUR-INFURA-KEY> --port 9545 --no-deploy
// and then running this script with:
// GCKMS_WALLET=<OPTIONAL-GCKMS-WALLET> \
// ADDRESS=<ADDRESS-TO-ADD> \
// UMIP_NUMBER=<UMIP-NUMBER> \
// FINAL_FEE=<FINAL_FEE> \
// yarn hardhat run ./src/admin-proposals/add-address-whitelist/0_Propose.ts --network <network>

const hre = require("hardhat");

import {
  AddressWhitelistEthers,
  ERC20Ethers,
  ProposerV2Ethers,
  StoreEthers,
  VotingTokenEthers,
} from "@uma/contracts-node";

import { Provider } from "@ethersproject/abstract-provider";
import { getGckmsSigner, getRetryProvider } from "@uma/common";
import { BigNumberish, Signer, Wallet } from "ethers";
import { BytesLike, isAddress } from "ethers/lib/utils";
import { getContractInstance, getContractInstanceWithProvider } from "../../utils/contracts";

interface AdminProposalTransaction {
  to: string;
  value: BigNumberish;
  data: BytesLike;
}

const proposerWallet = "0x2bAaA41d155ad8a4126184950B31F50A1513cE25";

async function main() {
  const adminProposalTransactions: AdminProposalTransaction[] = [];

  let proposerSigner: Signer;

  if (!process.env.ADDRESS) throw new Error("ADDRESS is not set");
  if (!isAddress(process.env.ADDRESS)) throw new Error("ADDRESS is not a valid address");
  const newAddress = process.env.ADDRESS;

  if (!process.env.FINAL_FEE) throw new Error("FINAL_FEE is not set");
  const finalFee = Number(process.env.FINAL_FEE);

  if (!process.env.UMIP_NUMBER) throw new Error("UMIP_NUMBER is not set");
  const umipNumber = process.env.UMIP_NUMBER;

  if (process.env.GCKMS_WALLET) {
    proposerSigner = ((await getGckmsSigner()) as Wallet).connect(hre.ethers.provider as Provider);
    if (proposerWallet.toLowerCase() != (await proposerSigner.getAddress()).toLowerCase())
      throw new Error("GCKMS wallet does not match proposer wallet");
  } else {
    proposerSigner = (await hre.ethers.getSigner(proposerWallet)) as Signer;
  }

  console.log("1. LOADING DEPLOYED CONTRACT STATE");

  const votingToken = await getContractInstance<VotingTokenEthers>("VotingToken");

  const proposer = await await getContractInstance<ProposerV2Ethers>("ProposerV2");
  const addressWhitelist = await getContractInstance<AddressWhitelistEthers>("AddressWhitelist");
  const store = await getContractInstance<StoreEthers>("Store");

  const provider = getRetryProvider(1) as Provider;
  const erc20 = await getContractInstanceWithProvider<ERC20Ethers>("ERC20", provider, newAddress);
  const decimals = await erc20.decimals();

  // add new address to whitelist
  const addAddressTx = await addressWhitelist.populateTransaction.addToWhitelist(newAddress);
  if (!addAddressTx.data) throw "addAddressTx.data is null";
  adminProposalTransactions.push({ to: addressWhitelist.address, value: 0, data: addAddressTx.data });

  // set final fee
  const setFinalFeeTx = await store.populateTransaction.setFinalFee(newAddress, {
    rawValue: hre.ethers.utils.parseUnits(finalFee.toString(), decimals),
  });
  if (!setFinalFeeTx.data) throw "setFinalFeeTx.data is null";
  adminProposalTransactions.push({ to: store.address, value: 0, data: setFinalFeeTx.data });

  const defaultBond = await proposer.bond();
  const allowance = await votingToken.allowance(proposerWallet, proposer.address);
  if (allowance.lt(defaultBond)) {
    console.log("Approving proposer bond");
    const approveTx = await votingToken.connect(proposerSigner).approve(proposer.address, defaultBond);
    await approveTx.wait();
  }

  const tx = await (await getContractInstance<ProposerV2Ethers>("ProposerV2", proposer.address))
    .connect(proposerSigner)
    .propose(
      adminProposalTransactions,
      hre.ethers.utils.toUtf8Bytes(
        `UMIP-${umipNumber}: whitelist ${process.env.ADDRESS} in AddressWhitelist and set final fee to ${finalFee}`
      )
    );

  await tx.wait();

  console.log("Proposal done!🎉");
  console.log("\nProposal data:\n", tx.data);
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
