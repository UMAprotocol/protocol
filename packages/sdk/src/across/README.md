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

### Constants

Across has some important constants which can be found in the [constants.ts](./constants.ts) file.

#### RATE_MODELS

The rate models here should be considered the source of truth, and be imported for the frontend and bots.

```ts
import { across } from "@uma/sdk"
const { RATE_MODELS } = across.constants
// Rate models are specified by bridge pool checksummed address. You can ensure checksum with ethers.getAddress.
const wethPoolAddress = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2"
const wethRateModel = RATE_MODELS[wethPoolAddress]

// example output
console.log(wethRateModel)
// {
//   UBar: "650000000000000000",
//   R0: "0",
//   R1: "80000000000000000",
//   R2: "1000000000000000000",
// }
```

## Gas Fee Calculator

Calculates gas fee percentages when doing a transfer for slow and fast relays. This utility can
output the direct values when providing gas estimates for `depositbox.deposit` contract.

### Quick Start

Quickest way to get up and running.

#### Requirements

- Mainnet Ethers provider
- Address of erc20 token on mainnet, if transfering a token, or `ethers.constants.AddressZero` for ETH.

#### Basic Fees Example

Calculate fees for calling deposit for initiating a relay.

```ts
import * as uma from "@uma/sdk"
const { gasFeeCalculator, constants, utils } = uma.across

const totalRelayed = utils.toWei(10)
const provider = ethers.providers.getDefaultProvider()
const umaAddress = constants.ADDRESSES.UMA
const { slowPct, instantPct } = await gasFeecalculator.getDepositFees(provider, totalRelayed, umaAddress)

// example call to deposit, uses the slow/instant percentages from getDepositFees call
// const tx = await depositBox.deposit(
//   toAddress,
//   umaAddress,
//   totalRelayed,
//   slowPct,
//   instantPct,
//   latestl2Block.timestamp,
// );
```

#### Detailed Fees Example

This uses the same underlying logic as the basic example, but returns omre information useful for display purposes.

```ts
import * as uma from "@uma/sdk"
const { gasFeeCalculator, constants, utils } = uma.across

const totalRelayed = utils.toWei(10)
const provider = ethers.providers.getDefaultProvider()
const umaAddress = constants.ADDRESSES.UMA
const optionalFeeLimitPercent = 25 // this checks if fees are too high as a percentage of total amount to relay, omit to disable check
const feeDetails: gasFeeCalculator.DepositFeeDetails = await gasFeecalculator.getDepositFeesDetails(
  provider,
  totalRelayed,
  umaAddress,
  optionalFeeLimitPercent
)

// see the DepositFeeDetails type for the shape of return data.
```

### LP Fee Calculator

Get lp fee calculations by timestamp.

```ts
import * as uma from "@uma/sdk"

const LpFeeCalculator = uma.across.LpFeeCalculator

// pass in L1 read only provider. You should only have a single instance of the calculator.
const calculator = new LpFeeCalculator(provider)

const tokenAddress = // token address on L1 to transfer from l2 to l1
const bridgePoolAddress = // bridge pool address on L1 with the liquidity pool
const amount = // amount in wei for user to send across
const timestamp = // timestamp in seconds of latest block on L2 chain
const percent = await calculator.getLpFeePct(tokenAddress, bridgePoolAddress, amount, timestamp)


```

### Contract Clients

- [BridgePool Client](./clients/README.md)
