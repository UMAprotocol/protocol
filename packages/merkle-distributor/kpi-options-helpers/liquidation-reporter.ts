const winston = require("winston");
import BigNumber from "bignumber.js";
const { getWeb3, ConvertDecimals } = require("@uma/common");
const web3 = getWeb3();
const { toWei, toBN, fromWei } = web3.utils;

const { Networker, createReferencePriceFeedForFinancialContract } = require("@uma/financial-templates-lib");

import { getAllEmpsPositions } from "./emp-position-helper";

import { fetchAllFinancialContractsData, evaluateFinancialContractCollateral } from "./calculate-uma-tvl";

export async function fetchUmaEcosystemData() {
  console.log("hello");
  //   const allFinancialContractsData = await fetchAllFinancialContractsData();
  //   const collateralInfoWithValue = evaluateFinancialContractCollateral(allFinancialContractsData);

  const allEmpPositions = await getAllEmpsPositions();
  console.log("allEmpPositions", allEmpPositions[2].positions);

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
  console.log("CURRENT", samplePriceFeed.getCurrentPrice().toString());
}

function calculateLiquidationPrice(collateral: BigNumber, debt: BigNumber, collateralRequirement: BigNumber) {
  return collateral.dividedBy(debt.times(collateralRequirement));
}

fetchUmaEcosystemData().catch(e => {
  console.log(e);
  process.exit(1);
});
