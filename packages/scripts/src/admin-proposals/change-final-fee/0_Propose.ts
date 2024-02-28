// This script create a proposal to change the final fee for the WETH and stable coin tokens collateral types in mainnet
// and in the supported l2 chains.
// To run this on the localhost first fork mainnet into a local hardhat node by running:
// HARDHAT_CHAIN_ID=1 yarn hardhat node --fork https://mainnet.infura.io/v3/<YOUR-INFURA-KEY> --port 9545 --no-deploy
// Then execute the script:
// PROPOSAL_TITLE=<PROPOSAL_TITLE> \
// NODE_URL_1=<MAINNET-NODE-URL> \
// NODE_URL_10=<OPTIMISM-NODE-URL> \
// NODE_URL_137=<POLYGON-NODE-URL> \
// NODE_URL_42161=<ARBITRUM-NODE-URL> \
// TOKENS_TO_UPDATE='{"USDC":{"finalFee":"250.00","mainnet":"0x123","polygon":"0x123","arbitrum":"0x123"}}' \
// yarn hardhat run ./src/admin-proposals/change-final-fee/0_Propose.ts --network localhost

const hre = require("hardhat");

import {
  ERC20Ethers,
  GovernorHubEthers,
  GovernorRootTunnelEthers,
  ParentMessengerBaseEthers,
  ProposerV2Ethers,
  VotingTokenEthers,
} from "@uma/contracts-node";

