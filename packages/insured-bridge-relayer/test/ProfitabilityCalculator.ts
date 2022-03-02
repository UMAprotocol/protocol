import winston from "winston";
import sinon from "sinon";
import Web3 from "web3";
const { toWei, toBN, toChecksumAddress, randomHex } = Web3.utils;
const toBNWei = (number: string | number) => toBN(toWei(number.toString()).toString());

const { ZERO_ADDRESS, createFormatFunction, MAX_SAFE_ALLOWANCE } = require("@uma/common");

const formatWei = createFormatFunction(2, 4, false, 18);
const formatGwei = (number: string | number | BN) => createFormatFunction(2, 4, false, 9)(number.toString());

const { across } = require("@uma/sdk");

import { SpyTransport, lastSpyLogIncludes } from "@uma/financial-templates-lib";

import { assert } from "chai";

import type { BN } from "@uma/common";

// Tested module
import { ProfitabilityCalculator, TokenType } from "../src/ProfitabilityCalculator";

// Mock to inject pricing information to avoid calling the update method to work with real prices.
import { MockProfitabilityCalculator } from "./mocks/MockProfitabilityCalculator";

// Useful enum import for testing correct relay submission mode.
import { RelaySubmitType } from "../src/Relayer";

let profitabilityCalculator: any;
let spy: any;
let spyLogger: any;

// Addresses of actual L1 tokens on mainnet. Used to ensure the calculator can pull real world data.
const umaAddress = "0x04Fa0d235C4abf4BcF4787aF4CF447DE572eF828";
const wethAddress = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
const usdcAddress = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";

const mainnetChainId = 1;
const relayerDiscount = 0; // Set the discount to 0 to fairly price all relays.

// For profitability calculations we need to inject prices for each token into the calculator to have deterministic results.
const mockUmaPriceInEth = toBNWei(0.002);
const mockWethPriceInEth = toBNWei(1);
const mockUSDCPriceInEth = toBNWei(0.0002);

// Decimals
const umaDecimals = toBN(18);
const wethDecimals = toBN(18);
const usdcDecimals = toBN(6);

const sampleCumulativeGasPrice = toBN(100e9); // A gas price of 100 Gwei.

class Contract {
  public methods = {
    decimals: () => ({
      call: () => {
        if (this.address === usdcAddress) return "6";
        return "18";
      },
    }),
  };

  constructor(abi: any, readonly address: string) {}
}

const mockWeb3 = ({
  eth: {
    Contract: Contract,
  },
} as unknown) as Web3;

