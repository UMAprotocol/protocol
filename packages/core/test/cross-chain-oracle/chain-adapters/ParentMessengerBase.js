const hre = require("hardhat");
const { web3 } = hre;
const { getContract } = hre;
const { assert } = require("chai");

const { ZERO_ADDRESS, didContractThrow } = require("@uma/common");

// Tested Contract
const ParentMessengerBase = getContract("ParentMessengerBase");

// Create some random accounts to to mimic key cross-chain oracle addresses.
const childMessengerAddress = web3.utils.toChecksumAddress(web3.utils.randomHex(20));
const oracleHubAddress = web3.utils.toChecksumAddress(web3.utils.randomHex(20));
const governorHubAddress = web3.utils.toChecksumAddress(web3.utils.randomHex(20));
const oracleSpokeAddress = web3.utils.toChecksumAddress(web3.utils.randomHex(20));
const governorSpokeAddress = web3.utils.toChecksumAddress(web3.utils.randomHex(20));

const chainId = 42069;

describe("ParentMessengerBase", function () {
  let parentMessengerBase;
  let l1Owner;
  let rando;

  before(async () => {
    const accounts = await hre.web3.eth.getAccounts();
    [l1Owner, rando] = accounts;

    parentMessengerBase = await ParentMessengerBase.new(chainId).send({ from: l1Owner });
  });
  describe("Admin controls", () => {
    it("Constructs correctly", async () => {
      assert.equal(await parentMessengerBase.methods.chainId().call(), chainId);
    });
    it("Can change addresses of key admin addresses", async () => {
      assert.equal(await parentMessengerBase.methods.childMessenger().call(), ZERO_ADDRESS);
      assert.equal(await parentMessengerBase.methods.oracleHub().call(), ZERO_ADDRESS);
      assert.equal(await parentMessengerBase.methods.governorHub().call(), ZERO_ADDRESS);
      assert.equal(await parentMessengerBase.methods.oracleSpoke().call(), ZERO_ADDRESS);
      assert.equal(await parentMessengerBase.methods.governorSpoke().call(), ZERO_ADDRESS);

      await parentMessengerBase.methods.setChildMessenger(childMessengerAddress).send({ from: l1Owner });
      assert.equal(await parentMessengerBase.methods.childMessenger().call(), childMessengerAddress);

      await parentMessengerBase.methods.setOracleHub(oracleHubAddress).send({ from: l1Owner });
      assert.equal(await parentMessengerBase.methods.oracleHub().call(), oracleHubAddress);

      await parentMessengerBase.methods.setGovernorHub(governorHubAddress).send({ from: l1Owner });
      assert.equal(await parentMessengerBase.methods.governorHub().call(), governorHubAddress);

      await parentMessengerBase.methods.setOracleSpoke(oracleSpokeAddress).send({ from: l1Owner });
      assert.equal(await parentMessengerBase.methods.oracleSpoke().call(), oracleSpokeAddress);

      await parentMessengerBase.methods.setGovernorSpoke(governorSpokeAddress).send({ from: l1Owner });
      assert.equal(await parentMessengerBase.methods.governorSpoke().call(), governorSpokeAddress);
    });
    it("Admin methods block calls by non-owner", async () => {
      assert(
        await didContractThrow(
          parentMessengerBase.methods.setChildMessenger(childMessengerAddress).send({ from: rando })
        )
      );
      assert(
        await didContractThrow(parentMessengerBase.methods.setOracleHub(childMessengerAddress).send({ from: rando }))
      );
      assert(
        await didContractThrow(parentMessengerBase.methods.setGovernorHub(childMessengerAddress).send({ from: rando }))
      );
      assert(
        await didContractThrow(parentMessengerBase.methods.setOracleSpoke(childMessengerAddress).send({ from: rando }))
      );
      assert(
        await didContractThrow(
          parentMessengerBase.methods.setGovernorSpoke(childMessengerAddress).send({ from: rando })
        )
      );
    });
  });
});
