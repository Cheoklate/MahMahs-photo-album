const albumsView = document.getElementById("albums-view");
const albumsGrid = document.getElementById("albums-grid");
const albumView = document.getElementById("album-view");
const albumGrid = document.getElementById("album-grid");
const albumTitleEl = document.getElementById("album-title");
const backButton = document.getElementById("back-to-albums");

const lightbox = document.getElementById("lightbox");
const lightboxImage = lightbox.querySelector(".lightbox-image");
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

// Lightbox — scoped to whichever album is currently open

function openLightbox(album, index) {
  currentAlbum = album;
  currentIndex = index;
  showPhoto();
  lightbox.hidden = false;
  document.body.style.overflow = "hidden";
}

function closeLightbox() {
  lightbox.hidden = true;
  document.body.style.overflow = "";
}

function showPhoto() {
  const photo = currentAlbum.photos[currentIndex];
  lightboxImage.src = photo.src;
  lightboxImage.alt = photo.alt || "";
}

function showNext() {
  currentIndex = (currentIndex + 1) % currentAlbum.photos.length;
  showPhoto();
}

function showPrev() {
  currentIndex = (currentIndex - 1 + currentAlbum.photos.length) % currentAlbum.photos.length;
  showPhoto();
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

// Touch swipe support (mobile) — swipe left/right to move between photos
let touchStartX = null;
let touchStartY = null;

lightbox.addEventListener(
  "touchstart",
  (event) => {
    touchStartX = event.changedTouches[0].clientX;
    touchStartY = event.changedTouches[0].clientY;
  },
  { passive: true }
);

lightbox.addEventListener(
  "touchend",
  (event) => {
    if (touchStartX === null) return;
    const dx = event.changedTouches[0].clientX - touchStartX;
    const dy = event.changedTouches[0].clientY - touchStartY;

    // Ignore mostly-vertical swipes so scrolling gestures aren't mistaken for navigation
    if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy)) {
      if (dx < 0) showNext();
      else showPrev();
    }

    touchStartX = null;
    touchStartY = null;
  },
  { passive: true }
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
  route();
}

init();
