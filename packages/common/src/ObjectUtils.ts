// Contains helpful methods for interacting with the Object data type.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ObjectType = { [key: string]: any };

/**
 * @notice Given `overrideProps` and `defaultProps` Objects, returns a new Object, `newObject`,
 * with the same properties as `defaultProps`, but replaces any property values that overlap with
 * those also contained in `overrideProps`. Performs validation tests on all `newObject` properties, as specified
 * by `defaultProps`.
 * @dev Throws an Error if any validation tests fail.
 * @param {Object} [overrideProps] specifies property values in newly created Object that should differ from
 * those contained in `defaultProps`.
 * @param {Object{Object, Function}} defaultProps its properties will be the same as the newly created Object, but each
 * property itself is an Object that has `value` and `isValid` properties. The `value` determine the default values of
 * the new Object and `isValid` will be called to validate each of `newObject`'s properties.
 * @return `newObject` a new Object with the same properties as `defaultProps`, or `defaultProps` if undefined `overrideProps`.
 */
export const createObjectFromDefaultProps = (overrideProps: ObjectType, defaultProps: ObjectType): ObjectType => {
  if (!defaultProps) {
    throw new Error("Undefined `defaultProps`");
  }

  if (!overrideProps) {
    overrideProps = {};
  }

  const newObject: ObjectType = {};

  Object.keys(defaultProps).forEach((prop) => {
    // Set property value to that contained in `overrideProps` if it exists, else set to `defaultProps`.
    newObject[prop] = prop in overrideProps ? overrideProps[prop] : defaultProps[prop].value;

    if (!("isValid" in defaultProps[prop])) {
      throw new Error(`Property (${prop}) must define an "isValid" method`);
    }

    // Validate property value, regardless if coming from `overrideProps` or `defaultProps`.
    if (!defaultProps[prop].isValid(newObject[prop])) {
      throw new Error(`Attempting to set configuration field with invalid value on ${prop}`);
    }
  });

  return newObject;
};

/**
 * @notice Given an`object`, and a `mapFn`, returns a new Object having applied the mapping function to each element in
 * the `object`. Analogous to Array.prototype.map(), but for Objects.
 * @param {object} the Object to map over.
 * @param {mapFn} the mapping function to apply to each element in the `object`.
 * @returns {object} new Object with the same keys as the `object`, but each value is the result of applying the mapFn.
 */
export const objectMap = <T extends Record<string, unknown>, U>(
  object: T,
  mapFn: (arg: T[keyof T]) => U
): { [Property in keyof T]: U } => {
  return (Object.keys(object) as (keyof T)[]).reduce(function (result, key) {
    result[key] = mapFn(object[key]);
    return result;
  }, {} as { [Property in keyof T]: U });
};

/**
 * @notice Type checks if the given input is a JavaScript object (not null) with string keys and unknown values.
 * @param {unknown} input - The input to check.
 * @returns {boolean} `true` if the input is a valid Record<string, unknown>, otherwise `false`.
 */
export const isRecordStringUnknown = (input: unknown): input is Record<string, unknown> => {
  return (
    typeof input === "object" &&
    input !== null &&
    !Array.isArray(input) &&
    Object.keys(input).every((key) => typeof key === "string")
  );
};

module.exports = { createObjectFromDefaultProps, objectMap, isRecordStringUnknown };
