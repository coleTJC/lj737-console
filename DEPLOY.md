# Deploy LJ737 Console for free

## Inspection result

This ZIP is the complete Device Lab static website: plain HTML, CSS and browser JavaScript modules. There is no framework, dependency installation, build command, backend or paid service. `package.json` only supplies optional local-server and test commands; Node.js is not required on GitHub Pages or on your phone.

No application-code changes are needed for GitHub Pages. `index.html` loads `style.css`, `lab.css` and `js/app.js` with relative paths; JavaScript imports are relative to their modules. The home link is `./`. There are no root-relative asset paths, client-side URL routes, service workers or localhost API calls to reconfigure. `.nojekyll` is included.

## Publish to your repository

1. Extract this ZIP. Its contents start directly with `index.html`, `style.css`, `lab.css`, `js/`, `.nojekyll` and documentation; there is no enclosing project folder inside the ZIP.
2. Open https://github.com/coleTJC/lj737-console and ensure the repository is public to use GitHub Pages on GitHub Free.
3. Choose **Add file → Upload files**. Upload the extracted files and folders into the repository root, preserving `js/`. Do not upload the ZIP itself or an enclosing `lj737-console` folder. Commit the upload to `main` (or your existing default branch). Include `.nojekyll`; enable hidden-file display if needed.
4. Open https://github.com/coleTJC/lj737-console/settings/pages. Under **Build and deployment**, set **Source → Deploy from a branch**, choose the branch containing your files, and select **/(root)**. Click **Save**. No custom build workflow is needed.
5. Wait for the Pages deployment to finish; the repository's **Actions** tab shows progress and any errors. Leave the custom-domain setting empty and use **Enforce HTTPS** if available.
6. Open https://coleTJC.github.io/lj737-console/ directly in Chrome on Android or Chrome/Edge on a Windows PC with Bluetooth.

## Bluetooth when hosted

GitHub Pages supplies the HTTPS origin required by Web Bluetooth. The `/lj737-console/` subpath does not change Bluetooth access or require a special base URL, CORS setup or proxy. The existing Connect button invokes the browser's device picker from a click, and the transport requests access to the main watch service plus battery and device-information services.

Turn Bluetooth on, disconnect FitPro or any other app using the watch, tap **Connect watch**, and choose **MOVEMENT**. Grant the requested browser/Android permissions. Use the full page, not an embedded preview or in-app browser. Each PC or phone connects directly to a nearby watch; the website does not relay Bluetooth from another device. Open **Device Lab** to preview and test commands. Firmware flashing remains disabled.

## Verification scope

The package is designed for direct replacement of the repository-root files. Physical watch communication must still be checked with your watch. Session logs and private Bluetooth captures are not included in the ZIP.

Official references:
- https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site
- https://developer.chrome.com/docs/capabilities/bluetooth
