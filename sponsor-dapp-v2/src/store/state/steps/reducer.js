/**
 * @ External Dependencies
 */
import { handleActions } from 'redux-actions';

/**
 * @ Actions
 */
import {
	fetchFirstStepsSuccess,
	fetchFirstStepsError,
	fetchLastStepsSuccess,
	fetchLastStepsError
} from './actions';

/**
 * @ Reducer
 */

const defaultState = {
	firstSteps: null,
	firstStepsError: false,
	lastSteps: null,
	lastStepsError: false
};

/**
 * Actions Handler
 *
 * @type       {Function}
 */
const stepsData = handleActions(
	{
		[fetchFirstStepsSuccess]: (state, { payload }) => ({
			...state,
			firstSteps: payload,
			firstStepsError: false
		}),
		[fetchFirstStepsError]: (state, { payload }) => ({
			...state,
			firstStepsError: true
		}),

		[fetchLastStepsSuccess]: (state, { payload }) => ({
			...state,
			lastSteps: payload,
			lastStepsError: false
		}),
		[fetchLastStepsError]: (state, { payload }) => ({
			...state,
			lastStepsError: true
		})
	},
	defaultState
);

export default stepsData;
