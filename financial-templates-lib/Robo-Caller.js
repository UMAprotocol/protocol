require("dotenv").config();
const { Logger } = require("./Logger");

class RoboCaller {
  constructor() {
    if (
      process.env.TWILIO_SID == "" || // require the account SID
      process.env.TWILIO_AUTH == "" || // require the account authentication key
      process.env.DRI_NUMBER1 == "" || // require at least 1 number to call
      process.env.TWILIO_FROM_NUMBER == "" // require the number to originate the call from
    ) {
      Logger.debug({
        at: "RoboCaller",
        message: "Missing config variable. RoboCaller Disabled"
      });
    } else {
      this.client = require("twilio")(process.env.TWILIO_SID, process.env.TWILIO_AUTH);

      this.numbersToCall = [];
      for (const envVariable in process.env) {
        if (envVariable.startsWith("DRI_NUMBER")) {
          this.numbersToCall.push(process.env[envVariable]);
        }
      }
      Logger.debug({
        at: "RoboCaller",
        message: "Client configured",
        numbersToCall: this.numbersToCall,
        fromNumber: process.env.TWILIO_FROM_NUMBER
      });
    }
  }
  canPlaceCall = () => {
    return this.client != undefined;
  };
  placeCall = async message => {
    if (!this.canPlaceCall) {
      Logger.debug({
        at: "RoboCaller",
        message: "Incorrectly configured! Cant place call"
      });
      return;
    }
    Logger.debug({
      at: "RoboCaller",
      message: "Placing calls",
      numbersToCall: this.numbersToCall
    });
    for (const number of this.numbersToCall) {
      try {
        const callResponse = await this.client.calls.create({
          twiml: this.generateTwiML(message),
          to: number,
          from: process.env.TWILIO_FROM_NUMBER
        });
        console.log("async responce");
        console.log(callResponse);
        Logger.debug({
          at: "RoboCaller",
          message: "call placed",
          accountSid: callResponse.accountSid,
          sid: callResponse.sid,
          from: callResponse.fromFormatted,
          to: callResponse.toFormatted
        });
      } catch (error) {
        Logger.debug({
          at: "RoboCaller",
          message: "Failed to place a call",
          to: number,
          from: process.env.TWILIO_FROM_NUMBER,
          error: error
        });
      }
    }
  };
  generateTwiML = message => {
    return `<Response>
            <Say voice="alice">${message}</Say>
        </Response>`;
  };
}

module.exports = { RoboCaller };
