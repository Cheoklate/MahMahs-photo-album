# Grandma's 80th Birthday Photo Album

A simple, warm photo gallery site to celebrate Grandma's 80th birthday — built so you
can share it with her friends and family with just a link.

## Preview it locally

Just open `index.html` in a browser, or run a tiny local server from this folder:

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
2. Open `js/albums.js` and edit the `albums` list. Each album needs a unique
   `id`, a `title`, and a list of photos in the order you want them to appear:

   ```js
   const albums = [
     {
       id: "wedding",
       title: "Wedding Day",
       photos: [
         { src: "photos/wedding/ceremony.jpg", alt: "Wedding ceremony, 1968" },
         { src: "photos/wedding/reception.jpg", alt: "Reception dance, 1968" },
         // ...
       ],
     },
     // more albums...
   ];
   ```
3. Delete the `photos/childhood`, `photos/family-friends`, and
   `photos/celebrations` placeholder folders (and their entries in
   `js/albums.js`) once you have real albums in.

The album's cover thumbnail is always its first listed photo.

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

### A privacy note

GitHub Pages sites are public — anyone with the link can view them, and (unlike a
private repo) there's no login or access control. This site already includes a
`noindex` tag so search engines won't index or list it, so it's effectively
"unlisted" (only reachable if someone has the exact link), but not
password-protected. That's usually fine for sharing photos with friends, but avoid
including anything sensitive, and pick a repo/URL name that isn't easily guessable
if you'd like extra obscurity.
