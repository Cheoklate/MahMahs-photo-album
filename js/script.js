const albumsView = document.getElementById("albums-view");
const albumsGrid = document.getElementById("albums-grid");
const albumView = document.getElementById("album-view");
const albumGrid = document.getElementById("album-grid");
const albumTitleEl = document.getElementById("album-title");
const backButton = document.getElementById("back-to-albums");

const lightbox = document.getElementById("lightbox");
const lightboxViewport = lightbox.querySelector(".lightbox-viewport");
const lightboxTrack = lightbox.querySelector(".lightbox-track");
const prevSlide = lightbox.querySelector('[data-slide="prev"]');
const currentSlide = lightbox.querySelector('[data-slide="current"]');
const nextSlide = lightbox.querySelector('[data-slide="next"]');
const closeBtn = lightbox.querySelector(".lightbox-close");
const prevBtn = lightbox.querySelector(".lightbox-prev");
const nextBtn = lightbox.querySelector(".lightbox-next");
const downloadBtn = lightbox.querySelector(".lightbox-download");

let albums = [];
let currentAlbum = null;
let currentIndex = 0;

function albumCover(album) {
  return (album.photos[0] && album.photos[0].src) || "";
}

function renderAlbums() {
  albumsGrid.innerHTML = "";
  // Albums start out empty when created by the Telegram bot, so skip any
  // with no photos yet rather than showing a broken cover image.
  albums.filter((album) => album.photos.length > 0).forEach((album) => {
    const figure = document.createElement("figure");
    figure.className = "album-card";

    const button = document.createElement("button");
    const img = document.createElement("img");
    img.src = albumCover(album);
    img.alt = album.title;
    img.loading = "lazy";

    const caption = document.createElement("figcaption");
    const count = album.photos.length;
    caption.innerHTML = `<span class="album-title">${album.title}</span><span class="album-count">${count} photo${count === 1 ? "" : "s"}</span>`;

    button.appendChild(img);
    button.appendChild(caption);
    button.addEventListener("click", () => {
      location.hash = `#/album/${album.id}`;
    });

    figure.appendChild(button);
    albumsGrid.appendChild(figure);
  });
}

function renderAlbum(album) {
  albumTitleEl.textContent = album.title;
  albumGrid.innerHTML = "";
  album.photos.forEach((photo, index) => {
    const figure = document.createElement("figure");
    const button = document.createElement("button");
    const img = document.createElement("img");

    img.src = photo.src;
    img.alt = photo.alt || "";
    img.loading = "lazy";

    button.appendChild(img);
    button.addEventListener("click", () => openLightbox(album, index));

    figure.appendChild(button);
    albumGrid.appendChild(figure);
  });
}

function showAlbumsView() {
  albumsView.hidden = false;
  albumView.hidden = true;
}

function showAlbumView(album) {
  renderAlbum(album);
  albumsView.hidden = true;
  albumView.hidden = false;
}

