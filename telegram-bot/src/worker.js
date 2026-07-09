// Telegram webhook -> GitHub Contents API bridge.
//
// Flow: a friend sends a photo -> the bot replies with inline buttons, one
// per existing album plus "New Album" -> tapping an existing album uploads
// straight away; tapping "New Album" asks for a name (force-reply) and then
// creates it. Each pending photo is held in Workers KV (PENDING_UPLOADS) for
// a few minutes under a short random id, since a Telegram bot can't re-fetch
// an old message on demand — the id round-trips through the button's
// callback_data (and, for the new-album case, through a second KV entry
// keyed by the force-reply prompt's message id) so we know which photo a
// later tap or reply belongs to.

const UPLOAD_TTL_SECONDS = 600;

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

  if (message.text && /^\/(adduser|removeuser|listusers|reorder|deletealbum|deletephoto|commands)\b/.test(message.text)) {
    if (!isAdmin(env, userId)) {
      await sendMessage(env, chatId, "Only the site owner can do that.");
      return;
    }
    if (message.text.startsWith("/reorder")) {
      await handleReorderCommand(message, env);
    } else if (message.text.startsWith("/deletealbum")) {
      await handleDeleteAlbumCommand(message, env);
    } else if (message.text.startsWith("/deletephoto")) {
      await handleDeletePhotoCommand(message, env);
    } else if (message.text.startsWith("/commands")) {
      await handleCommandsList(message, env);
    } else {
      await handleAdminCommand(message, env);
    }
    return;
  }

  if (!(await isAllowed(env, userId))) {
    await sendMessage(env, chatId, "Sorry, this bot is private and only accepts photos from approved family & friends.");
    return;
  }

  // Is this a reply to an earlier prompt (new album name, or photo reorder)?
  if (message.reply_to_message) {
    const replyId = message.reply_to_message.message_id;

    const pendingAlbumNameKey = `pendingAlbumName:${replyId}`;
    const uploadId = await env.PENDING_UPLOADS.get(pendingAlbumNameKey);
    if (uploadId) {
      await handleNewAlbumName(uploadId, pendingAlbumNameKey, message, env);
      return;
    }

    const pendingReorderKey = `pendingReorder:${replyId}`;
    const reorderAlbumId = await env.PENDING_UPLOADS.get(pendingReorderKey);
    if (reorderAlbumId) {
      await handleReorderReply(reorderAlbumId, pendingReorderKey, message, env);
      return;
    }

    const pendingDeleteAlbumKey = `pendingDeleteAlbum:${replyId}`;
    const deleteAlbumId = await env.PENDING_UPLOADS.get(pendingDeleteAlbumKey);
    if (deleteAlbumId) {
      await handleDeleteAlbumReply(deleteAlbumId, pendingDeleteAlbumKey, message, env);
      return;
    }

    const pendingDeletePhotoKey = `pendingDeletePhoto:${replyId}`;
    const deletePhotoAlbumId = await env.PENDING_UPLOADS.get(pendingDeletePhotoKey);
    if (deletePhotoAlbumId) {
      await handleDeletePhotoReply(deletePhotoAlbumId, pendingDeletePhotoKey, message, env);
      return;
    }
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

  const uploadId = crypto.randomUUID().slice(0, 8);
  const largest = message.photo[message.photo.length - 1];
  await env.PENDING_UPLOADS.put(
    `upload:${uploadId}`,
    JSON.stringify({ fileId: largest.file_id, caption: message.caption || null, senderName }),
    { expirationTtl: UPLOAD_TTL_SECONDS }
  );

  const buttons = albums.map((album) => [{ text: album.title, callback_data: `album:${uploadId}:${album.id}` }]);
  buttons.push([{ text: "➕ New Album", callback_data: `newalbum:${uploadId}` }]);

  await sendMessage(env, chatId, "Which album should this go in?", {
    reply_to_message_id: message.message_id,
    reply_markup: { inline_keyboard: buttons },
  });
}

