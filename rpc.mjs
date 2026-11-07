#!/usr/bin/env node
// Fake "Grand Theft Auto VI" Discord Rich Presence, spoken directly over the
// desktop client's local IPC socket. No dependencies.
import net from 'node:net';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';

const OP = { HANDSHAKE: 0, FRAME: 1, CLOSE: 2, PING: 3, PONG: 4 };
const TYPES = { playing: 0, streaming: 1, listening: 2, watching: 3, competing: 5 };
const RETRY_MS = 15_000;

const configUrl = new URL('./config.json', import.meta.url);
if (!existsSync(configUrl)) {
  console.error('No config.json found. Copy config.example.json to config.json and fill it in.');
  process.exit(1);
}
const config = JSON.parse(readFileSync(configUrl, 'utf8'));
if (!/^\d{17,20}$/.test(config.clientId)) {
  console.error('Set "clientId" in config.json to your Discord Application ID (Developer Portal → General Information).');
  process.exit(1);
}

const startedAt = Date.now(); // drives the "elapsed" timer; kept across reconnects
let sock = null;
let rotateTimer = null;
let statusIndex = 0;
const fallbackType = TYPES[config.fallbackType] ?? TYPES.playing;
let activeType = TYPES[config.type] ?? fallbackType;
const pending = new Map();

function socketPaths() {
  if (process.platform === 'win32') return Array.from({ length: 10 }, (_, i) => `\\\\?\\pipe\\discord-ipc-${i}`);
  const base = process.env.XDG_RUNTIME_DIR || process.env.TMPDIR || '/tmp';
  return Array.from({ length: 10 }, (_, i) => path.join(base, `discord-ipc-${i}`));
}

function encode(op, data) {
  const body = Buffer.from(JSON.stringify(data));
  const header = Buffer.alloc(8);
  header.writeInt32LE(op, 0);
  header.writeInt32LE(body.length, 4);
  return Buffer.concat([header, body]);
}

function openSocket() {
  const paths = socketPaths();
  return new Promise((resolve, reject) => {
    const attempt = (i) => {
      if (i >= paths.length) return reject(new Error('Discord IPC socket not found. Is the Discord desktop app running?'));
      const s = net.createConnection(paths[i]);
      s.once('connect', () => { s.removeAllListeners('error'); resolve(s); });
      s.once('error', () => attempt(i + 1));
    };
    attempt(0);
  });
}

function request(cmd, args) {
  const nonce = randomUUID();
  return new Promise((resolve, reject) => {
    pending.set(nonce, { resolve, reject });
    sock.write(encode(OP.FRAME, { cmd, args, nonce }));
  });
}

function onMessage(op, msg) {
  if (op === OP.PING) return sock.write(encode(OP.PONG, msg));
  if (op === OP.CLOSE) {
    console.error(`Discord closed the connection: ${msg.message} (code ${msg.code})`);
    if (msg.code === 4000) process.exit(1); // invalid client id; retrying won't help
    return;
  }
  if (msg.evt === 'READY') return onReady(msg.data.user);
  const waiter = msg.nonce && pending.get(msg.nonce);
  if (!waiter) return;
  pending.delete(msg.nonce);
  if (msg.evt === 'ERROR') waiter.reject(new Error(`${msg.data.message} (code ${msg.data.code})`));
  else waiter.resolve(msg.data);
}

function buildActivity(status, type) {
  const activity = {
    type,
    details: status.details,
    state: status.state || undefined,
    timestamps: { start: startedAt },
    instance: false,
  };
  if (config.largeImage) activity.assets = { large_image: config.largeImage, large_text: config.largeText };
  if (type === TYPES.streaming) activity.url = config.watchUrl;
  else activity.buttons = [{ label: config.buttonLabel, url: config.watchUrl }];
  return activity;
}

async function pushStatus() {
  const status = config.statuses[statusIndex % config.statuses.length];
  statusIndex++;
  const wanted = activeType;
  try {
    const result = await request('SET_ACTIVITY', { pid: process.pid, activity: buildActivity(status, wanted) });
    if (result?.type !== undefined && result.type !== wanted && wanted !== fallbackType) {
      // Discord accepted the call but rewrote the type, so the stream URL is dropped too.
      return fallBack(`Discord changed type ${wanted} to ${result.type}`);
    }
    console.log(`[${new Date().toLocaleTimeString()}] ${typeName(result?.type ?? wanted)} · ${status.details}`);
  } catch (err) {
    if (wanted !== fallbackType) return fallBack(err.message);
    console.error('SET_ACTIVITY failed:', err.message);
  }
}

function fallBack(reason) {
  activeType = fallbackType;
  console.warn(`"${config.type}" rejected (${reason}); using "${config.fallbackType}" with a "${config.buttonLabel}" button instead.`);
  statusIndex--; // retry the same status line
  return pushStatus();
}

const typeName = (t) => Object.keys(TYPES).find((k) => TYPES[k] === t);

function onReady(user) {
  console.log(`Connected as ${user.username}. Presence is live — Ctrl+C to stop.`);
  pushStatus();
  clearInterval(rotateTimer);
  if (config.statuses.length > 1) rotateTimer = setInterval(pushStatus, Math.max(config.rotateSeconds, 20) * 1000);
}

async function connect() {
  try {
    sock = await openSocket();
  } catch (err) {
    console.error(`${err.message} Retrying in ${RETRY_MS / 1000}s…`);
    return setTimeout(connect, RETRY_MS);
  }
  let buf = Buffer.alloc(0);
  sock.on('data', (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    while (buf.length >= 8) {
      const len = buf.readInt32LE(4);
      if (buf.length < 8 + len) break;
      onMessage(buf.readInt32LE(0), JSON.parse(buf.subarray(8, 8 + len).toString()));
      buf = buf.subarray(8 + len);
    }
  });
  sock.on('close', () => {
    clearInterval(rotateTimer);
    for (const { reject } of pending.values()) reject(new Error('connection closed'));
    pending.clear();
    console.error(`Lost connection to Discord. Reconnecting in ${RETRY_MS / 1000}s…`);
    setTimeout(connect, RETRY_MS);
  });
  sock.on('error', () => {}); // 'close' follows and handles the retry
  sock.write(encode(OP.HANDSHAKE, { v: 1, client_id: config.clientId }));
}

async function shutdown() {
  clearInterval(rotateTimer);
  if (sock?.writable) {
    await Promise.race([request('SET_ACTIVITY', { pid: process.pid }), new Promise((r) => setTimeout(r, 1000))]).catch(() => {});
  }
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

connect();
