class RoboCaller {
  constructor(params) {
    if (
      !params.twilioSid || // require the account SID
      !params.twilioAuth || // require the account authentication key
      !params.twilioFrom || // require the number to originate the call from
      !params.twilioCallNumbers // require at least 1 number to call
    ) {
      console.error("Missing config variable. RoboCaller Disabled");
      return;
    }
    this.client = require("twilio")(params.twilioSid, params.twilioAuth);

    this.twilioFrom = params.twilioFrom;
    this.twilioCallNumbers = params.twilioCallNumbers;
  }
  canPlaceCall = () => {
    return this.client != undefined;
  };
  placeCall = async message => {
    if (!this.canPlaceCall) {
      console.log("cant place call");
      return;
    }

    for (const number of this.twilioCallNumbers) {
      try {
        const callResponse = await this.client.calls.create({
          twiml: this.generateTwiML(message),
          to: number,
          from: this.twilioFrom
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
