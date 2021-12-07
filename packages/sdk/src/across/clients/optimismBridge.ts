import assert from "assert";
import { Provider } from "@ethersproject/providers";
import { Contract, Signer, BigNumber, ContractTransaction } from "ethers";
import { predeploys, getContractInterface } from "@eth-optimism/contracts";
import { ERC20Ethers__factory, OptimismL1StandardBridgeEthers__factory } from "@uma/contracts-node";
import { Watcher } from "@eth-optimism/core-utils";

export const l1Contracts: { Proxy__OVM_L1StandardBridge: { [chainId: number]: string } } = {
  Proxy__OVM_L1StandardBridge: {
    1: "0x99C9fc46f92E8a1c0deC1b1747d010903E884bE1",
    42: "0x22F24361D548e5FaAfb36d1437839f080363982B",
  },
};

export class OptimismBridgeClient {
  // Gas limit for the L2 transaction initiated by the Sequencer
  public readonly L2_DEPOSIT_GAS_LIMIT = 2000000;

  public getL1BridgeAddress(chainId: number): string {
    const l1StandardBridgeAddress = l1Contracts.Proxy__OVM_L1StandardBridge[chainId];
    assert(typeof l1StandardBridgeAddress === "string", "Chain not supported");
    return l1StandardBridgeAddress;
  }

  /**
   * Create a transaction to deposit ERC20 tokens to Optimism
   * @param l1Signer The L1 wallet provider (signer)
   * @param l1Erc20Address The L1 token address
   * @param l2Erc20Address The L2 token address
   * @param amount The amount to be deposited in wei
   * @returns The submitted transaction
   */
  async depositERC20(l1Signer: Signer, l1Erc20Address: string, l2Erc20Address: string, amount: BigNumber) {
    const chainId = await l1Signer.getChainId();
    const l1StandardBridgeAddress = this.getL1BridgeAddress(chainId);
    const l1StandardBridge = OptimismL1StandardBridgeEthers__factory.connect(l1StandardBridgeAddress, l1Signer);
    const l1_ERC20 = ERC20Ethers__factory.connect(l1Erc20Address, l1Signer);
    return l1StandardBridge.depositERC20(l1_ERC20.address, l2Erc20Address, amount, this.L2_DEPOSIT_GAS_LIMIT, "0x");
  }

  /**
   * Create transaction to deposit ETH to Optimism
   * @param l1Signer The L1 wallet provider (signer)
   * @param amount The amount to be deposited in wei
   * @returns The submitted transaction
   */
  async depositEth(l1Signer: Signer, amount: BigNumber) {
    const chainId = await l1Signer.getChainId();
    const l1StandardBridgeAddress = this.getL1BridgeAddress(chainId);
    const l1StandardBridge = OptimismL1StandardBridgeEthers__factory.connect(l1StandardBridgeAddress, l1Signer);
    return l1StandardBridge.depositETH(this.L2_DEPOSIT_GAS_LIMIT, "0x", { value: amount });
  }

  /**
   * Wait a L1 transaction to be relayed by the L1 Cross Domain Messenger
   * @param tx The L1 -> L2 transaction
   * @param l1RpcProvider Layer 1 RPC provider
   * @param l2RpcProvider Layer 2 RPC provider
   * @returns The transaction receipt
   */
  async waitRelayToL2(tx: ContractTransaction, l1RpcProvider: Provider, l2RpcProvider: Provider) {
    const l2Messenger = new Contract(
      predeploys.L2CrossDomainMessenger,
      getContractInterface("L2CrossDomainMessenger"),
      l2RpcProvider
    );
    const l1Messenger = new Contract(
      await l2Messenger.l1CrossDomainMessenger(),
      getContractInterface("L1CrossDomainMessenger"),
      l1RpcProvider
    );
    // Watch for messages to be relayed between L1 and L2.
    const watcher = new Watcher({
      l1: {
        provider: l1RpcProvider,
        messengerAddress: l1Messenger.address,
      },
      l2: {
        provider: l2RpcProvider,
        messengerAddress: l2Messenger.address,
      },
    });
    // Wait for the message to be relayed to L2
    const [msgHash1] = await watcher.getMessageHashesFromL1Tx(tx.hash);
    return watcher.getL2TransactionReceipt(msgHash1, true);
  }

  public async checkAllowance(l1Signer: Signer, l1Erc20Address: string) {
    const chainId = await l1Signer.getChainId();
    const l1StandardBridgeAddress = this.getL1BridgeAddress(chainId);
    const l1_ERC20 = ERC20Ethers__factory.connect(l1Erc20Address, l1Signer);
    return l1_ERC20.allowance(await l1Signer.getAddress(), l1StandardBridgeAddress);
  }

  public async approve(l1Signer: Signer, l1Erc20Address: string, amount: BigNumber) {
    const chainId = await l1Signer.getChainId();
    const l1StandardBridgeAddress = this.getL1BridgeAddress(chainId);
    const l1_ERC20 = ERC20Ethers__factory.connect(l1Erc20Address, l1Signer);
    return l1_ERC20.approve(l1StandardBridgeAddress, amount);
  }
}
