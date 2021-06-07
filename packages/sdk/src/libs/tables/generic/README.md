# Uma Generic Tables

This is a table class you can use with your own custom data structure. It contains functionality that
would commonly be used by tables in general, so typically you wouldnt use this directly.

## Usage

```js
import * as uma from '@uma/sdk'

// custom data
type Data = {
  id: string;
  name: string;
  email: string;
}
// custom id function
function makeId(data: Data) {
  return data.id;
}
const usersTable = uma.tables.generic.JsMap<string, Data>('User',makeId)
// use users table like a regular typed table now
```

## Types

Generic tables are typed to a specific store. Currently support:

- [js-map](./js-map.ts)
- [sorted-js-map](./sorted-js-map.ts)