async function handleCallbackQuery(callbackQuery, env) {
  const userId = callbackQuery.from && callbackQuery.from.id;
  const promptMessage = callbackQuery.message;
  const chatId = promptMessage.chat.id;
  const data = callbackQuery.data || "";

  if (!(await isAllowed(env, userId))) {
    await answerCallbackQuery(env, callbackQuery.id, "Not authorized");
    return;
  }

  const newAlbumMatch = data.match(/^newalbum:(.+)$/);
  if (newAlbumMatch) {
    const uploadId = newAlbumMatch[1];
    const upload = await getUpload(env, uploadId);
    if (!upload) {
      await answerCallbackQuery(env, callbackQuery.id, "This request expired — please resend the photo.");
      await editMessageText(env, chatId, promptMessage.message_id, "This request expired — please resend the photo.");
      return;
    }

    const sent = await sendMessage(env, chatId, "What would you like to name the new album? Reply to this message with a name.", {
      reply_markup: { force_reply: true, selective: true },
    });
    if (sent && sent.result) {
      await env.PENDING_UPLOADS.put(`pendingAlbumName:${sent.result.message_id}`, uploadId, {
        expirationTtl: UPLOAD_TTL_SECONDS,
      });
    }

    await answerCallbackQuery(env, callbackQuery.id, "");
    await editMessageText(env, chatId, promptMessage.message_id, "Creating a new album — check the next message!");
    return;
  }

  const albumMatch = data.match(/^album:([^:]+):(.+)$/);
  if (!albumMatch) {
    await answerCallbackQuery(env, callbackQuery.id, "");
    return;
  }

  const [, uploadId, albumId] = albumMatch;
  const upload = await getUpload(env, uploadId);
  if (!upload) {
    await answerCallbackQuery(env, callbackQuery.id, "This request expired — please resend the photo.");
    await editMessageText(env, chatId, promptMessage.message_id, "This request expired — please resend the photo.");
    return;
  }

  try {
    const { albums } = await getAlbumsJson(env);
    const album = albums.find((a) => a.id === albumId);
    if (!album) {
      await answerCallbackQuery(env, callbackQuery.id, "That album no longer exists.");
      return;
    }

    const fileBytes = await downloadTelegramFile(env, upload.fileId);
    const photoPath = `photos/${albumId}/${photoFilename()}`;

    await githubUploadPhoto(env, photoPath, fileBytes, upload.senderName);
    await addPhotoToAlbum(env, albumId, null, photoPath, upload.caption || `Shared by ${upload.senderName}`);
    await env.PENDING_UPLOADS.delete(`upload:${uploadId}`);

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

async function handleNewAlbumName(uploadId, pendingKey, message, env) {
  const chatId = message.chat.id;
  const upload = await getUpload(env, uploadId);
  if (!upload) {
    await env.PENDING_UPLOADS.delete(pendingKey);
    await sendMessage(env, chatId, "This request expired — please resend the photo.", { reply_to_message_id: message.message_id });
    return;
  }

  const title = (message.text || "").trim();
  if (!title) {
    // Leave the pending state in place so they can just reply again with a real name.
    await sendMessage(env, chatId, "Please reply with a name for the album (some text, not empty).", {
      reply_to_message_id: message.message_id,
    });
    return;
  }

  const albumId = slugify(title);

  try {
    const fileBytes = await downloadTelegramFile(env, upload.fileId);
    const photoPath = `photos/${albumId}/${photoFilename()}`;

    await githubUploadPhoto(env, photoPath, fileBytes, upload.senderName);
    const finalTitle = await addPhotoToAlbum(env, albumId, title, photoPath, upload.caption || `Shared by ${upload.senderName}`);

    await env.PENDING_UPLOADS.delete(`upload:${uploadId}`);
    await env.PENDING_UPLOADS.delete(pendingKey);

    await sendMessage(env, chatId, `Thanks! Created "${finalTitle}" and added your photo 🎉\n${env.SITE_URL}#/album/${albumId}`, {
      reply_to_message_id: message.message_id,
    });
  } catch (err) {
    console.error("New album creation failed", err);
    await sendMessage(env, chatId, "Sorry, something went wrong creating that album. Please try again.", {
      reply_to_message_id: message.message_id,
    });
  }
}

function slugify(title) {
  const slug = title
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50);
  return slug || `album-${Date.now()}`;
}

function photoFilename() {
  return `bot-${Date.now()}-${crypto.randomUUID().slice(0, 8)}.jpg`;
}

async function getUpload(env, uploadId) {
  const raw = await env.PENDING_UPLOADS.get(`upload:${uploadId}`);
  return raw ? JSON.parse(raw) : null;
}

const ALLOWLIST_KV_KEY = "config:allowlist";

// The submission allowlist lives in KV (so /adduser etc. can edit it at
// runtime) but starts out seeded from the ALLOWED_USER_IDS secret set up
// during initial deploy - once anyone runs an admin command it "forks" into
// KV and the secret is no longer consulted.
async function getAllowlist(env) {
  const stored = await env.PENDING_UPLOADS.get(ALLOWLIST_KV_KEY);
  if (stored) return JSON.parse(stored);
  return parseIdList(env.ALLOWED_USER_IDS);
}

async function saveAllowlist(env, ids) {
  await env.PENDING_UPLOADS.put(ALLOWLIST_KV_KEY, JSON.stringify(ids));
}

async function isAllowed(env, userId) {
  const allowlist = await getAllowlist(env);
  return allowlist.length === 0 || allowlist.includes(String(userId));
}

// Admins (who can run /adduser, /removeuser, /listusers) are a fixed, separate
// list from the submission allowlist - only the site owner, set via the
// ADMIN_USER_IDS secret. Unlike the allowlist, this is never editable from
// within Telegram itself.
function isAdmin(env, userId) {
  const admins = parseIdList(env.ADMIN_USER_IDS);
  return admins.includes(String(userId));
}

function parseIdList(raw) {
  return (raw || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

const ADMIN_COMMANDS_HELP = `Admin commands:
/adduser <telegram id> - allow someone to submit photos
/removeuser <telegram id> - revoke someone's access
/listusers - show everyone currently allowed to submit photos
/reorder <album id> - change the photo order within an album
/deletealbum <album id> - delete an album and all its photos
/deletephoto <album id> - delete a single photo from an album
/commands - show this list

Anyone allowed to submit photos (including you) can just send a photo to add it to an album.`;

async function handleCommandsList(message, env) {
  await sendMessage(env, message.chat.id, ADMIN_COMMANDS_HELP);
}

async function handleAdminCommand(message, env) {
  const chatId = message.chat.id;
  const parts = message.text.trim().split(/\s+/);
  const command = parts[0];

  if (command === "/listusers") {
    const allowlist = await getAllowlist(env);
    const body = allowlist.length > 0 ? allowlist.join("\n") : "(empty - currently open to anyone)";
    await sendMessage(env, chatId, `Allowed user IDs:\n${body}`);
    return;
  }

  const targetId = parts[1];
  if (!targetId || !/^\d+$/.test(targetId)) {
    await sendMessage(
      env,
      chatId,
      "Usage:\n/adduser <telegram id>\n/removeuser <telegram id>\n/listusers\n\nAsk them to message @userinfobot to get their id."
    );
    return;
  }

  const allowlist = await getAllowlist(env);

  if (command === "/adduser") {
    if (allowlist.includes(targetId)) {
      await sendMessage(env, chatId, `${targetId} is already allowed.`);
      return;
    }
    allowlist.push(targetId);
    await saveAllowlist(env, allowlist);
    await sendMessage(env, chatId, `Added ${targetId}. They can now message this bot to add photos. (${allowlist.length} allowed in total.)`);
    return;
  }

  if (command === "/removeuser") {
    if (!allowlist.includes(targetId)) {
      await sendMessage(env, chatId, `${targetId} wasn't on the list.`);
      return;
    }
    await saveAllowlist(env, allowlist.filter((id) => id !== targetId));
    await sendMessage(env, chatId, `Removed ${targetId}.`);
  }
}

async function handleReorderCommand(message, env) {
  const chatId = message.chat.id;
  const albumId = message.text.trim().split(/\s+/)[1];

  let albums;
  try {
    ({ albums } = await getAlbumsJson(env));
  } catch (err) {
    console.error("Failed to load albums for reorder", err);
    await sendMessage(env, chatId, "Sorry, I couldn't load the album list right now. Please try again in a moment.");
    return;
  }

  if (!albumId) {
    const list = albums.map((a) => `${a.id} (${a.photos.length} photo${a.photos.length === 1 ? "" : "s"})`).join("\n");
    await sendMessage(env, chatId, `Usage: /reorder <album id>\n\nAlbums:\n${list}`);
    return;
  }

  const album = albums.find((a) => a.id === albumId);
  if (!album) {
    await sendMessage(env, chatId, `No album called "${albumId}". Send /reorder with no arguments to see valid ids.`);
    return;
  }

  if (album.photos.length < 2) {
    await sendMessage(env, chatId, `"${album.title}" has ${album.photos.length} photo(s) — nothing to reorder.`);
    return;
  }

  for (let i = 0; i < album.photos.length; i++) {
    await sendPhotoByUrl(env, chatId, album.photos[i].src, `${i + 1}`);
  }

  const example = Array.from({ length: album.photos.length }, (_, i) => album.photos.length - i).join(" ");
  const sent = await sendMessage(
    env,
    chatId,
    `Reply with the new order as space-separated numbers 1-${album.photos.length} (e.g. "${example}" to fully reverse), or "cancel".`,
    { reply_markup: { force_reply: true, selective: true } }
  );
  if (sent && sent.result) {
    await env.PENDING_UPLOADS.put(`pendingReorder:${sent.result.message_id}`, albumId, { expirationTtl: UPLOAD_TTL_SECONDS });
  }
}

async function handleReorderReply(albumId, pendingKey, message, env) {
  const chatId = message.chat.id;
  const text = (message.text || "").trim();

  if (/^cancel$/i.test(text)) {
    await env.PENDING_UPLOADS.delete(pendingKey);
    await sendMessage(env, chatId, "Reorder cancelled.", { reply_to_message_id: message.message_id });
    return;
  }

  const order = text.split(/\s+/).map((s) => parseInt(s, 10));

  try {
    const finalTitle = await reorderAlbum(env, albumId, order);
    await env.PENDING_UPLOADS.delete(pendingKey);
    await sendMessage(env, chatId, `Reordered "${finalTitle}" 🎉\n${env.SITE_URL}#/album/${albumId}`, {
      reply_to_message_id: message.message_id,
    });
  } catch (err) {
    // Leave the pending state in place so they can just reply again with a corrected order.
    await sendMessage(env, chatId, `${err.message} Reply again with a corrected order, or "cancel".`, {
      reply_to_message_id: message.message_id,
    });
  }
}

async function handleDeleteAlbumCommand(message, env) {
  const chatId = message.chat.id;
  const albumId = message.text.trim().split(/\s+/)[1];

  let albums;
  try {
    ({ albums } = await getAlbumsJson(env));
  } catch (err) {
    console.error("Failed to load albums for delete", err);
    await sendMessage(env, chatId, "Sorry, I couldn't load the album list right now. Please try again in a moment.");
    return;
  }

  if (!albumId) {
    const list = albums.map((a) => `${a.id} (${a.photos.length} photo${a.photos.length === 1 ? "" : "s"})`).join("\n");
    await sendMessage(env, chatId, `Usage: /deletealbum <album id>\n\nAlbums:\n${list}`);
    return;
  }

  const album = albums.find((a) => a.id === albumId);
  if (!album) {
    await sendMessage(env, chatId, `No album called "${albumId}". Send /deletealbum with no arguments to see valid ids.`);
    return;
  }

  const sent = await sendMessage(
    env,
    chatId,
    `Delete "${album.title}" and all ${album.photos.length} photo${album.photos.length === 1 ? "" : "s"} in it? This can't be undone. Reply YES to confirm, or "cancel".`,
    { reply_markup: { force_reply: true, selective: true } }
  );
  if (sent && sent.result) {
    await env.PENDING_UPLOADS.put(`pendingDeleteAlbum:${sent.result.message_id}`, albumId, { expirationTtl: UPLOAD_TTL_SECONDS });
  }
}

async function handleDeleteAlbumReply(albumId, pendingKey, message, env) {
  const chatId = message.chat.id;
  const text = (message.text || "").trim();
  const senderName = (message.from && message.from.first_name) || "an admin";

  if (!/^yes$/i.test(text)) {
    await env.PENDING_UPLOADS.delete(pendingKey);
    await sendMessage(env, chatId, "Delete cancelled.", { reply_to_message_id: message.message_id });
    return;
  }

  try {
    const title = await deleteAlbum(env, albumId, senderName);
    await env.PENDING_UPLOADS.delete(pendingKey);
    await sendMessage(env, chatId, `Deleted "${title}" and its photos.`, { reply_to_message_id: message.message_id });
  } catch (err) {
    console.error("Album delete failed", err);
    await env.PENDING_UPLOADS.delete(pendingKey);
    await sendMessage(env, chatId, `Sorry, something went wrong deleting that album: ${err.message}`, {
      reply_to_message_id: message.message_id,
    });
  }
}

async function handleDeletePhotoCommand(message, env) {
  const chatId = message.chat.id;
  const albumId = message.text.trim().split(/\s+/)[1];

  let albums;
  try {
    ({ albums } = await getAlbumsJson(env));
  } catch (err) {
    console.error("Failed to load albums for delete", err);
    await sendMessage(env, chatId, "Sorry, I couldn't load the album list right now. Please try again in a moment.");
    return;
  }

  if (!albumId) {
    const list = albums.map((a) => `${a.id} (${a.photos.length} photo${a.photos.length === 1 ? "" : "s"})`).join("\n");
    await sendMessage(env, chatId, `Usage: /deletephoto <album id>\n\nAlbums:\n${list}`);
    return;
  }

  const album = albums.find((a) => a.id === albumId);
  if (!album) {
    await sendMessage(env, chatId, `No album called "${albumId}". Send /deletephoto with no arguments to see valid ids.`);
    return;
  }

  if (album.photos.length === 0) {
    await sendMessage(env, chatId, `"${album.title}" has no photos.`);
    return;
  }

  for (let i = 0; i < album.photos.length; i++) {
    await sendPhotoByUrl(env, chatId, album.photos[i].src, `${i + 1}`);
  }

  const sent = await sendMessage(
    env,
    chatId,
    `Reply with the number of the photo to delete (1-${album.photos.length}), or "cancel".`,
    { reply_markup: { force_reply: true, selective: true } }
  );
  if (sent && sent.result) {
    await env.PENDING_UPLOADS.put(`pendingDeletePhoto:${sent.result.message_id}`, albumId, { expirationTtl: UPLOAD_TTL_SECONDS });
  }
}

async function handleDeletePhotoReply(albumId, pendingKey, message, env) {
  const chatId = message.chat.id;
  const text = (message.text || "").trim();
  const senderName = (message.from && message.from.first_name) || "an admin";

  if (/^cancel$/i.test(text)) {
    await env.PENDING_UPLOADS.delete(pendingKey);
    await sendMessage(env, chatId, "Delete cancelled.", { reply_to_message_id: message.message_id });
    return;
  }

  const position = parseInt(text, 10);

  try {
    const title = await deletePhoto(env, albumId, position, senderName);
    await env.PENDING_UPLOADS.delete(pendingKey);
    await sendMessage(env, chatId, `Deleted photo ${position} from "${title}".`, { reply_to_message_id: message.message_id });
  } catch (err) {
    // Leave the pending state in place so they can just reply again with a corrected number.
    await sendMessage(env, chatId, `${err.message} Reply again with a valid number, or "cancel".`, {
      reply_to_message_id: message.message_id,
    });
  }
}

async function sendMessage(env, chatId, text, extra = {}) {
  const resp = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, ...extra }),
  });
  return resp.json().catch(() => null);
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

