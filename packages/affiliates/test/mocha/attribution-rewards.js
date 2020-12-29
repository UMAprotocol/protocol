const Path = require("path");
const assert = require("assert");

const { DappMining } = require("../../libs/affiliates");
const { getWeb3 } = require("@uma/common");
const { getAbi } = require("@uma/core");
const { mocks } = require("../../libs/datasets");
const { Queries } = mocks;

const web3 = getWeb3();
const empAbi = getAbi("ExpiringMultiParty");
const datasetPath = Path.join(__dirname, "../datasets/set1");

describe("DappMining", function() {
  it("should instanciate", function() {
    const queries = Queries(datasetPath);
    const result = DappMining({ queries, empAbi, web3 });
    assert(result);
  });
  // TODO: add more tests and appropriate dataset
});
