# Creating Synthetic Tokens from Truffle console

This tutorial will show you how to create synthetic tokens from the command line using UMA’s synthetic token template. Before beginning this tutorial, please make sure your environment is set up correctly by following the instructions in the “Prerequisites” section. After completing this section, your environment will: 
* Clone the UMA repo
* Run a personal Ethereum blockchain locally on port 9545
* Compile all contracts in the UMA repo

Below, we’ll discuss how to create and manage a token sponsor position via the command line on a local testnet. UMA also has a command-line interface (CLI) tool that bundles and renames some of these steps. These tutorials discuss how to create and manage a token sponsor position using this CLI tool. <!-- (links to separate page) -->

* Begin [here](#parameterize-and-deploy-a-contract) if you are creating a new type of synthetic token on a local testnet.
* Begin [here](#create-new-tokens-from-an-existing-contract) if you are creating synthetic tokens from an existing contract on a local testnet.
* Begin here if you are creating tokens on UMA-supported testnet and mainnet deployments. <!-- (links to separate page) -->
 
## Parameterize and deploy a contract
 
1. Set up the truffle environment and migrate contracts. (This step is not necessary if working with an existing testnet or mainnet deployment.)
```
$(npm bin)/truffle migrate --network test
```
 
2. Open the truffle console.
```bash
$(npm bin)/truffle console --network test
```
 
3. Create an instance of the expiring multiparty creator (the contract factory for synthetic tokens). This command should return “undefined”. 
```js
const empCreator = await ExpiringMultiPartyCreator.deployed()
```
 
4. Define the parameters for the synthetic tokens you would like to create. For documentation surrounding the meanings of each parameter, please see this page. 
```
const constructorParams = { expirationTimestamp: "1585699200", collateralAddress: TestnetERC20.address, priceFeedIdentifier: web3.utils.utf8ToHex("UMATEST"), syntheticName: "Test UMA Token", syntheticSymbol: "UMATEST", collateralRequirement: { rawValue: web3.utils.toWei("1.5") }, disputeBondPct: { rawValue: web3.utils.toWei("0.1") }, sponsorDisputeRewardPct: { rawValue: web3.utils.toWei("0.1") }, disputerDisputeRewardPct: { rawValue: web3.utils.toWei("0.1") } }
```
 
5. Before the contract for the synthetic tokens can be created, the price identifier for the synthetic tokens must be registered with `IdentifierWhitelist`. This is important to ensure that the UMA DVM can resolve any disputes for these synthetic tokens. 
```
const identifierWhitelist = await IdentifierWhitelist.deployed()
await identifierWhitelist.addSupportedIdentifier(constructorParams.priceFeedIdentifier)
```
 
6. We also need to register the `empCreator` factory with the `registry` to give it permission to create new expiring multiparty (emp) synthetic tokens.
```
const registry = await Registry.deployed()
await registry.addMember(1, empCreator.address)
```
 
7. Now, we can create a new expiring multiparty synthetic token with the factory instance.
```
const txResult = await empCreator.createExpiringMultiParty(constructorParams)
const emp = await ExpiringMultiParty.at(txResult.logs[0].args.expiringMultiPartyAddress)
```
 
## Create new tokens from an existing contract
 
1. Now that we’ve parameterized and deployed the synthetic token contract, we will create synthetic tokens from that contract. The first step is to create an instance of the Test token and mint 10,000 to the wallet. This is the token that will serve as collateral for the synthetic token. [Give permission](#how-to-conduct-initial-token-creation) to the empCreator to spend the collateral tokens on our behalf. 
 
```
const collateralToken = await TestnetERC20.deployed()
await collateralToken.allocateTo(accounts[0], web3.utils.toWei("10000"))
await collateralToken.approve(emp.address, web3.utils.toWei("10000"))
```
 
2. We can now create a synthetic token position. We will deposit 150 units of collateral (the first argument) to create 100 units of synthetic tokens (the second argument).
 
```
await emp.create({rawValue: web3.utils.toWei("150")},{rawValue:web3.utils.toWei("100")})
```
 
3. Let’s check that we now have synthetic tokens. We should have 100 synthetic tokens and 9,850 collateral tokens. 
 
```
const syntheticToken = await SyntheticToken.at(await emp.tokenCurrency())
 
(await collateralToken.balanceOf(accounts[0])).toString()
// collateral token balance
(await syntheticToken.balanceOf(accounts[0])).toString()
// synthetic token balance
await emp.positions(accounts[0])
// position information
```
 
## Redeem tokens against a contract
 
1. Because we are a token sponsor for this synthetic token contract, we can redeem some of the tokens we minted even before the synthetic token expires. Let's redeem half.
 
```
await syntheticToken.approve(emp.address,web3.utils.toWei("10000"))
await emp.redeem({rawValue: web3.utils.toWei("50")})
```
 
2. Let’s check that our synthetic token balance has decreased and our collateral token balance has increased. Our synthetic token balance should now be 50. Because the contract does not have an on-chain price feed to determine the token redemption value for the tokens, it will give us collateral equal to the proportional value value of the total collateral deposited to back the 100 tokens (50/100 * 150 = 75). Our collateral token balance should increase to 9,925. 
 
```
(await collateralToken.balanceOf(accounts[0])).toString()
// collateral token balance
(await syntheticToken.balanceOf(accounts[0])).toString()
// synthetic token balance
await emp.positions(accounts[0])
// position information
```
 
## Deposit and withdraw collateral
 
1. As a token sponsor, we may wish to add additional collateral to our position to avoid being liquidated by a token holder. Let’s deposit 10 additional collateral tokens to our position and see our updated balance, from 9,925 to 9,915. 
```
await emp.deposit({rawValue: web3.utils.toWei("10")})
(await collateralToken.balanceOf(accounts[0])).toString()
```
 
2. For a token sponsor to withdraw collateral from his position, there are typically 2 ways to do this. Click here for more information. In this scenario, because we are the only token sponsor, we will have to withdraw collateral the “slow” way. First, we need to request a withdrawal of 10 collateral tokens.
```
await emp.requestWithdrawal({rawValue: web3.utils.toWei("10")})
```
 
3. Now, we need to simulate the withdrawal liveness period passing without a dispute of our withdrawal request. Because we set this period to be 1000 when we parameterized and deployed the contract, let’s simulate 1001 of time elapsing. Once the 1001 has elapsed, we can withdraw the amount we previously requested. 
 
```
await emp.setCurrentTime((await emp.getCurrentTime()).toNumber() + 1001)
await emp.withdrawPassedRequest()
```
 
4. Let’s now check that our collateral token balance has returned to 9,925. 
 
```
(await collateralToken.balanceOf(accounts[0])).toString()
// collateral token balance
```
<!-- 
--END OF TUTORIAL--
 
Notes: We might prefer to show people how to settle a contract after expiration using a CLI tool so they can change between token sponsor, token holder, and DVM voter personas more easily. 
 
# settle past expiration???
This might be a good tutorial to write with the CLI as someone can flip between the token holder, token sponsor, and voter personas throughout the tutorial.
 
steps:
 
1. advance timestamp
2. emp.expire
3. DVM vote on price
4. advance time again
5. emp.settleExpired
6. check balance

-->
