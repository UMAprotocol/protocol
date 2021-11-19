import assert from "assert";
import { L1Bridge, networks, BridgeHelper, ArbRetryableTx__factory, L1ERC20Gateway__factory } from "arb-ts";
import { NodeInterface__factory, L1WethGateway__factory } from "arb-ts/dist/lib/abi";
import { NODE_INTERFACE_ADDRESS, ARB_RETRYABLE_TX_ADDRESS } from "arb-ts/dist/lib/precompile_addresses";
import { Signer, BigNumber } from "ethers";
import { parseEther } from "@ethersproject/units";
import { Logger } from "@ethersproject/logger";
import { Zero } from "@ethersproject/constants";
import { Provider } from "@ethersproject/abstract-provider";
import { ContractTransaction, PayableOverrides } from "@ethersproject/contracts";

// these are not exported from arb-ts/bridge
export const DEFAULT_SUBMISSION_PERCENT_INCREASE = BigNumber.from(400);
const DEFAULT_MAX_GAS_PERCENT_INCREASE = BigNumber.from(50);
const MIN_CUSTOM_DEPOSIT_MAXGAS = BigNumber.from(275000);

export interface RetryableGasArgs {
  maxSubmissionPrice?: BigNumber;
  maxGas?: BigNumber;
  gasPriceBid?: BigNumber;
  maxSubmissionPricePercentIncrease?: BigNumber;
  maxGasPercentIncrease?: BigNumber;
}

export interface DepositInputParams {
  erc20L1Address: string;
  amount: BigNumber;
  retryableGasArgs?: RetryableGasArgs;
  destinationAddress?: string;
}

export interface DepositParams {
  erc20L1Address: string;
  amount: BigNumber;
  l1CallValue: BigNumber;
  maxSubmissionCost: BigNumber;
  maxGas: BigNumber;
  gasPriceBid: BigNumber;
  destinationAddress: string;
}

const isDepositInputParams = (obj: any): obj is DepositInputParams => !obj["l1CallValue"];

function isError(error: Error): error is NodeJS.ErrnoException {
  return error instanceof Error;
}

export function getNetwork(chainId: string) {
  assert(networks[chainId], "Unsupported chainId: " + chainId);
  return networks[chainId];
}
export function getL1Bridge(chainId: string, l1Signer: Signer) {
  const network = getNetwork(chainId);
  return new L1Bridge(network, l1Signer);
}

