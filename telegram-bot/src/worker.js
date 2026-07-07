// Telegram webhook -> GitHub Contents API bridge.
//
// Flow: a friend sends a photo -> the bot replies to that photo with inline
// buttons, one per existing album -> tapping a button uploads the photo into
// that album. Both commits go straight to `main`, which GitHub Pages
// auto-rebuilds.
//
// The album choice is threaded statelessly: the button-picker message is
// sent as a reply to the original photo message, so when the callback comes
// back, `callback_query.message.reply_to_message` is that original photo
// message again (Telegram preserves one level of reply nesting) — no need
// for a database or KV store to remember which photo the buttons belong to.

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method !== "POST" || url.pathname !== "/telegram-webhook") {
      return new Response("Not found", { status: 404 });
    }

    // Telegram doesn't sign requests, but it does echo back a secret token
    // we chose when registering the webhook — reject anything without it.
    const secretHeader = request.headers.get("X-Telegram-Bot-Api-Secret-Token");
    if (secretHeader !== env.TELEGRAM_WEBHOOK_SECRET) {
      return new Response("Unauthorized", { status: 401 });
    }

    let update;
    try {
      update = await request.json();
    } catch {
      return new Response("Bad request", { status: 400 });
    }

    // Always return 200 once we've accepted the update — Telegram retries
    // (and can back off/disable the webhook) on non-2xx responses, and we
    // don't want a downstream GitHub hiccup to trigger a retry storm.
    try {
      if (update.callback_query) {
        await handleCallbackQuery(update.callback_query, env);
      } else if (update.message) {
        await handleMessage(update.message, env);
      }
    } catch (err) {
      console.error("Update handling failed", err);
    }
    return new Response("OK", { status: 200 });
  },
};

async function handleMessage(message, env) {
  const chatId = message.chat.id;
  const userId = message.from && message.from.id;
  const senderName = (message.from && message.from.first_name) || "a friend";

  if (!isAllowed(env, userId)) {
    await sendMessage(env, chatId, "Sorry, this bot is private and only accepts photos from approved family & friends.");
    return;
  }

  if (message.text === "/start") {
    await sendMessage(env, chatId, `Hi ${senderName}! Send me a photo and I'll ask which album to add it to.\n${env.SITE_URL}`);
    return;
  }

  if (!message.photo || message.photo.length === 0) {
    await sendMessage(env, chatId, "Send me a photo (not a file/document) and I'll add it to an album!");
    return;
  }

  let albums;
  try {
    ({ albums } = await getAlbumsJson(env));
  } catch (err) {
    console.error("Failed to load albums for picker", err);
    await sendMessage(env, chatId, "Sorry, I couldn't load the album list right now. Please try again in a moment.");
    return;
  }

  if (albums.length === 0) {
    await sendMessage(env, chatId, "There aren't any albums set up yet — ask the site owner to add one.");
    return;
  }

  await sendMessage(env, chatId, "Which album should this go in?", {
    reply_to_message_id: message.message_id,
    reply_markup: {
      inline_keyboard: albums.map((album) => [{ text: album.title, callback_data: `album:${album.id}` }]),
    },
  });
}

async function handleCallbackQuery(callbackQuery, env) {
  const userId = callbackQuery.from && callbackQuery.from.id;
  const senderName = (callbackQuery.from && callbackQuery.from.first_name) || "a friend";
  const promptMessage = callbackQuery.message;
  const chatId = promptMessage.chat.id;

  if (!isAllowed(env, userId)) {
    await answerCallbackQuery(env, callbackQuery.id, "Not authorized");
    return;
  }

  const match = (callbackQuery.data || "").match(/^album:(.+)$/);
  const photoMessage = promptMessage.reply_to_message;

  if (!match || !photoMessage || !photoMessage.photo || photoMessage.photo.length === 0) {
    await answerCallbackQuery(env, callbackQuery.id, "That photo is no longer available — please resend it.");
    return;
  }

  const albumId = match[1];

  try {
    const { albums } = await getAlbumsJson(env);
    const album = albums.find((a) => a.id === albumId);
    if (!album) {
      await answerCallbackQuery(env, callbackQuery.id, "That album no longer exists.");
      return;
    }

    // Telegram sends multiple resolutions of the same photo; the last is the largest.
    const largest = photoMessage.photo[photoMessage.photo.length - 1];
    const fileBytes = await downloadTelegramFile(env, largest.file_id);

    const filename = `bot-${Date.now()}-${crypto.randomUUID().slice(0, 8)}.jpg`;
    const photoPath = `photos/${albumId}/${filename}`;

    await githubUploadPhoto(env, photoPath, fileBytes, senderName);
    await addPhotoToAlbum(env, albumId, photoPath, photoMessage.caption || `Shared by ${senderName}`);

    await answerCallbackQuery(env, callbackQuery.id, "Added!");
    await editMessageText(
      env,
      chatId,
      promptMessage.message_id,
      `Thanks! Added to "${album.title}" 🎉\n${env.SITE_URL}#/album/${albumId}`
    );
  } catch (err) {
    console.error("Photo upload failed", err);
    await answerCallbackQuery(env, callbackQuery.id, "Something went wrong");
    await editMessageText(env, chatId, promptMessage.message_id, "Sorry, something went wrong uploading that photo. Please try again.");
  }
}

