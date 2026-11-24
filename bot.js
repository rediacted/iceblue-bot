
import fs from "node:fs";
import path from "node:path";

const TOKEN = process.env.YAPPER_BOT_TOKEN;
const OWNER_ID = process.env.BOT_OWNER_ID || "";
const WELCOME_CHANNEL = process.env.WELCOME_CHANNEL_ID || "";
const OPENAI_KEY = process.env.OPENAI_API_KEY || "";

const API = "https://www.yapper.website/api/bot/v1";
const DATA_PATH = process.env.DATA_PATH || "./iceblue-data.json";

if (!TOKEN) throw new Error("Missing YAPPER_BOT_TOKEN");

const commands = [
  ["ping", "Check ICEBLUE status"],
  ["help", "Show commands"],
  ["roll", "Roll a dice"],
  ["balance", "Check your wallet"],
  ["daily", "Collect daily coins"],
  ["work", "Earn coins"],
  ["pay", "Pay another member"],
  ["say", "Make ICEBLUE say something"],
  ["setreply", "Create a custom auto response"],
  ["kick", "Kick a member"],
  ["ban", "Ban a member"],
  ["timeout", "Timeout a member"],
  ["ticket", "Open a support ticket"],
  ["ask", "Ask ICEBLUE AI"]
];

function loadData() {
  try {
    return JSON.parse(fs.readFileSync(DATA_PATH, "utf8"));
  } catch {
    return {
      wallets: {},
      daily: {},
      replies: {}
    };
  }
}

const data = loadData();

function saveData() {
  fs.mkdirSync(path.dirname(DATA_PATH), { recursive: true });
  fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2));
}

async function api(method, endpoint, body) {
  const response = await fetch(API + endpoint, {
    method,
    headers: {
      Authorization: `Bot ${TOKEN}`,
      "Content-Type": "application/json"
    },
    ...(body === undefined
      ? {}
      : { body: JSON.stringify(body) })
  });

  const text = await response.text();
  let result = {};

  try {
    result = text ? JSON.parse(text) : {};
  } catch {
    result = { error: text };
  }

  if (!response.ok) {
    throw new Error(
      `Yapper API ${response.status}: ${JSON.stringify(result)}`
    );
  }

  return result;
}

async function send(channel, content, replyTo) {
  if (!channel) return;

  return api("POST", `/channels/${channel}/messages`, {
    content: String(content).slice(0, 2000),
    ...(replyTo ? { reply_to: replyTo } : {})
  });
}

function wallet(id) {
  return data.wallets[id] || 0;
}

function addCoins(id, amount) {
  data.wallets[id] = wallet(id) + amount;
  saveData();
}

function getMention(text) {
  return text.match(/<@([a-fA-F0-9-]+)>/)?.[1];
}

function reply(msg, text) {
  return send(msg.channel_id, text, msg.id);
}

async function moderate(msg, action, target, minutes = 10) {
  if (!target || !msg.server_id) {
    return reply(msg, `Usage: /${action} @user`);
  }

  const routes = {
    kick: [`/servers/${msg.server_id}/kick`, {
      user_id: target
    }],
    ban: [`/servers/${msg.server_id}/bans`, {
      user_id: target
    }],
    timeout: [`/servers/${msg.server_id}/timeouts`, {
      user_id: target,
      minutes,
      reason: "ICEBLUE moderation"
    }]
  };

  await api("POST", routes[action][0], routes[action][1]);
  await reply(msg, `🛡️ ${action.toUpperCase()} completed.`);
}

async function askAI(msg, question) {
  if (!OPENAI_KEY) {
    return reply(
      msg,
      "❄️ AI is not configured yet. Add OPENAI_API_KEY to your hosting secrets."
    );
  }

  const response = await fetch(
    "https://api.openai.com/v1/chat/completions",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4.1-mini",
        messages: [
          {
            role: "system",
            content: "You are ICEBLUE, a friendly and helpful assistant. Keep replies concise."
          },
          { role: "user", content: question }
        ],
        max_tokens: 300
      })
    }
  );

  if (!response.ok) {
    throw new Error(`AI API error: ${response.status}`);
  }

  const result = await response.json();
  const answer = result.choices?.[0]?.message?.content;

  await reply(msg, answer || "I couldn't generate a response.");
}

