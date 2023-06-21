// This script create a proposal to change the final fee for the WETH and stable coin tokens collateral types in mainnet
// and in the supported l2 chains.
// To run this on the localhost first fork mainnet into a local hardhat node by running:
// HARDHAT_CHAIN_ID=1 yarn hardhat node --fork https://mainnet.infura.io/v3/<YOUR-INFURA-KEY> --port 9545 --no-deploy
// Then execute the script:
// NEW_FINAL_FEE_USD=<NEW_FINAL_FEE_USD> \
// NEW_FINAL_FEE_WETH=<NEW_FINAL_FEE_WETH> \
// UMIP_NUMBER=<UMIP_NUMBER> \
// NODE_URL_1=<MAINNET-NODE-URL> \
// NODE_URL_10=<OPTIMISM-NODE-URL> \
// NODE_URL_137=<POLYGON-NODE-URL> \
// NODE_URL_42161=<ARBITRUM-NODE-URL> \
// yarn hardhat run ./src/admin-proposals/change-final-fee/0_Propose.ts --network localhost

const hre = require("hardhat");

import {
  ERC20Ethers,
  GovernorHubEthers,
  GovernorRootTunnelEthers,
  ParentMessengerBaseEthers,
  ProposerV2Ethers,
  StoreEthers,
  VotingTokenEthers,
} from "@uma/contracts-node";

import { Provider } from "@ethersproject/abstract-provider";
import { getGckmsSigner, getRetryProvider } from "@uma/common";
import { BigNumberish, PopulatedTransaction, Signer, Wallet } from "ethers";
import { BytesLike } from "ethers/lib/utils";
import { getContractInstance, getContractInstanceByUrl, getContractInstanceWithProvider } from "../../utils/contracts";
import { fundArbitrumParentMessengerForRelays, relayGovernanceMessages } from "../../utils/relay";
import { tokensToUpdateFee } from "./common";

interface AdminProposalTransaction {
  to: string;
  value: BigNumberish;
  data: BytesLike;
}

const proposerWallet = "0x2bAaA41d155ad8a4126184950B31F50A1513cE25";

// Env vars
const NODE_URL_ENV = "NODE_URL_";

async function main() {
  const adminProposalTransactions: AdminProposalTransaction[] = [];

  let proposerSigner: Signer;

  if (!process.env.NEW_FINAL_FEE_USD) throw new Error("NEW_FINAL_FEE_USD is not set");
  if (!process.env.NEW_FINAL_FEE_WETH) throw new Error("NEW_FINAL_FEE_WETH is not set");
  if (!process.env.UMIP_NUMBER) throw new Error("UMIP_NUMBER is not set");

  const umipNumber = Number(process.env.UMIP_NUMBER);

  const newFinalFeeUSD = Number(process.env.NEW_FINAL_FEE_USD);
  const newFinalFeeWeth = Number(process.env.NEW_FINAL_FEE_WETH);

  const arbitrumParentMessenger = await getContractInstance<ParentMessengerBaseEthers>("Arbitrum_ParentMessenger");

  const governorRootTunnel = await getContractInstance<GovernorRootTunnelEthers>("GovernorRootTunnel"); // for polygon
  const governorHub = await getContractInstance<GovernorHubEthers>("GovernorHub"); // rest of l2

  const l2Networks = ["polygon", "arbitrum", "optimism"];
  const l2NetworksNumber = { polygon: 137, optimism: 10, arbitrum: 42161 };

  if (process.env.GCKMS_WALLET) {
    proposerSigner = ((await getGckmsSigner()) as Wallet).connect(hre.ethers.provider as Provider);
    if (proposerWallet.toLowerCase() != (await proposerSigner.getAddress()).toLowerCase())
      throw new Error("GCKMS wallet does not match proposer wallet");
  } else {
    proposerSigner = (await hre.ethers.getSigner(proposerWallet)) as Signer;
  }

  const votingToken = await getContractInstance<VotingTokenEthers>("VotingToken");

  const proposer = await await getContractInstance<ProposerV2Ethers>("ProposerV2");
  const store = await getContractInstance<StoreEthers>("Store");

  // case mainnet
  for (const token in tokensToUpdateFee) {
    const provider = getRetryProvider(1) as Provider;

    const isWeth = token == "WETH";
    const newFinalFee = isWeth ? newFinalFeeWeth : newFinalFeeUSD;

    const tokenAddress = tokensToUpdateFee[token as keyof typeof tokensToUpdateFee].mainnet;
    const erc20 = await getContractInstanceWithProvider<ERC20Ethers>("ERC20", provider, tokenAddress);
    const decimals = await erc20.decimals();

    const setFinalFeeTx = await store.populateTransaction.setFinalFee(tokenAddress, {
      rawValue: hre.ethers.utils.parseUnits(newFinalFee.toString(), decimals),
    });
    if (!setFinalFeeTx.data) throw "setFinalFeeTx.data is null";
    adminProposalTransactions.push({ to: store.address, value: 0, data: setFinalFeeTx.data });
  }

  for (const i in l2Networks) {
    const networkName = l2Networks[i];
    const provider = getRetryProvider(l2NetworksNumber[networkName as keyof typeof l2NetworksNumber]) as Provider;
    const l2ChainId = l2NetworksNumber[networkName as keyof typeof l2NetworksNumber];
    const l2NodeUrl = process.env[String(NODE_URL_ENV + l2ChainId)];
    const isPolygon = l2ChainId === 137;
    const isArbitrum = l2ChainId === 42161;

    // If is arbitrum we need to fund the parent messenger
    if (isArbitrum)
      await fundArbitrumParentMessengerForRelays(
        arbitrumParentMessenger,
        proposerSigner,
        Object.keys(tokensToUpdateFee).length
      );

    const governanceMessages: { targetAddress: string; tx: PopulatedTransaction }[] = [];

    for (const token in tokensToUpdateFee) {
      const isWeth = token == "WETH";
      const newFinalFee = isWeth ? newFinalFeeWeth : newFinalFeeUSD;
      const tokenAddresses = tokensToUpdateFee[token as keyof typeof tokensToUpdateFee];
      const tokenAddress = tokenAddresses[networkName as keyof typeof tokenAddresses];

      if (!l2NodeUrl) throw new Error(`Missing ${networkName} network config`);

      const l2Erc20 = await getContractInstanceWithProvider<ERC20Ethers>("ERC20", provider, tokenAddress);
      const l2Store = await getContractInstanceByUrl<StoreEthers>("Store", l2NodeUrl);

      const decimals = await l2Erc20.decimals();

      const setFinalFeeTx = await l2Store.populateTransaction.setFinalFee(tokenAddress, {
        rawValue: hre.ethers.utils.parseUnits(newFinalFee.toString(), decimals),
      });

      governanceMessages.push({ targetAddress: l2Store.address, tx: setFinalFeeTx });
    }

    const relayedMessages = await relayGovernanceMessages(
      governanceMessages,
      isPolygon ? governorRootTunnel : governorHub,
      l2ChainId
    );

    adminProposalTransactions.push(...relayedMessages);
  }

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
      hre.ethers.utils.toUtf8Bytes(`UMIP-${umipNumber} - Update final fee to ${newFinalFeeUSD} USD`)
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