async function sendPhotoByUrl(env, chatId, relativeSrc, caption) {
  await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendPhoto`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, photo: `${env.SITE_URL}${relativeSrc}`, caption }),
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

async function githubGetFileSha(env, path) {
  const resp = await fetch(
    `https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/contents/${path}?ref=${env.GITHUB_BRANCH}`,
    { headers: githubHeaders(env) }
  );
  if (resp.status === 404) return null;
  if (!resp.ok) {
    throw new Error(`GitHub file lookup failed: ${resp.status} ${await resp.text()}`);
  }
  const data = await resp.json();
  return data.sha;
}

// No-op if the file is already gone, so a retried delete doesn't error out.
async function githubDeletePhoto(env, path, senderName) {
  const sha = await githubGetFileSha(env, path);
  if (!sha) return;

  const resp = await fetch(`https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/contents/${path}`, {
    method: "DELETE",
    headers: githubHeaders(env),
    body: JSON.stringify({
      message: `Delete photo from Telegram (${senderName})`,
      sha,
      branch: env.GITHUB_BRANCH,
    }),
  });
  if (!resp.ok) {
    throw new Error(`GitHub photo delete failed: ${resp.status} ${await resp.text()}`);
  }
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

// Appends a photo to the given album, creating it (using newAlbumTitle) if it
// doesn't exist yet. Returns the album's title. Retries on a 409 (someone
// else updated albums.json between our GET and PUT).
async function addPhotoToAlbum(env, albumId, newAlbumTitle, photoPath, alt) {
  const maxAttempts = 3;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const { albums, sha } = await getAlbumsJson(env);

    let album = albums.find((a) => a.id === albumId);
    if (!album) {
      if (!newAlbumTitle) {
        // The button list comes from this same data, so this should only ever
        // happen if the album was deleted between the button being sent and tapped.
        throw new Error(`Album "${albumId}" no longer exists`);
      }
      album = { id: albumId, title: newAlbumTitle, photos: [] };
      albums.push(album);
    }
    album.photos.push({ src: photoPath, alt });

    const content = new TextEncoder().encode(JSON.stringify(albums, null, 2) + "\n");
    const putResp = await fetch(
      `https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/contents/js/albums.json`,
      {
        method: "PUT",
        headers: githubHeaders(env),
        body: JSON.stringify({
          message: newAlbumTitle ? `Create album "${newAlbumTitle}" from Telegram` : "Add photo submitted via Telegram bot",
          content: bytesToBase64(content),
          sha,
          branch: env.GITHUB_BRANCH,
        }),
      }
    );

    if (putResp.ok) return album.title;

    // Someone else updated albums.json between our GET and PUT — refetch the
    // sha and retry rather than clobbering their change.
    if (putResp.status === 409 && attempt < maxAttempts) continue;

    throw new Error(`GitHub albums.json update failed: ${putResp.status} ${await putResp.text()}`);
  }
}

// order is a 1-indexed permutation, e.g. [3, 1, 2] moves photo 3 to the
// front. Validated fresh on each attempt since the photo count could in
// theory change between the numbered listing and this reply.
async function reorderAlbum(env, albumId, order) {
  const maxAttempts = 3;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const { albums, sha } = await getAlbumsJson(env);
    const album = albums.find((a) => a.id === albumId);
    if (!album) {
      throw new Error(`Album "${albumId}" no longer exists.`);
    }

    const n = album.photos.length;
    const isValidOrder =
      order.length === n && order.every((x) => Number.isInteger(x) && x >= 1 && x <= n) && new Set(order).size === n;

    if (!isValidOrder) {
      throw new Error(`That's not a valid ordering — I need exactly the numbers 1-${n}, each once.`);
    }

    album.photos = order.map((position) => album.photos[position - 1]);

    const content = new TextEncoder().encode(JSON.stringify(albums, null, 2) + "\n");
    const putResp = await fetch(
      `https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/contents/js/albums.json`,
      {
        method: "PUT",
        headers: githubHeaders(env),
        body: JSON.stringify({
          message: `Reorder album "${albumId}" from Telegram`,
          content: bytesToBase64(content),
          sha,
          branch: env.GITHUB_BRANCH,
        }),
      }
    );

    if (putResp.ok) return album.title;

    if (putResp.status === 409 && attempt < maxAttempts) continue;

    throw new Error(`GitHub albums.json update failed: ${putResp.status} ${await putResp.text()}`);
  }
}

