// @flow

const fs = require('fs-extra')
const huejay = require('huejay')
const fetch = require('node-fetch')

const CHECK_INTERVAL = 1000
const DB_FILE = 'db.json'
const DB_DEFAULT = {
  bridgeIp: null,
  username: null,
}

run()

async function run() {
  console.log('Starting Hue power memory server')
  const db = await discoverBridge(await initDb())
  const urlBase = `http://${db.bridgeIp}/api/${db.username}/`
  const state = {
    db,
    getJson: uri => fetch(`${urlBase}${uri}`).then(res => res.json()),
    putJson: (uri, body) => fetch(`${urlBase}${uri}`, { method: 'PUT', body: JSON.stringify(body) }).then(res => res.json()),
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
  const lights = await state.getJson('lights')
  return Object.assign({}, state, { lights })
}

async function restoreState(state, prevState) {
  const lightChanges = await Promise.all(Object.keys(state.lights).map(async (sp, id) => {
    const l = state.lights[id]
    const prevL = prevState.lights[id]
    try {
      if (prevL && (isLightReset(l) || !l.state.reachable)) {
        // console.log(`Restored state on ${l.name}`)
        const newParams = {
          bri: prevL.state.bri,
          hue: prevL.state.hue,
          sat: prevL.state.sat,
          xy: prevL.state.xy,
          ct: prevL.state.ct,
          // effect: 'none',
          // alert: 'none',
          // colormode: 'xy',
        }
        await state.putJson(`lights/${id}/state`, newParams)
        return {
          ...l,
          state: {
            ...l.state,
            ...newParams,
          },
        }
      }
      return l
    } catch (e) {
      if (prevL) {
        console.log(prevL.name, ' not available')
        return prevL
      }
      return null
    }
  }))
  return Object.assign({}, state, {
    lights: lightChanges.reduce((acc, l) => (
      l
        ? Object.assign(acc, {
          [l.id]: l,
        })
        : acc
    ), state.lights),
  })
}

function isLightReset(light) {
  return (
    light.state.on
    && light.state.bri === 254
    && light.state.hue === 8418
    && light.state.sat === 140
    && light.state.xy[0] === 0.4573
    && light.state.xy[1] === 0.41
    && light.state.ct === 366
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
