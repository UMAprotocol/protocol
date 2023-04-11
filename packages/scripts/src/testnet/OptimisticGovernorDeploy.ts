// This script can be used to deploy and enable a new Optimistic Governor module for a Gnosis Safe.
// It is intended to be used on testnets as this assumes that the Gnosis Safe has only a threshold of 1.
// Environment:
// - CUSTOM_NODE_URL: URL of the Ethereum node to use (required)
// - MNEMONIC: Mnemonic to use for signing transactions (required)
// - SAFE: Address of Gnosis Safe to use. If not provided, a new Gnosis Safe will be deployed.
// - COLLATERAL: Address of collateral token. If not provided, value from mastercopy will be used.
// - BOND_AMOUNT: Proposal bond amount (scaled down to human readable). If not provided, value from mastercopy will be used.
// - RULES: Rules to use for evaluating proposed transactions. If not provided, the rules will be set to "placeholder rules".
// - IDENTIFIER: Price identifier to use (in UTF-8). If not provided, value from mastercopy will be used.
// - LIVENESS: Proposal liveness in seconds. If not provided, value from mastercopy will be used.
// Run:
//   node dist/testnet/OptimisticGovernorDeploy.js
// Note:
// - Existing Gnosis Safe must have a threshold of 1 and the first mnemonic wallet owner must be among the Safe owners.
// - COLLATERAL token must be whitelisted in the AddressWhitelist.
// - IDENTIFIER must be whitelisted in the IdentifierWhitelist.

import { StaticJsonRpcProvider } from "@ethersproject/providers";
import { deployAndSetUpCustomModule } from "@gnosis.pm/zodiac";
import { getMnemonicSigner } from "@uma/common";
import { getAbi, getAddress, ERC20Ethers, OptimisticGovernorEthers } from "@uma/contracts-node";
import { BigNumber, Contract, constants, utils, Wallet } from "ethers";
import { getContractInstanceWithProvider } from "../utils/contracts";
import { getGnosisSafe, deployGnosisSafe } from "../utils/gnosisSafeDeployment";

async function main() {
  if (process.env.CUSTOM_NODE_URL === undefined) throw new Error("Must provide CUSTOM_NODE_URL");
  const provider = new StaticJsonRpcProvider(process.env.CUSTOM_NODE_URL);
  const walletSigner = (await getMnemonicSigner()).connect(provider);

  // Deploy Gnosis Safe unless a safe address is provided.
  let gnosisSafe: Contract;
  if (process.env.SAFE === undefined) {
    gnosisSafe = await deployGnosisSafe(walletSigner);
  } else {
    if (utils.isAddress(process.env.SAFE)) {
      console.log("Using existing safe", process.env.SAFE);
      gnosisSafe = getGnosisSafe(process.env.SAFE, provider);
      const safeOwners = await gnosisSafe.getOwners();
      if (!safeOwners.includes(walletSigner.address)) throw new Error("Wallet owner is not among safe owners");
      if (Number(await gnosisSafe.getThreshold()) !== 1) throw new Error("Safe threshold is not 1");
    } else throw new Error("Invalid safe address");
  }

  const optimisticGovernor = await deployOptimisticGovernor(walletSigner, gnosisSafe.address);
  console.log("Deployed Optimistic Governor at", optimisticGovernor.address);

  await enableModule(walletSigner, gnosisSafe, optimisticGovernor.address);
}

async function deployOptimisticGovernor(signer: Wallet, owner: string): Promise<OptimisticGovernorEthers> {
  // Get mastercopy.
  // TODO: use deployAndSetUpModule from zodiac once the new OptimisticGovernor addresses are released.
  const provider = signer.provider;
  const chainId = (await provider.getNetwork()).chainId;
  const optimisticGovernorAbi = getAbi("OptimisticGovernor");
  const mastercopyAddress = await getAddress("OptimisticGovernor", chainId);
  const mastercopy = new Contract(mastercopyAddress, optimisticGovernorAbi, provider) as OptimisticGovernorEthers;

  // Construct OptimisticGovernor parameters.
  const collateralAddress =
    process.env.COLLATERAL !== undefined ? process.env.COLLATERAL : await mastercopy.collateral();
  if (!utils.isAddress(collateralAddress)) throw new Error("Invalid COLLATERAL address");
  const collateral = await getContractInstanceWithProvider<ERC20Ethers>("ERC20", provider, collateralAddress);
  const decimals = await collateral.decimals();
  const bondAmount =
    process.env.BOND_AMOUNT !== undefined
      ? utils.parseUnits(process.env.BOND_AMOUNT, decimals)
      : await mastercopy.bondAmount();
  const rules = process.env.RULES !== undefined ? process.env.RULES : "placeholder rules";
  const identifier =
    process.env.IDENTIFIER !== undefined
      ? utils.formatBytes32String(process.env.IDENTIFIER)
      : await mastercopy.identifier();
  const liveness =
    process.env.LIVENESS !== undefined ? BigNumber.from(process.env.LIVENESS) : await mastercopy.liveness();
  const saltNonce = Number(new Date());

  const txAndExpectedAddress = await deployAndSetUpCustomModule(
    mastercopyAddress,
    optimisticGovernorAbi,
    {
      types: ["address", "address", "uint256", "string", "bytes32", "uint64"],
      values: [owner, collateralAddress, bondAmount, rules, identifier, liveness],
    },
    provider,
    chainId,
    saltNonce.toString()
  );
  await (
    await signer.sendTransaction({
      to: txAndExpectedAddress.transaction.to,
      data: txAndExpectedAddress.transaction.data,
      value: txAndExpectedAddress.transaction.value,
    })
  ).wait();
  return new Contract(
    txAndExpectedAddress.expectedModuleAddress,
    optimisticGovernorAbi,
    provider
  ) as OptimisticGovernorEthers;
}

async function enableModule(signer: Wallet, gnosisSafe: Contract, moduleAddress: string) {
  const payload = gnosisSafe.interface.encodeFunctionData("enableModule", [moduleAddress]);
  // Assumes the signer is the owner of the Gnosis Safe with threshold 1.
  const signatures = utils.hexConcat([utils.hexZeroPad(signer.address, 32), constants.HashZero, "0x01"]);
  await (
    await gnosisSafe
      .connect(signer)
      .execTransaction(
        gnosisSafe.address,
        0,
        payload,
        0,
        0,
        0,
        0,
        constants.AddressZero,
        constants.AddressZero,
        signatures
      )
  ).wait();

  console.log("Enabled module", moduleAddress);
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
