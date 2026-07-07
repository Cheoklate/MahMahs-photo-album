const gallery = document.getElementById("gallery");
const lightbox = document.getElementById("lightbox");
const lightboxImage = lightbox.querySelector(".lightbox-image");
const closeBtn = lightbox.querySelector(".lightbox-close");
const prevBtn = lightbox.querySelector(".lightbox-prev");
const nextBtn = lightbox.querySelector(".lightbox-next");

let currentIndex = 0;

function buildGallery() {
  photos.forEach((photo, index) => {
    const figure = document.createElement("figure");
    const button = document.createElement("button");
    const img = document.createElement("img");

    img.src = photo.src;
    img.alt = photo.alt || "";
    img.loading = "lazy";

    button.appendChild(img);
    button.addEventListener("click", () => openLightbox(index));

    figure.appendChild(button);
    gallery.appendChild(figure);
  });
}

function openLightbox(index) {
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
  const photo = photos[currentIndex];
  lightboxImage.src = photo.src;
  lightboxImage.alt = photo.alt || "";
}

function showNext() {
  currentIndex = (currentIndex + 1) % photos.length;
  showPhoto();
}

function showPrev() {
  currentIndex = (currentIndex - 1 + photos.length) % photos.length;
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

buildGallery();
