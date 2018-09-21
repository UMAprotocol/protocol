# InitialContract

## Prototype

How to run:

1. Install nodejs and npm
1. Run `npm install -g truffle`
1. Run `npm install`
1. Run `truffle develop`. Pay attention to the line `Mnemonic: ...` that is printed after the private keys, we will use this later.
1. Make sure you have metamask or mist configured in your browswer and connected to truffle developer chain. This requires:
    - Installation
    - Configure a Custom RPC that points to url http://127.0.0.1:9545
    - Sign in using mnemonic printed out near the top of the `truffle develop` output. To do this (with metamask) you click "Import account using seed phrase", on popup enter mnemonic and create a pasword.
1. In truffle console run `compile --reset`
1. Also in truffle console run `migrate --reset`
1. In different shell run `npx ethereum-bridge -a 9 -H 127.0.0.1 -p 9545 --dev`
    - When this finishes, look for
    ```
    Please add this line to your contract constructor:

    OAR = OraclizeAddrResolverI(0x6f485C8BF6fc43eA212E93BBF8ce046C7f1cb475);
    ```
    Make sure the address inside `OraclizeAddrResolverI` matches the line of code in `contracts/Vote.sol`
1. Run `VoteCoin.deployed().then(function(instance){instance.updatePrice()})` to start fetching prices.
1. In another shell `npm run dev`
1. Open browser and go to address indicated by `npm run serve` (usually http://localhost:8080)
Contains some code for a first pass at a derivatives contract

## Additional Developer Tools

### Solhint - Solidity Linter
Find more information about solhint [here](https://protofire.github.io/solhint/). There are plugins available to see solhint errors inline in many IDEs.

- To install:
```
npm install -g solhint
```
- To run over all contracts under `contracts/`:
```
solhint contracts/**/*.sol
```

## Links

https://medium.com/@olxc/ethereum-and-smart-contracts-basics-e5c84838b19

http://solidity.readthedocs.io/en/develop/index.html

https://karl.tech/learning-solidity-part-2-voting/

https://media.consensys.net/time-sure-does-fly-ed4518792679

Read article below (and other things by Alex Evans):

https://medium.com/blockchannel/a-crash-course-in-mechanism-design-for-cryptoeconomic-applications-a9f06ab6a976

https://blockgeeks.com/guides/proof-of-work-vs-proof-of-stake/
https://cryptologie.net/article/424/writing-a-dapp-for-the-ethereum-block-chain/
https://medium.com/@mvmurthy/full-stack-hello-world-voting-ethereum-dapp-tutorial-part-1-40d2d0d807c2
https://electronjs.org/docs/tutorial/first-app
