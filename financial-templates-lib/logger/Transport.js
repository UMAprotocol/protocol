// This module generates transport objects for the winston logger to push messages to.
// Primarily this module separates the logic for reading in state environment variables
// from the logger itself. All Winston transport objects and their associated formatting
// are created within this module.

// Transport objects
const ConsoleTransport = require("./ConsoleTransport");
const SlackTransport = require("./SlackTransport");
const TwilioTransport = require("./TwilioTransport");

require("dotenv").config();

// transports array to store all winston transports
let transports = [];

// add a console transport to log to the console.
transports.push(ConsoleTransport.createConsoleTransport());

// If there is a slack web hook, add to the transports array to enable slack messages.
if (process.env.SLACK_WEBHOOK) {
  transports.push(SlackTransport.createSlackTransport(process.env.SLACK_WEBHOOK));
}

// If all the required environment variables for twilio are added, add the transport array.
if (process.env.TWILIO_SID && process.env.TWILIO_AUTH && process.env.DRI_NUMBER1 && process.env.TWILIO_FROM_NUMBER) {
  // read in the numbers to call from the environment variables. Each number is prefaced by a DRI_NUMBER
  let numbersToCall = [];
  for (const envVariable in process.env) {
    if (envVariable.startsWith("DRI_NUMBER")) {
      numbersToCall.push(process.env[envVariable]);
    }
  }

  transports.push(
    new TwilioTransport(
      {
        level: "error" // note that twilio will only report on error. levels
      },
      {
        twilioSid: process.env.TWILIO_SID,
        twilioAuth: process.env.TWILIO_AUTH,
        twilioFrom: process.env.TWILIO_FROM_NUMBER,
        twilioCallNumbers: numbersToCall
      }
    )
  );
}

module.exports = { transports };
