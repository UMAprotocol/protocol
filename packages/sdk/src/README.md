## UMA SDK SRC

This contains all non application code, meant to be composed in your app or other libraries. The code is generally
classified into a few major types:

- [stores](./stores/README.md): technology specific adapters which persist data, databases, caches, etc. These inherit a very similar interface to a JS Map
- [tables](./tables/README.md): data specific classes which rely on stores for persistence. These model data by a schema, and fit them into tables with unique identifiers.
- [clients](./clients/README.md): contract specific classes with helper functions for finding addresses, connecting and query state.
- [utils](./utils.ts): catch all place for code that is shared across the sdk.
