// Telegram webhook -> GitHub Contents API bridge.
//
// Flow: a friend sends a photo to the bot -> Telegram calls this Worker ->
// we download the photo from Telegram, commit it into photos/<ALBUM_ID>/ in
// the GitHub repo, and append it to the matching album in js/albums.json.
// Both commits go straight to `main`, which GitHub Pages auto-rebuilds.

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
      await handleUpdate(update, env);
    } catch (err) {
      console.error("handleUpdate failed", err);
    }
    return new Response("OK", { status: 200 });
  },
};

async function handleUpdate(update, env) {
  const message = update.message;
  if (!message) return;

  const chatId = message.chat.id;
  const userId = message.from && message.from.id;
  const senderName = (message.from && message.from.first_name) || "a friend";

  const allowlist = parseAllowlist(env.ALLOWED_USER_IDS);
  if (allowlist.length > 0 && !allowlist.includes(String(userId))) {
    await sendMessage(env, chatId, "Sorry, this bot is private and only accepts photos from approved family & friends.");
    return;
  }

  if (message.text === "/start") {
    await sendMessage(
      env,
      chatId,
      `Hi ${senderName}! Send me a photo and I'll add it to Grandma's 80th birthday album:\n${env.SITE_URL}`
    );
    return;
  }

  const photoSizes = message.photo;
  if (!photoSizes || photoSizes.length === 0) {
    await sendMessage(env, chatId, "Send me a photo (not a file/document) and I'll add it to the album!");
    return;
  }

  try {
    // Telegram sends multiple resolutions of the same photo; the last is the largest.
    const largest = photoSizes[photoSizes.length - 1];
    const fileBytes = await downloadTelegramFile(env, largest.file_id);

    const filename = `bot-${Date.now()}-${crypto.randomUUID().slice(0, 8)}.jpg`;
    const photoPath = `photos/${env.ALBUM_ID}/${filename}`;

    await githubUploadPhoto(env, photoPath, fileBytes, senderName);
    await addPhotoToAlbum(env, photoPath, message.caption || `Shared by ${senderName}`);

    await sendMessage(
      env,
      chatId,
      `Thanks! Your photo has been added to the album 🎉\n${env.SITE_URL}#/album/${env.ALBUM_ID}`
    );
  } catch (err) {
    console.error("Photo upload failed", err);
    await sendMessage(env, chatId, "Sorry, something went wrong uploading that photo. Please try again in a moment.");
  }
}

function parseAllowlist(raw) {
  return (raw || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

async function sendMessage(env, chatId, text) {
  await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text }),
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

async function addPhotoToAlbum(env, photoPath, alt) {
  const maxAttempts = 3;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const { albums, sha } = await getAlbumsJson(env);

    let album = albums.find((a) => a.id === env.ALBUM_ID);
    if (!album) {
      album = { id: env.ALBUM_ID, title: env.ALBUM_TITLE, photos: [] };
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
