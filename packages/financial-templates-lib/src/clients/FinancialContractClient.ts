// A thick client for getting information about an ExpiringMultiParty. Used to get sponsor information, outstanding
// positions, undisputed Liquidations, expired liquidations, disputed liquidations.

import { ConvertDecimals, LiquidationStatesEnum, getFromBlock } from "@uma/common";
import { Abi, Awaited, BN, FinancialContractType, isDefined } from "../types";
import type { ExpiringMultiPartyWeb3, PerpetualWeb3 } from "@uma/contracts-node";
import Web3 from "web3";
import { aggregateTransactionsAndCall } from "../helpers/multicall";
import type { Logger } from "winston";

import BluebirdPromise from "bluebird";

interface Position {
  sponsor: string;
  withdrawalRequestPassTimestamp: string;
  withdrawalRequestAmount: string;
  adjustedTokens: string;
  numTokens: string;
  amountCollateral: string;
  hasPendingWithdrawal: boolean;
}

interface Liquidation {
  sponsor: string;
  id: string;
  state: string;
  numTokens: string;
  liquidatedCollateral: string;
  lockedCollateral: string;
  liquidationTime: string;
  liquidator: string;
  disputer: string;
}

type FinancialContract = ExpiringMultiPartyWeb3 | PerpetualWeb3;

type ContractLiquidationStruct = Omit<
  Awaited<ReturnType<ReturnType<FinancialContract["methods"]["liquidations"]>["call"]>>,
  number
>;

type ConvertDecimals = ReturnType<typeof ConvertDecimals>;

export class FinancialContractClient {
  // Web3 financial contract instantiation.
  public readonly financialContract: ExpiringMultiPartyWeb3 | PerpetualWeb3;

  // Store the last on-chain time the clients were updated to inform price request information.
  public lastUpdateTimestamp = 0;

  // Financial Contract Data structures & values to enable synchronous returns of the financialContract state seen by
  // the client.
  private activeSponsors: string[] = [];
  private positions: Position[] = [];
  private undisputedLiquidations: Liquidation[] = [];
  private expiredLiquidations: Liquidation[] = [];
  private disputedLiquidations: Liquidation[] = [];
  private collateralRequirement: BN | undefined;
  private cumulativeFeeMultiplier: undefined | BN;
  private liquidationLiveness: undefined | number;
  private readonly fixedPointAdjustment: BN;

  // Perpetual financial products require the latest fundingRate to correctly calculate fundingRate adjusted debt.
  private latestCumulativeFundingRateMultiplier: undefined | BN;

  // Helper functions.
  private readonly toBN = Web3.utils.toBN;
  private readonly toWei = Web3.utils.toWei;
  private readonly normalizeCollateralDecimals: ConvertDecimals;
  private readonly normalizeSyntheticDecimals: ConvertDecimals;
  private readonly normalizePriceFeedDecimals: ConvertDecimals;

  /**
   * @notice Constructs new FinancialContractClient.
   * @param {Object} logger Winston module used to send logs.
   * @param {Object} financialContractAbi truffle ABI object to create a contract instance of the financial contract.
   * @param {Object} web3 Provider from Truffle instance to connect to Ethereum network.
   * @param {String} financialContractAddress Ethereum address of the Financial Contract contract deployed on the
   * current network.
   * @param {Object} multicallContractAddress Address of deployed Multicall contract on provided network.
   * @param {Number} collateralDecimals Number of decimals within the collateral currency.
   * @param {Number} syntheticDecimals Number of decimals within the synthetic currency.
   * @param {Number} priceFeedDecimals Number of decimals a price feed returned by the DVM would be scaled by. For old
   * Financial Contracts this is scaled to the number of decimals in the collateral currency (8 for BTC) and in new
   * Financial Contracts this has been updated to always use 18 decimals, irrespective of the collateral type for
   * consistency.
   * @return None or throws an Error.
   */
  constructor(
    private readonly logger: Logger,
    financialContractAbi: Abi,
    readonly web3: Web3,
    private readonly financialContractAddress: string,
    // We use this Multicall contract to simulate the results of batched state-modifying transactions.
    private readonly multicallContractAddress: string,
    collateralDecimals = 18,
    syntheticDecimals = 18,
    priceFeedDecimals = 18,
    private readonly contractType: FinancialContractType = "ExpiringMultiParty" // Default to Expiring Multi Party for now to enable backwards compatibility with other bots. // This will be removed as soon as the other bots have been updated to work with these contract types.
  ) {
    // Financial Contract contract
    this.financialContract = (new web3.eth.Contract(financialContractAbi, financialContractAddress) as unknown) as
      | ExpiringMultiPartyWeb3
      | PerpetualWeb3; // Cast to web3-specific type

    // Define a set of normalization functions. These Convert a number delimited with given base number of decimals to a
    // number delimited with a given number of decimals (18). For example, consider normalizeCollateralDecimals. 100 BTC
    // is 100*10^8. This function would return 100*10^18, thereby converting collateral decimals to 18 decimal places.
    this.normalizeCollateralDecimals = ConvertDecimals(collateralDecimals, 18);
    this.normalizeSyntheticDecimals = ConvertDecimals(syntheticDecimals, 18);
    this.normalizePriceFeedDecimals = ConvertDecimals(priceFeedDecimals, 18);

    this.fixedPointAdjustment = this.toBN(this.toWei("1"));

    if (contractType !== "ExpiringMultiParty" && contractType !== "Perpetual")
      throw new Error(
        `Invalid contract type provided: ${contractType}! The financial product client only supports ExpiringMultiParty or Perpetual`
      );
  }

