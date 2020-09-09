import React, { useState, useEffect } from "react";
import { drizzleReactHooks } from "@umaprotocol/react-plugin";
import { Drizzle, generateStore } from "@umaprotocol/store";
import drizzleOptions from "./drizzleOptions";
import Button from "@material-ui/core/Button";
import DrizzleInit from "./DrizzleInit.js";

function DrizzleLogin(props) {
  const [isButtonDisabled, setButtonDisabled] = useState(false);
  const [drizzle, setDrizzle] = useState(null);
  const [hasMetamask, setHasMetamask] = useState(false);

  const getMetamask = () => {
    window.open("https://metamask.io/", "_blank");
  };

  const loginFn = () => {
    // Disable the button immediately after pressing.
    setButtonDisabled(true);

    // Send the enable request to metamask (or other provider).
    window.ethereum.enable().then(
      () => {
        // After the enable call comes back successfully, initialize drizzle.
        const drizzleStore = generateStore(drizzleOptions);
        const drizzle = new Drizzle(drizzleOptions, drizzleStore);
        setDrizzle(drizzle);

        // Note: don't re-enable the button because the request was accepted and we don't want them to fire it again.
      },
      error => {
        console.log("Error in login: " + error);

        // Re-enable the button so the user can attempt to log in a second time.
        setButtonDisabled(false);
      }
    );
  };

  let buttonJsx = (
    <Button variant="contained" color="primary" disabled={isButtonDisabled} onClick={loginFn}>
      Connect to Your Ethereum Wallet
    </Button>
  );

  let getMetamaskButtonJsx = (
    <Button variant="contained" color="secondary" onClick={getMetamask}>
      Get Metamask
    </Button>
  );

  // This useEffect will only run on the first render.
  // It's a hack to detect whether the user has previously connected. If this is true, we should intantly initiate the
  // login flow since metamask will not require them to press the connect button.
  useEffect(() => {
    if (window.ethereum == null) return;
    setHasMetamask(true);
    if (window.ethereum.selectedAddress) {
      loginFn();
    }
  }, []);

  // Centers the div.
  const divStyle = { display: "flex", justifyContent: "center", alignItems: "center", height: "100vh" };

  if (drizzle) {
    // TODO: add some sort of loading icon as opposed to just a disabled button.
    return (
      <div style={divStyle}>
        {buttonJsx}
        <drizzleReactHooks.DrizzleProvider drizzle={drizzle}>
          <DrizzleInit initializationFinished={() => props.setParentDrizzle(drizzle)} />
        </drizzleReactHooks.DrizzleProvider>
      </div>
    );
  } else {
    if (hasMetamask) {
      return <div style={divStyle}>{buttonJsx}</div>;
    } else {
      return <div style={divStyle}>{getMetamaskButtonJsx}</div>;
    }
  }
}

export default DrizzleLogin;
