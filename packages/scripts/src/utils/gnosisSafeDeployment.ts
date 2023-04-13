import { Provider } from "@ethersproject/abstract-provider";
import {
  getCompatibilityFallbackHandlerDeployment,
  getSafeSingletonDeployment,
  getProxyFactoryDeployment,
} from "@safe-global/safe-deployments";
import { Contract, constants, Wallet } from "ethers";

export async function deployGnosisSafe(signer: Wallet, _owners?: string[], _threshold?: number): Promise<Contract> {
  const owners = _owners ? _owners : [signer.address];
  const threshold = _threshold ? _threshold : 1;
  if (threshold < 1) throw new Error("Threshold cannot be less than 1");
  if (owners.length < threshold) throw new Error("Threshold cannot be greater than number of owners");
  const provider = signer.provider;
  const chainId = (await provider.getNetwork()).chainId;
  const gnosisSafeProxyFactoryDeployment = getProxyFactoryDeployment({ version: "1.3.0" });
  if (!gnosisSafeProxyFactoryDeployment) {
    throw new Error("No gnosis safe proxy factory deployment found");
  }
  const gnosisSafeProxyFactory = new Contract(
    gnosisSafeProxyFactoryDeployment.networkAddresses[chainId],
    gnosisSafeProxyFactoryDeployment.abi,
    provider
  );
  const gnosisSafeDeployment = getSafeSingletonDeployment({ version: "1.3.0" });
  if (!gnosisSafeDeployment) {
    throw new Error("No gnosis safe deployment found");
  }
  const gnosisSafeSingletonAddress = gnosisSafeDeployment.networkAddresses[chainId];
  const gnosisSafeSingleton = new Contract(gnosisSafeSingletonAddress, gnosisSafeDeployment.abi, provider);
  const compatibilityFallbackHandlerDeployment = getCompatibilityFallbackHandlerDeployment({ version: "1.3.0" });
  if (!compatibilityFallbackHandlerDeployment) {
    throw new Error("No compatibility fallback handler deployment found");
  }
  const compatibilityFallbackHandlerAddress = compatibilityFallbackHandlerDeployment.networkAddresses[chainId];
  const initializer = gnosisSafeSingleton.interface.encodeFunctionData("setup", [
    owners,
    threshold,
    constants.AddressZero,
    "0x",
    compatibilityFallbackHandlerAddress,
    constants.AddressZero,
    0,
    constants.AddressZero,
  ]);
  const saltNonce = Number(new Date());
  const proxyCreationReciept = await (
    await gnosisSafeProxyFactory
      .connect(signer)
      .createProxyWithNonce(gnosisSafeSingletonAddress, initializer, saltNonce)
  ).wait();
  const proxyAddress = (
    await gnosisSafeProxyFactory.queryFilter(
      gnosisSafeProxyFactory.filters.ProxyCreation(),
      proxyCreationReciept.blockNumber,
      proxyCreationReciept.blockNumber
    )
  )[0].args?.proxy;
  const gnosisSafe = new Contract(proxyAddress, gnosisSafeDeployment.abi, provider);
  console.log("Deployed Gnosis Safe at", gnosisSafe.address);
  return gnosisSafe;
}

export function getGnosisSafe(gnosisSafeAddress: string, provider: Provider): Contract {
  const gnosisSafeDeployment = getSafeSingletonDeployment({ version: "1.3.0" });
  if (!gnosisSafeDeployment) {
    throw new Error("No gnosis safe deployment found");
  }
  return new Contract(gnosisSafeAddress, gnosisSafeDeployment.abi, provider);
}
