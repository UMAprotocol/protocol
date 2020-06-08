# Style Guide

This guide covers the preferred style guidelines for the `protocol` repo. If a rule is not listed here, you are
encouraged to follow whatever the most accepted or idiomatic rule is for that language and scenario.

## Solidity

### Correct Solhint Errors and Warnigns

Solhint mostly follows the [official solidity style guide](https://solidity.readthedocs.io/en/latest/style-guide.html),
but where they contradict one another, we conform to Solhint. For more information on how to install and run the Solhint
linter, please see [the README](README.md#solhint---solidity-linter).

### Follow the [Official Solidity Style Guide](https://solidity.readthedocs.io/en/latest/style-guide.html)

Solhint doesn't check for all style violations. Where it doesn't, we follow the official solidity style guide. For
example, Solhint doesn't care about exactly how hanging indents are done. The solidity style guide indicates that they
should all have one more indent than the first line. We follow the solidity style guide and use a single hanging indent.

### Ordering

#### Enums/Structs

Enums/Structs that will be used within the contract should be declared prior to everything.

#### Variables

All variables should be declared immediately following the enums/structs. Variables should be sorted by visibility like
functions (see the `Functions` section for details). Instead of sorting alphabetically within visibility groups,
however, related variables should be grouped together.

#### Functions

Functions should follow variable declarations. Solhint enforces that functions are ordered by:

1. Constructor
2. External
3. Public
4. Internal
5. Private

In addition to this ordering by function privacy, within each of these 5 groups there are additional
rules:

1. All abstract functions should precede all concrete functions.
2. Within the abstract/concrete groups, view/pure functions should come after other functions (in that order).
3. Sort each group of functions (e.g. external abstract, external abstract view...) alphabetically.
4. If two functions share a name, alphabetically order by the arguments (both type and name).

### Naming

#### Interval versus External Functions

In all contracts (abstract included), private and internal methods are preceded by underscores (i.e. `_functionNameHere()`). This does not apply to libraries or test contracts. As a general rule, if the function is able to be called in a downstream script or client, then it is not an internal method.

#### Variables

Private variables are not preceded by underscores.

#### Function Parameters

Function parameters are not preceded by underscores unless they are constructor parameters. This is because constructors often initialize contract variables for the first and only time.

### Comments

We follow the official Soldity style guide and use the ["Ethereum Natural Language Specification Format" or "NatSpec"](https://solidity.readthedocs.io/en/latest/style-guide.html#natspec). We choose to apply this only to public methods. If internal methods require documentation, we prefer to use single line (`//`) format comments.

## Javascript

### Function Declarations

If the implementation does not _require_ a specific type of function declaration, the following guidelines should be
used.

When the function is named and declared at the file-level or class-level scope, it should be declared as a
"traditional" or "normal" function:

```js
function name(arg1, arg2) {
  // Function body
}
```

When a function is declared within another function, some tighter non-class scope, or is anonymous, it should use the "arrow" style:

```js
const name = (arg1, arg2) => {
  // Function body
}
```
