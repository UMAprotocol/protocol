import React, { Component } from "react";
import { DrizzleContext } from "drizzle-react";
import "./App.css";
import DerivativeList from "./DerivativeList.js";

class App extends Component {
  render() {
    return (
      <DrizzleContext.Provider drizzle={this.props.drizzle}>
        <DrizzleContext.Consumer>
          {drizzleContext => {
            const { drizzle, initialized, drizzleState } = drizzleContext;

            // If drizzle hasn't gotten any state, don't load the application.
            if (!initialized) {
              return "Loading...";
            }

            return <DerivativeList drizzle={drizzle} drizzleState={drizzleState} />;
          }}
        </DrizzleContext.Consumer>
      </DrizzleContext.Provider>
    );
  }
}

export default App;
