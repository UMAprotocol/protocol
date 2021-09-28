# Blocks Table

Defines an ethereum block type and returns a base table typed to that. Currently exposes a js-map compatible table.

## Usage

See [tests](./js-map.test.ts) for more example usage.

```js
import { stores, tables } from "@uma/sdk"
const Table = tables.blocks.Table

const table = tables.blocks.Table()
type Data = tables.blocks.Data

const entry: Data = { number: "100" }
const result: Data = await tables.create(entry)
```

## Types

Found in [utils.ts](./utils.ts)

```js
import type * as uma from "@uma/sdk";
type Block = uma.tables.blocks.Data;
```