describe("ProfitabilityCalculator.ts", function () {
  beforeEach(async function () {
    spy = sinon.spy();
    spyLogger = winston.createLogger({ level: "debug", transports: [new SpyTransport({ level: "debug" }, { spy })] });
  });
  describe("Update logic", function () {
    it("Update method correctly pulls appropriate pricing information", async function () {
      profitabilityCalculator = new ProfitabilityCalculator(
        spyLogger,
        [umaAddress, wethAddress, usdcAddress],
        mainnetChainId,
        mockWeb3,
        relayerDiscount
      );

      assert.equal(Object.keys(profitabilityCalculator.l1TokenInfo).length, 0); // no info before update

      await profitabilityCalculator.update();

      assert.equal(Object.keys(profitabilityCalculator.l1TokenInfo).length, 3); // 3 separate tokens after update

      // The three keys of each token should be included in the calculators state.
      assert.equal(Object.keys(profitabilityCalculator.l1TokenInfo)[0], umaAddress);
      assert.equal(Object.keys(profitabilityCalculator.l1TokenInfo)[1], wethAddress);
      assert.equal(Object.keys(profitabilityCalculator.l1TokenInfo)[2], usdcAddress);

      // Each address should have a price (check each price is not equal to 0).
      assert.isFalse(profitabilityCalculator.l1TokenInfo[umaAddress].tokenEthPrice.eq(toBN(0)));
      assert.isFalse(profitabilityCalculator.l1TokenInfo[wethAddress].tokenEthPrice.eq(toBN(0)));
      assert.isFalse(profitabilityCalculator.l1TokenInfo[usdcAddress].tokenEthPrice.eq(toBN(0)));

      // Token types are correctly assigned.
      assert.equal(profitabilityCalculator.l1TokenInfo[umaAddress].tokenType, TokenType.UMA);
      assert.equal(profitabilityCalculator.l1TokenInfo[wethAddress].tokenType, TokenType.WETH);
      assert.equal(profitabilityCalculator.l1TokenInfo[usdcAddress].tokenType, TokenType.ERC20);

      const lastLog = spy.getCall(-1).lastArg;
      assert.equal(lastLog.level, "debug");
      assert.equal(lastLog.message, "Updated prices");
      assert.equal(Object.keys(lastLog.tokenInfo).length, 3); // 3 tokens
    });
    it("Warns and sets price to 0 if cant find token price", async function () {
      // In the event that coingecko cant find the price should not blow up but rather set the token price to 0 and send
      // a warning message. This way, the bot will keep running but wont do any relays for that token type.
      profitabilityCalculator = new ProfitabilityCalculator(
        spyLogger,
        [ZERO_ADDRESS], // Not a token with a price
        mainnetChainId,
        mockWeb3,
        relayerDiscount
      );

      await profitabilityCalculator.update();

      assert.isTrue(profitabilityCalculator.l1TokenInfo[ZERO_ADDRESS].tokenEthPrice.eq(toBN(MAX_SAFE_ALLOWANCE)));
      const lastLog = spy.getCall(-2).lastArg;
      assert.equal(lastLog.level, "warn");
      assert.isTrue(lastLog.message.includes("Could not find token price!"));
    });
  });
  describe("Profitability calculation", function () {
    // Mock the update method to return a fixed price for each token.
    beforeEach(async function () {
      profitabilityCalculator = new MockProfitabilityCalculator(
        spyLogger,
        [umaAddress, wethAddress, usdcAddress],
        mainnetChainId,
        mockWeb3,
        relayerDiscount
      );
      profitabilityCalculator.setL1TokenInfo({
        [umaAddress]: { tokenType: TokenType.UMA, tokenEthPrice: mockUmaPriceInEth, decimals: umaDecimals },
        [wethAddress]: { tokenType: TokenType.WETH, tokenEthPrice: mockWethPriceInEth, decimals: wethDecimals },
        [usdcAddress]: { tokenType: TokenType.ERC20, tokenEthPrice: mockUSDCPriceInEth, decimals: usdcDecimals },
      });
    });
    it("Correctly errors if attempt to relay a token that has no price", async function () {
      assert.throws(
        () =>
          profitabilityCalculator.getRelaySubmitTypeBasedOnProfitability(
            toChecksumAddress(randomHex(20)), // some address the calculator doesn't know about.
            sampleCumulativeGasPrice,
            toBNWei(1),
            toBNWei(1),
            toBNWei(1)
          ).relaySubmitType
      );
    });
    describe("Correctly selects relay type", function () {
      // Tests set uses large differences between the cost and the revenue to validate relay submission type selection.
      // This acts to validate that the calculator correctly selects the most profitable relay submission mode.
      it("Correctly decides when to slow relay", async function () {
        assert.equal(
          profitabilityCalculator.getRelaySubmitTypeBasedOnProfitability(
            wethAddress,
            sampleCumulativeGasPrice,
            toBNWei(1), // Set speedUp and instant revenue to 0. Set slow revenue to 1 WETH. Should be a slow relay.
            toBNWei(0),
            toBNWei(0)
          ).relaySubmitType,
          RelaySubmitType.Slow
        );

        // Validate the relay profitability message message is produced correctly.
        const expectedProfit = toBNWei(1).sub(sampleCumulativeGasPrice.mul(toBN(across.constants.SLOW_ETH_GAS)));
        assert.equal(
          profitabilityCalculator.getRelaySubmitTypeBasedOnProfitability(
            wethAddress,
            sampleCumulativeGasPrice,
            toBNWei(1), // Set speedUp and instant revenue to 0. Set slow revenue to 1 WETH. Should be a slow relay.
            toBNWei(0),
            toBNWei(0)
          ).profitabilityInformation,
          `Expected relay profit of ${formatWei(expectedProfit)} ETH for Slow relay, with a relayerDiscount of 0%.`
        );

        // Correctly selects the most profitable option.
        assert.equal(
          profitabilityCalculator.getRelaySubmitTypeBasedOnProfitability(
            wethAddress,
            sampleCumulativeGasPrice,
            toBNWei(1.1), // Set instant revenue to 1. Set slow revenue to 1.1 WETH. Should be a slow relay.
            toBNWei(0),
            toBNWei(1)
          ).relaySubmitType,
          RelaySubmitType.Slow
        );
      });
      it("Correctly decides when to speed up a relay", async function () {
        assert.equal(
          profitabilityCalculator.getRelaySubmitTypeBasedOnProfitability(
            wethAddress,
            sampleCumulativeGasPrice,
            toBNWei(0), // set slow revenue and instant to 0. Set speed up to to 1 WETH. Relay should be sped up.
            toBNWei(1),
            toBNWei(0)
          ).relaySubmitType,
          RelaySubmitType.SpeedUp
        );
        // Validate the relay profitability message message is produced correctly.
        const expectedProfit = toBNWei(1); // note that we set the cost for speedup to 0 to ensure we always speedup.
        assert.equal(
          profitabilityCalculator.getRelaySubmitTypeBasedOnProfitability(
            wethAddress,
            sampleCumulativeGasPrice,
            toBNWei(0), // set slow revenue and instant to 0. Set speed up to to 1 WETH. Relay should be sped up.
            toBNWei(1),
            toBNWei(0)
          ).profitabilityInformation,
          `Expected relay profit of ${formatWei(expectedProfit)} ETH for SpeedUp relay, with a relayerDiscount of 0%.`
        );

        // Correctly selects the most profitable option.
        assert.equal(
          profitabilityCalculator.getRelaySubmitTypeBasedOnProfitability(
            wethAddress,
            sampleCumulativeGasPrice,
            toBNWei(1), // set slow revenue and instant to 1. Set speed up to to 1.1 WETH. Relay should be sped up.
            toBNWei(1.1),
            toBNWei(1)
          ).relaySubmitType,
          RelaySubmitType.SpeedUp
        );
      });
      it("Correctly decides when to instant relay", async function () {
        assert.equal(
          profitabilityCalculator.getRelaySubmitTypeBasedOnProfitability(
            wethAddress,
            sampleCumulativeGasPrice,
            toBNWei(0), // set slow and speed up to 0. Set instant to 1 WETH. Should be instant relayed.
            toBNWei(0),
            toBNWei(1)
          ).relaySubmitType,
          RelaySubmitType.Instant
        );

        // Validate the relay profitability message message is produced correctly.
        const expectedProfit = toBNWei(1).sub(sampleCumulativeGasPrice.mul(toBN(across.constants.FAST_ETH_GAS)));
        assert.equal(
          profitabilityCalculator.getRelaySubmitTypeBasedOnProfitability(
            wethAddress,
            sampleCumulativeGasPrice,
            toBNWei(0), // set slow revenue and instant to 0. Set speed up to to 1 WETH. Relay should be sped up.
            toBNWei(0),
            toBNWei(1)
          ).profitabilityInformation,
          `Expected relay profit of ${formatWei(expectedProfit)} ETH for Instant relay, with a relayerDiscount of 0%.`
        );

        // Correctly selects the most profitable option.
        assert.equal(
          profitabilityCalculator.getRelaySubmitTypeBasedOnProfitability(
            wethAddress,
            sampleCumulativeGasPrice,
            toBNWei(1), // set slow up to 1. Set instant to 1.1 WETH. Should be instant relayed.
            toBNWei(0),
            toBNWei(1.1)
          ).relaySubmitType,
          RelaySubmitType.Instant
        );
      });

      it("Correctly decides when to ignore a relay", async function () {
        // Zero revenue relay.
        assert.equal(
          profitabilityCalculator.getRelaySubmitTypeBasedOnProfitability(
            wethAddress,
            sampleCumulativeGasPrice,
            toBNWei(0), // Set all forms of revenue to 0. Relay should be ignored.
            toBNWei(0),
            toBNWei(0)
          ).relaySubmitType,
          RelaySubmitType.Ignore
        );
        // Under pay for each kind of relay and check the logs are produced correctly. Choose a reward of 0.02 for both
        // slow and instant relay types.
        const reward = toBNWei(0.02);
        // At 100 Gwei gas price:
        //  - slow cost is: 100e9 * 243177 / 1e18= 0.0243177 ETH.
        //  - instant cost is: 100e9 * 273519 / 1e18= 0.0273519 ETH.
        // If we set the reward for slow and instant to 0.02 we are underpaying for the relay. The expected profit for
        // each relay type is the difference between the above costs and the revenue of 0.02.
        const slowProfit = formatWei(reward.sub(sampleCumulativeGasPrice.mul(toBN(across.constants.SLOW_ETH_GAS))));
        const fastProfit = formatWei(reward.sub(sampleCumulativeGasPrice.mul(toBN(across.constants.FAST_ETH_GAS))));
        const speedUpProfit = formatWei("0");

        // Equally, there is a gas price at which the revenue of 0.02 for slow & fast relays becomes profitable.
        const breakEvenSlowGasPrice = formatGwei(reward.div(toBN(across.constants.SLOW_ETH_GAS)));
        const breakEvenFastGasPrice = formatGwei(reward.div(toBN(across.constants.FAST_ETH_GAS)));

        // Validate the log contains the correct information given our independent calculations.
        assert.equal(
          profitabilityCalculator.getRelaySubmitTypeBasedOnProfitability(
            wethAddress,
            sampleCumulativeGasPrice,
            reward, // set slow and instant rewards to 0.02, below the cost of the relay.
            toBNWei(0),
            reward
          ).profitabilityInformation,
          `SlowRelay profit ${slowProfit} ETH, SpeedUpRelay profit ${speedUpProfit} ETH and InstantRelay profit ${fastProfit} ETH, with a relayerDiscount of 0%. Current cumulativeGasPrice is 100.00 Gwei. Relay would be break even at gas price of SlowRelay ${breakEvenSlowGasPrice} Gwei, SpeedUpRelay 0.000 Gwei and InstantRelay ${breakEvenFastGasPrice} Gwei.`
        );

        // Validate the relay profitability message message is produced correctly.
        const expectedProfit = toBNWei(1).sub(sampleCumulativeGasPrice.mul(toBN(across.constants.FAST_ETH_GAS)));
        assert.equal(
          profitabilityCalculator.getRelaySubmitTypeBasedOnProfitability(
            wethAddress,
            sampleCumulativeGasPrice,
            toBNWei(0), // set slow revenue and instant to 0. Set speed up to to 1 WETH. Relay should be sped up.
            toBNWei(0),
            toBNWei(1)
          ).profitabilityInformation,
          `Expected relay profit of ${formatWei(expectedProfit)} ETH for Instant relay, with a relayerDiscount of 0%.`
        );
      });
    });
    describe("Correctly calculates profit on the margin", function () {
      // For this set of tests create a situation where a relay is right on the margin of being profitable. Should be
      // able to induce a state where profit toggles between positive and negative and the module responds accordingly.
      it("Relays correctly on the margin", async function () {
        // Compute the exact realized cost for doing a slow relay. If the revenue is at or below this value the bot
        // should not relay. If it is above, it should relay. Re-do this test for each type of token.

        [across.constants.SLOW_UMA_GAS, across.constants.SLOW_ETH_GAS, across.constants.SLOW_ERC_GAS].forEach(
          (gasUsed, index) => {
            const tokenAddress = [umaAddress, wethAddress, usdcAddress][index];
            const tokenPrice = [mockUmaPriceInEth, mockWethPriceInEth, mockUSDCPriceInEth][index];
            const tokenDecimals = [umaDecimals, wethDecimals, usdcDecimals][index];

            // Compute exact expected cost for a slow relay, in the token. At this exact price the relayer will be
            // breaking even. right above this, the relayer is making money.
            const slowRelayCostInToken = toBN(gasUsed)
              .mul(sampleCumulativeGasPrice)
              .mul(toBN(10).pow(tokenDecimals))
              .div(tokenPrice);

            // set revenue right below cost. should ignore.
            assert.equal(
              profitabilityCalculator.getRelaySubmitTypeBasedOnProfitability(
                tokenAddress,
                sampleCumulativeGasPrice,
                slowRelayCostInToken.subn(1),
                toBNWei(0),
                toBNWei(0)
              ).relaySubmitType,
              RelaySubmitType.Ignore
            );

            // set revenue right at cost. should also ignore.
            assert.equal(
              profitabilityCalculator.getRelaySubmitTypeBasedOnProfitability(
                tokenAddress,
                sampleCumulativeGasPrice,
                slowRelayCostInToken,
                toBNWei(0),
                toBNWei(0)
              ).relaySubmitType,
              RelaySubmitType.Ignore
            );
            // The log should show that there is exactly 0 wei, in eth, worth of profit expected for this relay, hence
            // it was ignored.
            assert.isTrue(lastSpyLogIncludes(spy, `"slowEthProfit":"0"`));

            // Note: this can be zero if a wei of the token is worth more than a wei of ETH.
            const amountToAdd = toBN(10).pow(tokenDecimals).div(tokenPrice);

            // Finally, set the revenue right above cost (by an amount of 1 wei). This should be profitable and relayed.
            assert.equal(
              profitabilityCalculator.getRelaySubmitTypeBasedOnProfitability(
                tokenAddress,
                sampleCumulativeGasPrice,
                slowRelayCostInToken.add(amountToAdd.isZero() ? toBN(1) : amountToAdd),
                toBNWei(0),
                toBNWei(0)
              ).relaySubmitType,
              RelaySubmitType.Slow
            );
          }
        );
      });
      it("Relayer discount correctly discounts the cost of a relay", async function () {
        // create a new instance of the module with a discount of 50%.
        profitabilityCalculator = new MockProfitabilityCalculator(
          spyLogger,
          [umaAddress, wethAddress, usdcAddress],
          mainnetChainId,
          mockWeb3,
          50 // 50% discount factor.
        );
        profitabilityCalculator.setL1TokenInfo({
          [umaAddress]: { tokenType: TokenType.UMA, tokenEthPrice: mockUmaPriceInEth, decimals: umaDecimals },
          [wethAddress]: { tokenType: TokenType.WETH, tokenEthPrice: mockWethPriceInEth, decimals: wethDecimals },
          [usdcAddress]: { tokenType: TokenType.ERC20, tokenEthPrice: mockUSDCPriceInEth, decimals: usdcDecimals },
        });

        // calculate the amount of eth relayed that would make a relay exactly profitable.
        const slowRelayCostInEth = toBN(across.constants.SLOW_ETH_GAS).mul(sampleCumulativeGasPrice);

        // If the discount was 0 then the relayer should not relay this as it is exactly on the margin of profitability
        // (shown in the previous test). If we half the cost, the relayer should relay this.
        assert.equal(
          profitabilityCalculator.getRelaySubmitTypeBasedOnProfitability(
            wethAddress,
            sampleCumulativeGasPrice,
            slowRelayCostInEth.divn(2).subn(1), // set the revenue to just below half the cost. Should not relay.
            toBNWei(0),
            toBNWei(0)
          ).relaySubmitType,
          RelaySubmitType.Ignore
        );

        assert.equal(
          profitabilityCalculator.getRelaySubmitTypeBasedOnProfitability(
            wethAddress,
            sampleCumulativeGasPrice,
            slowRelayCostInEth.divn(2), // set the revenue to exactly half the cost. Should not relay.
            toBNWei(0),
            toBNWei(0)
          ).relaySubmitType,
          RelaySubmitType.Ignore
        );

        assert.equal(
          profitabilityCalculator.getRelaySubmitTypeBasedOnProfitability(
            wethAddress,
            sampleCumulativeGasPrice,
            slowRelayCostInEth.divn(2).addn(1), // set the revenue to just above half the cost. Should now relay.
            toBNWei(0),
            toBNWei(0)
          ).relaySubmitType,
          RelaySubmitType.Slow
        );
      });
    });
  });
});
