# Style Guide

## Solidity

### Correct Solhint Errors and Warnigns

Solhint mostly follows the [official solidity style guide](https://solidity.readthedocs.io/en/latest/style-guide.html),
but where they contradict one another, we conform to Solhint. For more information on how to install and run the
Solhint linter, please see [the README](README.md#solhint---solidity-linter).

### Follow the [Official Solidity Style Guide](https://solidity.readthedocs.io/en/latest/style-guide.html)

Solhint doesn't check for all style violations. Where it doesn't, we follow the official solidity style guide. For
example, Solhint doesn't care about exactly how hanging indents are done. The solidity style guide indicates that they
should all have one more indent than the first line. We follow the solidity style guide and use a single hanging
indent.

### Ordering Stuff

#### Functions

Solhint enforces that functions are ordered by:

1. Constructor
2. External
3. Public
4. Internal
5. Private

In addition to this ordering by function privacy, within each of these 5 groups there are additional
rules:

1. All abstract functions should precede all concrete functions
2. Within the abstract/concrete groups, view/pure functions should come after other functions (in that order)
3. Finally, sort each group of functions (e.g. external abstract, external abstract view...) alphabetically.
4. If two functions share a name, alphabetically order by the type of the arguments

#### Enums/Structs

Enums/Structs that will be used within the contract should be declared prior to everything

#### Variables

All variables should be declared immediately following the enums/structs. These should also be
grouped by their privacy level. Public variables first then private. Order in a sensible way, but
that might not be alphabetically.

## Javascript

TODO
