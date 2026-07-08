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

function photoAt(offset) {
  const len = currentAlbum.photos.length;
  const index = (currentIndex + offset + len) % len;
  return currentAlbum.photos[index];
}

function updateSlides() {
  const prev = photoAt(-1);
  const current = photoAt(0);
  const next = photoAt(1);

  prevSlide.src = prev.src;
  prevSlide.alt = prev.alt || "";
  currentSlide.src = current.src;
  currentSlide.alt = current.alt || "";
  nextSlide.src = next.src;
  nextSlide.alt = next.alt || "";
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
}

function closeLightbox() {
  lightbox.hidden = true;
  document.body.style.overflow = "";
}

// direction: 1 to advance to the next photo, -1 for the previous photo
function settleTo(direction) {
  if (isAnimating) return;

  if (direction === 0) {
    setTrackPosition(0, true);
    return;
  }

  isAnimating = true;
  setTrackPosition(-direction * viewportWidth, true);
  lightboxTrack.addEventListener(
    "transitionend",
    () => {
      currentIndex = (currentIndex + direction + currentAlbum.photos.length) % currentAlbum.photos.length;
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

// Drag-to-swipe (touch, mouse, and pen alike via Pointer Events)
const DRAG_THRESHOLD_RATIO = 0.2;

lightboxViewport.addEventListener("pointerdown", (event) => {
  if (isAnimating) return;
  activePointerId = event.pointerId;
  dragStartX = event.clientX;
  dragOffset = 0;
  lightboxViewport.setPointerCapture(activePointerId);
});

lightboxViewport.addEventListener("pointermove", (event) => {
  if (dragStartX === null || event.pointerId !== activePointerId) return;
  dragOffset = event.clientX - dragStartX;
  setTrackPosition(dragOffset, false);
});

function endDrag(event) {
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

lightboxViewport.addEventListener("pointerup", endDrag);
lightboxViewport.addEventListener("pointercancel", endDrag);

async function init() {
  try {
    const response = await fetch("js/albums.json", { cache: "no-store" });
    albums = await response.json();
  } catch (err) {
    console.error("Could not load albums.json", err);
    albums = [];
  }
  renderAlbums();
  route();
}

init();
