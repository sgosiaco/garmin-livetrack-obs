const log = require("signale").scope("Core");
const MailWatcher = require("./lib/MailWatcher");
const fetch = require("node-fetch");
const TextOutputter = require("./lib/TextOutputter");
const assign = require("assign-deep");
const fs = require('fs');

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
    speedInKph: "${(speed * 3.6).toFixed(1)}km/hr",
    fitnessPointData: {
      distanceInMiles: "${Math.round(distanceMeters / 1609.34 * 10) / 10}",
      distanceInKilometers: "${Math.round(distanceMeters / 1000 * 10) / 10}",
      durationInHhmm:
        "${new Date(durationSecs * 1000).toISOString().substr(11, 5)}",
      durationInHhmmss:
        "${new Date(durationSecs * 1000).toISOString().substr(11, 8)}",
    },
  },
  paceOutput: "$formattedResult",

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
    log.warn("No Garmin Livetrack Session Id/Token available yet, will try again in 4 seconds");
    return;
  }

  const url = `https://livetrack.garmin.com/apollo/graphql`;
  const payload = {
    query: `
          query sessionAndPoints($sessionId: String!, $token: String!, $begin: String) {
              session: sessionById(sessionId: $sessionId, token: $token) {
                  start
                  end
                  sessionId
              }
              points: trackPointsBySessionId(sessionId: $sessionId, token: $token, begin: $begin) {
                  trackPoints {
                      fitnessPointData {
                          totalDurationSecs
                          speedMetersPerSec
                          totalDistanceMeters
                          activityType
                          cadenceCyclesPerMin
                          distanceMeters
                          durationSecs
                          elevationGainMeters
                          elevationSource
                          eventTypes
                          heartRateBeatsPerMin
                          pointStatus
                          powerWatts
                      }
                      position {
                          lat
                          lon
                      }
                      dateTime
                      speed
                      altitude
                  }
              }
          }
      `,
    variables: {
      sessionId: mailWatcher.sessionInfo.Id,
      token: mailWatcher.sessionInfo.Token,
      begin: null // Set to null for the latest points or a timestamp for specific points
    }
  };

  log.info(`Fetching ${url} with sessionId: ${mailWatcher.sessionInfo.Id}`);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      },
      body: JSON.stringify(payload)
    });

    if (response.status !== 200) {
      log.warn(`Invalid response received - Status: ${response.status}`);
      const data = await response.text();
      log.warn(`Response body: ${data.slice(0, 500)}`);
      return;
    }

    let data;
    try {
      data = await response.json();
      log.info("Response data:", JSON.stringify(data, null, 2));
    } catch (err) {
      log.error("JSON parsing failed:", err.message);
      const text = await response.text();
      log.error(`Raw response: ${text.slice(0, 500)}`);
      return;
    }

    // Check if data contains trackPoints
    if (data.data && data.data.points && data.data.points.trackPoints) {
      const latestData = data.data.points.trackPoints.pop();
      if (latestData) {
        latestData.speed = latestData.speed || 0;
        if (latestData.fitnessPointData) {
          latestData.fitnessPointData.speedMetersPerSec = latestData.fitnessPointData.speedMetersPerSec || 0;
        }

        calculateMinutesPerKilometer(latestData.fitnessPointData.totalDistanceMeters, latestData.fitnessPointData.totalDurationSecs);
        TextOutputter.OutputFile(config.outputFolder, "trackpoints.json", data.data.points);
        TextOutputter.OutputToTextFiles(config.outputFolder, config.outputTemplates, latestData);
      } else {
        log.warn("No trackPoints found in response");
      }
    } else {
      log.warn("No valid trackPoints data in response:", JSON.stringify(data, null, 2));
    }
  } catch (err) {
    log.error("Fetch error:", err.message);
  }
}, config.refreshTimeInMilliseconds);

function calculateMinutesPerKilometer(distance, time) {
  if (distance <= 0 || time <= 0) {
    return "Invalid input. Distance and time must be greater than 0.";
  }

  const distanceKilometers = distance / 1000;
  const timeMinutes = time / 60;

  //log.warn(distance, time, distanceKilometers, timeMinutes)

  const minutesPerKilometer = (timeMinutes / distanceKilometers);
  const convertedToMins = decimalToTimeString(minutesPerKilometer);
  //const formattedResult = `${convertedToMins.toFixed(2)}min/km`;
  const formattedResult = `${convertedToMins}min/km`;



  // Write the result to a text file
  fs.writeFileSync("pace.txt", formattedResult);

  return formattedResult;
}

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
  // using floor to avoid accidental rounding up to 60 seconds
  let sec = Math.floor(60 * fracSec)

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