// Deletes every photo file in the album, then removes the album entry from
// albums.json. The photo files are deleted once upfront (deleting them isn't
// affected by concurrent albums.json edits); only the albums.json write is
// retried on a 409.
async function deleteAlbum(env, albumId, senderName) {
  const { albums } = await getAlbumsJson(env);
  const album = albums.find((a) => a.id === albumId);
  if (!album) {
    throw new Error(`Album "${albumId}" no longer exists.`);
  }

  for (const photo of album.photos) {
    await githubDeletePhoto(env, photo.src, senderName);
  }

  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const { albums: freshAlbums, sha } = await getAlbumsJson(env);
    const remaining = freshAlbums.filter((a) => a.id !== albumId);

    const content = new TextEncoder().encode(JSON.stringify(remaining, null, 2) + "\n");
    const putResp = await fetch(
      `https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/contents/js/albums.json`,
      {
        method: "PUT",
        headers: githubHeaders(env),
        body: JSON.stringify({
          message: `Delete album "${albumId}" via Telegram`,
          content: bytesToBase64(content),
          sha,
          branch: env.GITHUB_BRANCH,
        }),
      }
    );

    if (putResp.ok) return album.title;

    if (putResp.status === 409 && attempt < maxAttempts) continue;

    throw new Error(`GitHub albums.json update failed: ${putResp.status} ${await putResp.text()}`);
  }
}

