# @uma/logger

This package contains various clients and helpers to interact with UMA's financial templates. It is primarily used to
power the disputer, liquidator, and monitor bots.

## Installing the package

```bash
yarn add @uma/logger
```

## Importing the package

The [Logger](./src/logger) directory contains helpers and factories for logging with Winston. To get the default
logger:

```js
const { Logger, createPriceFeed, Networker } = require("@uma/logger");

// A winston logger is required for createPriceFeed, networker and other objects in logger.
const networker = new Networker(Logger);
const priceFeed = createPriceFeed(Logger, web3, networker, ...);

// You can also log directly using the winston logger.
Logger.debug({
    at: "createPriceFeed",
    message: "Creating CryptoWatchPriceFeed",
    otherParam: 5
});
```

## Helpers

There are two helper files that are available in logger:

- [delay.js](./src/helpers/delay.js): simple file containing a function to "sleep".