  public getContractType(): FinancialContractType {
    return this.contractType;
  }

  // Returns an array of { sponsor, adjustedTokens, numTokens, amountCollateral } for each open position.
  public getAllPositions(): Position[] {
    return this.positions;
  }

  // Returns an array of positions that are  undercollateralized according to the provided `tokenRedemptionValue`.
  // Note that the `amountCollateral` fed into `_isUnderCollateralized` is taken as the positions `amountCollateral`
  // minus any `withdrawalRequestAmount`. As a result this function will return positions that are undercollateralized
  // due to too little collateral or a withdrawal that, if passed, would make the position undercollateralized.
  public getUnderCollateralizedPositions(tokenRedemptionValue: string): Position[] {
    return this.positions.filter((position) => {
      const collateralNetWithdrawal = this.toBN(position.amountCollateral)
        .sub(this.toBN(position.withdrawalRequestAmount))
        .toString();
      return this._isUnderCollateralized(position.adjustedTokens, collateralNetWithdrawal, tokenRedemptionValue);
    });
  }

  // Returns an array of undisputed liquidations. To check whether a liquidation can be disputed, call `isDisputable`
  // with the liquidation's token redemption value at `liquidationTime`.
  public getUndisputedLiquidations(): Liquidation[] {
    return this.undisputedLiquidations;
  }

  // Returns an array of undisputed liquidations from which liquidators can withdraw rewards.
  public getExpiredLiquidations(): Liquidation[] {
    return this.expiredLiquidations;
  }

  // Returns an array of disputed liquidations from which liquidators can withdraw rewards.
  public getDisputedLiquidations(): Liquidation[] {
    return this.disputedLiquidations;
  }

  // Whether the given undisputed `liquidation` (`getUndisputedLiquidations` returns an array of `liquidation`s) is
  // disputable. `tokenRedemptionValue` should be the redemption value at `liquidation.time`.
  public isDisputable(liquidation: Liquidation, tokenRedemptionValue: string): boolean {
    return !this._isUnderCollateralized(liquidation.numTokens, liquidation.liquidatedCollateral, tokenRedemptionValue);
  }

  // Returns an array of sponsor addresses.
  public getAllSponsors(): string[] {
    return this.activeSponsors;
  }

  // Returns the last update timestamp.
  public getLastUpdateTime(): number {
    return this.lastUpdateTimestamp;
  }

  getLatestCumulativeFundingRateMultiplier(): BN {
    if (!isDefined(this.latestCumulativeFundingRateMultiplier)) throw new Error("initialSetup hasn't been called");
    return this.latestCumulativeFundingRateMultiplier;
  }

  async initialSetup(): Promise<void> {
    const [collateralRequirement, liquidationLiveness, cumulativeFeeMultiplier] = await BluebirdPromise.all([
      this.financialContract.methods.collateralRequirement().call(),
      this.financialContract.methods.liquidationLiveness().call(),
      this.financialContract.methods.cumulativeFeeMultiplier().call(),
    ]);
    this.collateralRequirement = this.toBN(collateralRequirement.toString());
    this.liquidationLiveness = Number(liquidationLiveness);
    this.cumulativeFeeMultiplier = this.toBN(cumulativeFeeMultiplier.toString());
  }

