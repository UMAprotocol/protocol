# Across Utilities

Across is a system that uses UMA contracts to quickly move tokens across chains. This contains various utilities to support applications
on across.

## Fee Calculator

Calculates lp fee percentages when doing a transfer.

### Usage

See tests for more documentation: [Fee Calculator Test]("./feeCalculator.test.ts")

```ts
import * as uma from "@uma/sdk"

const { calculateApyFromUtilization, calculateRealizedLpFeePct } = uma.across.feeCalculator

// sample interest rate model.
const rateModel = { UBar: toBNWei("0.65"), R0: toBNWei("0.00"), R1: toBNWei("0.08"), R2: toBNWei("1.00") }

// Each interval contains the utilization at pointA (before deposit), the
// utilization at pointB (after the deposit), expected APY rate and the expected weekly rate.
const interval = { utilA: toBNWei("0"), utilB: toBNWei("0.01"), apy: "615384615384600", wpy: "11830749673498" }

// Calculate the realized yearly LP Fee APY Percent for a given rate model, utilization before and after the deposit.
const apyFeePct = calculateApyFromUtilization(rateModel, interval.utilA, interval.utilB)
assert.equal(apyFeePct.toString(), interval.apy)

const realizedLpFeePct = calculateRealizedLpFeePct(rateModel, interval.utilA, interval.utilB).toString()
assert.equal(realizedLpFeePct.toString(), interval.wpy)
```

## Gas Fee Calculator

Calculates gas fee percentages when doing a transfer for slow and fast relays.

### Quick Start

Quickest way to get up and running.

#### Requirements

- Ethers provider
- address of erc20 token on mainnet, if transfering a token
- See constants for correct gas estimation for relay

```ts
import * as uma from "@uma/sdk"
const { constants, gasFeeCalculator } = uma.across

// currently available constants
const {
  SLOW_ETH_GAS
  SLOW_ERC_GAS
  SLOW_UMA_GAS
  FAST_ETH_GAS
  FAST_ERC_GAS
  FAST_UMA_GAS
} = constants

const provider = ethers.providers.getDefaultProvider();
const usdcAddress = "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48";
const slowGasFees = gasFeeCalculator(provider, SLOW_ERC_GAS, usdcAddress);

```

### Custom Calculation Examples

These examples show how to make calculations with arbitrary token prices or gas prices. See examples in
See [utility tests](./utils.test.ts) for more examples.

```ts
import * as uma from "@uma/sdk"

const { constants, utils } = uma.across
const { fromWei } = utils

// given a transfer of ETH across chains, get amount of eth used in gas for a slow transaction
const gasPrice = await ethersProvider.getGasPrice() // you will need to get an estimate from provider. This returns gas price in wei.
const ethFees = getGasfees(SLOW_ETH_GAS, gasPrice)

// Given a standard USDC ERC20 transfer across chains, get amount of the token used in gas for a slow transaction.
const gas = constants.SLOW_ERC_GAS
const gasPrice = await ethersProvider.getGasPrice() // you will need to get an estimate from provider
// we need a coingecko client to get us prices in ETH per USDC.
const coingecko = new uma.Coingecko()
// note we denominate price in eth when calling coingecko, this call returns [timestamp,price], but we only care about price
const [timestamp, tokenPrice] = await coingecko.getCurrentPriceByContract(usdcAddress, "eth")
const decimals = 6
const result = utils.calculateGasFees(gas, gasPrice, tokenPrice, decimals)
const userDisplay = fromWei(result, decimals)

// For Eth the tokenPrice can be omitted, as can decimals.
// Calculating fast eth price.
const gas = constants.FAST_ETH_GAS
const gasPrice = await ethersProvider.getGasPrice() // you will need to get an estimate from provider
const result = utils.calculateGasFees(gas, gasPrice)
const userDisplay = fromWei(result)
```
