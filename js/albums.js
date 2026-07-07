// The photo album's contents, organized into albums.
//
// To add your own photos:
//   1. Create a folder under photos/ for the album (e.g. photos/wedding/).
//   2. Copy your image files into it.
//   3. Add or edit an album entry below. "id" must be unique and URL-safe
//      (letters, numbers, hyphens) — it's used to link directly to an album.
//   4. List each photo in the order you want it to appear within the album.
//
// "alt" is a short description used for accessibility (screen readers) —
// it does not show up as a visible caption.

const albums = [
  {
    id: "childhood",
    title: "Childhood",
    photos: [
      { src: "photos/childhood/placeholder-1.svg", alt: "Childhood placeholder photo 1" },
      { src: "photos/childhood/placeholder-2.svg", alt: "Childhood placeholder photo 2" },
      { src: "photos/childhood/placeholder-3.svg", alt: "Childhood placeholder photo 3" },
    ],
  },
  {
    id: "family-friends",
    title: "Family & Friends",
    photos: [
      { src: "photos/family-friends/placeholder-1.svg", alt: "Family & Friends placeholder photo 1" },
      { src: "photos/family-friends/placeholder-2.svg", alt: "Family & Friends placeholder photo 2" },
      { src: "photos/family-friends/placeholder-3.svg", alt: "Family & Friends placeholder photo 3" },
    ],
  },
  {
    id: "celebrations",
    title: "Celebrations",
    photos: [
      { src: "photos/celebrations/placeholder-1.svg", alt: "Celebrations placeholder photo 1" },
      { src: "photos/celebrations/placeholder-2.svg", alt: "Celebrations placeholder photo 2" },
      { src: "photos/celebrations/placeholder-3.svg", alt: "Celebrations placeholder photo 3" },
    ],
  },
];