  async update(): Promise<void> {
    // If it is the first run then get contract contestants. This only needs to be called once.
    if (!this.collateralRequirement || !this.liquidationLiveness || !this.cumulativeFeeMultiplier) {
      await this.initialSetup();
    }
    // Fetch contract state variables in parallel.
    const fromBlock = await getFromBlock(this.web3);
    const [newSponsorEvents, endedSponsorEvents, liquidationCreatedEvents, currentTime] = await BluebirdPromise.all([
      this.financialContract.getPastEvents("NewSponsor", { fromBlock }),
      this.financialContract.getPastEvents("EndedSponsorPosition", { fromBlock }),
      this.financialContract.getPastEvents("LiquidationCreated", { fromBlock }),
      this.financialContract.methods.getCurrentTime().call().then(parseInt),
    ]);

    if (this.contractType === "Perpetual") {
      const financialContract = this.financialContract as PerpetualWeb3;
      if (!this.multicallContractAddress) {
        // If no multicontract address set, then read the contract's on-chain CFRM. Note that this will not take
        // into account any pending funding rates that will be published on the next contract interaction.
        this.latestCumulativeFundingRateMultiplier = this.toBN(
          (await financialContract.methods.fundingRate().call()).cumulativeMultiplier[0]
        );
      } else {
        // Simulate calling `applyFundingRate()` on the perpetual before reading `fundingRate()`, in order to
        // account for any unpublished, pending funding rates.
        const applyFundingRateCall = {
          target: this.financialContractAddress,
          callData: financialContract.methods.applyFundingRate().encodeABI(),
        };
        const fundingRateCall = {
          target: this.financialContractAddress,
          callData: financialContract.methods.fundingRate().encodeABI(),
        };
        const [, fundingRateData] = await aggregateTransactionsAndCall(this.multicallContractAddress, this.web3, [
          applyFundingRateCall,
          fundingRateCall,
        ]);
        // `aggregateTransactionsAndCall` returns an array of decoded return data bytes corresponding to the
        // transactions passed to the multicall aggregate method. Therefore, `fundingRate()`'s return output is the
        // second element.
        this.latestCumulativeFundingRateMultiplier = this.toBN(fundingRateData.cumulativeMultiplier.rawValue);
      }
    } else {
      this.latestCumulativeFundingRateMultiplier = this.fixedPointAdjustment;
    }

    // Array of all sponsors, over all time. Can contain repeats for every `NewSponsor` event.
    const newSponsorAddresses = newSponsorEvents.map((e) => e.returnValues.sponsor);

    // Array of ended sponsors. Can contain repeats for every `EndedSponsorPosition` event.
    const endedSponsorAddresses = endedSponsorEvents.map((e) => e.returnValues.sponsor);

    // Filter out the active sponsors by removing ended sponsors from all historic sponsors. Note that a sponsor could
    // create a position, end their position and then create another one. They could potentially do this multiple times.
    // As a result, create a temp array `sponsorsToRemove` which is updated as sponsors are removed from the array.
    let sponsorsToRemove = endedSponsorAddresses; // temp array to contain address to remove.
    this.activeSponsors = newSponsorAddresses.filter((address) => {
      // If the sponsorsToRemove contains the current address, then that address should be removed from
      // newSponsorAddresses.
      const index = sponsorsToRemove.indexOf(address);
      // Update the `sponsorsToRemove` by removing the first instance of the address from the sponsorsToRemove array.
      if (index !== -1) {
        sponsorsToRemove = [...sponsorsToRemove.slice(0, index), ...sponsorsToRemove.slice(index + 1)];
        return false; // return false means that the filter will remove the current address from newSponsorAddresses
      }
      return true; // returning true means that the filter will keep the current address from newSponsorAddresses
    });

    // Array of all liquidated sponsors, over all time. Use a Set to ensure only contains unique elements.
    const liquidatedSponsors = [...new Set(liquidationCreatedEvents.map((e) => e.returnValues.sponsor))];

    // Fetch sponsor position & liquidation in parallel batches, 150 at a time, to be safe and not overload the web3
    // node.
    const WEB3_CALLS_BATCH_SIZE = 150;
    const [activePositions, allLiquidations] = await BluebirdPromise.all([
      BluebirdPromise.map(this.activeSponsors, (address) => this.financialContract.methods.positions(address).call(), {
        concurrency: WEB3_CALLS_BATCH_SIZE,
      }),
      BluebirdPromise.map(
        liquidatedSponsors,
        (address) =>
          (this.financialContract.methods.getLiquidations(address).call() as unknown) as ContractLiquidationStruct[],
        {
          concurrency: WEB3_CALLS_BATCH_SIZE,
        }
      ),
    ]);

    const undisputedLiquidations: Liquidation[] = [];
    const expiredLiquidations: Liquidation[] = [];
    const disputedLiquidations: Liquidation[] = [];
    for (const liquidations of allLiquidations) {
      for (const [id, liquidation] of Object.entries(liquidations)) {
        // Liquidations that have had all of their rewards withdrawn will still show up here but have their properties
        // set to default values. We can skip them.
        if (liquidation.state === LiquidationStatesEnum.UNINITIALIZED) {
          continue;
        }

        // Construct Liquidation data to save
        const liquidationData = {
          sponsor: liquidation.sponsor,
          id: id.toString(),
          state: liquidation.state,
          // Note: The `tokensOutstanding` entry in the Perpetual's on-chain Liquidation struct is adjusted
          // for the funding rate multiplier at the time of liquidation.
          numTokens: liquidation.tokensOutstanding.toString(),
          liquidatedCollateral: liquidation.liquidatedCollateral.toString(),
          lockedCollateral: liquidation.lockedCollateral.toString(),
          liquidationTime: liquidation.liquidationTime,
          liquidator: liquidation.liquidator,
          disputer: liquidation.disputer,
        };

        // Get all undisputed liquidations.
        if (this._isLiquidationPreDispute(liquidation)) {
          // Determine whether liquidation has expired.
          if (!this._isExpired(liquidation, currentTime)) {
            undisputedLiquidations.push(liquidationData);
          } else {
            expiredLiquidations.push(liquidationData);
          }
        } else {
          disputedLiquidations.push(liquidationData);
        }
      }
    }
    this.undisputedLiquidations = undisputedLiquidations;
    this.expiredLiquidations = expiredLiquidations;
    this.disputedLiquidations = disputedLiquidations;

    this.positions = activePositions.map((position, index) => {
      if (!isDefined(this.latestCumulativeFundingRateMultiplier) || !isDefined(this.cumulativeFeeMultiplier))
        throw new Error("initialSetup hasn't been called");

      return {
        sponsor: this.activeSponsors[index],
        withdrawalRequestPassTimestamp: position.withdrawalRequestPassTimestamp,
        withdrawalRequestAmount: position.withdrawalRequestAmount.toString(),
        adjustedTokens: this.toBN(position.tokensOutstanding.toString())
          .mul(this.latestCumulativeFundingRateMultiplier)
          .div(this.fixedPointAdjustment)
          .toString(),
        // Applies the current funding rate to the sponsor's raw amount of tokens outstanding. `adjustedTokens` is equal
        // to `numTokens * cumulativeFundingRateMultplier`, and this client uses `adjustedTokens` to determine whether
        // a position is liquidatable or not. If a position is liquidatable, then `numTokens` amount of debt needs
        // to be repaid by the liquidator to liquidate the position.
        numTokens: position.tokensOutstanding.toString(), // This represents the actual amount of tokens outstanding
        // for a sponsor and is the maximum amount of tokens needed to fully liquidate a position. The liquidator bot
        // therefore can liquidate up to this amount of tokens.
        amountCollateral: this.toBN(position.rawCollateral.toString())
          .mul(this.cumulativeFeeMultiplier)
          .div(this.fixedPointAdjustment)
          .toString(),
        // Applies the current outstanding fees to collateral.
        hasPendingWithdrawal: parseInt(position.withdrawalRequestPassTimestamp) > 0,
      };
    });
    this.lastUpdateTimestamp = currentTime;
    this.logger.debug({
      at: "FinancialContractClient",
      message: "Financial Contract state updated",
      lastUpdateTimestamp: this.lastUpdateTimestamp,
    });
  }
  // The formula for an undercollateralized position is: (numTokens * trv) * collateralRequirement > amountCollateral.
  // This equation assumes the decimal points across the inputs are normalized to the same basis. However, this wont
  // always be the case and so we need to consider arbitrary decimals coming into the equation. When considering
  // decimals of each variable within the as collateral (cD), synthetic (sD), CR (1e18), trv (trvD) this equation
  // becomes: numTokens * 10^sD * trv * 10^trvD * collateralRequirement * 10^18 > amountCollateral * 10^cD.
  // To accommodate these different decimal points we can normalize each term to the 10^18 basis and then apply a
  // "correction" factor due to the additional scalling from multiplying basis numbers.
  private _isUnderCollateralized(numTokens: string, amountCollateral: string, tokenRedemptionValue: string) {
    // Normalize the inputs. Now all terms are 18 decimal delimited and no extra conversion is needed.
    const normalizedNumTokens = this.normalizeSyntheticDecimals(numTokens);
    const normalizedAmountCollateral = this.normalizeCollateralDecimals(amountCollateral);
    const normalizedTokenRedemptionValue = this.normalizePriceFeedDecimals(tokenRedemptionValue);

    if (!isDefined(this.collateralRequirement)) throw new Error("initialSetup hasn't been called");

    return normalizedNumTokens
      .mul(normalizedTokenRedemptionValue)
      .mul(this.collateralRequirement)
      .gt(normalizedAmountCollateral.mul(this.fixedPointAdjustment).mul(this.fixedPointAdjustment));
  }

  private _isExpired(liquidation: { liquidationTime: string }, currentTime: number) {
    if (!isDefined(this.liquidationLiveness)) {
      throw new Error("initialSetup hasn't been called");
    }
    return Number(liquidation.liquidationTime) + this.liquidationLiveness <= currentTime;
  }

  private _isLiquidationPreDispute(liquidation: { state: string }) {
    return liquidation.state === LiquidationStatesEnum.PRE_DISPUTE;
  }
}
