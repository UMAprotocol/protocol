## Verification Overview
The current directory contains Certora's formal verification of UMA Optimistic asserter contract.
In this directory you will find three subdirectories:

1. specs - Contains all the specification files that were written by Certora for the asserter contract verification.

- `Asserter_Base.spec` contains method declarations, CVL functions, ghost functions and definitions used by the main specification files. Must be imported
for every main spec wished to be verified.
- `Asserter_Auxiliary.spec` contains simple rules for an early part of the verification.
- `Asserter_Bonds.spec` contains rules related to the bonds of assertions in the protocol.
- `erc20.spec` contains a methods block that dispatches all erc20 interface functions.
- `dispatchedMethods.spec` contains a methods block that dispatches all the functions which are not a part from the main contract. If one imports this spec
to one of the other specs, it is crucial that there exists at least one implementation of each function in the list of contracts provided in the script.
- `nonDetMethods.spec` - contains a methods block for all the function which are not a part of the main contract, that summarizes these functions as non-state changing and returning a non deterministic value for each call.  

2. scripts - Contains the necessary run scripts to execute the spec files on the Certora Prover. These scripts composed of a run command of Certora Prover, contracts to take into account in the verification context, declaration of the compiler and a set of additional settings. 
- `verifyAsserter.sh` is a script for running of the main specs `Asserter_Auxiliary` or `Asserter_Bonds`. One can choose the desired spec to be verified by changing the argument in the `verify` command in the script. e.g. `--verify OptimisticAsserterHarness:certora/specs/exampleSpec.spec`

3. harness - Contains all the inheriting contracts that add/simplify functionalities to the original contract, together with our own Mock contracts

We use one harnessed file:
- `OptimisticAsserter.sol` - the main contract that is verified. Inherits from the original `optimisticAsserter` contracts. This file contains simple getter functions, mostly for the assertion parameters, for easier use through CVL.

You may add any additional mock contracts to this folder, and import them to the running script. Simply add their relative path to the first part of script file, where you would see the list of all Solidity files used by the tool.
If the mock file's name is different than the name of the contract it holds,
simply add a semi-colon after the name of the file and then the name of the contract. e.g.
`.certora/harness/myFile.sol:myContract`.

</br>

---

## Running Instructions
To run a verification job:

1. Open terminal and `cd` your way to the UMA/packages/core directory.

2. Run the script you'd like to get results for:
    ```
    sh certora/scripts/verifyAsserter.sh
    ```