// position is 1-indexed, matching what /deletephoto sends the user. Deletes
// the photo file once upfront, then retries only the albums.json write on a
// 409, matching deleteAlbum's approach.
async function deletePhoto(env, albumId, position, senderName) {
  const { albums } = await getAlbumsJson(env);
  const album = albums.find((a) => a.id === albumId);
  if (!album) {
    throw new Error(`Album "${albumId}" no longer exists.`);
  }
  if (!Number.isInteger(position) || position < 1 || position > album.photos.length) {
    throw new Error(`That's not a valid photo number — I need a number 1-${album.photos.length}.`);
  }

  const photo = album.photos[position - 1];
  await githubDeletePhoto(env, photo.src, senderName);

  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const { albums: freshAlbums, sha } = await getAlbumsJson(env);
    const freshAlbum = freshAlbums.find((a) => a.id === albumId);
    if (freshAlbum) {
      freshAlbum.photos = freshAlbum.photos.filter((p) => p.src !== photo.src);
    }

    const content = new TextEncoder().encode(JSON.stringify(freshAlbums, null, 2) + "\n");
    const putResp = await fetch(
      `https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/contents/js/albums.json`,
      {
        method: "PUT",
        headers: githubHeaders(env),
        body: JSON.stringify({
          message: `Delete photo from "${albumId}" via Telegram`,
          content: bytesToBase64(content),
          sha,
          branch: env.GITHUB_BRANCH,
        }),
      }
    );

    if (putResp.ok) return album.title;

    if (putResp.status === 409 && attempt < maxAttempts) continue;

    throw new Error(`GitHub albums.json update failed: ${putResp.status} ${await putResp.text()}`);
  }
}