function route() {
  const match = location.hash.match(/^#\/album\/(.+)$/);
  const album = match && albums.find((a) => a.id === match[1]);

  if (album) {
    showAlbumView(album);
  } else {
    showAlbumsView();
  }
}

// If the page loads with an album already in the hash (e.g. a link shared
// from the Telegram bot), there's no albums-view entry underneath it in this
// tab's history yet - the back button would leave the site entirely instead
// of returning to the main page. Give it one to land on. History entries we
// create are marked so a normal in-app visit doesn't get a duplicate.
function ensureAlbumsHistoryBase() {
  if (history.state && history.state.mahmahsApp) return;

  const initialHash = location.hash;
  history.replaceState({ mahmahsApp: true }, "", location.pathname + location.search);
  if (initialHash) {
    history.pushState({ mahmahsApp: true }, "", location.pathname + location.search + initialHash);
  }
}

backButton.addEventListener("click", () => {
  location.hash = "";
});

window.addEventListener("hashchange", route);

// Lightbox — scoped to whichever album is currently open.
//
// The track holds 3 slides (prev/current/next) side by side. Dragging moves
// the track 1:1 with the pointer so the neighboring photo peeks in as you
// go, like Instagram; releasing past a distance threshold finishes the
// slide into place, otherwise it springs back to the current photo.

let viewportWidth = 0;
let dragStartX = null;
let dragOffset = 0;
let activePointerId = null;
let isAnimating = false;

// No wrap-around: past either end there's simply no photo to show.
function photoAt(offset) {
  const index = currentIndex + offset;
  if (index < 0 || index >= currentAlbum.photos.length) return null;
  return currentAlbum.photos[index];
}

function setSlide(imgEl, photo) {
  imgEl.src = photo ? photo.src : "";
  imgEl.alt = photo ? photo.alt || "" : "";
}

function updateSlides() {
  setSlide(prevSlide, photoAt(-1));
  setSlide(currentSlide, photoAt(0));
  setSlide(nextSlide, photoAt(1));
  prevBtn.disabled = currentIndex === 0;
  nextBtn.disabled = currentIndex === currentAlbum.photos.length - 1;
  resetZoom();

  const photo = photoAt(0);
  downloadBtn.href = photo ? photo.src : "";
  downloadBtn.download = photo ? photo.src.split("/").pop() : "";
}

function setTrackPosition(offsetPx, withTransition) {
  lightboxTrack.style.transition = withTransition ? "transform 0.25s ease" : "none";
  lightboxTrack.style.transform = `translateX(${-viewportWidth + offsetPx}px)`;
}

function openLightbox(album, index) {
  currentAlbum = album;
  currentIndex = index;
  lightbox.hidden = false;
  document.body.style.overflow = "hidden";
  viewportWidth = lightboxViewport.getBoundingClientRect().width;
  updateSlides();
  setTrackPosition(0, false);
  // Push a history entry so the phone's back button (and the browser's)
  // closes the photo instead of leaving the app/navigating away.
  history.pushState({ lightbox: true }, "");
}

// Hides the lightbox without touching history - used when a popstate (the
// back button) has already consumed the entry pushed by openLightbox.
function hideLightbox() {
  lightbox.hidden = true;
  document.body.style.overflow = "";
}

// Closes the lightbox from an in-page action (close button, backdrop click,
// Escape). Goes back through history so the entry from openLightbox is
// consumed, keeping the back button in sync for the next photo.
function closeLightbox() {
  if (lightbox.hidden) return;
  if (history.state && history.state.lightbox) {
    history.back();
  } else {
    hideLightbox();
  }
}

window.addEventListener("popstate", () => {
  if (!lightbox.hidden && !(history.state && history.state.lightbox)) {
    hideLightbox();
  }
});

// direction: 1 to advance to the next photo, -1 for the previous photo, or
// 0 to just spring back to the current one. Springs back (rather than
// moving) if direction points past either end of the album - no wrap-around.
function settleTo(direction) {
  if (isAnimating) return;

  const targetIndex = currentIndex + direction;
  const canMove = direction !== 0 && targetIndex >= 0 && targetIndex < currentAlbum.photos.length;

  if (!canMove) {
    setTrackPosition(0, true);
    return;
  }

  isAnimating = true;
  setTrackPosition(-direction * viewportWidth, true);
  lightboxTrack.addEventListener(
    "transitionend",
    () => {
      currentIndex = targetIndex;
      updateSlides();
      setTrackPosition(0, false);
      isAnimating = false;
    },
    { once: true }
  );
}

function showNext() {
  settleTo(1);
}

function showPrev() {
  settleTo(-1);
}

closeBtn.addEventListener("click", closeLightbox);
nextBtn.addEventListener("click", showNext);
prevBtn.addEventListener("click", showPrev);

lightbox.addEventListener("click", (event) => {
  if (event.target === lightbox) closeLightbox();
});

document.addEventListener("keydown", (event) => {
  if (lightbox.hidden) return;
  if (event.key === "Escape") closeLightbox();
  if (event.key === "ArrowRight") showNext();
  if (event.key === "ArrowLeft") showPrev();
});

window.addEventListener("resize", () => {
  if (lightbox.hidden) return;
  viewportWidth = lightboxViewport.getBoundingClientRect().width;
  setTrackPosition(dragStartX === null ? 0 : dragOffset, false);
});

// Zoom & pan on the current photo — pinch (touch) or scroll wheel (mouse) to
// zoom continuously, double-tap/double-click to jump to a fixed zoom level,
// drag to pan while zoomed. All coexist with the swipe-between-photos drag
// below: a single pointer drives swipe when not zoomed in, and pan once it
// is; a second pointer touching down always starts a pinch.
const MIN_ZOOM = 1;
const MAX_ZOOM = 4;
const DOUBLE_TAP_ZOOM = 2.5;
const TAP_MAX_MOVEMENT = 10;
const TAP_MAX_DELAY_MS = 300;

let zoomScale = 1;
let panX = 0;
let panY = 0;

function applyZoom(withTransition) {
  currentSlide.style.transition = withTransition ? "transform 0.2s ease" : "none";
  currentSlide.style.transform = `translate(${panX}px, ${panY}px) scale(${zoomScale})`;
  lightboxViewport.style.cursor = zoomScale > 1 ? "grab" : "zoom-in";
}

function resetZoom() {
  zoomScale = 1;
  panX = 0;
  panY = 0;
  applyZoom(false);
}

// The img element's own box always fills its slide (33.3333% of the track),
// but object-fit: contain letterboxes the actual photo pixels inside it —
// this is the photo's real on-screen size, needed to clamp panning so it
// can't be dragged past its own edges.
function containedPhotoSize() {
  const cw = currentSlide.clientWidth;
  const ch = currentSlide.clientHeight;
  const iw = currentSlide.naturalWidth;
  const ih = currentSlide.naturalHeight;
  if (!iw || !ih) return { width: cw, height: ch };
  const fitScale = Math.min(cw / iw, ch / ih);
  return { width: iw * fitScale, height: ih * fitScale };
}

function clampPan() {
  const viewport = lightboxViewport.getBoundingClientRect();
  const photo = containedPhotoSize();
  const maxX = Math.max(0, (photo.width * zoomScale - viewport.width) / 2);
  const maxY = Math.max(0, (photo.height * zoomScale - viewport.height) / 2);
  panX = Math.min(maxX, Math.max(-maxX, panX));
  panY = Math.min(maxY, Math.max(-maxY, panY));
}

// Zooms in to DOUBLE_TAP_ZOOM centered on (clientX, clientY), or back out to
// 1x if already zoomed.
function toggleZoom(clientX, clientY) {
  if (zoomScale > 1) {
    resetZoom();
    return;
  }
  const rect = lightboxViewport.getBoundingClientRect();
  const offsetX = clientX - rect.left - rect.width / 2;
  const offsetY = clientY - rect.top - rect.height / 2;
  zoomScale = DOUBLE_TAP_ZOOM;
  panX = -offsetX * (zoomScale - 1);
  panY = -offsetY * (zoomScale - 1);
  clampPan();
  applyZoom(true);
}

let lastTapTime = 0;
let lastTapPos = null;

// A "tap" is a pointer down/up with barely any movement in between (checked
// by the caller). Two of those close together in time and position toggle
// zoom — handled here rather than the native dblclick event so touch and
// mouse behave the same way, and so it only fires after a real tap, never
// after a swipe or pan.
function maybeToggleZoomOnTap(x, y) {
  const now = Date.now();
  const isDoubleTap =
    now - lastTapTime < TAP_MAX_DELAY_MS && lastTapPos && Math.hypot(x - lastTapPos.x, y - lastTapPos.y) < TAP_MAX_MOVEMENT;

  if (isDoubleTap) {
    lastTapTime = 0;
    lastTapPos = null;
    toggleZoom(x, y);
  } else {
    lastTapTime = now;
    lastTapPos = { x, y };
  }
}

function pointerDistance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function pointerMidpoint(a, b) {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

const pointerDownPos = new Map(); // pointerId -> {x, y} at pointerdown, for tap detection
const activePointers = new Map(); // pointerId -> latest {x, y}
let panPointerId = null;
let panStart = null; // {x, y, panX, panY}
let pinchStartDistance = 0;
let pinchStartZoom = 1;
let pinchAnchor = null; // photo-space point under the pinch midpoint, fixed for the gesture

function beginPan(pointerId, x, y) {
  panPointerId = pointerId;
  panStart = { x, y, panX, panY };
}

function beginPinch() {
  const [a, b] = [...activePointers.values()];
  const rect = lightboxViewport.getBoundingClientRect();
  const mid = pointerMidpoint(a, b);
  const midX = mid.x - rect.left - rect.width / 2;
  const midY = mid.y - rect.top - rect.height / 2;
  pinchStartDistance = pointerDistance(a, b);
  pinchStartZoom = zoomScale;
  pinchAnchor = { x: (midX - panX) / zoomScale, y: (midY - panY) / zoomScale };
}

// Drag-to-swipe (touch, mouse, and pen alike via Pointer Events)
const DRAG_THRESHOLD_RATIO = 0.2;

lightboxViewport.addEventListener("pointerdown", (event) => {
  if (isAnimating) return;
  pointerDownPos.set(event.pointerId, { x: event.clientX, y: event.clientY });
  activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  try {
    lightboxViewport.setPointerCapture(event.pointerId);
  } catch {
    // Rare (e.g. the pointer was already released) - the rest of this
    // handler doesn't depend on capture succeeding, so just carry on.
  }

  if (activePointers.size === 2) {
    // A second finger landed - abandon any in-progress swipe/pan and start a pinch.
    dragStartX = null;
    dragOffset = 0;
    activePointerId = null;
    panPointerId = null;
    panStart = null;
    setTrackPosition(0, true);
    beginPinch();
  } else if (activePointers.size === 1) {
    if (zoomScale > 1) {
      beginPan(event.pointerId, event.clientX, event.clientY);
    } else {
      activePointerId = event.pointerId;
      dragStartX = event.clientX;
      dragOffset = 0;
    }
  }
});

// At either end of the album, dragging toward the missing photo gets heavy
// resistance instead of moving 1:1, so it reads as "hit the end" rather than
// dragging into blank space.
function withEdgeResistance(offset) {
  const atStart = currentIndex === 0;
  const atEnd = currentIndex === currentAlbum.photos.length - 1;
  if ((offset > 0 && atStart) || (offset < 0 && atEnd)) return offset / 4;
  return offset;
}

lightboxViewport.addEventListener("pointermove", (event) => {
  if (!activePointers.has(event.pointerId)) return;
  activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

  if (activePointers.size === 2) {
    if (!pinchAnchor) return; // shouldn't happen - beginPinch() runs whenever a 2nd pointer lands
    const [a, b] = [...activePointers.values()];
    const rect = lightboxViewport.getBoundingClientRect();
    const mid = pointerMidpoint(a, b);
    const midX = mid.x - rect.left - rect.width / 2;
    const midY = mid.y - rect.top - rect.height / 2;
    const distance = pointerDistance(a, b);
    zoomScale = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, pinchStartZoom * (distance / pinchStartDistance)));
    panX = midX - pinchAnchor.x * zoomScale;
    panY = midY - pinchAnchor.y * zoomScale;
    clampPan();
    applyZoom(false);
    return;
  }

  if (panPointerId === event.pointerId) {
    panX = panStart.panX + (event.clientX - panStart.x);
    panY = panStart.panY + (event.clientY - panStart.y);
    clampPan();
    applyZoom(false);
    return;
  }

  if (dragStartX === null || event.pointerId !== activePointerId) return;
  dragOffset = event.clientX - dragStartX;
  setTrackPosition(withEdgeResistance(dragOffset), false);
});

