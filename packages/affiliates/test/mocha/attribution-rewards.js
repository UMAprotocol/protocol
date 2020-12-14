const { DeployerRewards } = require("../../libs/affiliates");
const lodash = require("lodash");
const { assert } = require("chai");
const { getAbi } = require("@uma/core");
const { Prices } = require("../../libs/models");
// Dataset based mocks that know how to load data from files. This is not the same as the libs/mocks file.
const { mocks } = require("../../libs/datasets");
const Path = require("path");

const empAbi = getAbi("ExpiringMultiParty");
const empCreatorAbi = getAbi("ExpiringMultiPartyCreator");

const { EmpBalancesHistory } = require("../../libs/processors");

const datasetPath = Path.join(__dirname, "../datasets/set1");
const params = require(Path.join(datasetPath, "/config.json"));

const { getWeb3 } = require("@uma/common");
const web3 = getWeb3();
const { toWei } = web3.utils;

const {
  empCreator,
  empContracts,
  collateralTokens,
  collateralTokenDecimals,
  syntheticTokenDecimals,
  startingTimestamp,
  endingTimestamp
} = params;
const devRewardsToDistribute = "50000";
// mocks
const { Queries, Coingecko, SynthPrices } = mocks;

describe("AttributionRewards", function() {
})

