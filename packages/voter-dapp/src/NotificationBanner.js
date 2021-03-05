import React from "react";
import AppBar from "@material-ui/core/AppBar";
import Toolbar from "@material-ui/core/Toolbar";
function NotificationBanner({ text = "Add your text", children }) {
  return (
    <AppBar color="primary" position="static">
      <Toolbar>{children}</Toolbar>
    </AppBar>
  );
}

export default NotificationBanner;
