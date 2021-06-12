# Erc20 Table

Stores basic information for erc20 tokens, keyed by token address.

## Usage

See [tests](./js-map.test.ts) for more example usage.

```js
import * as uma from "@uma/sdk"

const table = uma.tables.erc20s.JsMap()
type Data = uma.tables.erc20s.Data

const entry: Data = { address: "0xeca82185adCE47f39c684352B0439f030f860318" }
const result: Data = await tables.create(entry)
```

## Types

Found in [utils.ts](./utils.ts)

```js
import type * as uma from "@uma/sdk";
type Erc20Type = uma.tables.erc20s.Data;
```
