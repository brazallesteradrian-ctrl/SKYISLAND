# Sky Island

Static Three.js experience. No package installation or build step is required.

```text
SKYISLAND/
|-- index.html
|-- assets/
|   |-- css/style.css
|   |-- js/
|   |   |-- main.js
|   |   `-- pictureFrames.js
|   |-- images/             # WebP images, including SUNSET.webp
|   `-- models/SKYC.glb     # Model with embedded textures
|-- .gitignore
`-- README.md
```

## Local preview

Open the project folder with VS Code Live Server and serve `index.html`.
Use an HTTP server instead of opening the file directly; the page loads ES modules and a GLB model.

## Deployment

Upload `index.html` and the entire `assets/` directory to your static host's public directory. Keep filenames and capitalization unchanged.

For a host with repository deployment settings:

- Framework preset: Other / Static HTML
- Build command: leave empty
- Publish/output directory: `.` (the project root)

For GitHub Pages, publish from the repository root on your chosen branch. All local asset paths are relative, so the page can also run under a project subdirectory.

The page needs internet access for Three.js, GSAP, Google Fonts, and the Draco decoder. These remain loaded from the existing CDN URLs.

Frames display fixed bundled images. The shared photo order is configured in `FRAME_IMAGES` in `assets/js/pictureFrames.js`; corresponding desktop and phone frames always use the same photo. No uploads or browser storage are used.

## Before publishing

Preview over HTTP and confirm the model and sunset load, the scroll animation works, and all 11 gallery photos appear automatically and remain the same after refreshing. Check both desktop and mobile layouts.

## Deployment security

Commit `vercel.json` for Vercel deployments. For Netlify, include `_headers` in the published root alongside `index.html` and `assets/`. Other hosts must be configured to send the same response headers; copying these files alone does not activate headers on every host.

The headers restrict resource origins, block framing, prevent MIME sniffing, limit referrer information, disable unused device permissions, and enable HSTS over HTTPS. Enable HTTPS and HTTP-to-HTTPS redirects in your hosting settings. The HTML also includes a fallback CSP for hosts without custom headers; clickjacking protection and HSTS require HTTP response headers.

The CSP allows the pinned Three.js/GSAP paths, Google Fonts, and the Draco decoder. Blob workers and WebAssembly are permitted for Draco. Inline styles remain allowed for GSAP animations; arbitrary inline JavaScript and JavaScript eval are blocked. The inline import map is authorized by its SHA-256 hash.

After changing the import map or security policy, run `node scripts/security.mjs`, then `node scripts/security.mjs --check`. No Node runtime or build step is needed on the deployed site.

After deployment, check the document response headers in browser DevTools and confirm there are no CSP errors while loading the model, scrolling, and rotating the screen. Header configuration has been checked locally; live enforcement must be verified on your chosen host.

All gallery images and the GLB are public downloadable assets. Do not place private files or credentials in the published directory. This static site has no authentication or server-side API.

Host configuration references: [Vercel configuration](https://vercel.com/docs/project-configuration/vercel-json), [Netlify custom headers](https://docs.netlify.com/manage/routing/headers/).
