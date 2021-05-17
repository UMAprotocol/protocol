const assert = require("chai").assert;
import Web3 from "web3";
const { isAddress } = Web3.utils;

import { strategyRunnerConfig, buildBotConfigs, buildGlobalWhitelist } from "../src/ConfigBuilder";

// simple config with a permalink to a white lists.
const minimalConfig: strategyRunnerConfig = {
  botNetwork: "mainnet_mnemonic",
  globalAddressWhitelistUrls: [
    "https://raw.githubusercontent.com/UMAprotocol/protocol/4612097ead953b89daa6e237cdb6c704460025dd/packages/affiliates/payouts/devmining-status.json"
  ],
  liquidatorSettings: { enableBotType: true },
  disputerSettings: { enableBotType: true },
  monitorSettings: { enableBotType: true }
};

const sampleEMPAddressNotOnWhitelist = "0xAb5801a7D398351b8bE11C439e05C5B3259aeC9B";

// whitelist sample taken from the globalAddress whitelist.
const sampleWhitelist = [
  "0xCef85b352CCD7a446d94AEeeA02dD11622289954",
  "0x56BaBEcb3dCaC063697fE38AB745c10181c56fA6",
  "0x10E018C01792705BefB7A757628C2947E38B9426",
  "0xb40BA94747c59d076B3c189E3A031547492013da",
  "0x46f5E363e69798a74c8422BFb9EDB63e3FB0f08a"
];

const minimumRequiredConfigKeys = [
  "botType",
  "syntheticSymbol",
  "botIdentifier",
  "botNetwork",
  "financialContractAddress",
  "pollingDelay"
];
describe("buildGlobalWhitelist", async function() {
  it("Correctly fetches global whitelist", async function() {
    this.timeout(60000);
    // Construct a whitelist from all current EMPs on the affiliates payout. Append a sample address to the list.
    const constructedWhitelist = await buildGlobalWhitelist({
      ...minimalConfig,
      globalAddressWhitelist: [sampleEMPAddressNotOnWhitelist]
    });
    // First address should be the sample and the list returned should contain other valid addresses.
    assert.equal(constructedWhitelist[0], sampleEMPAddressNotOnWhitelist);
    assert.isTrue(constructedWhitelist.length > 0);
    constructedWhitelist.forEach((address: string) => {
      assert.isTrue(isAddress(address));
    });
  });
  it("Correctly removes black listed addresses", async function() {
    this.timeout(60000);
    // Construct a whitelist from all current EMPs on the affiliates payout and remove the first address from the sampleWhitelist.
    const constructedWhitelist = await buildGlobalWhitelist({
      ...minimalConfig,
      globalAddressBlacklist: [sampleWhitelist[0]]
    });
    // The returned whitelist should contain additional addresses over and above the sample whitelist - the black listed.
    assert.isTrue(constructedWhitelist.length > sampleWhitelist.length - 1);

    // Each address in the sampleWhitelist (except for the first one) should be included in the constructed config.
    sampleWhitelist.splice(1, sampleWhitelist.length).forEach((address: string) => {
      assert.isTrue(constructedWhitelist.includes(address)); // all addresses, except for the blacklisted address, should be included.
    });
  });
  it("Correctly errors on incorrectly structured external whitelist file", async function() {
    this.timeout(60000);
    let errorsThrown = 0; // count the number of errors. note that // assert.throws(()... syntax did not work for some reason.

    // Invalid URL should throw.
    try {
      await buildGlobalWhitelist({
        globalAddressWhitelistUrls: ["not-a-url"]
      });
    } catch (error) {
      errorsThrown += 1;
    }
    // Path to a file missing the `empWhitelist` key should fail.
    try {
      await buildGlobalWhitelist({
        globalAddressWhitelistUrls: [
          "https://raw.githubusercontent.com/UMAprotocol/protocol/4612097ead953b89daa6e237cdb6c704460025dd/packages/affiliates/payouts/dappmining/2021-05-03_2021-05-10_YD-ETH-JUN21_0017.json"
        ]
      });
    } catch (error) {
      errorsThrown += 1;
    }
    assert.equal(errorsThrown, 2);
  });
});
describe("buildBotConfigs", async function() {
  it("Correctly builds bot config from given input", async function() {
    this.timeout(60000);
    // Construct a whitelist from all current EMPs on the affiliates payout. Append a sample address to the list.
    const constructedConfig = await buildBotConfigs(sampleWhitelist, minimalConfig);

    // For each address in the sampleWhitelist there should be 3 configs, for the monitor, liquidator and disputer.
    assert.equal(constructedConfig.length, sampleWhitelist.length * 3);

    const botConfigCounter: { [key: string]: number } = { liquidator: 0, monitor: 0, disputer: 0 };
    constructedConfig.forEach((config: any) => {
      minimumRequiredConfigKeys.forEach((key: string) => {
        assert.isTrue(Object.keys(config).includes(key));
      });
      assert.equal(config.pollingDelay, 0); // all bots should default to 0 polling delay.
      // There should be 1 liquidator, monitor and disputer for each type of config built.
      botConfigCounter[config.botType.toString()] = botConfigCounter[config.botType] + 1;
    });

    // For each bot type there should be an equal number of bots created. i.e for the 5 addresses in the white list
    // there should be 5 liquidators, 5 disputers and 5 monitors defined.
    Object.values(botConfigCounter).forEach((botTypeCount: number) => {
      assert.equal(botTypeCount, sampleWhitelist.length);
    });
  });
  it("Correctly respects override configs all bots", async function() {
    this.timeout(60000);
    // Append a common config. This should be injected into every config.
    const configWithOverride = { ...minimalConfig, commonConfig: { testInjection: "some-key-value-pair" } };

    const constructedConfig = await buildBotConfigs(sampleWhitelist, configWithOverride);

    // For each address in the sampleWhitelist there should be 3 configs, for the monitor, liquidator and disputer.
    assert.equal(constructedConfig.length, sampleWhitelist.length * 3);

    constructedConfig.forEach((config: any) => {
      assert.isTrue(Object.keys(config).includes("testInjection"));
      assert.equal(config["testInjection"], "some-key-value-pair");
    });
  });
  it("Correctly respects override configs for a specific contract address", async function() {
    this.timeout(60000);
    // add some override to a specific bot address. All bots of this type should contain this override.
    const overriddenAddress = sampleWhitelist[3];

    const configWithOverride = {
      ...minimalConfig,
      addressConfigOverride: { [overriddenAddress]: { someKey: "some-value" } }
    };

    const constructedConfig = await buildBotConfigs(sampleWhitelist, configWithOverride);

    // For each address in the sampleWhitelist there should be 3 configs, for the monitor, liquidator and disputer.
    assert.equal(constructedConfig.length, sampleWhitelist.length * 3);

    // Each bot config should contain the required keys. Each version of the overrides address should contain the additional field.
    constructedConfig.forEach((config: any) => {
      minimumRequiredConfigKeys.forEach((key: string) => {
        assert.isTrue(Object.keys(config).includes(key), `does not include ${key}!`);
      });
      if (config.financialContractAddress === overriddenAddress) assert.isTrue(config["someKey"] === "some-value");
      else assert.isFalse(Object.keys(config).includes("someKey")); // should not contain this key if not overridden.
    });
  });
});
