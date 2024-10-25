# UMA Protocol

<p align="center">
  <img alt="UMA Logo" src="https://raw.githubusercontent.com/UMAprotocol/website/master/documents/press-kit/logos/01_PNG/red/uma_red.png" width="440">
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

Please see [here](https://docs.umaproject.org/dev-ref/bug-bounty) for details on our bug bounty.

## Contributing 🙌

Please see our [contributing guidelines](./CONTRIBUTING.md).

## Developer Information and Tools 👩‍💻

For detailed information on how to initialize and interact with our smart contracts, please see the
[documentation site](https://docs.umaproject.org).

### Install dependencies 👷‍♂️

You'll need to install the long-term support version of nodejs, currently nodejs v20. You will also need to install yarn. Assuming that's done, run `yarn` with no args:

```
yarn
```

If you'd like to completely clear all packages' `node_modules` and reinstall all deps from scratch, run:

```
yarn clean-packages
yarn
```

### Build the code 🧐

Some code in the repository requires a build step to compile it. To run this build step, use the `qbuild` (quick build) command:

```
yarn qbuild
```

The above command does not include dapps because dapps take a long time to build and they have their own scripts to run locally.
However, if you'd like to build _everything_, you can use the build command:

```
yarn build
```

To remove any remnants of previous builds, you can run:

```
yarn clean
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
one package, you can run:

```
yarn workspace <package_name> test
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

### Packages 📦

Because this repo is a monorepo, it contains many different npm packages. More will be discussed about these packages in the
following sections. However, the basic structure is that each package is listed in the `packages/` directory. Each package has
its own scripts and dependencies and operates (mostly) independently from the others.

### Adding dependencies 👩‍👦

All runtime/production dependencies should be added to the package that needs them. Development dependencies
should also generally be installed in packages unless they are needed by code that exists outside of any package.

For more details on packages and the monorepo, please see the next section.

To add a dependency to a package:

```
yarn workspace <package_name> add <dependency_name>
```

Note: development dependencies are those that are not required by the code that's published to the npm registry. If you're not
sure whether a dependency should be dev or not, just ask! To install a dev dependency in a package:

```
yarn workspace <package_name> add <dependency_name> --dev
```

Note: all root dependencies should be dev dependencies because the root package is not published to npm, so there is no "production" code.
To install a dev dependency at root:

```
yarn add <dependency_name> --dev
```

After you've installed a dependency, yarn should automatically update the `yarn.lock` file. If git doesn't notice any changes in that file,
run `yarn` to update the lockfile.

### Depending on another package in the monorepo 🤝

The standard way to pull a JS element from another package is to reference it like this:

```js
const { importedObject } = require("@uma/some-package")
```

Note: the require will resolve to the `main` file specified in the `package.json` file. If you'd like to import a different file, you
should ensure that that file is exported in the `files` directive inside the `package.json` file. Once you're sure of that, you can
import it using the following syntax:

```js
const { importedObject } = require("@uma/some-package/path/to/some/file")
```

Note: if this file isn't exported by the `files` directive, it will work locally, but fail when run via an npm installation.

To install this dependency you're using in `@uma/my-package`, you should run the following command:

```
yarn lerna add @uma/some-package --scope @uma/my-package
```

By default, this will symlink the package in `node_modules` rather than attempting to pull the package via npm. This allows
the packages to depend on the in-repo versions of one another. If you'd like to reference a particular version from npm,
you can specify that version exactly in the `package.json` file.

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
yarn workspace <package_name> <script>
```

For instance, this could be used to run the build command in the `@uma/core` package:

```
yarn workspace @uma/core build
```

or to install the truffle package as a devDependency in the `@uma/liquidator` package:

```
yarn workspace @uma/liquidator add truffle --dev
```

To run a package script in _every_ package that has a script by that name, you should use `lerna`:

```
yarn lerna run <script> --stream
```

Note: the stream argument is just to force lerna to stream the output so you get realtime logs, but it's not required.

### Coverage 🔎

We use the [solidity-coverage](https://github.com/sc-forks/solidity-coverage) package to generate our coverage reports.
You can find the coverage report at [coveralls](https://coveralls.io/github/UMAprotocol/protocol). Otherwise, you can generate it locally by running:

```
./ci/coverage.sh packages/core
```

The full report can be viewed by opening the `packages/core/coverage/index.html` file in a browser.

### Style Guide 🕺

See [STYLE.md](STYLE.md).

### Package Upgrade

The recommended way to upgrade a version number on any sub-package in this monorepo is to create a release for all candidate packages. To generate this release diff, run the following command and create a PR with the diff.

```
yarn create-release
```
