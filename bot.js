const TelegramBot = require("node-telegram-bot-api");
const { spawn } = require("child_process");
const fs = require("fs");

/* ================= CONFIG ================= */

const BOT_TOKEN = "7756981381:AAHJcwxWKeD-QpVNbRxJyQGSKVNmfKygPC8";
const AUTO_RESTART_DELAY = 5000;

/* ========================================== */

const bot = new TelegramBot(BOT_TOKEN, { polling: true });

/* ================= DATABASE ================= */

let db = JSON.parse(fs.readFileSync("./streams.json"));
let adminsDB = JSON.parse(fs.readFileSync("./admins.json"));

const processes = {};
const restartTimers = {};

/* ================= UTILS ================= */

function saveStreams() {
  fs.writeFileSync("./streams.json", JSON.stringify(db, null, 2));
}

function saveAdmins() {
  fs.writeFileSync("./admins.json", JSON.stringify(adminsDB, null, 2));
}

function isAdmin(userId) {
  return adminsDB.admins.includes(userId);
}

/* ================= FFMPEG ================= */

function ffmpegArgs(s) {
  return [
    "-re", "-i", s.input,
    "-c:v", "libx264",
    "-preset", "veryfast",
    "-c:a", "aac",
    "-f", "flv",
    s.output
  ];
}

function startFFmpeg(id, chatId) {
  const s = db.streams[id];
  if (!s || processes[id]) return;

  const ff = spawn("ffmpeg", ffmpegArgs(s));
  processes[id] = ff;

  s.running = true;
  s.manuallyStopped = false;
  saveStreams();

  bot.sendMessage(chatId, `▶️ Started: ${id}`);

  ff.on("close", () => {
    delete processes[id];
    s.running = false;
    saveStreams();

    if (!s.manuallyStopped) {
      bot.sendMessage(chatId, `🔄 Restarting: ${id}`);
      restartTimers[id] = setTimeout(() => {
        startFFmpeg(id, chatId);
      }, AUTO_RESTART_DELAY);
    }
  });

  ff.on("error", err => {
    bot.sendMessage(chatId, `❌ FFmpeg error: ${err.message}`);
  });
}

function stopFFmpeg(id) {
  const s = db.streams[id];
  if (!s) return;

  s.manuallyStopped = true;
  s.running = false;

  if (restartTimers[id]) clearTimeout(restartTimers[id]);

  if (processes[id]) {
    processes[id].kill("SIGKILL");
    delete processes[id];
  }

  saveStreams();
}

/* ================= UI ================= */

function mainMenu(chatId) {
  const buttons = Object.keys(db.streams).map(id => ([
    { text: `▶️ ${id}`, callback_data: `start:${id}` },
    { text: `⏹ ${id}`, callback_data: `stop:${id}` }
  ]));

  buttons.push([
    { text: "➕ Add Stream", callback_data: "add" },
    { text: "➖ Remove Stream", callback_data: "remove" }
  ]);

  bot.sendMessage(chatId, "🎛 FFmpeg Control Panel", {
    reply_markup: { inline_keyboard: buttons }
  });
}

/* ================= BOT ================= */

bot.onText(/\/start/, msg => {
  if (!isAdmin(msg.from.id))
    return bot.sendMessage(msg.chat.id, "🚫 Access denied");

  mainMenu(msg.chat.id);
});

/* INLINE BUTTON HANDLER */

bot.on("callback_query", query => {
  const chatId = query.message.chat.id;
  if (!isAdmin(query.from.id)) return;

  const [action, id] = query.data.split(":");

  if (action === "start") startFFmpeg(id, chatId);
  if (action === "stop") stopFFmpeg(id);
  if (action === "add") askAdd(chatId);
  if (action === "remove") askRemove(chatId);
  if (action === "del") removeStream(id, chatId);

  bot.answerCallbackQuery(query.id);
});

/* ADD STREAM */

function askAdd(chatId) {
  bot.sendMessage(chatId,
`Send stream as:
id | m3u8_url | rtmp_url`);

  bot.once("message", msg => {
    if (!isAdmin(msg.from.id)) return;

    const p = msg.text.split("|").map(x => x.trim());
    if (p.length !== 3)
      return bot.sendMessage(chatId, "❌ Invalid format");

    const [id, input, output] = p;

    db.streams[id] = {
      input,
      output,
      running: false,
      manuallyStopped: false
    };

    saveStreams();
    bot.sendMessage(chatId, `✅ Added: ${id}`);
    mainMenu(chatId);
  });
}

/* REMOVE STREAM */

function askRemove(chatId) {
  const buttons = Object.keys(db.streams).map(id => ([
    { text: `❌ ${id}`, callback_data: `del:${id}` }
  ]));

  bot.sendMessage(chatId, "Remove stream:", {
    reply_markup: { inline_keyboard: buttons }
  });
}

function removeStream(id, chatId) {
  stopFFmpeg(id);
  delete db.streams[id];
  saveStreams();
  bot.sendMessage(chatId, `🗑 Removed: ${id}`);
  mainMenu(chatId);
}

/* ================= ADMIN COMMANDS ================= */

/* LIST ADMINS */
bot.onText(/\/admins/, msg => {
  if (!isAdmin(msg.from.id)) return;
  bot.sendMessage(msg.chat.id,
    "👑 Admins:\n" + adminsDB.admins.join("\n")
  );
});

/* ADD ADMIN */
bot.onText(/\/addadmin (\d+)/, (msg, match) => {
  if (!isAdmin(msg.from.id)) return;

  const id = Number(match[1]);
  if (adminsDB.admins.includes(id))
    return bot.sendMessage(msg.chat.id, "Already admin");

  adminsDB.admins.push(id);
  saveAdmins();
  bot.sendMessage(msg.chat.id, `✅ Added admin: ${id}`);
});

/* REMOVE ADMIN */
bot.onText(/\/removeadmin (\d+)/, (msg, match) => {
  if (!isAdmin(msg.from.id)) return;

  const id = Number(match[1]);
  adminsDB.admins = adminsDB.admins.filter(x => x !== id);
  saveAdmins();
  bot.sendMessage(msg.chat.id, `🗑 Removed admin: ${id}`);
});

/* ================= START ================= */

console.log("🤖 Telegram FFmpeg bot running (MULTI-ADMIN)");
