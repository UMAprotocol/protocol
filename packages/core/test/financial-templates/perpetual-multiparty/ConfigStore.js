// External libs
const { toWei, toBN } = web3.utils;
const truffleAssert = require("truffle-assertions");

// Local libs
const { didContractThrow } = require("@uma/common");
const { assert } = require("chai");

// Tested Contract
const ConfigStore = artifacts.require("ConfigStore");

// Helper Contracts
const Timer = artifacts.require("Timer");

// Helper functions.
async function incrementTime(contract, amount) {
  const currentTime = await contract.getCurrentTime();
  await contract.setCurrentTime(Number(currentTime) + amount);
}

contract("ConfigStore", function(accounts) {
  let timer;
  let configStore;

  let owner = accounts[0];
  let rando = accounts[1];

  let testConfig = {
    updateLiveness: 100,
    rewardRatePerSecond: { rawValue: toWei("0.0001") },
    proposerBondPct: { rawValue: toWei("0.04") }
  };
  let defaultConfig = {
    updateLiveness: "0",
    rewardRatePerSecond: { rawValue: "0" },
    proposerBondPct: { rawValue: "0" }
  };

  async function currentConfigMatchesInput(_store, _inputConfig) {
    let currentConfig = await _store.getCurrentConfig();
    assert.equal(currentConfig.updateLiveness.toString(), _inputConfig.updateLiveness.toString());
    assert.equal(
      currentConfig.rewardRatePerSecond.rawValue.toString(),
      _inputConfig.rewardRatePerSecond.rawValue.toString()
    );
    assert.equal(currentConfig.proposerBondPct.rawValue.toString(), _inputConfig.proposerBondPct.rawValue.toString());
  }

  async function pendingConfigMatchesInput(_store, _inputConfig) {
    let pendingConfig = await _store.pendingConfig();
    assert.equal(pendingConfig.updateLiveness.toString(), _inputConfig.updateLiveness.toString());
    assert.equal(
      pendingConfig.rewardRatePerSecond.rawValue.toString(),
      _inputConfig.rewardRatePerSecond.rawValue.toString()
    );
    assert.equal(pendingConfig.proposerBondPct.rawValue.toString(), _inputConfig.proposerBondPct.rawValue.toString());
  }

  async function storeHasNoPendingConfig(_store) {
    await pendingConfigMatchesInput(_store, defaultConfig);
    assert.equal((await _store.pendingPassedTimestamp()).toString(), "0");
  }

  beforeEach(async () => {
    timer = await Timer.deployed();
  });

  describe("Construction", function() {
    it("Default values get set", async function() {
      configStore = await ConfigStore.new(testConfig, timer.address);
      let config = await configStore.getCurrentConfig();
      assert.equal(config.updateLiveness.toString(), "100");
      assert.equal(config.rewardRatePerSecond.rawValue.toString(), toWei("0.0001"));
      assert.equal(config.proposerBondPct.rawValue.toString(), toWei("0.04"));
      await storeHasNoPendingConfig(configStore);
    });

    it("Invalid default values revert on construction", async function() {
      let invalidConfig = {
        ...testConfig,
        updateLiveness: 604800 + 1
      };
      assert(await didContractThrow(ConfigStore.new(invalidConfig, timer.address)));
    });
  });
  describe("Proposing a new configuration", function() {
    it("Liveness is 0, instant update", async function() {
      configStore = await ConfigStore.new(defaultConfig, timer.address);

      // Can only propose from owner account
      assert(await didContractThrow(configStore.proposeNewConfig(testConfig, { from: rando })));

      // Liveness is 0, meaning that `getCurrentConfig()` should return the pending proposal
      const proposeTime = await configStore.getCurrentTime();
      let proposeTxn = await configStore.proposeNewConfig(testConfig);
      truffleAssert.eventEmitted(proposeTxn, "ProposedNewConfigSettings", ev => {
        return (
          ev.proposer === owner &&
          ev.rewardRate.toString() === toWei("0.0001") &&
          ev.proposerBond.toString() === toWei("0.04") &&
          ev.updateLiveness.toString() === "100" &&
          ev.proposalPassedTimestamp.toString() === proposeTime.toString()
        );
      });
      await currentConfigMatchesInput(configStore, testConfig);

      // Pending config is updated, liveness passed timestamp is same as current time.
      await pendingConfigMatchesInput(configStore, testConfig);
      assert.equal((await configStore.pendingPassedTimestamp()).toString(), proposeTime.toString());

      // Next propose transaction publishes the new config.
      let test2Config = {
        ...testConfig,
        updateLiveness: 200
      };
      proposeTxn = await configStore.proposeNewConfig(test2Config);
      truffleAssert.eventEmitted(proposeTxn, "ChangedNewConfigSettings", ev => {
        return (
          ev.rewardRate.toString() === toWei("0.0001") &&
          ev.proposerBond.toString() === toWei("0.04") &&
          ev.updateLiveness.toString() === "100"
        );
      });
      truffleAssert.eventEmitted(proposeTxn, "ProposedNewConfigSettings", ev => {
        // New passed timestamp should take newly updated liveness into account.
        return (
          ev.proposer === owner &&
          ev.rewardRate.toString() === toWei("0.0001") &&
          ev.proposerBond.toString() === toWei("0.04") &&
          ev.updateLiveness.toString() === "200" &&
          ev.proposalPassedTimestamp.toString() === proposeTime.add(toBN(100)).toString()
        );
      });
      await currentConfigMatchesInput(configStore, testConfig);

      // Pending config and passed timestamp is updated.
      await pendingConfigMatchesInput(configStore, test2Config);
      assert.equal((await configStore.pendingPassedTimestamp()).toString(), proposeTime.add(toBN(100)).toString());
    });
    it("Liveness is > 0, update occurs after liveness period", async function() {
      configStore = await ConfigStore.new(testConfig, timer.address);

      // Propose new config.
      const proposeTime = await configStore.getCurrentTime();
      let proposeTxn = await configStore.proposeNewConfig(defaultConfig);
      truffleAssert.eventEmitted(proposeTxn, "ProposedNewConfigSettings", ev => {
        return (
          ev.proposer === owner &&
          ev.rewardRate.toString() === "0" &&
          ev.proposerBond.toString() === "0" &&
          ev.updateLiveness.toString() === "0" &&
          ev.proposalPassedTimestamp.toString() === proposeTime.add(toBN(100)).toString()
        );
      });

      // Current config doesn't change.
      await currentConfigMatchesInput(configStore, testConfig);

      // Pending config and liveness timestamp is updated.
      await pendingConfigMatchesInput(configStore, defaultConfig);
      assert.equal((await configStore.pendingPassedTimestamp()).toString(), proposeTime.add(toBN(100)).toString());

      // Advancing time before the liveness is up doesn't change state.
      await incrementTime(configStore, 99);
      await configStore.publishPendingConfig();
      await currentConfigMatchesInput(configStore, testConfig);
      await pendingConfigMatchesInput(configStore, defaultConfig);
      assert.equal((await configStore.pendingPassedTimestamp()).toString(), proposeTime.add(toBN(100)).toString());

      // Proposing a new config overwrites the pending proposal.
      let test2Config = {
        ...testConfig,
        updateLiveness: 200
      };
      const overwriteProposalTime = await configStore.getCurrentTime();
      proposeTxn = await configStore.proposeNewConfig(test2Config);
      truffleAssert.eventEmitted(proposeTxn, "ProposedNewConfigSettings", ev => {
        // New passed timestamp should take newly updated liveness into account.
        return (
          ev.proposer === owner &&
          ev.rewardRate.toString() === toWei("0.0001") &&
          ev.proposerBond.toString() === toWei("0.04") &&
          ev.updateLiveness.toString() === "200" &&
          ev.proposalPassedTimestamp.toString() === overwriteProposalTime.add(toBN(100)).toString()
        );
      });
      await currentConfigMatchesInput(configStore, testConfig);
      await pendingConfigMatchesInput(configStore, test2Config);
      assert.equal(
        (await configStore.pendingPassedTimestamp()).toString(),
        overwriteProposalTime.add(toBN(100)).toString()
      );

      // Advancing time after the original-proposal's liveness but before the overwrite-proposal's liveness
      // doesn't change state.
      await incrementTime(configStore, 99);
      await configStore.publishPendingConfig();
      await currentConfigMatchesInput(configStore, testConfig);
      await pendingConfigMatchesInput(configStore, test2Config);
      assert.equal(
        (await configStore.pendingPassedTimestamp()).toString(),
        overwriteProposalTime.add(toBN(100)).toString()
      );

      // Finally, advancing past liveness allows pending config to be returned as current config,
      // and the pending config can be published.
      await incrementTime(configStore, 1);
      await currentConfigMatchesInput(configStore, test2Config);
      proposeTxn = await configStore.publishPendingConfig();
      truffleAssert.eventEmitted(proposeTxn, "ChangedNewConfigSettings", ev => {
        return (
          ev.rewardRate.toString() === toWei("0.0001") &&
          ev.proposerBond.toString() === toWei("0.04") &&
          ev.updateLiveness.toString() === "200"
        );
      });
    });
  });
});
