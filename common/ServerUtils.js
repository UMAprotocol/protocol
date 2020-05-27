const express = require("express");

// Starts a simple server that exposes one GET route that can be called by an external party to monitor this
// bot's uptime. Returns the Server node or throws.
/**
 * @notice Starts a simple server with one route. Designed to be used as a health status server that an external
 * monitor can check periodically to see if a parent process is alive.
 * @param {Number} [port] Server to listen on this port number. If `port` is omitted or is 0, the operating system
 * will assign an arbitrary unused port, which is useful for cases like automated tasks (tests, etc.).
 * Source: https://expressjs.com/en/4x/api.html#app.listen
 * @return server The newly constructed server node. API: https://nodejs.org/api/http.html#http_class_http_server.
 * @return portNumber The port number the new server is listening on.
 */
const startServer = port => {
  const app = express();

  // Define routes.
  app.get("/", (req, res) =>
    res.status(200).json({
      message: "Bot is up"
    })
  );
  //
  // source: https://expressjs.com/en/4x/api.html#app.listen
  const server = app.listen(port);
  const portNumber = server.address().port;

  return {
    server,
    portNumber
  };
};

module.exports = {
  startServer
};
