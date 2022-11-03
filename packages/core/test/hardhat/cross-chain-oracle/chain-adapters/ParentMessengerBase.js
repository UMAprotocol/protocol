const hre = require("hardhat");
const { web3 } = hre;
const { getContract } = hre;
const { assert } = require("chai");

const { ZERO_ADDRESS, didContractThrow } = require("@uma/common");

// Tested Contract
const ParentMessengerBase = getContract("ParentMessengerBaseMock");

// Create some random accounts to to mimic key cross-chain oracle addresses.
const childMessenger = web3.utils.toChecksumAddress(web3.utils.randomHex(20));
const oracleHub = web3.utils.toChecksumAddress(web3.utils.randomHex(20));
const governorHub = web3.utils.toChecksumAddress(web3.utils.randomHex(20));
const oracleSpoke = web3.utils.toChecksumAddress(web3.utils.randomHex(20));
const governorSpoke = web3.utils.toChecksumAddress(web3.utils.randomHex(20));

const chainId = 42069;

describe("ParentMessengerBase", function () {
  let parentMessenger;
  let l1Owner;
  let rando;

  before(async () => {
    const accounts = await hre.web3.eth.getAccounts();
    [l1Owner, rando] = accounts;

    parentMessenger = await ParentMessengerBase.new(chainId).send({ from: l1Owner });
  });
  describe("Admin controls", () => {
    it("Constructs correctly", async () => {
      assert.equal(await parentMessenger.methods.childChainId().call(), chainId);
    });
    it("Can change addresses of key admin addresses", async () => {
      assert.equal(await parentMessenger.methods.childMessenger().call(), ZERO_ADDRESS);
      assert.equal(await parentMessenger.methods.oracleHub().call(), ZERO_ADDRESS);
      assert.equal(await parentMessenger.methods.governorHub().call(), ZERO_ADDRESS);
      assert.equal(await parentMessenger.methods.oracleSpoke().call(), ZERO_ADDRESS);
      assert.equal(await parentMessenger.methods.governorSpoke().call(), ZERO_ADDRESS);

      await parentMessenger.methods.setChildMessenger(childMessenger).send({ from: l1Owner });
      assert.equal(await parentMessenger.methods.childMessenger().call(), childMessenger);

      await parentMessenger.methods.setOracleHub(oracleHub).send({ from: l1Owner });
      assert.equal(await parentMessenger.methods.oracleHub().call(), oracleHub);

      await parentMessenger.methods.setGovernorHub(governorHub).send({ from: l1Owner });
      assert.equal(await parentMessenger.methods.governorHub().call(), governorHub);

      await parentMessenger.methods.setOracleSpoke(oracleSpoke).send({ from: l1Owner });
      assert.equal(await parentMessenger.methods.oracleSpoke().call(), oracleSpoke);

      await parentMessenger.methods.setGovernorSpoke(governorSpoke).send({ from: l1Owner });
      assert.equal(await parentMessenger.methods.governorSpoke().call(), governorSpoke);
    });
    it("Admin methods block calls by non-owner", async () => {
      assert(await didContractThrow(parentMessenger.methods.setChildMessenger(childMessenger).send({ from: rando })));
      assert(await didContractThrow(parentMessenger.methods.setOracleHub(childMessenger).send({ from: rando })));
      assert(await didContractThrow(parentMessenger.methods.setGovernorHub(childMessenger).send({ from: rando })));
      assert(await didContractThrow(parentMessenger.methods.setOracleSpoke(childMessenger).send({ from: rando })));
      assert(await didContractThrow(parentMessenger.methods.setGovernorSpoke(childMessenger).send({ from: rando })));
    });
  });
});
