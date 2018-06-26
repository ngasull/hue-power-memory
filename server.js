// @flow

const fs = require('fs-extra')
const huejay = require('huejay')

const DB_FILE = 'db.json'
const DB_DEFAULT = {
  bridgeIp: null,
  username: null,
}

run()

async function run() {
  console.log('Starting Hue power memory server')
  const db = await discoverBridge(await initDb())
  const state = {
    db,
    client: new huejay.Client({
      host: db.bridgeIp,
      username: db.username,
    }),
  }

  const lights = await state.client.lights.getAll()
  lights.forEach(console.log)
}

async function initDb() {
  let conf
  try {
    conf = await fs.readJson(DB_FILE)
  } catch (e) {
    console.log('No conf found: initializing conf')
    conf = {}
  }
  return writeDb(Object.assign({}, DB_DEFAULT, conf))
}

async function writeDb(db) {
  try {
    await fs.writeJson(DB_FILE, db)
  } catch (e) {
    console.error('Couldn\'t write DB file', e)
  }
  return db
}

async function discoverBridge(db) {
  let { bridgeIp, username } = db

  if (!bridgeIp) {
    const bridges = await huejay.discover()

    if (bridges.length === 0) {
      console.error('No bridge found on LAN')
      process.exit(1)
    }

    bridgeIp = bridges[0].ip
    console.log(`Using bridge found at ${bridgeIp}`)
  }

  if (!username) {
    const client = new huejay.Client({
      host: bridgeIp,
      timeout: 30000,
    })
    console.log('Please press the button on the bridge to authenticate')

    try {
      const user = await client.users.create(new client.users.User())
      username = user.username
    } catch (e) {
      console.error('Could not authenticate to the bridge', e)
      process.exit(1)
    }
  }

  return (
    bridgeIp !== db.bridgeIp || username !== db.username
      ? writeDb(Object.assign({}, db, { bridgeIp, username }))
      : db
  )
}