async function handle(msg) {
  if (!msg.channel_id || !msg.author_id) return;
  if (msg.author_bot) return;

  const command = msg.command;
  const args = msg.args || "";
  const parts = args.trim().split(/\s+/);
  const user = msg.author_id;

  if (!command) {
    const content = msg.content.toLowerCase().trim();

    for (const [keyword, response] of Object.entries(data.replies)) {
      if (content.includes(keyword)) {
        return reply(msg, response);
      }
    }

    if (content === "hello" || content === "hi") {
      return reply(msg, "Hey there! ❄️ Welcome to ICEBLUE!");
    }

    return;
  }

  switch (command) {
    case "ping":
      return reply(msg, "🏓 Pong! ICEBLUE is online.");

    case "help":
      return reply(msg,
        "**❄️ ICEBLUE COMMANDS**\n\n" +
        commands.map(([name, description]) =>
          `\`/${name}\` — ${description}`
        ).join("\n")
      );

    case "roll": {
      const n = Number(parts[0]);
      const sides = Number.isSafeInteger(n) && n >= 2 && n <= 1000 ? n : 6;
      return reply(msg, `🎲 You rolled **${1 + Math.floor(Math.random() * sides)}**!`);
    }

    case "say":
      if (!args.trim()) return reply(msg, "Usage: /say hello");
      return reply(msg, args.slice(0, 1800));

    case "balance":
      return reply(msg, `💰 You have **${wallet(user)} coins**.`);

    case "daily": {
      const today = new Date().toISOString().slice(0, 10);

      if (data.daily[user] === today) {
        return reply(msg, "You already collected today's reward!");
      }

      data.daily[user] = today;
      addCoins(user, 250);
      return reply(msg, "🎁 You collected **250 coins**!");
    }

    case "work": {
      const amount = 50 + Math.floor(Math.random() * 101);
      addCoins(user, amount);
      return reply(msg, `💼 You earned **${amount} coins**!`);
    }

    case "pay": {
      const target = getMention(args);
      const amounts = args.match(/\b\d+\b/g);

      if (!target || !amounts) {
        return reply(msg, "Usage: /pay @user 100");
      }

      const amount = Number(amounts.at(-1));

      if (target === user || amount <= 0 || !Number.isSafeInteger(amount)) {
        return reply(msg, "Invalid payment.");
      }

      if (wallet(user) < amount) {
        return reply(msg, "You don't have enough coins.");
      }

      addCoins(user, -amount);
      addCoins(target, amount);

      return reply(msg, `💸 Sent **${amount} coins**!`);
    }

    case "setreply": {
      if (OWNER_ID !== user) {
        return reply(msg, "Only the bot owner can create auto responses.");
      }

      const split = args.split("|");
      if (split.length < 2) {
        return reply(msg, "Usage: /setreply keyword | response");
      }

      const keyword = split[0].trim().toLowerCase();
      const response = split.slice(1).join("|").trim();

      if (!keyword || !response) {
        return reply(msg, "Please provide a keyword and response.");
      }

      data.replies[keyword] = response.slice(0, 1000);
      saveData();

      return reply(msg, `✅ Auto response saved for **${keyword}**.`);
    }

    case "kick":
    case "ban":
      return moderate(msg, command, getMention(args));

    case "timeout": {
      const target = getMention(args);
      const numbers = args.match(/\b\d+\b/g);
      const minutes = Math.max(1, Math.min(
        40320,
        Number(numbers?.at(-1) || 10)
      ));

      return moderate(msg, "timeout", target, minutes);
    }

    case "ticket": {
      if (!msg.server_id) {
        return reply(msg, "Tickets can only be opened in a server.");
      }

      return reply(
        msg,
        "🎫 Ticket setup is not enabled yet. Configure a private ticket category and support-role access before opening tickets."
      );
    }

    case "ask":
      if (!args.trim()) return reply(msg, "Usage: /ask What is AI?");
      return askAI(msg, args);
  }
}

async function main() {
  console.log("❄️ Starting ICEBLUE...");

  await api("PUT", "/commands", {
    commands: commands.map(([name, description]) => ({
      name,
      description
    }))
  });

  await api("PATCH", "/me", {
    display_name: "ICEBLUE",
    bio: "❄️ Your premium multipurpose Yapper bot."
  });

  const initial = await api("GET", "/events?after=0&wait=0");
  let last = initial.last || 0;

  console.log("ICEBLUE is online!");

  await api("PUT", "/me/status", {
    status: "online",
    activity: "ICEBLUE Premium"
  });

  while (true) {
    try {
      const result = await api(
        "GET",
        `/events?after=${last}&wait=25`
      );

      for (const event of result.events || []) {
        last = event.id;

        try {
          if (event.type === "message") {
            await handle(event.data);
          }

          if (event.type === "member_join" && WELCOME_CHANNEL) {
            await send(
              WELCOME_CHANNEL,
              `❄️ Welcome <@${event.data.user_id}> to the server!`
            );
          }

          if (event.type === "member_leave") {
            console.log(`${event.data.username} left.`);
          }
        } catch (error) {
          console.error("Event error:", error.message);
        }
      }

      last = Math.max(last, result.last || 0);

    } catch (error) {
      console.error("Connection error:", error.message);
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  }
}

main().catch(error => {
  console.error("ICEBLUE failed:", error);
  process.exit(1);
});
