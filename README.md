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

For information on how to initialize and interact with our smart contracts, please see the
[documentation site](https://docs.umaproject.org).

### Install dependencies

You'll need the latest LTS release of nodejs and npm installed. Assuming that's done, run:

```
npm install
```

### Running the linter

To run the formatter, run:

```
npm run lint-fix
```

## Coverage

We use the [solidity-coverage](https://github.com/sc-forks/solidity-coverage) package to generate our coverage reports.
These can be generated manually by developers. There are no regression tests or published reports. CircleCI does
generate a coverage report automatically, but if you'd like to generate it locally, run:

```
./ci/coverage.sh core
```

The full report can be viewed by opening the `core/coverage/index.html` file in a browser.

## Style Guide

See [STYLE.md](STYLE.md).

## Roadmap for the DVM

Version 1 of the UMA Token and DVM have been released and launched. You can find the addresses of relevant contracts
[here](./core/networks/1.json). This version implements most of what's described in the
[whitepaper](https://github.com/UMAprotocol/whitepaper/blob/master/UMA-DVM-oracle-whitepaper.pdf). Notable exceptions
include:
- The voting process uses a simple modal majority. If there is no majority, the vote is retried in the next round.
- Defense against parasitic usage as described in section 8.1.
- The buyback-and-burn mechanism is currently run by the UMA Foundation rather than other automated mechanisms
mentioned in section 5.2.

The goal is to bring the implementation closer to the whitepaper in future DVM upgrades. Please see the
[documentation site](https://docs.umaproject.org) for more details.
