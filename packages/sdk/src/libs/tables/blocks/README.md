# Blocks Table

Defines an ethereum block type and returns a base table typed to that. Currently exposes a js-map compatible table.

## Usage

See [tests](./js-map.test.ts) for more example usage.

```js
import * as uma from "@uma/sdk"
const Table = uma.tables.blocks.JsMap

const table = uma.tables.blocks.JsMap()
type Data = uma.tables.blocks.Data

const entry: Data = { number: "100" }
const result: Data = await tables.create(entry)
```

## Types

Found in [utils.ts](./utils.ts)

```js
import type * as uma from "@uma/sdk";
type Block = uma.tables.blocks.Data;
```
