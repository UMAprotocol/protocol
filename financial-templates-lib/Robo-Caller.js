require("dotenv").config();

class RoboCaller {
  constructor() {
    if (
      (process.env.TWILIO_SID, // require the account SID
      process.env.TWILIO_AUTH, // require the account authentication key
      process.env.DRI_NUMBER1, // require at least 1 number to call
      process.env.TWILIO_FROM_NUMBER) // require the number to originate the call from
    ) {
      console.error("Missing config variable. RoboCaller Disabled");
      return;
    }
    this.client = require("twilio")(process.env.TWILIO_SID, process.env.TWILIO_AUTH);

    this.numbersToCall = [];
    for (const envVariable in process.env) {
      if (envVariable.startsWith("DRI_NUMBER")) {
        this.numbersToCall.push(process.env[envVariable]);
      }
    }
  }
  canPlaceCall = () => {
    return this.client != undefined;
  };
  placeCall = async message => {
    if (!this.canPlaceCall) {
      console.log("cant place call");
      return;
    }

    for (const number of this.numbersToCall) {
      try {
        const callResponse = await this.client.calls.create({
          twiml: this.generateTwiML(message),
          to: number,
          from: process.env.TWILIO_FROM_NUMBER
        });
      } catch (error) {
        console.error("something went wrong", error);
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
