# UMA Protocol

## Contact

- [Slack](https://umaprotocol.slack.com): to join, use this
[invite link](https://join.slack.com/t/umaprotocol/shared_invite/enQtNTk4MjQ4ODY0MDA1LTM4ODg0NGZhYWZkNjkzMDE4MjU0ZGFlYWQzZTFiZWFlZjI2NDE4OGI2NWY3OTdhYjYyZjg0MjAzMTgwODVhZTE).
Please use Slack for all technical questions and discussions.
- [Email](mailto:hello@umaproject.org): for anything non-technical.

## Documentation

Our docs site is [here](https://docs.umaproject.org). It contains tutorials, explainers, and smart contract
documentation. If you'd like to view these docs on github instead, check out the
[documentation folder](./documentation).

## Security and Bug Bounty

Please see [here](./documentation/developer_reference/bug_bounty.md) for details on our bug bounty. 

## Developer Information and Tools

### Solhint - Solidity Linter
Find more information about solhint [here](https://protofire.github.io/solhint/). There are plugins available to see solhint errors inline in many IDEs.

- Make sure you've run `npm install`.
- To run over all contracts under `contracts/`:
```
$(npm bin)/solhint contracts/**/*.sol
```

### Running Prettier JS Formatter
To run prettier over the `.js` files in the repo, run:
```
npm run prettier
```

## Coverage
We use the [solidity-coverage](https://github.com/sc-forks/solidity-coverage) package to generate our coverage reports.
These can be generated manually by developers. There are no regression tests or published reports. CircleCI does
generate a coverage report automatically, but if you'd like to generate it locally, run:
```
npm run coverage
```
The full report can be viewed by opening the `coverage/index.html` file in a browser.

## Style Guide

See [STYLE.md](STYLE.md).

## Roadmap for the Oracle
The current iteration of the system relies on a centrally controlled oracle to settle financial contracts with correct prices. To provide truly universal market access, future iterations will open up the system to allow outside participation while still providing guarantees about correct behavior, even with assumptions of arbitrary (byzantine) behavior. Look forward to our second whitepaper where we outline our vision for a trustless oracle.
