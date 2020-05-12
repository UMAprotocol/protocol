# DVM Security

## Audit

The contracts in [the common directory](https://github.com/UMAprotocol/protocol/tree/9d403ddb5f2f07194daefe7da51e0e0a6306f2c4/core/contracts/common) and [the oracle directory](https://github.com/UMAprotocol/protocol/tree/9d403ddb5f2f07194daefe7da51e0e0a6306f2c4/core/contracts/oracle) of the `/protocol` repo have been carefully audited by OpenZeppelin.
The audit report can be found [here](https://blog.openzeppelin.com/uma-audit-phase-1/).

## Known Issues

### Unimplemented Features

As described in section “M03” of the [audit report](https://blog.openzeppelin.com/uma-audit-phase-1/), there are mechanisms described in the whitepaper that are not yet implemented in the mainnet deployment of the DVM.
These mechanisms are described below.

#### Median Calculation

After a price request is made and DVM voters submit their votes on the correct value of the price identifier, the DVM calculates the value that should be returned to the requesting contract.
This is also used to determine what inflationary rewards, in the form of newly minted UMA tokens, should be paid to voters.

The whitepaper describes a method for the DVM to calculate this value via a median calculation:

- If the distribution of votes is highly unimodal (frequency of the mode >50%), the mode is returned as the verified price. Token holders who voted for the mode are rewarded; all other token holders are penalized.
- If the frequency of the mode of the votes is <50%, the median price is returned as the verified price. Token holders who submitted votes between the 25th and 75th percentile are rewarded; all other token holders are penalized.

However, this is not reflected in the v1 implementation of the DVM. The v1 implementation of the DVM instead conducts the following calculation:

- If the distribution of votes is highly unimodal (frequency of the mode >50%), the mode is returned as the verified price. Token holders who voted for the mode are rewarded; all other token holders are penalized.
- If the frequency of the mode of the votes is <50%, the vote is delayed until the next round.

#### Automated Buy and Burn Program

The whitepaper describes a method to calculate, collect, and use fees from contracts registered with the DVM and to “buy and burn” UMA tokens.
This program should be automated in the future, but is currently executed manually.

As described in [this section](./economic_architecture.md), \$UMA tokenholders currently manually observe the PfC and CoC to determine the regular and final fee rates.
The Risk Labs Foundation manually withdraws the fees that have been collected and uses them to manually “buy and burn” UMA tokens to increase the CoC.

### Areas of Research

#### Parasitic Usage

Step 2 of the mechanism described [here](./economic_architecture.md) shows that the profit from corruption (PfC) must be known at all times.
This is calculated by summing the PfC of each financial contract that is reliant on the UMA DVM.
This requires all financial contracts that rely on the DVM to be registered with the UMA DVM.

The problem of “parasitic usage” arises if there are financial contracts that are dependent on the UMA DVM but are not registered with it.
These contracts would cause the PfC of the UMA DVM to be higher than what is calculated, and the economic guarantee of the UMA DVM may not hold.

A proposed solution to the parasitic usage problem is to “fuzz” the information returned by the DVM.
Below is a simplified example of one solution, with some caveats that follow.

Alice and Bob are trying to settle a contract which contains $100 of collateral. The contract requests a resolution from the UMA DVM and transfers the $100 of collateral with that request.

Pre-vote phase:

- The DVM begins a new voting round, starting with a pre-vote phase.
- During the pre-vote phase, anyone can deposit money into the DVM contract along with a commit that’s constructed as follows: `hash(salt, payout_dest)`. The `payout_dest` is the party to which the money should go (either Alice’s or Bob’s address).
- Charlie (a friend of Alice) deposits \$50 with the commit `hash(salt, alice_address)`.
- Charlie sends his `(salt, alice_address)` pair to a trusted server. He provides instructions to the DVM voters for how to access this server. Note: this could be multiple servers or even be a trusted set of voters - there just needs to be some party he trusts to perform the proof on demand, but not reveal the salt.

Vote phase:

- DVM voters communicate with this server off chain. The voters each request an interactive zero knowledge proof (zk-proof) session with the server. The server systematically proves to each voter that the `payout_dest` that Charlie committed is Alice’s address without revealing the salt.
- Instead of voting on the underlying price, voters vote on Alice’s payout. Bob’s payout will be computed by subtracting Alice’s payout from the total that was paid in by the contract and pre-vote deposits.
- Each voter sees that the underlying price is $50. Assume that in this example, an underlying price of $50 would have normally resulted in a payout to Alice of $50. However, each voter commits on-chain to a value of $100, since this nets the usual payout of $50 with the $50 deposit that should go to Alice according to the interactive zk-proof.
- After all the voters reveal their votes, the underlying price resolves to $50 but the DVM does not reveal this number, only indicating that a payout of $100 to Alice and \$50 to Bob should be made.
- Alice and Bob are free to withdraw their payouts.

It would appear to a parasitic contract relying on these payouts that the price was $67 (because Alice got 2/3 of the money), when it was really $50.
Unless Charlie reveals his salt, there’s no way to prove on chain that Charlie requested his funds be paid out to Alice’s address.
If Charlie notices that voters have gone against his wishes, he is free to reveal his salt to demonstrate this publicly.

Noting that interactive zk proofs are costly, this “fuzzing” solution may inadvertently create avenues through which the DVM voting system could be DoS’d.
The contract and Charlie also need not send collateral to the DVM to escrow during the resolution process.
This collateral may be stored in a separate account and the DVM may instead only return the payments to be made from that account to each party.
