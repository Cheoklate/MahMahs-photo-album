# Grandma's 80th Birthday Photo Album

A simple, warm photo gallery site to celebrate Grandma's 80th birthday — built so you
can share it with her friends and family with just a link.

## Preview it locally

The gallery loads its photo list from `js/albums.json` via `fetch()`, which
browsers block when a page is opened directly as a `file://` URL — so you do
need a local server (not just double-clicking `index.html`):

```
python3 -m http.server 8000
```

Then visit http://localhost:8000

## Personalize it

- **Title/subtitle**: edit the text inside `<header class="hero">` in `index.html`.
  Add Grandma's name to the `<h1>` if you'd like (e.g. "Happy 80th Birthday, Grace!").
- **Colors/fonts**: tweak the CSS variables at the top of `css/style.css`.

## How it's organized

Photos are grouped into **albums**. The home page shows a grid of albums (cover
photo + title); tapping one opens that album's own photo grid; tapping a photo
opens it full-screen where you can swipe (or use arrow keys / the on-screen
arrows) to move through the rest of that album's photos.

## Add your real photos

1. For each album, create a folder under `photos/` (e.g. `photos/wedding/`) and
   copy your photo files into it — JPG or PNG, ideally resized to under ~1500px
   wide so the site loads quickly.
2. Open `js/albums.json` and edit the list. Each album needs a unique `id`, a
   `title`, and a list of photos in the order you want them to appear:

   ```json
   [
     {
       "id": "wedding",
       "title": "Wedding Day",
       "photos": [
         { "src": "photos/wedding/ceremony.jpg", "alt": "Wedding ceremony, 1968" },
         { "src": "photos/wedding/reception.jpg", "alt": "Reception dance, 1968" }
       ]
     }
   ]
   ```
Currently set up: `grandkids`, `kids`, and `80th-at-bali` — all start empty,
ready for photos to be added.

The album's cover thumbnail is always its first listed photo. Albums with zero
photos are hidden
from the home page until they have at least one photo.

## Deploy to GitHub Pages

1. Create a new **public** repository on GitHub (e.g. `grandma-80th-birthday`).
2. From this folder, push the code:

   ```
   git init
   git add .
   git commit -m "Initial photo album"
   git branch -M main
   git remote add origin https://github.com/<your-username>/<repo-name>.git
   git push -u origin main
   ```
3. On GitHub, go to the repo's **Settings → Pages**, and under "Build and
   deployment", set Source to "Deploy from a branch", branch `main`, folder `/ (root)`.
4. After a minute, your site will be live at:

   ```
   https://<your-username>.github.io/<repo-name>/
   ```

   That's the link you can share with Grandma's friends.

### A cache-busting note

GitHub Pages caches every file for 10 minutes with no way to turn that off, so
after deploying a change to `css/style.css` or `js/script.js`, a visitor's
browser can keep serving the old version of one file alongside the new
version of the other — which can break things if the two are out of sync.
`index.html` links to them as `style.css?v=2` / `script.js?v=2`; bump that
number whenever you edit either file so browsers are forced to fetch the new
version instead of an old cached one.

### A privacy note

GitHub Pages sites are public — anyone with the link can view them, and (unlike a
private repo) there's no login or access control. This site already includes a
`noindex` tag so search engines won't index or list it, so it's effectively
"unlisted" (only reachable if someone has the exact link), but not
password-protected. That's usually fine for sharing photos with friends, but avoid
including anything sensitive, and pick a repo/URL name that isn't easily guessable
if you'd like extra obscurity.
