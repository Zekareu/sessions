# Sessions

A static browser app with eight training modes and minimal black and white menus. The layout uses the full browser width and adapts the number of mode columns to the screen. Original mode artwork features stylized cel-shaded illustrations of a female character interacting with each mode's mechanics.

During a game, the screen uses translucent state colors over a dark base: violet means keep holding because release is punished, yellow warns that action is needed soon, red means feedback is active, and green means release is safe. Gray is the neutral or resting state.

## Share a session

Choose a mode, adjust its setup, and press **Copy share link** below the Play button. Send the copied link from your published site to someone else. Opening it selects the mode and applies the saved setup, then waits on the setup screen for the recipient to review and press Play.

The link includes only choices on that mode's setup screen, including its intensity controls. It does not include device credentials, webhook URLs, account details, input source, or other connection settings. Each recipient configures their own output in Settings. A link made from a local server address will only work for someone who can reach that server.

## Publish on GitHub Pages

1. Put the contents of this folder in the root of a GitHub repository.
2. In the repository, open **Settings → Pages**.
3. Under **Build and deployment**, choose **Deploy from a branch**, select your branch, and select **/(root)**.
4. Save and open the URL shown by GitHub Pages.

The app uses relative paths, so it works at either a user site or a repository site. `.nojekyll` tells Pages to serve the files as written. `run.sh` is only for local preview; GitHub Pages does not run the embedded Python server.

## Configure outputs

Settings are beside the mode cards on wide screens. On smaller screens, use the **Sessions** and **Settings** tabs. Choose OpenShock, PiShock, or Webhook; only fields for the selected output are shown. Webhook mode sends a generic punishment event, so action, intensity, and duration controls are hidden. Settings are stored in that browser's local storage and are not included in this repository. Any token previously embedded in an older copy of the app should be revoked before publishing.

PiShock uses the [documented legacy control API](https://docs.pishock.com/pishock/api-documentation/pishock-legacy-api-documentation.html). It needs your PiShock username, API key, and an active share code. The API takes whole seconds, so this app rounds the configured duration up to the next second. A browser may block requests if PiShock does not allow your site's origin; in that case use a CORS-enabled webhook relay.

The punishment webhook receives an HTTP `POST` with `Content-Type: application/json`:

```json
{
  "event": "punishment",
  "game": "game-rhythm",
  "timestamp": "2026-11-10T12:00:00.000Z"
}
```

The receiving endpoint must allow cross-origin requests from your GitHub Pages origin. For a Pages site served over HTTPS, use an HTTPS webhook URL. The **Test punishment** button sends a real request using the current fields in Settings.

The optional reward webhook is separate from the feedback output. It sends one HTTP `POST` when a session is completed:

```json
{
  "event": "reward",
  "result": "completed",
  "game": "game-rhythm",
  "test": false,
  "timestamp": "2026-11-10T12:00:00.000Z"
}
```

It can use an optional bearer token. **Test reward** sends the same event with `"game": "test"` and `"test": true`. The endpoint needs to accept cross-origin requests, and an HTTPS Pages site needs an HTTPS reward URL.

The optional hardware input WebSocket connects to a separate sensor service. If you use it from the HTTPS Pages site, the sensor service needs a browser-accessible secure WebSocket (`wss://`).

## Local preview

Run `./run.sh` (or `bash run.sh` if executable permissions were lost in a download) and open the local URL printed by the server. The script needs only Bash and Python 3 with its standard library. It serves files from the folder containing `run.sh`, so it works after downloading or moving the folder. Set `PORT=8765 ./run.sh` if you want a specific port.
