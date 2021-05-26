# UMA SDK Stores

This contain classes which conform to a specific API for storing data to a specific type of technology.

## Stores

- [js-map](./js-map/README.md): a simple cache which wraps a Map to be a store
- [google-datastore](./google-datastore/README.md): wraps the google datastore client

## Types

```js
// Import from top level
import * as uma from '@uma/sdk'

// the main store interface
const store:uma.stores.Store = ...

// or within package
import {Store} from '../stores'

// the main store interface
const store:Store = ...
```

## Adding a store

Create a new folder named for the type of store technology you are adapting in the store's directory with the following files:

- README.md: Add some notes on what the store is for and what technology it is connecting with
- index.ts: Expose a single function which represents your store's constructor
- store.ts: Store logic which should expose a default function or class to instantiate the store
- store.test.ts: Any tests you want to run

### Store interface

Stores should try to conform to the interface defined [here](./index.ts). This will allow [tables](../tables/README.md)
to interoperate with the store seamlesly. See an example store [here](./js-map/store).

### Design Tips

- the name of the store's directory should reflect the underlying technology, ie: google-store, js-map, mongo, etc.
- consider injecting your specific database client into the constructor of the store, this makes it possible to
  mock this for testing later, and lets the user instantiate this outside your class.
- the interface is modeled from a JS Map, so keep in mind this should simply act like a key value store.
