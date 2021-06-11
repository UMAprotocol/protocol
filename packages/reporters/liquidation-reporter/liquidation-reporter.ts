// This script produces data that shows how much collateral would be needed to sufficiently liquidate positions due to x
// percentage drawdown in collateral prices. FOr example, for all WETH contracts, how much collateral would be needed
// to liquidate all underwater positions with a 10/20/30/40 percentage drawdown in collateral price.

import winston from "winston";

import { getWeb3, ConvertDecimals } from "@uma/common";
const web3 = getWeb3();
const { toWei, toBN, fromWei, toChecksumAddress, hexToUtf8 } = web3.utils;

// Import using require to work around not having types (yet).
const { Networker, createReferencePriceFeedForFinancialContract } = require("@uma/financial-templates-lib");

import { getAbi } from "@uma/core";

const fixedPointAdjustment = toBN(toWei("1"));

import { getAllEmpsPositions } from "./emp-position-helper";

import {
  getAllFinancialContractsData,
  evaluateFinancialContractCollateral,
} from "@uma/merkle-distributor/kpi-options-helpers/calculate-uma-tvl";

export async function fetchUmaEcosystemData() {
  console.log("Fetching UMA Ecosystem Data 🧙");

  // Fetch all info about all UMA financial contracts that have collateral in them.
  const allFinancialContractsData = await getAllFinancialContractsData();
  const collateralInfoWithValue = evaluateFinancialContractCollateral(allFinancialContractsData);

  // Filter out any contracts that dont have any collateral in them.
  const contractsWithCollateralValue = collateralInfoWithValue.filter((info) => info.collateralValueInUsd != "0");

  // Fetch all sponsors over all financial contracts in the UMA ecosystem.
  const allEmpPositions = await getAllEmpsPositions();

  // This data structure stores all information used in the final payout.
  const uniqueCollateralTypes: {
    [key: string]: {
      activeFinancialContracts: Array<any>;
      drawDownAmounts: Array<{
        priceDrop: string;
        collateralLiquidated: string;
        usdNeededToLiquidate: string;
        effectiveCollateralPrice: string;
      }>;
      collateralValueInUsd: string;
      collateralPriceInUsd: string;
      collateralSymbol: string;
    };
  } = {};

  // Populate initial data into the uniqueCollateralTypes. This we build by iterating over all collateral data.
  contractsWithCollateralValue.forEach((info: any) => {
    if (!uniqueCollateralTypes[info.collateralAddress]) {
      uniqueCollateralTypes[info.collateralAddress] = {
        activeFinancialContracts: [
          { contractAddress: info.contractAddress, collateralValueInUsd: info.collateralValueInUsd },
        ],
        drawDownAmounts: Array(10).fill({ priceDrop: "0", collateralLiquidated: "0", usdNeededToLiquidate: "0" }),
        collateralValueInUsd: info.collateralValueInUsd,
        collateralPriceInUsd: info.collateralPriceInUsd,
        collateralSymbol: info.collateralSymbol,
      };
    } else {
      uniqueCollateralTypes[info.collateralAddress] = {
        activeFinancialContracts: [
          ...uniqueCollateralTypes[info.collateralAddress].activeFinancialContracts,
          { contractAddress: info.contractAddress, collateralValueInUsd: info.collateralValueInUsd },
        ],
        drawDownAmounts: Array(10).fill({ priceDrop: "0", collateralLiquidated: "0", usdNeededToLiquidate: "0" }),
        collateralValueInUsd: fromWei(
          toBN(toWei(info.collateralValueInUsd)).add(
            toBN(toWei(uniqueCollateralTypes[info.collateralAddress].collateralValueInUsd))
          )
        ),
        collateralPriceInUsd: info.collateralPriceInUsd,
        collateralSymbol: info.collateralSymbol,
      };
    }
  });

  const logger = winston.createLogger({
    level: "info",
    transports: [new winston.transports.Console()],
  });
  const getTime = () => Math.round(new Date().getTime() / 1000);
  const networker = new Networker(logger);

  // Over each collateral type and each financial contract within it, iterate.
  for (const collateralAddress of Object.keys(uniqueCollateralTypes)) {
    for (const [financialContractIndex, financialContractInfo] of uniqueCollateralTypes[
      collateralAddress
    ].activeFinancialContracts.entries()) {
      const financialContractAddress = financialContractInfo.contractAddress;
      // Find the position information for the particular financial contract.
      const contractPositionsInfo = allEmpPositions.filter(
        (info: any) => toChecksumAddress(info.id) === toChecksumAddress(financialContractAddress)
      )[0];
      // If there is no position info, then continue. This would happen if there is data that is not on the graph.
      if (contractPositionsInfo == undefined) continue;

      // If the contract has no positions, we should also continue. Remove the contract from the list of active contracts
      if (contractPositionsInfo.positions.length == 0) continue;

      // If we got to this point we know that the financial contract matches what was returned from the graph and
      // the contract has positions in it. We can now fetch some extra info about the contract.
      const financialContract = new web3.eth.Contract(getAbi("ExpiringMultiParty"), financialContractAddress);
      const [collateralRequirementString, contractExpirationTime, contractPriceIdentifier] = await Promise.allSettled([
        financialContract.methods.collateralRequirement().call(),
        financialContract.methods.expirationTimestamp().call(),
        financialContract.methods.priceIdentifier().call(),
      ]);

      const collateralRequirement = toBN((collateralRequirementString as any).value);

      // If the collateral requirement is 1 then it is a KPI option or a kind of product that can be liquidated. Skip.
      if (Number(fromWei(collateralRequirement)) == 1) continue;

      // If expired, remove it from the list as it is not active.
      if (contractExpirationTime.status == "fulfilled" && getTime() > Number(contractExpirationTime.value)) continue;

      uniqueCollateralTypes[collateralAddress].activeFinancialContracts[financialContractIndex] = {
        ...uniqueCollateralTypes[collateralAddress].activeFinancialContracts[financialContractIndex],
        contractPriceIdentifier: hexToUtf8((contractPriceIdentifier as any).value),
        collateralRequirement: Number(fromWei(collateralRequirement)),
        contractExpirationTime:
          contractExpirationTime.status == "fulfilled" ? contractExpirationTime.value : "perpetual",
      };

      // Else, we can start building up draw down information.
      try {
        // Create a price feed for the product. We need to know the identifier price feed to compute drawdown as this
        // considers either the collateral value dropping OR the synthetic value increasing. We can set all three
        // common API keys. If the feed does not need one of these it just ignores it.
        const samplePriceFeed = await createReferencePriceFeedForFinancialContract(
          logger,
          web3,
          networker,
          getTime,
          financialContractAddress,
          {
            cryptowatchApiKey: process.env.CRYPTO_WATCH_API_KEY,
            tradermadeApiKey: process.env.TRADER_MADE_API_KEY,
            defipulseApiKey: process.env.DEFI_PULSE_API_KEY,
          }
        );
        await samplePriceFeed.update();

        const startingPrice = samplePriceFeed.getCurrentPrice();
        const priceFeedDecimals = samplePriceFeed.getPriceFeedDecimals();

        // Some feeds are inverted. This can either be at the top level within the object or within the array of priceFeeds
        // if the feed consists of multiple feeds within it.
        let invertedPrice = false;
        if (samplePriceFeed.invertPrice) invertedPrice = true;
        if (samplePriceFeed.priceFeeds && samplePriceFeed.priceFeeds[0].invertPrice) invertedPrice = true;

        // If the collateral type is stable, then we must invert the price feed by default. These kinds of feeds (such
        // as the BasketSpreadPriceFeed) do not contain the `invertPrice` flag, but they are all "inverted". As additional
        // stable collaterals are added this will need to be updated or the page will show up no liquidatable positions
        // for that collateral type.
        if (
          uniqueCollateralTypes[collateralAddress].collateralSymbol == "USDC" ||
          uniqueCollateralTypes[collateralAddress].collateralSymbol == "DAI" ||
          uniqueCollateralTypes[collateralAddress].collateralSymbol == "USDT" ||
          uniqueCollateralTypes[collateralAddress].collateralSymbol == "rDAI"
        )
          invertedPrice = true;
        // Next, using the value from the sample price feed, we can compute the drawdown intervals. These are steps
        // of 10% decrease from the current price. At each price point we can compute the CR of each position within
        // the financial contract. if it is below the contracts collateral Requirement add to the total liquidated amount.
        const drawDownPrices: Array<string> = [];
        for (let i = 0; i < 10; i++) {
          const priceStep = (10 - i) / 10;
          const drawDownInterval = invertedPrice ? 1 / priceStep : priceStep;

          const drawDownPrice = startingPrice.mul(toBN(toWei(drawDownInterval.toString()))).div(fixedPointAdjustment);
          drawDownPrices.push(ConvertDecimals(priceFeedDecimals, 18, web3)(drawDownPrice).toString());
        }

        // Iterate over all positions within the financial contract. Note that the effectiveCollateralPrice is calculated
        // using the collateralPriceInUsd and not the samplePriceFeed. This is because modifying the sample price feed by
        // x percent is equivalent to modifying the collateralPriceInUsd by an equal amount. For the analytics generated
        // by this reporter we care about the price action in collateral, not synthetics.
        contractPositionsInfo.positions.forEach((sponsor: any) => {
          drawDownPrices.forEach((drawDownPrice: string, drawDownIndex: number) => {
            const positionCR = computeCollateralizationRatio(
              toBN(toWei(sponsor.collateral.toString()).toString()),
              toBN(toWei(sponsor.tokensOutstanding.toString()).toString()),
              ConvertDecimals(samplePriceFeed.getPriceFeedDecimals(), 18, web3)(drawDownPrice)
            );
            const positionCRScaled = ConvertDecimals(samplePriceFeed.getPriceFeedDecimals(), 18, web3)(positionCR);
            if (positionCRScaled.lt(collateralRequirement)) {
              uniqueCollateralTypes[collateralAddress].drawDownAmounts[drawDownIndex] = {
                collateralLiquidated: fromWei(
                  toBN(
                    toWei(uniqueCollateralTypes[collateralAddress].drawDownAmounts[drawDownIndex].collateralLiquidated)
                  ).add(toBN(toWei(sponsor.collateral)))
                ),
                usdNeededToLiquidate: "0",
                priceDrop: (drawDownIndex * 10).toString(),
                effectiveCollateralPrice: fromWei(
                  toBN(toWei(uniqueCollateralTypes[collateralAddress].collateralPriceInUsd))
                    .muln(10 - drawDownIndex)
                    .divn(10)
                ),
              };
            } else {
              uniqueCollateralTypes[collateralAddress].drawDownAmounts[drawDownIndex] = {
                ...uniqueCollateralTypes[collateralAddress].drawDownAmounts[drawDownIndex],
                priceDrop: (drawDownIndex * 10).toString(),
                effectiveCollateralPrice: fromWei(
                  toBN(toWei(uniqueCollateralTypes[collateralAddress].collateralPriceInUsd))
                    .muln(10 - drawDownIndex)
                    .divn(10)
                ),
              };
            }
          });
        });
        // Iterate over all draw down intervals for a given collateral and compute the USD required to liquidate at the
        // current collateral price.
        uniqueCollateralTypes[collateralAddress].drawDownAmounts.forEach(
          (drawDownInterval: any, drawDownIndex: number) => {
            uniqueCollateralTypes[collateralAddress].drawDownAmounts[drawDownIndex].usdNeededToLiquidate = fromWei(
              toBN(toWei(uniqueCollateralTypes[collateralAddress].drawDownAmounts[drawDownIndex].collateralLiquidated))
                .mul(toBN(toWei(uniqueCollateralTypes[collateralAddress].collateralPriceInUsd)))
                .div(fixedPointAdjustment)
            );
          }
        );
      } catch (error) {
        console.error(error);
      }
    }
    // Remove any elements that have undefined params. This would be any contract that was skipped due to being
    // expired, having no sponsors or having no graph data.
    const builtUpExistingCollaterals: any = [];

    uniqueCollateralTypes[collateralAddress].activeFinancialContracts.forEach((activeFinancialContractInfo, index) => {
      if (activeFinancialContractInfo.contractExpirationTime)
        builtUpExistingCollaterals.push(activeFinancialContractInfo);
    });
    uniqueCollateralTypes[collateralAddress].activeFinancialContracts = builtUpExistingCollaterals;
  }

  // If we've stripped out a contract from a collateral type then we should remove the whole collateral from the output
  // as it will produce a blank spreadsheet.
  const strippedCollateralTypes: any = {};
  Object.keys(uniqueCollateralTypes).forEach((collateralAddress) => {
    if (uniqueCollateralTypes[collateralAddress].activeFinancialContracts.length > 0)
      strippedCollateralTypes[collateralAddress] = uniqueCollateralTypes[collateralAddress];
  });

  return strippedCollateralTypes;
}

function computeCollateralizationRatio(collateral: any, debt: any, tokenPrice: any) {
  return fixedPointAdjustment.mul(fixedPointAdjustment).mul(collateral).div(debt.mul(tokenPrice));
}
