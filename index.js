const log = require("signale").scope("Core");
const MailWatcher = require("./lib/MailWatcher");
const fetch = require("node-fetch");
const TextOutputter = require("./lib/TextOutputter");
const assign = require("assign-deep");

const VERSION = require("./package.json").version;

let config = {
  username: "",
  password: "",

  host: "imap.gmail.com",
  port: 993,
  tls: true,
  secure: true,
  label: "INBOX",

  markSeen: false,

  outputFolder: "./stats",
  outputTemplates: {
    gps: "${position.lat},${position.lon}",
    dateTime: "${new Intl.DateTimeFormat().format(new Date(dateTime))}",
    altitudeInFeet: "${Math.round(altitude)}",
    altitudeInMetres: "${Math.round(altitude * 0.3048)}",
    speedInMph: "${Math.round(speed * 2.2369362920544025)}",
    speedInKph: "${Math.round(speed * 3.6)}",
    fitnessPointData: {
      distanceInMiles: "${Math.round(distanceMeters / 1609.34 * 10) / 10}",
      distanceInKilometers: "${Math.round(distanceMeters / 1000 * 10) / 10}",
      durationInHhmm:
        "${new Date(durationSecs * 1000).toISOString().substr(11, 5)}",
      durationInHhmmss:
        "${new Date(durationSecs * 1000).toISOString().substr(11, 8)}",
    },
  },

  refreshTimeInMilliseconds: 4000,
};

log.info(`Starting garmin-livetrack-obs v${VERSION}`);

try {
  assign(config, require("./config.js"));
} catch (e) {
  log.warn(
    "You should create an obs.config.js file based on the obs.config.js.sample template to overwrite the default values"
  );
}

const mailWatcher = new MailWatcher(config);

setInterval(async () => {
  if (!mailWatcher.sessionInfo.Id || !mailWatcher.sessionInfo.Token) {
    log.warn(
      "No Garmin Livetrack Session Id/Token available yet, will try again in 4 seconds"
    );
    return;
  }

  const url = `https://livetrack.garmin.com/services/session/${mailWatcher.sessionInfo.Id
    }/trackpoints?requestTime=${Date.now()}`;

  log.info(`Fetching ${url}`);
  const response = await fetch(url);

  if (response.status !== 200) {
    log.warn(
      "Invalid response received - The previous link may have expired and the new one hasn't been delivered yet?"
    );

    const data = await response.text();
    log.warn(`response: ${data}`);

    return;
  }

  const data = await response.json();
  // const data = require('./trackpoints.json');

  const latestData = data.trackPoints.pop();

  if (latestData != undefined) {
    // Ensure these fields exist since they're not in the data if there's no GPS fix
    latestData.speed = latestData.speed || 0;
    if (latestData.fitnessPointData) {
      latestData.fitnessPointData.speedMetersPerSec =
        latestData.fitnessPointData.speedMetersPerSec || 0;
    }
  }

  // Output full trackpoints.json for advanced users
  TextOutputter.OutputFile(config.outputFolder, "trackpoints.json", data);

  // Output individual fields from the given templates
  TextOutputter.OutputToTextFiles(
    config.outputFolder,
    config.outputTemplates,
    latestData
  );
}, config.refreshTimeInMilliseconds);


// decimalToTimeString converts minute decimal to time string
function decimalToTimeString(dec) {
  // if for some reason we receive an undefined val, just default to 0:00
  if (dec == undefined) {
    return "0:00"
  }

  // extract the whole number of minutes
  let min = Math.floor(dec)
  // extract the fractional part with modulo
  let fracSec = dec % 1
  // convert the fractional part to whole seconds and round
  let sec = Math.round(60 * fracSec)

  // handle case where whole minutes is >= 60
  if (min >= 60) {
    // extract the number of hours
    let hour = Math.floor(min / 60)
    // reset min to remaining number of minutes
    min = min % 60
    // return padded string of format `hh:mm:ss`
    return `${padNum(hour)}:${padNum(min)}:${padNum(sec)}`
  }

  // return padded string of format `mm:ss`
  // not including padding on minutes to avoid leading 0 with < 10 min pace
  return `${min}:${padNum(sec)}`
}

// padNum converts the incoming number to a padded number with lead
function padNum(input) {
  // if for some reason we receive an undefined val, just default to 00
  if (input == undefined) {
    return "00"
  }

  // convert number to string and add leading 0s up to a max of 2
  return input.toString().padStart(2, '0');
}