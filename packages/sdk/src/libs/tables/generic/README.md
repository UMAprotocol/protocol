# Uma Generic Tables

This is a table class you can use with your own custom data structure and store. It contains functionality that
would commonly be used by tables in general, so typically you wouldnt use this directly.

## Usage

```js
import type { Data } from "."
import { JsMap } from "../generic"

export default (type: string = "Block") => {
  function makeId(data: Data) {
    return data.number
  }
  return JsMap < number, Data > (type, makeId)
}
```

## Types

Generic tables are typed to a specific store. Currently only the [js-map](./js-map.ts) table exists.
