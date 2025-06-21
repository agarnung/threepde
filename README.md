# threepde

A 3D visualization of image evolution under partial differential equations

# Summary

The input images must be WebP format, since RGBA is read. Converting a monochrome image to WebP and then passing it to the web is valid.

The project folder structure is designed to be modular, optimized, and separate responsibilities, e.g., static web parts from public or asset files, and from CI/CD components:

```txt
alejandro@DESKTOP-AIFFN1L:/opt/threepde$ tree
.
├── LICENSE
├── XXXX-XX-XX-three-PDE.md
├── index.html
├── public
│   ├── css
│   │   └── styles.css
│   ├── favicon.ico
│   └── images
│       ├── lena_gray.webp
│       └── lena_rgb.webp
└── src
    ├── helpers
    │   ├── color-maps.js
    │   ├── image-mesh-converter.js
    │   └── image-preprocessor.js
    ├── main.js
    └── solver.js
```

During development, only files inside src/ are modified. New images (by default, ones the user can select with a selector) are added to assets/images/ and are immediately accessible by the client in their original format without transfer processing. To preview the site during development, you can use [_Live Server_](https://marketplace.visualstudio.com/items?itemName=ritwickdey.LiveServer) or [_Live Preview_](https://marketplace.visualstudio.com/items?itemName=ms-vscode.live-server) in VSCode (accessible at http://localhost:5500), which serves index.html locally and reloads automatically when saving changes; thus, no backend (Flask, etc.) is required since everything served is static.

We use Three.js via CDN for both development and production, specified in index.html. This avoids duplicates in the repository, leverages browser cache, and uses a minified, optimized version of the library.

```html
<!-- In index.html (ALWAYS use CDN) -->
<script src="https://cdn.jsdelivr.net/npm/three@0.128.0/build/three.min.js"></script>
```

We use GitHub Actions to detect pushes to main and automatically minify all JS files in src/ to assets/js/main.min.js — i.e., to minify and deploy the website. This keeps the src/ code intact and only uploads the final optimized version to GitHub Pages, where it is served. This project is served via GitHub Pages, which delivers only static content (HTML, CSS, JS) with no backend required. In contrast, platforms like PythonAnywhere use Flask to run Python servers generating dynamic content. That’s why no backend is needed or configured here.

We should commit our entire src/, index.html, public/ and the YAML (workflow) file, to keep track of them, but not the dist/, because this is a temporary directvory were we copy the "ready-to-publish" files (we use a PAT with `workflow` permisson enabled).

```yaml
name: Deploy to GitHub Pages

on:
  push:
    branches:
      - main

jobs:
  build:
    runs-on: ubuntu-latest

    steps:
      - name: Checkout code
        uses: actions/checkout@v4

      - name: Install dependencies
        run: npm install -g terser

      - name: Build and Minify
        run: |
          mkdir -p dist/assets/js
          mkdir -p dist/assets/css
          cp index.html dist/
          cp -r public/images dist/images
          cp public/favicon.ico dist/
          
          # Minify JS
          npx terser "src/**/*.js" -c -m -o dist/assets/js/main.min.js

          # Minify CSS
          npx cleancss -o dist/assets/css/styles.min.css public/css/styles.css

      - name: Deploy to GitHub Pages
        uses: peaceiris/actions-gh-pages@v3
        with:
          github_token: ${{ secrets.GITHUB_TOKEN }}
          publish_dir: dist
```

To decide which JS scripts to load from index.html, a conditional loading block based on the current URL could be created, to differentiate whether to load our source code in development or the minified bundle in production:

```html
<!-- Conditional loading based on URL -->
<script>
  if (window.location.hostname === 'localhost') {
    // Development: load individual modules
    document.write('<script src="src/image-processor.js"><\/script>');
    document.write('<script src="src/pde-simulator.js"><\/script>');
  } else {
    // Production: load minified bundle
    const script = document.createElement('script');
    script.src = 'assets/js/main.min.js';
    script.defer = true;
    document.head.appendChild(script);
  }
</script>
```

Thus, on localhost we develop with individual source files, and on our domain (or here on github.io) the [minified bundle ](https://diegobersano.wordpress.com/2014/05/21/bundles-minificacion-y-cdn-en-asp-net-mvc/)is used automatically.

There are two types of images in the project:

1. Static images, predefined by me in public/images/, which are part of the repository and must be optimized. For example, tools like ImageMagick or squoosh-cli should be used to convert them to an optimized format (e.g., WebP) before uploading, to reduce repository size, improve initial load time, and reduce bandwidth:

```bash
convert lena.png -resize 512x512 -quality 99 public/images/lena.webp

npx @squoosh/cli --webp '{quality:99}' lena.png -d public/images/
```

2. Images uploaded by the user, coming from their local system, processed immediately and entirely in the browser. The flow is as follows:

```txt
The User selects an image in the Browser.

The browser uses the FileReader API (JavaScript) to read the image file.

JavaScript then draws the image onto an HTML Canvas.

From the canvas, JavaScript gets the image pixel data using getImageData().

The pixel data is normalized to values between 0 and 1.

JavaScript uses Three.js to create a heightmap based on the normalized data.

Finally, WebGL renders the heightmap visually.
```

For curiosity, the complete development and production workflow would be:

```txt
Edit files in the src/ folder.

Preview changes using a Live Server.

Check if it works correctly:

    If yes, push to GitHub.

    If no, go back to editing files.

GitHub Actions minify and deploy the project automatically.

The site becomes available at user.github.io/repo.
```

Additionally, we use [MathJax](<https://docs.mathjax.org/en/stable/start.html#using-the-mathjax-content-delivery-network-cdn)[Jax](https://stackoverflow.com/questions/49300667/which-mathjax-cdn-script-should-be-used>) (v3) to write equations, although MathML (native to HTML5) could also be used, but it is less readable and does not support LaTeX. A polyfill is also used to guarantee that some ES6 JavaScript features are available on older browsers that do not support them natively.

The ES6 version (three.module.js) is used with an import map, and not the UMD (three.min.js), as it is the [recommended modern version](https://discourse.threejs.org/t/umd-version-of-three-js-v-161/60912).

We also use Stats.js (from CDN) to display FPS.

To be precise, exponential decay is an ODE, not a PDE, so there is no spatial propagation and no CFL condition is required, but it does have a stability condition. For many more interesting PDEs applied to images, see [image-inpainting-app](https://www.researchgate.net/publication/387140474_Physics_Meets_Pixels_PDE_Models_in_Image_Processing/stats) and [Physics Meets Pixels: PDE Models in Image Processing](https://arxiv.org/abs/2412.11946).

> [!NOTE]
> Whatever the input image type, PDEs are solved using the luminance channel (even if RGB values are shown on top; the evolution is governed by the monochrome intensity here).

To learn more about boundary conditions: https://en.wikipedia.org/wiki/Boundary_value_problem#Examples. And check more discretization schemes: [forward Euler, backward Euler, Crank-Nicholson, forward-backward Euler, etc.](https://en.wikipedia.org/wiki/Explicit_and_implicit_methods).

In constant-color mode (useOriginalRGB = true), the RGB colors of the image remain completely unchanged — this is like placing the original image as a mantle over the mesh. The surface has no color evolution; the image looks intact. It no longer truly behaves like a heightmap, since the mesh is essentially just being draped with the image as a texture. All heightmap cells share the same color, which looks uniform and gray but is preserved to emphasize colormap functionality. Only in this mode does the 2D canvas display the image at original resolution because the solver does not alter intensity pixel-by-pixel. Other modes downsample images to 512×512 to optimize solver performance.

In contrast, constant-chrominance mode (useOriginalRGB = false) combines the evolving height (L, from lightness or luminance) with the original chrominance (a, b channels from LAB color space). Here, the color changes over time according to the height evolution, but the original chrominance is preserved. This mode gives a more physically informed visual feedback of the PDE evolution, while maintaining some of the original image’s color identity.

# References

- Inspired by the simulation from https://github.com/chrismars91/fdm?tab=readme-ov-file

- 3 options to use THREE.js in our project: https://discourse.threejs.org/t/help-getting-set-up-with-vscode-and-three-js/19606.

# TODO

- Regarding the variable needToUpdate: TODO run the solver in another thread and manage a shared variable with a mutex to notify when computation finishes, so rendering continues using the current state until it finishes, avoiding blocking rendering if the solver step is not complete yet. This should be done with a Web Worker, but it is challenging.

- Allow real-time control of roughness and metalness of the mesh material (see createHeightMesh()). Also allow switching the material type (basic or standard, etc.) in a dedicated Three.js options panel.

- Add a paragraph about the original "lab mode". Explain that in "mantle mode" the image remains intact (meaning "mantle mode" really means "keep original colors" mode, while the non-mantle mode means "keep original chrominance" mode).

- Allow users to select the heightmap size? Either by specifying width and height or by width or height while maintaining aspect ratio (not forced 512x512).