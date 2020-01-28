import React from "react";
import { Switch, Route, withRouter } from "react-router-dom";
import { TransitionGroup, CSSTransition } from "react-transition-group";

import routes from "lib/routes";

import { drizzleReactHooks } from "@umaprotocol/react-plugin";
import { useInitializeGoogleAnalytics } from "lib/google-analytics";

function App(props) {
  useInitializeGoogleAnalytics();

  const isDrizzleInitialized = drizzleReactHooks.useDrizzleState(drizzleState => ({
    initialized: drizzleState.drizzleStatus.initialized
  })).initialized;

  if (!isDrizzleInitialized) {
    return (
      <>
        <div>Loading</div>
        <div style={{ marginTop: "50px" }}>
          If this page doesn't refresh automatically, please make sure you're connected to the Rinkeby testnet and are
          using Chrome and Metamask.
        </div>
      </>
    );
  }

  const { location } = props;
  return (
    <div className="App">
      <TransitionGroup>
        <CSSTransition
          key={location.key}
          timeout={{ enter: 300, exit: 300 }}
          classNames={"fade"}
          onExit={node => {
            if (node) {
              node.style.position = "fixed";
              node.style.width = "100%";
              node.style.top = -1 * window.scrollY + "px";
            }
          }}
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

export default withRouter(App);
