# UMA Sdk EMP Table

This table is meant to store emp state data. It will use typescript to ensure you supply valid data.

## Usage

```js
import { stores, tables } from '@uma/sdk'
const empTable:table.emps.Table = tables.emps.Table()

const data:table.emps.Data = await empTable.create({
  address:// ...emp address
})
// returns data = { id:address, address }
```

## Types

Found in [utils.ts](./utils.ts)

```js
import type * as uma from "@uma/sdk";
type Emp = uma.tables.emps.Data;
```
