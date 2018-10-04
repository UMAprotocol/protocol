import React from "react";
import ListItem from "@material-ui/core/ListItem";
import ListItemIcon from "@material-ui/core/ListItemIcon";
import ListItemText from "@material-ui/core/ListItemText";
import AssignmentIcon from "@material-ui/icons/Assignment";
import AddIcon from "@material-ui/icons/Add";

export const mainListItems = obj => {
  var setState = (obj, state) => {
    return () => {
      obj.setState({ page: state });
    };
  };
  return (
    <div>
      <ListItem button onClick={setState(obj, "list")}>
        <ListItemIcon>
          <AssignmentIcon />
        </ListItemIcon>
        <ListItemText primary="Outstanding Contracts" />
      </ListItem>
      <ListItem button onClick={setState(obj, "new_contract")}>
        <ListItemIcon>
          <AddIcon />
        </ListItemIcon>
        <ListItemText primary="New Contract" />
      </ListItem>
    </div>
  );
};
