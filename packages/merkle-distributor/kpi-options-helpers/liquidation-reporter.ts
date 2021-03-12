const winston = require("winston");
import BigNumber from "bignumber.js";
const { getWeb3, ConvertDecimals } = require("@uma/common");
const web3 = getWeb3();
const { toWei, toBN, fromWei } = web3.utils;

const { Networker, createReferencePriceFeedForFinancialContract } = require("@uma/financial-templates-lib");

const fixedPointAdjustment = toBN(toWei("1"));

import { getAllEmpsPositions } from "./emp-position-helper";

import { fetchAllFinancialContractsData, evaluateFinancialContractCollateral } from "./calculate-uma-tvl";

export async function fetchUmaEcosystemData() {
  console.log("hello");
  //   const allFinancialContractsData = await fetchAllFinancialContractsData();
  //   const collateralInfoWithValue = evaluateFinancialContractCollateral(allFinancialContractsData);

  const allEmpPositions = await getAllEmpsPositions();
  console.log("allEmpPositions", allEmpPositions);
  console.log("allEmpPositions", allEmpPositions[7].positions);
  const sponsorsSubset = allEmpPositions[7].positions;
  console.log("subset", sponsorsSubset[0]);
  console.log("collateral", sponsorsSubset[0].collateral);
  console.log("tokensOutstanding", sponsorsSubset[0].tokensOutstanding);

  const logger = winston.createLogger({
    level: "info",
    transports: [new winston.transports.Console()]
  });
  const getTime = () => Math.round(new Date().getTime() / 1000);
  const networker = new Networker(logger);
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
  console.log("decimals", samplePriceFeed.getPriceFeedDecimals());

  const positionCR = computeCollatererlizationRatio(
    toBN(toWei(sponsorsSubset[0].collateral.toString()).toString()),
    toBN(toWei(sponsorsSubset[0].tokensOutstanding.toString()).toString()),
    ConvertDecimals(samplePriceFeed.getPriceFeedDecimals(), 18, web3)(samplePriceFeed.getCurrentPrice().toString())
  );
  console.log("positionCR", positionCR.toString());
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
