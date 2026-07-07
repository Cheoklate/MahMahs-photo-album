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

## Add your real photos

1. Copy your photo files into the `photos/` folder (JPG or PNG, ideally resized to
   under ~1500px wide so the site loads quickly).
2. Open `js/photos.js` and replace the placeholder entries with your real filenames,
   in the order you want them to appear:

   ```js
   const photos = [
     { src: "photos/beach-1962.jpg", alt: "Grandma at the beach, 1962" },
     { src: "photos/wedding-1968.jpg", alt: "Wedding day, 1968" },
     // ...
   ];
   ```
3. Delete the `placeholder-*.svg` files and their entries once you're done.

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