import { Provider } from "@ethersproject/abstract-provider";
import { getGckmsSigner, getRetryProvider } from "@uma/common";
import { BigNumberish, PopulatedTransaction, Signer, Wallet } from "ethers";
import { BytesLike } from "ethers/lib/utils";
import { getContractInstance, getContractInstanceWithProvider } from "../../utils/contracts";
import { fundArbitrumParentMessengerForRelays, relayGovernanceMessages } from "../../utils/relay";
import {
  getConnectedAddressWhitelist,
  getConnectedStore,
  isSupportedNetwork,
  networksNumber,
  parseAndValidateTokensConfig,
  supportedNetworks,
} from "./common";

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

  const tokensToUpdate = parseAndValidateTokensConfig(process.env.TOKENS_TO_UPDATE);
  if (!process.env.PROPOSAL_TITLE) throw new Error("PROPOSAL_TITLE is not set");

  const proposalTitle = Number(process.env.PROPOSAL_TITLE);

  const arbitrumParentMessenger = await getContractInstance<ParentMessengerBaseEthers>("Arbitrum_ParentMessenger");

  const governorRootTunnel = await getContractInstance<GovernorRootTunnelEthers>("GovernorRootTunnel"); // for polygon
  const governorHub = await getContractInstance<GovernorHubEthers>("GovernorHub"); // rest of l2

  if (process.env.GCKMS_WALLET) {
    proposerSigner = ((await getGckmsSigner()) as Wallet).connect(hre.ethers.provider as Provider);
    if (proposerWallet.toLowerCase() != (await proposerSigner.getAddress()).toLowerCase())
      throw new Error("GCKMS wallet does not match proposer wallet");
  } else {
    proposerSigner = (await hre.ethers.getSigner(proposerWallet)) as Signer;
  }

  const votingToken = await getContractInstance<VotingTokenEthers>("VotingToken");

  const proposer = await await getContractInstance<ProposerV2Ethers>("ProposerV2");

  // case mainnet
  for (const [token, updateInfo] of Object.entries(tokensToUpdate)) {
    const provider = getRetryProvider(1) as Provider;

    const tokenAddress = updateInfo.mainnet;
    const newFinalFee = updateInfo.finalFee;
    if (!tokenAddress) continue;

    const erc20 = await getContractInstanceWithProvider<ERC20Ethers>("ERC20", provider, tokenAddress);
    const decimals = await erc20.decimals();

    // Check if the token is already whitelisted
    const addressWhitelist = await getConnectedAddressWhitelist(1);
    const isWhitelisted = await addressWhitelist.isOnWhitelist(tokenAddress);
    if (!isWhitelisted) {
      console.log(`Adding ${token} to the whitelist on mainnet...`);
      const addAddressTx = await addressWhitelist.populateTransaction.addToWhitelist(tokenAddress);
      if (!addAddressTx.data) throw "addAddressTx.data is null";
      adminProposalTransactions.push({ to: addressWhitelist.address, value: 0, data: addAddressTx.data });
    }

    // Check if the final fee is different from the current one
    const store = await getConnectedStore(1);
    const currentFinalFee = await store.finalFees(tokenAddress);
    if (currentFinalFee.eq(hre.ethers.utils.parseUnits(newFinalFee.toString(), decimals))) {
      console.log(`Final fee for ${token} is already ${newFinalFee} on mainnet`);
      continue;
    }
    console.log(`Setting final fee for ${token} to ${newFinalFee} in mainnet...`);
    const setFinalFeeTx = await store.populateTransaction.setFinalFee(tokenAddress, {
      rawValue: hre.ethers.utils.parseUnits(newFinalFee.toString(), decimals),
    });
    if (!setFinalFeeTx.data) throw "setFinalFeeTx.data is null";
    adminProposalTransactions.push({ to: store.address, value: 0, data: setFinalFeeTx.data });
  }

  for (const networkName of supportedNetworks.filter((network) => network !== "mainnet")) {
    if (!isSupportedNetwork(networkName)) throw new Error(`Unsupported network: ${networkName}`);
    const l2ChainId = networksNumber[networkName];
    const provider = getRetryProvider(l2ChainId) as Provider;
    const l2NodeUrl = process.env[String(NODE_URL_ENV + l2ChainId)];
    const isPolygon = l2ChainId === 137;
    const isArbitrum = l2ChainId === 42161;

    const governanceMessages: { targetAddress: string; tx: PopulatedTransaction }[] = [];
    let fundArbitrumCount = 0;
    for (const [token, updateInfo] of Object.entries(tokensToUpdate)) {
      const newFinalFee = updateInfo.finalFee;
      const tokenAddress = updateInfo[networkName];
      if (!tokenAddress) continue;

      if (!l2NodeUrl) throw new Error(`Missing ${networkName} network config`);

      const l2Erc20 = await getContractInstanceWithProvider<ERC20Ethers>("ERC20", provider, tokenAddress);
      const l2Store = await getConnectedStore(l2ChainId);
      const l2AddressWhitelist = await getConnectedAddressWhitelist(l2ChainId);

      const isWhitelisted = await l2AddressWhitelist.isOnWhitelist(tokenAddress);
      if (!isWhitelisted) {
        console.log(`Adding ${token} to the whitelist in ${networkName}...`);
        if (isArbitrum) fundArbitrumCount++;
        const addAddressTx = await l2AddressWhitelist.populateTransaction.addToWhitelist(tokenAddress);
        if (!addAddressTx.data) throw "addAddressTx.data is null";
        governanceMessages.push({ targetAddress: l2AddressWhitelist.address, tx: addAddressTx });
      }

      const decimals = await l2Erc20.decimals();

      // Check if the final fee is different from the current one
      const currentFinalFee = await l2Store.finalFees(tokenAddress);
      if (currentFinalFee.eq(hre.ethers.utils.parseUnits(newFinalFee.toString(), decimals))) {
        console.log(`Final fee for ${token} on ${networkName} is already ${newFinalFee}`);
        continue;
      }
      console.log(`Setting final fee for ${token} to ${newFinalFee} on ${networkName}...`);
      if (isArbitrum) fundArbitrumCount++;
      const setFinalFeeTx = await l2Store.populateTransaction.setFinalFee(tokenAddress, {
        rawValue: hre.ethers.utils.parseUnits(newFinalFee.toString(), decimals),
      });
      governanceMessages.push({ targetAddress: l2Store.address, tx: setFinalFeeTx });
    }

    if (fundArbitrumCount)
      await fundArbitrumParentMessengerForRelays(arbitrumParentMessenger, proposerSigner, fundArbitrumCount);

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
    .propose(adminProposalTransactions, hre.ethers.utils.toUtf8Bytes(proposalTitle));

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
