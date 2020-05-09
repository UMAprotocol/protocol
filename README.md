# UMA Protocol

<div style="text-align:center"><img src="./documentation/Logo.png" /></div>

[![<UMAprotocol>](https://circleci.com/gh/UMAprotocol/protocol.svg?style=shield)](https://app.circleci.com/pipelines/github/UMAprotocol/protocol)
![Docker Cloud Build Status](https://img.shields.io/docker/cloud/build/umaprotocol/voting)

![GitHub](https://img.shields.io/github/license/UMAprotocol/protocol)
![GitHub last commit](https://img.shields.io/github/last-commit/UMAprotocol/protocol)
![GitHub commit activity](https://img.shields.io/github/commit-activity/m/UMAprotocol/protocol)
![GitHub contributors](https://img.shields.io/github/contributors-anon/UMAprotocol/protocol)

[![Generic badge](https://img.shields.io/badge/Website-Browse-red.svg)](https://umaproject.org/)
[![Generic badge](https://img.shields.io/badge/Slack-Join-green.svg)](https://join.slack.com/t/umaprotocol/shared_invite/zt-7mtxxds5-OIhE~q_WkwGCVNrq0~G~rg)
[![Generic badge](https://img.shields.io/badge/Send-Email-blue.svg)](mailto:hello@umaproject.org)
![Twitter Follow](https://img.shields.io/twitter/follow/UMAprotocol?label=Follow%20%40UMAprotocol&style=shield)

## Documentation 📚

Our docs site is [here](https://docs.umaproject.org). It contains tutorials, explainers, and smart contract
documentation. If you'd like to view these docs on github instead, check out the
[documentation folder](./documentation).

## Security and Bug Bounty 🐛

Please see [here](./documentation/developer_reference/bug_bounty.md) for details on our bug bounty.

## Developer Information and Tools 👩‍💻

For information on how to initialize and interact with our smart contracts, please see the
[documentation site](https://docs.umaproject.org).

### Install dependencies 👷‍♂️

You'll need the latest LTS release of nodejs and npm installed. Assuming that's done, run:

```
npm install
```

### Running the linter 🧽

To run the formatter, run:

```
npm run lint-fix
```

## Coverage 🔎

We use the [solidity-coverage](https://github.com/sc-forks/solidity-coverage) package to generate our coverage reports.
These can be generated manually by developers. There are no regression tests or published reports. CircleCI does
generate a coverage report automatically, but if you'd like to generate it locally, run:

```
./ci/coverage.sh core
```

The full report can be viewed by opening the `core/coverage/index.html` file in a browser.

## Style Guide 🕺

See [STYLE.md](STYLE.md).

## Roadmap for the DVM 🛣

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
