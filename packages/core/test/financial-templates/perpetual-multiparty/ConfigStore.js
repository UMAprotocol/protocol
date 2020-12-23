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
    timelockLiveness: 86401, // 1 day + 1 second
    rewardRatePerSecond: { rawValue: toWei("0.000001") },
    proposerBondPct: { rawValue: toWei("0.0001") },
    maxFundingRate: { rawValue: toWei("0.00001") },
    minFundingRate: { rawValue: toWei("-0.00001") },
    proposalTimePastLimit: 1800 // 30 mins
  };
  let defaultConfig = {
    timelockLiveness: 86400, // 1 day
    rewardRatePerSecond: { rawValue: "0" },
    proposerBondPct: { rawValue: "0" },
    maxFundingRate: { rawValue: toWei("0") },
    minFundingRate: { rawValue: toWei("0") },
    proposalTimePastLimit: 0
  };

  async function currentConfigMatchesInput(_store, _inputConfig) {
    let currentConfig = await _store.updateAndGetCurrentConfig.call();
    assert.equal(currentConfig.timelockLiveness.toString(), _inputConfig.timelockLiveness.toString());
    assert.equal(
      currentConfig.rewardRatePerSecond.rawValue.toString(),
      _inputConfig.rewardRatePerSecond.rawValue.toString()
    );
    assert.equal(currentConfig.proposerBondPct.rawValue.toString(), _inputConfig.proposerBondPct.rawValue.toString());
    assert.equal(currentConfig.maxFundingRate.rawValue.toString(), _inputConfig.maxFundingRate.rawValue.toString());
    assert.equal(currentConfig.minFundingRate.rawValue.toString(), _inputConfig.minFundingRate.rawValue.toString());
    assert.equal(currentConfig.proposalTimePastLimit.toString(), _inputConfig.proposalTimePastLimit.toString());
  }

  async function pendingConfigMatchesInput(_store, _inputConfig) {
    let pendingConfig = await _store.pendingConfig();
    assert.equal(pendingConfig.timelockLiveness.toString(), _inputConfig.timelockLiveness.toString());
    assert.equal(
      pendingConfig.rewardRatePerSecond.rawValue.toString(),
      _inputConfig.rewardRatePerSecond.rawValue.toString()
    );
    assert.equal(pendingConfig.proposerBondPct.rawValue.toString(), _inputConfig.proposerBondPct.rawValue.toString());
    assert.equal(pendingConfig.maxFundingRate.rawValue.toString(), _inputConfig.maxFundingRate.rawValue.toString());
    assert.equal(pendingConfig.minFundingRate.rawValue.toString(), _inputConfig.minFundingRate.rawValue.toString());
    assert.equal(pendingConfig.proposalTimePastLimit.toString(), _inputConfig.proposalTimePastLimit.toString());
  }

  async function storeHasNoPendingConfig(_store) {
    assert.equal((await _store.pendingPassedTimestamp()).toString(), "0");
  }

  beforeEach(async () => {
    timer = await Timer.deployed();
  });

  describe("Construction", function() {
    it("Default values get set", async function() {
      configStore = await ConfigStore.new(testConfig, timer.address);
      let config = await configStore.updateAndGetCurrentConfig.call();
      assert.equal(config.timelockLiveness.toString(), testConfig.timelockLiveness.toString());
      assert.equal(config.rewardRatePerSecond.rawValue.toString(), testConfig.rewardRatePerSecond.rawValue);
      assert.equal(config.proposerBondPct.rawValue.toString(), testConfig.proposerBondPct.rawValue);
      assert.equal(config.maxFundingRate.rawValue.toString(), testConfig.maxFundingRate.rawValue.toString());
      assert.equal(config.minFundingRate.rawValue.toString(), testConfig.minFundingRate.rawValue.toString());
      assert.equal(config.proposalTimePastLimit.toString(), testConfig.proposalTimePastLimit.toString());
      await storeHasNoPendingConfig(configStore);
    });
    it("Invalid default values revert on construction", async function() {
      // Invalid timelock
      let invalidConfig = {
        ...testConfig,
        timelockLiveness: 0
      };
      assert(await didContractThrow(ConfigStore.new(invalidConfig, timer.address)));

      // Invalid reward rate
      invalidConfig = {
        ...testConfig,
        rewardRatePerSecond: { rawValue: toWei("0.00000331") }
      };
      assert(await didContractThrow(ConfigStore.new(invalidConfig, timer.address)));
    });
  });
  describe("Proposing a new configuration", function() {
    it("Basic propose and publish test", async function() {
      // Propose a config and advance to timelock expiry.
      configStore = await ConfigStore.new(defaultConfig, timer.address);

      // Can only propose from owner account
      assert(await didContractThrow(configStore.proposeNewConfig(testConfig, { from: rando })));

      // Propose a config and check events
      let proposeTime = await configStore.getCurrentTime();
      let proposeTxn = await configStore.proposeNewConfig(testConfig);
      truffleAssert.eventEmitted(proposeTxn, "ProposedNewConfigSettings", ev => {
        return (
          ev.proposer === owner &&
          ev.rewardRate.toString() === testConfig.rewardRatePerSecond.rawValue &&
          ev.proposerBond.toString() === testConfig.proposerBondPct.rawValue &&
          ev.timelockLiveness.toString() === testConfig.timelockLiveness.toString() &&
          ev.proposalPassedTimestamp.toString() === proposeTime.add(toBN(defaultConfig.timelockLiveness)).toString() &&
          ev.maxFundingRate.toString() === testConfig.maxFundingRate.rawValue &&
          ev.minFundingRate.toString() === testConfig.minFundingRate.rawValue &&
          ev.proposalTimePastLimit.toString() === testConfig.proposalTimePastLimit.toString()
        );
      });
      await incrementTime(configStore, defaultConfig.timelockLiveness);

      // Pending config can be published with propose(). In the next test we'll test that publishPendingConfig
      // also updates pending configs.
      proposeTxn = await configStore.proposeNewConfig(testConfig);
      truffleAssert.eventEmitted(proposeTxn, "ChangedConfigSettings", ev => {
        return (
          ev.rewardRate.toString() === testConfig.rewardRatePerSecond.rawValue &&
          ev.proposerBond.toString() === testConfig.proposerBondPct.rawValue &&
          ev.timelockLiveness.toString() === testConfig.timelockLiveness.toString() &&
          ev.maxFundingRate.toString() === testConfig.maxFundingRate.rawValue &&
          ev.minFundingRate.toString() === testConfig.minFundingRate.rawValue &&
          ev.proposalTimePastLimit.toString() === testConfig.proposalTimePastLimit.toString()
        );
      });

      // Current config is updated
      await currentConfigMatchesInput(configStore, testConfig);
    });
    it("Proposals overwriting pending proposals", async function() {
      configStore = await ConfigStore.new(defaultConfig, timer.address);

      // Propose new config.
      const proposeTime = await configStore.getCurrentTime();
      let proposeTxn = await configStore.proposeNewConfig(testConfig);
      truffleAssert.eventEmitted(proposeTxn, "ProposedNewConfigSettings", ev => {
        return (
          ev.proposer === owner &&
          ev.rewardRate.toString() === testConfig.rewardRatePerSecond.rawValue &&
          ev.proposerBond.toString() === testConfig.proposerBondPct.rawValue &&
          ev.timelockLiveness.toString() === testConfig.timelockLiveness.toString() &&
          ev.proposalPassedTimestamp.toString() === proposeTime.add(toBN(defaultConfig.timelockLiveness)).toString() &&
          ev.maxFundingRate.toString() === testConfig.maxFundingRate.rawValue &&
          ev.minFundingRate.toString() === testConfig.minFundingRate.rawValue &&
          ev.proposalTimePastLimit.toString() === testConfig.proposalTimePastLimit.toString()
        );
      });

      // Current config doesn't change.
      await currentConfigMatchesInput(configStore, defaultConfig);

      // Pending config and liveness timestamp is updated.
      await pendingConfigMatchesInput(configStore, testConfig);
      assert.equal(
        (await configStore.pendingPassedTimestamp()).toString(),
        proposeTime.add(toBN(defaultConfig.timelockLiveness)).toString()
      );

      // Advancing time before the liveness is up doesn't change state.
      await incrementTime(configStore, defaultConfig.timelockLiveness - 1);
      await configStore.publishPendingConfig();
      await currentConfigMatchesInput(configStore, defaultConfig);
      await pendingConfigMatchesInput(configStore, testConfig);
      assert.equal(
        (await configStore.pendingPassedTimestamp()).toString(),
        proposeTime.add(toBN(defaultConfig.timelockLiveness)).toString()
      );

      // Proposing a new config overwrites the pending proposal.
      let test2Config = {
        ...testConfig,
        timelockLiveness: 86402
      };
      const overwriteProposalTime = await configStore.getCurrentTime();
      proposeTxn = await configStore.proposeNewConfig(test2Config);
      truffleAssert.eventEmitted(proposeTxn, "ProposedNewConfigSettings", ev => {
        return (
          ev.proposer === owner &&
          ev.rewardRate.toString() === test2Config.rewardRatePerSecond.rawValue &&
          ev.proposerBond.toString() === test2Config.proposerBondPct.rawValue &&
          ev.timelockLiveness.toString() === test2Config.timelockLiveness.toString() &&
          ev.proposalPassedTimestamp.toString() ===
            overwriteProposalTime.add(toBN(defaultConfig.timelockLiveness)).toString() &&
          ev.maxFundingRate.toString() === test2Config.maxFundingRate.rawValue &&
          ev.minFundingRate.toString() === test2Config.minFundingRate.rawValue &&
          ev.proposalTimePastLimit.toString() === test2Config.proposalTimePastLimit.toString()
        );
      });
      await currentConfigMatchesInput(configStore, defaultConfig);
      await pendingConfigMatchesInput(configStore, test2Config);
      assert.equal(
        (await configStore.pendingPassedTimestamp()).toString(),
        overwriteProposalTime.add(toBN(defaultConfig.timelockLiveness)).toString()
      );

      // Advancing time after the original-proposal's liveness but before the overwrite-proposal's liveness
      // doesn't change state.
      await incrementTime(configStore, defaultConfig.timelockLiveness - 1);
      // Can also use `updateAndGetCurrentConfig()` to publish a new config.
      await configStore.updateAndGetCurrentConfig();
      await currentConfigMatchesInput(configStore, defaultConfig);
      await pendingConfigMatchesInput(configStore, test2Config);
      assert.equal(
        (await configStore.pendingPassedTimestamp()).toString(),
        overwriteProposalTime.add(toBN(defaultConfig.timelockLiveness)).toString()
      );

      // Finally, advancing past liveness allows pending config to be returned as current config,
      // and the pending config can be published.
      await incrementTime(configStore, 1);
      await currentConfigMatchesInput(configStore, test2Config);
      proposeTxn = await configStore.publishPendingConfig();
      truffleAssert.eventEmitted(proposeTxn, "ChangedConfigSettings", ev => {
        return (
          ev.rewardRate.toString() === test2Config.rewardRatePerSecond.rawValue &&
          ev.proposerBond.toString() === test2Config.proposerBondPct.rawValue &&
          ev.timelockLiveness.toString() === test2Config.timelockLiveness.toString() &&
          ev.maxFundingRate.toString() === test2Config.maxFundingRate.rawValue &&
          ev.minFundingRate.toString() === test2Config.minFundingRate.rawValue &&
          ev.proposalTimePastLimit.toString() === test2Config.proposalTimePastLimit.toString()
        );
      });
      await storeHasNoPendingConfig(configStore);
    });
  });
});
