// @flow

const fs = require('fs-extra')
const huejay = require('huejay')

const CHECK_INTERVAL = 1500
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
    nextActions: [],
    lights: {},
  }
  loop(state)
}

async function loop(state) {
  const actions = [saveLightsState, restoreState, ...state.nextActions]
  const timeBefore = Date.now()
  const newState = await actions.reduce(async (s, a) => a(await s, state), state)
  await sleep(Math.max(0, CHECK_INTERVAL - (Date.now() - timeBefore)))
  return loop(newState)
}

async function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

async function saveLightsState(state) {
  const lights = await state.client.lights.getAll()
  return Object.assign({}, state, {
    lights: lights.reduce((s, l) => Object.assign(s, { [l.id]: getLightState(l) }), {}),
  })
}

async function restoreState(state, prevState) {
  const lightChanges = await Promise.all(Object.keys(state.lights).map(async (sp, id) => {
    const l = state.lights[id]
    const prevL = prevState.lights[id]
    try {
      if (prevL && l.huejay.reachable && isLightReset(l)) {
        l.huejay.brightness = prevL.brightness
        l.huejay.hue = prevL.hue
        l.huejay.saturation = prevL.saturation
        l.huejay.xy = prevL.xy
        l.huejay.colorTemp = prevL.colorTemp
        console.log(`Restored state on ${l.huejay.name}`)
        await state.client.lights.save(l.huejay)
        return Object.assign({}, getLightState(l.huejay), { justRestored: true })
      }
      return l
    } catch (e) {
      if (prevL) {
        console.log(prevL.huejay.name, ' not available')
        return prevL
      }
      return null
    }
  }))
  return Object.assign({}, state, {
    lights: lightChanges.reduce((acc, l) => (
      l
        ? Object.assign(acc, {
          [l.huejay.id]: l,
        })
        : acc
    ), state.lights),
  })
}

function getLightState(light) {
  return {
    huejay: light,
    on: light.on,
    reachable: light.reachable,
    brightness: light.brightness,
    hue: light.hue,
    saturation: light.saturation,
    xy: light.xy,
    colorTemp: light.colorTemp,
  }
}

function isLightReset(light) {
  return (
    light.on
    && light.brightness === 254
    && light.hue === 8418
    && light.saturation === 140
    && light.xy[0] === 0.4573
    && light.xy[1] === 0.41
    && light.colorTemp === 366
  )
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
