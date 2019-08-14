import deepEqual from "deep-equal";

export function createExpandedPromise() {
  let resolutionFn;
  let expandedPromise;

  expandedPromise = new Promise((resolve, reject) => {
    resolutionFn = value => {
      if (expandedPromise.isResolved) {
        throw new Error("Promise is already resolved");
      }
      expandedPromise.resolvedValue = value;
      expandedPromise.isResolved = true;
      resolve(value);
    };
  });

  expandedPromise.resolve = resolutionFn;
  expandedPromise.isResolved = false;
  return expandedPromise;
}

export function resolveOrReplaceExpandedPromise(value, expandedPromise, replaceExpandedPromise) {
  if (!expandedPromise.isResolved) {
    // If the promise is unresolved, resolve it.
    expandedPromise.resolve(value);
    return;
  }

  if (expandedPromise.resolvedValue === value || deepEqual(expandedPromise.resolvedValue, value)) {
    // Resolved value matches old value, do nothing.
    return;
  }

  // Replace the promise and resolve it since there is a new value.
  let replacementPromise = createExpandedPromise();
  replacementPromise.resolve(value);
  replaceExpandedPromise(replacementPromise);
}

// module.exports = {
//   createExpandedPromise,
//   resolveOrReplaceExpandedPromise
// };
