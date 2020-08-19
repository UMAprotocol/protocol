import { useEffect } from "react";
import { drizzleReactHooks } from "@umaprotocol/react-plugin";

// This component is just a wrapper to trigger a callback once drizzle has been initialized.
// It must be a separate component to allow useDrizzleState to only be called after the user has initiated the login
// flow.
function DrizzleInit(props) {
  const { initializationFinished } = props;

  const drizzleState = drizzleReactHooks.useDrizzleState(drizzleState => {
    return {
      initialized: drizzleState.drizzleStatus.initialized
    };
  });

  useEffect(() => {
    // Once drizzle is initialized, trigger the callback.
    if (drizzleState.initialized) {
      initializationFinished();
    }
  }, [initializationFinished, drizzleState]);

  return "";
}

export default DrizzleInit;
