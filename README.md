# UMA Protocol

<p align="center">
  <img alt="UMA Logo" src="./documentation/Logo.png" width="440">
</p>

[![<UMAprotocol>](https://circleci.com/gh/UMAprotocol/protocol.svg?style=shield)](https://app.circleci.com/pipelines/github/UMAprotocol/protocol)
[![Docker Cloud Build Status](https://img.shields.io/docker/cloud/build/umaprotocol/protocol)](https://hub.docker.com/r/umaprotocol/protocol)
[![Coverage Status](https://coveralls.io/repos/github/UMAprotocol/protocol/badge.svg?branch=master)](https://coveralls.io/github/UMAprotocol/protocol?branch=master)

[![GitHub](https://img.shields.io/github/license/UMAprotocol/protocol)](https://github.com/UMAprotocol/protocol/blob/master/LICENSE)
[![GitHub last commit](https://img.shields.io/github/last-commit/UMAprotocol/protocol)](https://github.com/UMAprotocol/protocol/commits/master)
[![GitHub commit activity](https://img.shields.io/github/commit-activity/m/UMAprotocol/protocol)](https://github.com/UMAprotocol/protocol/commits/master)
[![GitHub contributors](https://img.shields.io/github/contributors-anon/UMAprotocol/protocol)](https://github.com/UMAprotocol/protocol/graphs/contributors)

[![Generic badge](https://img.shields.io/badge/homepage-view-red.svg)](https://umaproject.org/)
[![Generic badge](https://img.shields.io/badge/discord-join-green.svg)](https://discord.com/invite/jsb9XQJ)
[![Generic badge](https://img.shields.io/badge/send-email-blue.svg)](mailto:hello@umaproject.org)
[![Twitter Follow](https://img.shields.io/twitter/follow/UMAprotocol?label=follow%20%40UMAprotocol&style=social)](https://twitter.com/UMAprotocol)

## Documentation 📚

Our docs site is [here](https://docs.umaproject.org). It contains tutorials, explainers, and smart contract
documentation. If you'd like to view these docs on github instead, check out the
[documentation folder in the docs repo](https://github.com/UMAprotocol/docs/tree/master/docs).

## Security and Bug Bounty 🐛

Please see [here](./documentation/developer_reference/bug_bounty.md) for details on our bug bounty.

## Developer Information and Tools 👩‍💻

For information on how to initialize and interact with our smart contracts, please see the
[documentation site](https://docs.umaproject.org).

### Install dependencies 👷‍♂️

You'll need the latest LTS release of nodejs and yarn installed. Assuming that's done, run `yarn` with no args:

```
yarn
```

### Prepare smart contracts 🧐

Some code in the repository requires a build step to compile it. To run this build step, use the `qbuild` (quick build) command:

```
yarn qbuild
```

The above command does not include dapps because dapps take a long time to build and they have their own scripts to run locally.
However, if you'd like to build _everything_, you can use the build command:

```
yarn build
```

### Run tests 🦾

To run tests, you'll need to start ganache on port 9545:

```
yarn ganache-cli -e 1000000000 -p 9545 -l 9000000 -d
```

Note: if you're interested in what these args do:

- `-e` is the amount of ETH to grant the default accounts.
- `-p` is the port that ganache will listen on.
- `-d` tells ganache to use a standard set of deterministic accounts on each run.

Then, you can run all of the tests across the repo by running:

```
yarn test
```

However, running all of the tests across the repository takes a lot of time. To run the tests for just
one subpackage, you can run:

```
yarn workspace <subpackage_name> test
```

### Running the linter 🧽

To run the linter in autofix mode (it will attempt to fix any errors it finds), run:

```
yarn lint-fix
```

To run the linter in the default mode, where it will print all errors and not modify code, run:

```
yarn lint
```

### Adding dependencies 👩‍👦

All runtime/production dependencies should be added to the subpackage that needs them. Development dependencies
should also generally be installed in subpackages unless they are needed by code that exists outside of any subpackage.

For more details on subpackages and the monorepo, please see the next section.

To add a dependency to a subpackage:

```
yarn workspace <subpackage_name> add <dependency_name>
```

Note: development dependencies are those that are not required by the code that's published to the npm registry. If you're not
sure whether a dependency should be dev or not, just ask! To install a dev dependency in a subpackage:

```
yarn workspace <subpackage_name> add <dependency_name> --dev
```

To install a dev dependency at root:

```
yarn add <dependency_name> --dev
```

After you've installed a dependency, yarn should automatically update the `yarn.lock` file. If git doesn't notice any changes in that file,
run `yarn` to update the lockfile.

### Using yarn and lerna 🧑‍🍳

This repository is a monorepo. That means that it contains many different, but related packages.
It uses [yarn workspaces](https://classic.yarnpkg.com/en/docs/workspaces/) and [lerna](https://github.com/lerna/lerna)
to manage these packages.

Note: lerna and yarn workspaces have some overlapping functionality. This is because `lerna` predates `yarn` workspaces and
is compatible with `yarn` alternatives that don't have workspace functions, like `npm`.

`yarn` should be installed globally to use this repo. This means that you can run any yarn command by running:

```
yarn <command>
```

Once you run `yarn` during the install section above, lerna should have been installed locally. After that,
you should be able to run lerna commands using yarn:

```
yarn lerna <command>
```

To run a yarn command in a particular sub-package, you can run the following from _anywhere in the repo_:

```
yarn workspace <subpackage_name> <script>
```

For instance, this could be used to run the build command in the `@umaprotocol/core` package:

```
yarn workspace @umaprotocol/core build
```

or to install the truffle package as a devDependency in the `@umaprotocol/liquidator` package:

```
yarn workspace @umaprotocol/liquidator add truffle --dev
```

To run a package script in _every_ package that has a script by that name, you should use `lerna`:

```
yarn lerna run <script> --stream
```

Note: the stream argument is just to force lerna to stream the output so you get realtime logs.

## Coverage 🔎

We use the [solidity-coverage](https://github.com/sc-forks/solidity-coverage) package to generate our coverage reports.
You can find the coverage report at [coveralls](https://coveralls.io/github/UMAprotocol/protocol). Otherwise, you can generate it locally by running:

```
./ci/coverage.sh packages/core
```

The full report can be viewed by opening the `packages/core/coverage/index.html` file in a browser.

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
