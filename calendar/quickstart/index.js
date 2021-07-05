/* eslint-disable quote-props */
/* eslint-disable quotes */
/* eslint linebreak-style: ["error", "windows"]*/

const fs = require('fs');
const readline = require('readline');
const {google} = require('googleapis');

// we use a few enviornment variables
const dotenv = require('dotenv').config();
// npm install @notionhq/client
const {Client} = require('@notionhq/client');
const { addAbortSignal } = require('stream');
const { testing } = require('googleapis/build/src/apis/testing');
const notion = new Client({auth: process.env['NOTION_KEY']});

// If modifying these scopes, delete token.json.
const SCOPES = ['https://www.googleapis.com/auth/calendar.readonly'];
// The file token.json stores the user's access and refresh tokens, and is
// created automatically when the authorization flow completes for the first
// time.
const TOKEN_PATH = 'token.json';

// Load client secrets from a local file.
fs.readFile('credentials.json', (err, content) => {
  if (err) return console.log('Error loading client secret file:', err);
  // Authorize a client with credentials, then call the Google Calendar API.
  authorize(JSON.parse(content), listEvents);
});

/**
 * Create an OAuth2 client with the given credentials, and then execute the
 * given callback function.
 * @param {Object} credentials The authorization client credentials.
 * @param {function} callback The callback to call with the authorized client.
 */
function authorize(credentials, callback) {
  const {client_secret, client_id, redirect_uris} = credentials.installed;
  const oAuth2Client = new google.auth.OAuth2(
      client_id, client_secret, redirect_uris[0]);

  // Check if we have previously stored a token.
  fs.readFile(TOKEN_PATH, (err, token) => {
    if (err) return getAccessToken(oAuth2Client, callback);
    oAuth2Client.setCredentials(JSON.parse(token));
    callback(oAuth2Client);
  });
}

/**
 * Get and store new token after prompting for user authorization, and then
 * execute the given callback with the authorized OAuth2 client.
 * @param {google.auth.OAuth2} oAuth2Client The OAuth2 client to get token for.
 * @param {getEventsCallback} callback The callback for the authorized client.
 */
function getAccessToken(oAuth2Client, callback) {
  const authUrl = oAuth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
  });
  console.log('Authorize this app by visiting this url:', authUrl);
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  rl.question('Enter the code from that page here: ', (code) => {
    rl.close();
    oAuth2Client.getToken(code, (err, token) => {
      if (err) return console.error('Error retrieving access token', err);
      oAuth2Client.setCredentials(token);
      // Store the token to disk for later program executions
      fs.writeFile(TOKEN_PATH, JSON.stringify(token), (err) => {
        if (err) return console.error(err);
        console.log('Token stored to', TOKEN_PATH);
      });
      callback(oAuth2Client);
    });
  });
}

/**
 * Lists the next 10 events on the user's primary calendar.
 * @param {google.auth.OAuth2} auth An authorized OAuth2 client.
 */
function listEvents(auth) {
  // List events in google calendar
  const calendar = google.calendar({version: 'v3', auth});
  calendar.events.list({
    calendarId: 'primary',
    timeMin: (new Date()).toISOString(),
    singleEvents: true,
    orderBy: 'startTime',
  }, (err, res) => {
    if (err) return console.log('The API returned an error: ' + err);
    const events = res.data.items;
    if (events.length) {
      console.log('Upcoming 10 events:');
      events.map((event, i) => {
        const start = event.start.dateTime || event.start.date;
        console.log(`${start} - ${event.summary}`);
      });
      // Write to NotionDB
      writeToDB(events);
    } else {
      console.log('No upcoming events found.');
    }
  });
}


/**
 * Write to NotionDB
 * @param {events} events Events in an object as defined by google calendar API
 */
async function writeToDB(events) {
  // Find the first database this bot has access to
  // TODO(blackmad): move to notion.search()
  const databases = await notion.databases.list({});

  if (databases.results.length === 0) {
    throw new Error("This bot doesn't have access to any databases!");
  }

  const database = databases.results[0];
  if (!database) {
    throw new Error("This bot doesn't have access to any databases!");
  }
  
  // Get the database properties out of our database
  const {properties} = await notion.databases.retrieve({
    database_id: database.id,
  });
  console.log(properties)

  for (i = 0; i < events.length; i++) {
    const text = events[i].summary;
    const start_date = events[i].start.dateTime || events[i].start.date;
    console.log(start_date);
    let end_date = null;
    if (start_date.includes("T")) {
      end_date = events[i].end.dateTime || events[i].end.date;
        if (end_date.includes("00:00:00")) {
          tzoffset = new Date(end_date).getTimezoneOffset() * 60000;
          change_date = Date.parse(end_date);
          change_date = change_date - 60000 - tzoffset;
          end_date = new Date(change_date).toISOString("en-US", {timeZone: "Australia/Sydney"});
        }
    }

    const event = {
      "start_date": start_date,
      "end_date": end_date,
      "text": text,
    };
    await addItem(event);
  }
  // await exerciseWriting(database.id, properties, events);
}

/**
 * Write to notion DB
 * @param {string} databaseId Database String
 * @param {PropertyMap} properties Database property object
 * @param {events} events Events in an object as defined by google calendar API
 */
async function exerciseWriting(databaseId, properties, events) {
  console.log('\n\n********* Exercising Writing *********\n\n');

  // const RowsToWrite = 10;
  for (i = 0; i < events.length; i++) {
    const event = events[0];
    const start = event.start.dateTime || event.start.date;

    const propertiesValues = {
      type: "title",
      // id: property.id,
      title: [
        {
          type: "text",
          text: {content: start},
        },
      ],
    };
    await notion.pages.create({
      parent: {
        database_id: databaseId,
      },
      properties: propertiesValues,
    });
  }
  console.log(`Wrote ${RowsToWrite} rows after ${startTime}`);
}

/**
 * Add item to notionDB
 * @param {JSON} event JSON Event
 */
async function addItem(event) {
  try {
    await notion.request({
      path: "pages",
      method: "POST",
      body: {
        parent: {database_id: process.env.NOTION_DATABASE_ID},
        properties: {
          title: {
            title: [
              {
                "text": {
                  "content": event.text,
                },
              },
            ],
          },
          "Date":{
            "date":{
              "start": event.start_date,
              "end": event.end_date,
            },
          },
          "Type": {
            "select": {
              "name": "Damian's Calendar",
            },
          },
        },
      },
    });
    console.log("Success! Entry added.");
  } catch (error) {
    console.error(error.body);
  }
}

