# UMA SDK

This package is meant as a low level cross platform utility library for viewing and interacting with UMA and other relevant contracts.

## Architecture

This is meant to be modular and add features as needed. This was bootstraped with TSDX, which you can find usage at the bottom of this file.

- [**clients**](./src/clients/README.md): are meant to be contract interaction clients that can lookup deployed contracts by network and return an ethers contract instance as well as parse events into useful state.
- [**stores**](./src/stores/README.md): are meant to be data shape agnostic classes for persistence or caching
- [**tables**](./src/tables/README.md): are classes which store tabular data, understand data shape and rely on stores for low level persistence
- [**utils**](./src/utils.ts): are meant to hold and expose useful utilities which can be shared and eventually promoted to their own modules
- [**across**](./src/across/README.md): supporting libraries for applications built on the across cross platform token transfer project.

Each folder should contain a README, index.ts and index.d.ts if needed which expose any code to the root of the SDK.

## Install

`yarn add @uma/sdk`

Or if running locally, checkout the protocol repo, and run `yarn link` inside the `packages/sdk` folder
Then inside your project type `yarn link @uma/sdk` to link to your local copy.

## Quick Start

```js
import * as uma from '@uma/sdk'

const { clients,stores,tables utils, across} = uma

const {Registry} = clients
const {JsMap, GoogleDatastore} = stores
const {blocks, base} = tables

// to see usage of each of these classes, see their individual readme within their directories.

```

## Building

This repo modifies the standard tsdx build process to support builds for frontend and node. Instances of `@uma/contracts-node` will
be replaced with `@uma/contracts-frontend` when using the `yarn build` command. To build frontend/node independently
you can run `build:web` or `build:node`. By default `yarn start` will start watching the node version of the sdk, and all
tests by default will run in the node context.

# TSDX User Guide

Congrats! You just saved yourself hours of work by bootstrapping this project with TSDX. Let’s get you oriented with what’s here and how to use it.

> This TSDX setup is meant for developing libraries (not apps!) that can be published to NPM. If you’re looking to build a Node app, you could use `ts-node-dev`, plain `ts-node`, or simple `tsc`.

> If you’re new to TypeScript, checkout [this handy cheatsheet](https://devhints.io/typescript)

## Commands

TSDX scaffolds your new library inside `/src`.

To run TSDX, use:

```bash
npm start # or yarn start
```

This builds to `/dist` and runs the project in watch mode so any edits you save inside `src` causes a rebuild to `/dist`.

To do a one-off build, use `npm run build` or `yarn build`.

To run tests, use `npm test` or `yarn test`.

## Configuration

Code quality is set up for you with `prettier`, `husky`, and `lint-staged`. Adjust the respective fields in `package.json` accordingly.

### Jest

Jest tests are set up to run with `npm test` or `yarn test`.

### Bundle Analysis

[`size-limit`](https://github.com/ai/size-limit) is set up to calculate the real cost of your library with `npm run size` and visualize the bundle with `npm run analyze`.

#### Setup Files

This is the folder structure we set up for you:

```txt
/src
  index.tsx       # EDIT THIS
/test
  blah.test.tsx   # EDIT THIS
.gitignore
package.json
README.md         # EDIT THIS
tsconfig.json
```

### Rollup

TSDX uses [Rollup](https://rollupjs.org) as a bundler and generates multiple rollup configs for various module formats and build settings. See [Optimizations](#optimizations) for details.

### TypeScript

`tsconfig.json` is set up to interpret `dom` and `esnext` types, as well as `react` for `jsx`. Adjust according to your needs.

## Continuous Integration

### GitHub Actions

Two actions are added by default:

- `main` which installs deps w/ cache, lints, tests, and builds on all pushes against a Node and OS matrix
- `size` which comments cost comparison of your library on every pull request using [`size-limit`](https://github.com/ai/size-limit)

## Optimizations

Please see the main `tsdx` [optimizations docs](https://github.com/palmerhq/tsdx#optimizations). In particular, know that you can take advantage of development-only optimizations:

```js
// ./types/index.d.ts
declare var __DEV__: boolean

// inside your code...
if (__DEV__) {
  console.log("foo")
}
```

You can also choose to install and use [invariant](https://github.com/palmerhq/tsdx#invariant) and [warning](https://github.com/palmerhq/tsdx#warning) functions.

## Module Formats

CJS, ESModules, and UMD module formats are supported.

The appropriate paths are configured in `package.json` and `dist/index.js` accordingly. Please report if any issues are found.

## Named Exports

Per Palmer Group guidelines, [always use named exports.](https://github.com/palmerhq/typescript#exports) Code split inside your React app instead of your React library.

## Including Styles

There are many ways to ship styles, including with CSS-in-JS. TSDX has no opinion on this, configure how you like.

For vanilla CSS, you can include it at the root directory and add it to the `files` section in your `package.json`, so that it can be imported separately by your users and run through their bundler's loader.

## Publishing to NPM

We recommend using [np](https://github.com/sindresorhus/np).
