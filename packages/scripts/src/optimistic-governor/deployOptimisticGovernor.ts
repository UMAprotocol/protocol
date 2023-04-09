// This script can be used to deploy and enable a new Optimistic Governor module for a Gnosis Safe.
// Environment:
// - CUSTOM_NODE_URL: URL of the Ethereum node to use (required)
// - MNEMONIC: Mnemonic to use to sign transactions (required when mnemonic is used for --wallet)
// - PRIVATE_KEY: Private key to use to sign transactions (required when privateKey is used for --wallet)
// - GCKMS_WALLET: GCKMS wallet name to use to sign transactions (required when gckms is used for --wallet)
// Run:
//   node dist/optimistic-governor/deployOptimisticGovernor.js --wallet <mnemonic|privateKey|gckms> \
//   --safe <Gnosis Safe Address> \       // Optional. If not provided, a new Gnosis Safe will be deployed.
//   --collateral <collateral address> \  // Optional. If not provided, the collateral will be taken from mastercopy.
//   --bondAmount <bond amount in wei> \  // Optional. If not provided, the bond amount will be taken from mastercopy.
//   --rules <rules string> \             // Optional. If not provided, the rules will be set to "proxy rules".
//   --identifier <identifier> \          // Optional. If not provided, the identifier will be taken from mastercopy.
//   --liveness <liveness in seconds>     // Optional. If not provided, the liveness will be taken from mastercopy.
// Note:
// - Existing Gnosis Safe must have a threshold of 1 and the wallet owner must be among the Safe owners.
// - collateral token must be whitelisted in the AddressWhitelist.
// - identifier must be whitelisted in the IdentifierWhitelist.

import { StaticJsonRpcProvider } from "@ethersproject/providers";
import { deployAndSetUpCustomModule } from "@gnosis.pm/zodiac";
import { getEthersSigner, ZERO_ADDRESS } from "@uma/common";
import { getAbi, getAddress, OptimisticGovernorEthers } from "@uma/contracts-node";
import { BigNumber, Contract, utils, Wallet } from "ethers";
import minimist from "minimist";
import { getGnosisSafe, deployGnosisSafe } from "../utils/gnosisSafeDeployment";

async function main() {
  const argv = minimist(process.argv.slice(), { string: ["safe"] });

  if (process.env.CUSTOM_NODE_URL === undefined) throw new Error("Must provide CUSTOM_NODE_URL");
  const provider = new StaticJsonRpcProvider(process.env.CUSTOM_NODE_URL);
  const walletSigner = (await getEthersSigner()).connect(provider);

  // Deploy Gnosis Safe unless a safe address is provided.
  let gnosisSafe: Contract;
  if (argv.safe === undefined) {
    gnosisSafe = await deployGnosisSafe(walletSigner);
  } else {
    if (utils.isAddress(argv.safe)) {
      console.log("Using existing safe", argv.safe);
      gnosisSafe = getGnosisSafe(argv.safe, provider);
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
  const argv = minimist(process.argv.slice(), {
    string: ["collateral", "bondAmount", "rules", "identifier", "liveness"],
  });

  // Get mastercopy.
  // TODO: use deployAndSetUpModule from zodiac once the new OptimisticGovernor addresses are released.
  const provider = signer.provider;
  const chainId = (await provider.getNetwork()).chainId;
  const optimisticGovernorAbi = getAbi("OptimisticGovernor");
  const mastercopyAddress = await getAddress("OptimisticGovernor", chainId);
  const mastercopy = new Contract(mastercopyAddress, optimisticGovernorAbi, provider) as OptimisticGovernorEthers;

  // Construct OptimisticGovernor parameters.
  const collateral: string = argv.collateral !== undefined ? argv.collateral : await mastercopy.collateral();
  if (!utils.isAddress(collateral)) throw new Error("Invalid collateral address");
  const bondAmount: BigNumber =
    argv.bondAmount !== undefined ? BigNumber.from(argv.bondAmount) : await mastercopy.bondAmount();
  const rules: string = argv.rules !== undefined ? argv.rules : "proxy rules";
  const identifier: string =
    argv.identifier !== undefined ? utils.formatBytes32String(argv.identifier) : await mastercopy.identifier();
  const liveness: BigNumber = argv.liveness !== undefined ? BigNumber.from(argv.liveness) : await mastercopy.liveness();
  const saltNonce = Number(new Date());

  const txAndExpectedAddress = await deployAndSetUpCustomModule(
    mastercopyAddress,
    optimisticGovernorAbi,
    {
      types: ["address", "address", "uint256", "string", "bytes32", "uint64"],
      values: [owner, collateral, bondAmount, rules, identifier, liveness],
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
  const signatures = utils.hexConcat([utils.hexZeroPad(signer.address, 32), utils.hexZeroPad("0x", 32), "0x01"]);
  await (
    await gnosisSafe
      .connect(signer)
      .execTransaction(gnosisSafe.address, 0, payload, 0, 0, 0, 0, ZERO_ADDRESS, ZERO_ADDRESS, signatures)
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
