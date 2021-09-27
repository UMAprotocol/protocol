# UMA SDK Historical Prices Table

This table uses a sorted key value under the hood so that you can add time series price data. You may need the flexibility to define your own price structure
and identification mapping, in this case use the [generic](../generic/README.md) table which requires you provide these explicitly.

## Key Design

For this particular table, only timestamp is considered as part of the key. Timestamp will be converted into a string, and padded with '0' in order to guarantee strings are the same length.

## Usage

See [tests](./js-map.test.ts) for more example usage.

```js
import { stores, tables } from "@uma/sdk"
const Table = tables.prices.Table

const table = Table()

const data = {
  timestamp: 10,
  price: "100",
}

const result: tables.prices.Data = await table.create(data)
// { id: '000000000000000000000010', timestamp: 10, price: '100' }

// see libs/store/index.ts interface for all calls
```

## Types

Found in [utils.ts](./utils.ts)

```js
import type * as uma from "@uma/sdk";
type Price = uma.tables.prices.Data;
```
