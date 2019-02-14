import React from "react";
import { withStyles } from "@material-ui/core/styles";
import Button from "@material-ui/core/Button";
import Dialog from "@material-ui/core/Dialog";
import DialogContent from "@material-ui/core/DialogContent";
import DialogTitle from "@material-ui/core/DialogTitle";
import InputLabel from "@material-ui/core/InputLabel";
import FormControl from "@material-ui/core/FormControl";
import MenuItem from "@material-ui/core/MenuItem";
import Select from "@material-ui/core/Select";
import TextField from "@material-ui/core/TextField";

const styles = theme => ({
  root: {
    display: "flex",
    flexDirection: "column"
  },
  submitButton: {
    marginTop: "10px"
  }
});

class CreateContractModal extends React.Component {
  state = {
    address: "",
    leverage: "",
    asset: "",
    symbol: ""
  };

  submit = () => {
    this.props.onClose();
  };

  render() {
    const { classes } = this.props;
    return (
      <Dialog open={this.props.open} onClose={this.props.onClose}>
        <DialogTitle>Create New Token Contract</DialogTitle>
        <DialogContent>
          <form className={classes.root} autoComplete="off">
            <FormControl>
              <InputLabel htmlFor="create-contract-address">Address</InputLabel>
              <Select value={this.state.address} inputProps={{id: 'create-contract-address'}}>
                <MenuItem value="0">0xABCD</MenuItem>
                <MenuItem value="1">0x1234</MenuItem>
                <MenuItem value="2">0x4567</MenuItem>
              </Select>
            </FormControl>
            <FormControl>
              <InputLabel htmlFor="create-contract-leverage">Leverage</InputLabel>
              <Select value={this.state.leverage} inputProps={{id: 'create-contract-leverage'}}>
                <MenuItem value="1">unlevered</MenuItem>
                <MenuItem value="2">2x</MenuItem>
              </Select>
            </FormControl>
            <FormControl>
              <InputLabel htmlFor="create-contract-asset">Asset Type</InputLabel>
              <Select value={this.state.asset} inputProps={{id: 'create-contract-asset'}}>
                <MenuItem value="OILUSD">OIL/USD</MenuItem>
                <MenuItem value="SPYUSD">SPY/USD</MenuItem>
                <MenuItem value="CNHUSD">CNH/USD</MenuItem>
              </Select>
            </FormControl>
            <TextField
              id="contract-name"
              label="Contract Name"
              value={this.state.name}
            />
            <TextField
              id="contract-symbol"
              label="Contract Symbol"
              value={this.state.symbol}
            />
          </form>
          <Button variant="contained" color="primary" className={classes.submitButton} onClick={this.submit}>Create Contract</Button>
        </DialogContent>
      </Dialog>
    )
  }
}

export default withStyles(styles)(CreateContractModal);