function endPointer(event) {
  const downPos = pointerDownPos.get(event.pointerId);
  pointerDownPos.delete(event.pointerId);
  const wasTracked = activePointers.delete(event.pointerId);
  const remaining = [...activePointers.entries()];

  if (wasTracked && remaining.length === 0 && downPos) {
    const moved = Math.hypot(event.clientX - downPos.x, event.clientY - downPos.y);
    if (moved < TAP_MAX_MOVEMENT) maybeToggleZoomOnTap(event.clientX, event.clientY);
  }

  if (panPointerId === event.pointerId) {
    panPointerId = null;
    panStart = null;
    if (zoomScale <= 1) resetZoom();
    return;
  }

  if (remaining.length === 1) {
    // Released one finger of a pinch - hand off to single-finger pan/swipe
    // using whichever pointer is still down.
    const [remainingId, pos] = remaining[0];
    if (zoomScale > 1) {
      beginPan(remainingId, pos.x, pos.y);
    } else {
      activePointerId = remainingId;
      dragStartX = pos.x;
      dragOffset = 0;
    }
    return;
  }

  if (dragStartX === null || event.pointerId !== activePointerId) return;

  const threshold = viewportWidth * DRAG_THRESHOLD_RATIO;
  if (dragOffset <= -threshold) {
    settleTo(1);
  } else if (dragOffset >= threshold) {
    settleTo(-1);
  } else {
    settleTo(0);
  }

  dragStartX = null;
  dragOffset = 0;
  activePointerId = null;
}

lightboxViewport.addEventListener("pointerup", endPointer);
lightboxViewport.addEventListener("pointercancel", endPointer);

// Scroll wheel is the desktop equivalent of pinch — zoom continuously,
// anchored under the cursor.
lightboxViewport.addEventListener(
  "wheel",
  (event) => {
    if (lightbox.hidden) return;
    event.preventDefault();

    const rect = lightboxViewport.getBoundingClientRect();
    const offsetX = event.clientX - rect.left - rect.width / 2;
    const offsetY = event.clientY - rect.top - rect.height / 2;
    const anchorX = (offsetX - panX) / zoomScale;
    const anchorY = (offsetY - panY) / zoomScale;

    const factor = Math.exp(-event.deltaY * 0.01);
    zoomScale = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoomScale * factor));
    panX = offsetX - anchorX * zoomScale;
    panY = offsetY - anchorY * zoomScale;
    clampPan();
    applyZoom(false);
  },
  { passive: false }
);

async function init() {
  try {
    const response = await fetch("js/albums.json", { cache: "no-store" });
    albums = await response.json();
  } catch (err) {
    console.error("Could not load albums.json", err);
    albums = [];
  }
  renderAlbums();
  ensureAlbumsHistoryBase();
  route();
}

init();
