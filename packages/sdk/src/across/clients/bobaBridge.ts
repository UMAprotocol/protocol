import assert from "assert";
import { ethers } from "ethers";
import { Provider } from "@ethersproject/providers";
import { Signer, BigNumber, ContractTransaction } from "ethers";
import {
  ERC20Ethers__factory,
  OptimismL1StandardBridgeEthers__factory,
  BobaAddressManagerEthers__factory,
} from "@uma/contracts-node";
import { Watcher } from "@eth-optimism/core-utils";
import { SignerOrProvider } from "../..";

export const l1Contracts: { ADDRESS_MANAGER_ADDRESS: { [chainId: number]: string } } = {
  ADDRESS_MANAGER_ADDRESS: {
    // mainnet
    1: "0x8376ac6C3f73a25Dd994E0b0669ca7ee0C02F089",
    // rinkeby
    4: "0x93A96D6A5beb1F661cf052722A1424CDDA3e9418",
  },
};

export class BobaBridgeClient {
  // Gas limit for the L2 transaction initiated by the Sequencer
  public readonly L2_DEPOSIT_GAS_LIMIT = 1300000;

  public async getL1BridgeAddress(chainId: number, l1Provider: SignerOrProvider): Promise<string> {
    const addressManagerAddress = l1Contracts.ADDRESS_MANAGER_ADDRESS[chainId];
    assert(typeof addressManagerAddress === "string", "Chain not supported");
    const addressManager = BobaAddressManagerEthers__factory.connect(addressManagerAddress, l1Provider);
    const l1StandardBridgeAddress = await addressManager.getAddress("Proxy__OVM_L1StandardBridge");

    return l1StandardBridgeAddress;
  }

  /**
   * Create a transaction to deposit ERC20 tokens to Boba. Mainnet and Rinkeby are currently supported
   * @param l1Signer The L1 wallet provider (signer)
   * @param l1Erc20Address The L1 token address
   * @param l2Erc20Address The L2 token address
   * @param amount The amount to be deposited in wei
   * @returns The submitted transaction
   */
  async depositERC20(l1Signer: Signer, l1Erc20Address: string, l2Erc20Address: string, amount: BigNumber) {
    const chainId = await l1Signer.getChainId();
    const l1StandardBridgeAddress = await this.getL1BridgeAddress(chainId, l1Signer);
    const l1StandardBridge = OptimismL1StandardBridgeEthers__factory.connect(l1StandardBridgeAddress, l1Signer);
    const l1_ERC20 = ERC20Ethers__factory.connect(l1Erc20Address, l1Signer);
    return l1StandardBridge.depositERC20(
      l1_ERC20.address,
      l2Erc20Address,
      amount,
      this.L2_DEPOSIT_GAS_LIMIT,
      ethers.utils.formatBytes32String(new Date().getTime().toString())
    );
  }

  /**
   * Create transaction to deposit ETH to Boba
   * @param l1Signer The L1 wallet provider (signer)
   * @param amount The amount to be deposited in wei
   * @returns The submitted transaction
   */
  async depositEth(l1Signer: Signer, amount: BigNumber) {
    const chainId = await l1Signer.getChainId();
    const l1StandardBridgeAddress = await this.getL1BridgeAddress(chainId, l1Signer);
    const l1StandardBridge = OptimismL1StandardBridgeEthers__factory.connect(l1StandardBridgeAddress, l1Signer);
    return l1StandardBridge.depositETH(
      this.L2_DEPOSIT_GAS_LIMIT,
      ethers.utils.formatBytes32String(new Date().getTime().toString()),
      { value: amount }
    );
  }

  /**
   * Wait a L1 transaction to be relayed by the L1 Cross Domain Messenger
   * @param tx The L1 -> L2 transaction
   * @param l1RpcProvider Layer 1 RPC provider
   * @param l2RpcProvider Layer 2 RPC provider
   * @returns The transaction receipt
   */
  async waitRelayToL2(tx: ContractTransaction, l1RpcProvider: Provider, l2RpcProvider: Provider) {
    const chainId = (await l1RpcProvider.getNetwork()).chainId;
    const addressManagerAddress = l1Contracts.ADDRESS_MANAGER_ADDRESS[chainId];
    assert(typeof addressManagerAddress === "string", "Chain not supported");
    const addressManager = BobaAddressManagerEthers__factory.connect(addressManagerAddress, l1RpcProvider);
    const proxyL1CrossDomainMessengerAddress = await addressManager.getAddress("Proxy__L1CrossDomainMessenger");
    const l2CrossDomainMessenger = await addressManager.getAddress("L2CrossDomainMessenger");
    // Watch for messages to be relayed between L1 and L2.
    const watcher = new Watcher({
      l1: {
        provider: l1RpcProvider,
        messengerAddress: proxyL1CrossDomainMessengerAddress,
      },
      l2: {
        provider: l2RpcProvider,
        messengerAddress: l2CrossDomainMessenger,
      },
    });
    // Wait for the message to be relayed to L2
    const [msgHash] = await watcher.getMessageHashesFromL1Tx(tx.hash);
    return watcher.getL2TransactionReceipt(msgHash, true);
  }

  public async checkAllowance(l1Signer: Signer, l1Erc20Address: string) {
    const chainId = await l1Signer.getChainId();
    const l1StandardBridgeAddress = await this.getL1BridgeAddress(chainId, l1Signer);
    const l1_ERC20 = ERC20Ethers__factory.connect(l1Erc20Address, l1Signer);
    return l1_ERC20.allowance(await l1Signer.getAddress(), l1StandardBridgeAddress);
  }

  public async approve(l1Signer: Signer, l1Erc20Address: string, amount: BigNumber) {
    const chainId = await l1Signer.getChainId();
    const l1StandardBridgeAddress = await this.getL1BridgeAddress(chainId, l1Signer);
    const l1_ERC20 = ERC20Ethers__factory.connect(l1Erc20Address, l1Signer);
    return l1_ERC20.approve(l1StandardBridgeAddress, amount);
  }
}