function isAllowed(env, userId) {
  const allowlist = parseAllowlist(env.ALLOWED_USER_IDS);
  return allowlist.length === 0 || allowlist.includes(String(userId));
}

function parseAllowlist(raw) {
  return (raw || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

async function sendMessage(env, chatId, text, extra = {}) {
  await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, ...extra }),
  });
}

async function editMessageText(env, chatId, messageId, text) {
  await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/editMessageText`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      message_id: messageId,
      text,
      reply_markup: { inline_keyboard: [] },
    }),
  });
}

async function answerCallbackQuery(env, callbackQueryId, text) {
  await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/answerCallbackQuery`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ callback_query_id: callbackQueryId, text }),
  });
}

async function downloadTelegramFile(env, fileId) {
  const getFileResp = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/getFile?file_id=${fileId}`);
  const getFileData = await getFileResp.json();
  if (!getFileData.ok) {
    throw new Error(`Telegram getFile failed: ${JSON.stringify(getFileData)}`);
  }

  const fileResp = await fetch(`https://api.telegram.org/file/bot${env.TELEGRAM_BOT_TOKEN}/${getFileData.result.file_path}`);
  if (!fileResp.ok) {
    throw new Error(`Telegram file download failed: ${fileResp.status}`);
  }
  return new Uint8Array(await fileResp.arrayBuffer());
}

function bytesToBase64(bytes) {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function githubHeaders(env) {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${env.GITHUB_TOKEN}`,
    "User-Agent": "mahmahs-photo-bot",
    Accept: "application/vnd.github+json",
  };
}

async function githubUploadPhoto(env, path, bytes, senderName) {
  const url = `https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/contents/${path}`;
  const resp = await fetch(url, {
    method: "PUT",
    headers: githubHeaders(env),
    body: JSON.stringify({
      message: `Add photo from Telegram (${senderName})`,
      content: bytesToBase64(bytes),
      branch: env.GITHUB_BRANCH,
    }),
  });
  if (!resp.ok) {
    throw new Error(`GitHub photo upload failed: ${resp.status} ${await resp.text()}`);
  }
}

async function getAlbumsJson(env) {
  const resp = await fetch(
    `https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/contents/js/albums.json?ref=${env.GITHUB_BRANCH}`,
    { headers: githubHeaders(env) }
  );
  if (!resp.ok) {
    throw new Error(`GitHub albums.json fetch failed: ${resp.status} ${await resp.text()}`);
  }
  const data = await resp.json();
  const albums = JSON.parse(atob(data.content.replace(/\n/g, "")));
  return { albums, sha: data.sha };
}

async function addPhotoToAlbum(env, albumId, photoPath, alt) {
  const maxAttempts = 3;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const { albums, sha } = await getAlbumsJson(env);

    const album = albums.find((a) => a.id === albumId);
    if (!album) {
      // The button list comes from this same data, so this should only ever
      // happen if the album was deleted between the button being sent and tapped.
      throw new Error(`Album "${albumId}" no longer exists`);
    }
    album.photos.push({ src: photoPath, alt });

    const content = new TextEncoder().encode(JSON.stringify(albums, null, 2) + "\n");
    const putResp = await fetch(
      `https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/contents/js/albums.json`,
      {
        method: "PUT",
        headers: githubHeaders(env),
        body: JSON.stringify({
          message: "Add photo submitted via Telegram bot",
          content: bytesToBase64(content),
          sha,
          branch: env.GITHUB_BRANCH,
        }),
      }
    );

    if (putResp.ok) return;

    // Someone else updated albums.json between our GET and PUT — refetch the
    // sha and retry rather than clobbering their change.
    if (putResp.status === 409 && attempt < maxAttempts) continue;

    throw new Error(`GitHub albums.json update failed: ${putResp.status} ${await putResp.text()}`);
  }
}