// a lot of this code is ripped from arbitrum bridge client. Bridge client cant easily be used in FE environment
// because it requires 2 signers on different networks. We cant do this with metamask, so we have to change it to
// 2 providers and a dynamic signer and copy a lot of the logic out.
export class DepositClient {
  private arbRetryableTx: ReturnType<typeof ArbRetryableTx__factory.connect>;
  constructor(
    private l1Provider: Provider,
    private l2Provider: Provider,
    private chainId: string = "1",
    private isCustomNetwork = false
  ) {
    this.arbRetryableTx = ArbRetryableTx__factory.connect(ARB_RETRYABLE_TX_ADDRESS, l2Provider);
  }
  private async looksLikeWethGateway(potentialWethGatewayAddress: string) {
    try {
      const potentialWethGateway = L1WethGateway__factory.connect(potentialWethGatewayAddress, this.l1Provider);
      await potentialWethGateway.l1Weth();
      return true;
    } catch (err) {
      if (err instanceof Error && isError(err) && err.code === Logger.errors.CALL_EXCEPTION) {
        return false;
      } else {
        throw err;
      }
    }
  }
  public async getDepositTxParams(
    signer: Signer,
    { erc20L1Address, amount, retryableGasArgs = {}, destinationAddress }: DepositInputParams,
    overrides: PayableOverrides = {}
  ): Promise<DepositParams> {
    const l1Bridge = getL1Bridge(this.chainId, signer);
    const {
      l1WethGateway: l1WethGatewayAddress,
      l1CustomGateway: l1CustomGatewayAddress,
    } = l1Bridge.network.tokenBridge;

    // 1. Get gas price
    const gasPriceBid = retryableGasArgs.gasPriceBid || (await this.l2Provider.getGasPrice());

    const l1GatewayAddress = await l1Bridge.getGatewayAddress(erc20L1Address);

    // 2. Get submission price (this depends on size of calldata used in deposit)
    const l1Gateway = L1ERC20Gateway__factory.connect(l1GatewayAddress, this.l1Provider);
    const sender = await l1Bridge.getWalletAddress();
    const to = destinationAddress ? destinationAddress : sender;
    const depositCalldata = await l1Gateway.getOutboundCalldata(erc20L1Address, sender, to, amount, "0x");

    const maxSubmissionPricePercentIncrease =
      retryableGasArgs.maxSubmissionPricePercentIncrease || DEFAULT_SUBMISSION_PERCENT_INCREASE;

    const maxSubmissionPrice = BridgeHelper.percentIncrease(
      (await this.getL2TxnSubmissionPrice(depositCalldata.length - 2))[0],
      maxSubmissionPricePercentIncrease
    );

    // 3. Estimate gas
    const nodeInterface = NodeInterface__factory.connect(NODE_INTERFACE_ADDRESS, this.l2Provider);
    const l2Dest = await l1Gateway.counterpartGateway();

    /** The WETH gateway is the only deposit that requires callvalue in the L2 user-tx (i.e., the recently un-wrapped ETH)
     * Here we check if this is a WETH deposit, and include the callvalue for the gas estimate query if so
     */
    const estimateGasCallValue = await (async () => {
      if (this.isCustomNetwork) {
        // For custom network, we do an ad-hoc check to see if it's a WETH gateway
        if (await this.looksLikeWethGateway(l1GatewayAddress)) {
          return amount;
        }
        // ...otherwise we directly check it against the config file
      } else if (l1WethGatewayAddress === l1GatewayAddress) {
        return amount;
      }

      return Zero;
    })();

    let maxGas =
      retryableGasArgs.maxGas ||
      BridgeHelper.percentIncrease(
        (
          await nodeInterface.estimateRetryableTicket(
            l1GatewayAddress,
            parseEther("0.05").add(
              estimateGasCallValue
            ) /** we add a 0.05 "deposit" buffer to pay for execution in the gas estimation  */,
            l2Dest,
            estimateGasCallValue,
            maxSubmissionPrice,
            sender,
            sender,
            0,
            gasPriceBid,
            depositCalldata
          )
        )[0],
        retryableGasArgs.maxGasPercentIncrease || BigNumber.from(DEFAULT_MAX_GAS_PERCENT_INCREASE)
      );
    if (l1GatewayAddress === l1CustomGatewayAddress && maxGas.lt(MIN_CUSTOM_DEPOSIT_MAXGAS)) {
      // For insurance, we set a sane minimum max gas for the custom gateway
      maxGas = MIN_CUSTOM_DEPOSIT_MAXGAS;
    }
    // 4. Calculate total required callvalue
    let totalEthCallvalueToSend = overrides && (await overrides.value);
    if (!totalEthCallvalueToSend || BigNumber.from(totalEthCallvalueToSend).isZero()) {
      totalEthCallvalueToSend = await maxSubmissionPrice.add(gasPriceBid.mul(maxGas));
    }
    return {
      maxGas,
      gasPriceBid,
      l1CallValue: BigNumber.from(totalEthCallvalueToSend),
      maxSubmissionCost: maxSubmissionPrice,
      destinationAddress: to,
      amount,
      erc20L1Address,
    };
  }
  public getL2TxnSubmissionPrice(dataSize: BigNumber | number): Promise<[BigNumber, BigNumber]> {
    return this.arbRetryableTx.functions.getSubmissionPrice(dataSize);
  }
  public async depositETH(
    signer: Signer,
    value: BigNumber,
    _maxSubmissionPricePercentIncrease?: BigNumber,
    overrides: PayableOverrides = {}
  ): Promise<ContractTransaction> {
    const l1Bridge = getL1Bridge(this.chainId, signer);
    const maxSubmissionPricePercentIncrease = _maxSubmissionPricePercentIncrease || DEFAULT_SUBMISSION_PERCENT_INCREASE;

    const maxSubmissionPrice = BridgeHelper.percentIncrease(
      (await this.getL2TxnSubmissionPrice(0))[0],
      maxSubmissionPricePercentIncrease
    );

    return l1Bridge.depositETH(value, maxSubmissionPrice, overrides);
  }
  async depositToken(signer: Signer, params: DepositParams, overrides: PayableOverrides = {}) {
    const l1Bridge = getL1Bridge(this.chainId, signer);
    const depositInput: DepositParams = isDepositInputParams(params)
      ? await this.getDepositTxParams(signer, params)
      : params;
    return l1Bridge.deposit(depositInput, overrides);
  }
}
