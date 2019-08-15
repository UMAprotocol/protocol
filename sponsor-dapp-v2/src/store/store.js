/**
 * @ External Dependencies
 */
import { createStore, combineReducers, applyMiddleware } from 'redux';
import thunk from 'redux-thunk';

/**
 * @ Reducers
 */
import commonData from './state/data/reducer';
import positionsData from './state/positions/reducer';
import stepsData from './state/steps/reducer';

/**
 * @ Root Reducer
 */

const rootReducer = combineReducers({
	commonData,
	positionsData,
	stepsData
});

export default createStore(rootReducer, applyMiddleware(thunk));
