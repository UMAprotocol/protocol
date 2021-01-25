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
export function createObjectFromDefaultProps(overrideProps?: any, defaultProps: any): {};
