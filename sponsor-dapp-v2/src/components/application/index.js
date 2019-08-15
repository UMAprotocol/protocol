import React, { Component } from 'react';
import { connect } from 'react-redux';
import { Switch, Route, withRouter } from 'react-router-dom';
import { TransitionGroup, CSSTransition } from 'react-transition-group';

import routes from 'lib/routes';

import { fetchAllPositions } from 'store/state/positions/actions';

class App extends Component {
    componentDidMount() {
        this.props.fetchAllPositions();
    }

    render() {
        const { location } = this.props;

        return (
            <div className="App">
                <TransitionGroup>
                    <CSSTransition
                        key={location.key}
                        timeout={{ enter: 300, exit: 300 }}
                        classNames={'fade'}
                    >
                        <Switch>
                            {routes.map(route => (
                                <Route key={route.path} {...route} />
                            ))}
                        </Switch>
                    </CSSTransition>
                </TransitionGroup>
            </div>
        );
    }
}

export default withRouter(
    connect(
        state => ({
            isLocked: state.commonData.isLocked,
            landingPositions: state.positionsData.landingPositions,
            managePositions: state.positionsData.managePositions
        }),
        {
            fetchAllPositions
        }
    )(App)
);
