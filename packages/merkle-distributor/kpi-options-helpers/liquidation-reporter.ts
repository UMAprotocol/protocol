const winston = require("winston");
import BigNumber from "bignumber.js";
const { getWeb3, ConvertDecimals } = require("@uma/common");
const web3 = getWeb3();
const { toWei, toBN, fromWei, toChecksumAddress } = web3.utils;

const { Networker, createReferencePriceFeedForFinancialContract } = require("@uma/financial-templates-lib");

const fixedPointAdjustment = toBN(toWei("1"));

import { getAllEmpsPositions } from "./emp-position-helper";

import { fetchAllFinancialContractsData, evaluateFinancialContractCollateral } from "./calculate-uma-tvl";

function removeItemOnce(arr: Array<any>, value: any) {
  var index = arr.indexOf(value);
  if (index > -1) {
    arr.splice(index, 1);
  }
  return arr;
}

export async function fetchUmaEcosystemData() {
  console.log("hello");
  const allFinancialContractsData = await fetchAllFinancialContractsData();
  const collateralInfoWithValue = evaluateFinancialContractCollateral(allFinancialContractsData);
  console.log("collateralInfoWithValue", collateralInfoWithValue);

  const contractsWithCollateralValue = collateralInfoWithValue.filter(info => info.collateralValueInUsd != "0");
  console.log("contractsWithCollateralValue", contractsWithCollateralValue);

  const allEmpPositions = await getAllEmpsPositions();
  console.log("allEmpPositions", allEmpPositions);

  let uniqueCollateralTypes: {
    [key: string]: { financialContracts: Array<string>; collateralValueInUsd: string };
  } = {};

  contractsWithCollateralValue.forEach((info: any) => {
    if (!uniqueCollateralTypes[info.collateralAddress]) {
      uniqueCollateralTypes[info.collateralAddress] = {
        financialContracts: [info.contractAddress],
        collateralValueInUsd: info.collateralValueInUsd
      };
    } else {
      uniqueCollateralTypes[info.collateralAddress] = {
        financialContracts: [...uniqueCollateralTypes[info.collateralAddress].financialContracts, info.contractAddress],
        collateralValueInUsd: fromWei(
          toBN(toWei(info.collateralValueInUsd)).add(
            toBN(toWei(uniqueCollateralTypes[info.collateralAddress].collateralValueInUsd))
          )
        )
      };
    }
  });
  console.log("uniqueCollateralTypes1", uniqueCollateralTypes);

  const logger = winston.createLogger({
    level: "info",
    transports: [new winston.transports.Console()]
  });
  const getTime = () => Math.round(new Date().getTime() / 1000);
  const networker = new Networker(logger);
  Object.keys(uniqueCollateralTypes).forEach(async (collateralAddress: string) => {
    uniqueCollateralTypes[collateralAddress].financialContracts.forEach(async (financialContractAddress: string) => {
      const contractPositionsInfo = allEmpPositions.filter(
        (info: any) => toChecksumAddress(info.id) === toChecksumAddress(financialContractAddress)
      )[0];
      if (contractPositionsInfo == undefined) return;

      if (contractPositionsInfo.positions.length == 0)
        removeItemOnce(uniqueCollateralTypes[collateralAddress].financialContracts, financialContractAddress);
      else {
        const samplePriceFeed = await createReferencePriceFeedForFinancialContract(
          logger,
          web3,
          networker,
          getTime,
          financialContractAddress
        );
        await samplePriceFeed.update();
        console.log("inverted keys", Object.keys(samplePriceFeed));
        console.log("inverted", samplePriceFeed.priceFeeds[0].invertPrice);
        console.log("CURRENT", samplePriceFeed.getCurrentPrice().toString());

        process.exit(0);
      }
    });
  });
  console.log("uniqueCollateralTypes2", uniqueCollateralTypes);

  return;

  console.log("allEmpPositions", allEmpPositions);
  console.log("allEmpPositions", allEmpPositions[8].positions);
  const sponsorsSubset = allEmpPositions[8].positions;
  console.log("subset", sponsorsSubset[0]);
  console.log("collateral", sponsorsSubset[0].collateral);
  console.log("tokensOutstanding", sponsorsSubset[0].tokensOutstanding);

  const samplePriceFeed = await createReferencePriceFeedForFinancialContract(
    logger,
    web3,
    networker,
    getTime,
    "0x1c3f1a342c8d9591d9759220d114c685fd1cf6b8"
  );
  await samplePriceFeed.update();
  console.log("inverted keys", Object.keys(samplePriceFeed));
  console.log("inverted", samplePriceFeed.priceFeeds[0].invertPrice);
  console.log("CURRENT", samplePriceFeed.getCurrentPrice().toString());

  const startingPrice = samplePriceFeed.getCurrentPrice();
  for (let i = 1; i < 11; i++) {
    const drawDownInterval = samplePriceFeed.priceFeeds[0].invertPrice ? (10 * i) / 10 : (10 - i) / 10;
    const drawDownPrice = startingPrice.mul(toBN(toWei(drawDownInterval.toString()))).div(fixedPointAdjustment);
    console.log("drawDownPrice", drawDownPrice.toString());
    const positionCR = computeCollatererlizationRatio(
      toBN(toWei(sponsorsSubset[0].collateral.toString()).toString()),
      toBN(toWei(sponsorsSubset[0].tokensOutstanding.toString()).toString()),
      ConvertDecimals(samplePriceFeed.getPriceFeedDecimals(), 18, web3)(drawDownPrice)
    );
    console.log("positionCR", positionCR.toString());
  }
}

function computeCollatererlizationRatio(collateral: any, debt: any, tokenPrice: any) {
  return fixedPointAdjustment
    .mul(fixedPointAdjustment)
    .mul(collateral)
    .div(debt.mul(tokenPrice));
}

function calculateLiquidationPrice(collateral: any, debt: any, collateralRequirement: any, invertedPrice: boolean) {
  console.log(collateral, debt, collateralRequirement, invertedPrice);
  if (!invertedPrice) return collateral.mul(fixedPointAdjustment).div(debt.mul(collateralRequirement));
  else return fixedPointAdjustment.mul(fixedPointAdjustment).div(collateral.div(debt.mul(collateralRequirement)));
}

fetchUmaEcosystemData().catch(e => {
  console.log(e);
  process.exit(1);
});
