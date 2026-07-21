# Armory Notes

A Tampermonkey/Torn PDA userscript that adds shared notes, color tags, and ownership labels to Torn items.

Armory Notes is designed for faction use. Authorized Leadership and Council members can add, edit, and delete shared notes, while everyone else can view existing notes in read-only mode.

## Features

- Shared notes stored on a central server
- Notes synchronized between faction members
- Owner labels for assigned items
- Custom color tags
- Hover tooltips on desktop
- Tap tooltips on mobile
- Leadership and Council access control
- Read-only fallback for unauthorized users
- Torn PDA and mobile support
- Settings entry under **Settings → Utilities**
- Tampermonkey menu controls
- Automatic script updates through GitHub
- Local caching for faster page loading
- Support for:
  - Torn Inventory
  - Faction Armory
  - Trade item lists
- Compatibility styling for **RW Bonus Convenient Name**

## Supported Pages

The script runs on Torn pages and adds the notes interface on:

- `https://www.torn.com/item.php`
- `https://www.torn.com/factions.php?step=your`
- `https://www.torn.com/trade.php`

The broader `https://www.torn.com/*` match is used so the script can add its API-key control to Torn PDA/mobile settings.

## Installation

### Tampermonkey

1. Install the Tampermonkey browser extension.
2. Open the raw userscript file:

   ```text
   https://raw.githubusercontent.com/TravisDoo/TNL-Torn-Scripts/main/Armory.user.js
   ```

3. Tampermonkey should open an installation page.
4. Select **Install**.
5. Reload Torn.

### Torn PDA

1. Open the raw userscript file in Torn PDA.
2. Install or import the userscript.
3. Reload Torn.
4. Open **Settings → Utilities**.
5. Select **Armory Notes API Key** to configure access.

## Torn API Key Setup

Armory Notes uses a user's **Public Only** Torn API key to verify their Torn identity and determine their access level.

Create the key in Torn:

1. Open Torn.
2. Go to **Settings**.
3. Open **API Keys**.
4. Create a new key.
5. Select **Public Only** access.
6. Copy the key.
7. Enter it when Armory Notes prompts you.

The key can also be changed later.

### Tampermonkey

Open the Tampermonkey script menu and select:

```text
🔑 Set / update Torn API key
```

### Torn PDA or Mobile

Open:

```text
Settings → Utilities → Armory Notes API Key
```

Leaving the key blank keeps the script in read-only mode.

## Access Levels

The server determines access based on the Torn account associated with the submitted public API key.

| Role | View Notes | Add/Edit Notes | Delete Notes | Manage Access |
|---|---:|---:|---:|---:|
| Read-only | Yes | No | No | No |
| Council | Yes | Yes | Yes | No |
| Leadership | Yes | Yes | Yes | Yes |

Users with no API key, an invalid API key, or no assigned role automatically receive read-only access.

## Using Armory Notes

### View a Note

Items with saved notes display the note as a tooltip.

- **Desktop:** Hover over the item row.
- **Mobile:** Tap the item row.

### Add or Edit a Note

Authorized users see a note button beside supported items:

```text
📝
```

Selecting the button prompts for:

1. Note text
2. Color tag
3. Owner name

The color value may be a CSS color name or hex value.

Examples:

```text
red
orange
#ff5500
#2ecc71
```

### Delete a Note

Authorized users can enable deletion mode from the userscript menu:

```text
🧨 Toggle Deletion Mode
```

While deletion mode is enabled, selecting an item's `📝` button deletes the saved note instead of opening the edit prompts.

Disable deletion mode when finished.

## Leadership Access Manager

Leadership members receive an additional menu option:

```text
👑 Manage Leadership / Council
```

The access manager allows Leadership to:

- View current Leadership members
- View current Council members
- Add members by Torn ID
- Remove members
- See the authenticated user's current entry

Names may initially display as `(pending)` until that member loads the script and authenticates against the server.

## Userscript Menu Options

Depending on the authenticated role, the following commands may appear:

| Command | Purpose |
|---|---|
| `🎨 Theme: Torn Dark` | Switches between tooltip themes |
| `🔑 Set / update Torn API key` | Saves, replaces, or clears the user's public Torn API key |
| `👑 Manage Leadership / Council` | Opens the access manager for Leadership |
| `🧨 Toggle Deletion Mode` | Enables or disables note deletion mode |
| `🧹 Clear Notes Cache` | Clears locally cached note data |
| `ℹ️ My Access Level` | Displays the authenticated account and permissions |

## Automatic Updates

The userscript checks the GitHub raw file configured in its metadata:

```javascript
// @updateURL    https://raw.githubusercontent.com/TravisDoo/TNL-Torn-Scripts/main/Armory.user.js
// @downloadURL  https://raw.githubusercontent.com/TravisDoo/TNL-Torn-Scripts/main/Armory.user.js
```

To publish an update:

1. Edit `Armory.user.js`.
2. Increase the `@version` number.
3. Commit and push the change to the `main` branch.
4. Wait for GitHub's raw file to update.
5. In Tampermonkey, select **Check for userscript updates** or wait for its scheduled update check.

Example:

```javascript
// @version      3.5
```

Tampermonkey will not install an update unless the new `@version` is greater than the installed version.

## Server Configuration

The client currently connects to:

```javascript
const SERVER_BASE = 'https://bunch-uphold-antennae.ngrok-free.dev/armory';
const TEAM_ID = 'tnl-faction';
```

The script sends these headers to the server:

```text
Content-Type: application/json
X-API-Key: <shared application key>
X-Torn-API-Key: <user public Torn API key>
ngrok-skip-browser-warning: 1
```

The userscript metadata must allow the server hostname:

```javascript
// @connect      bunch-uphold-antennae.ngrok-free.dev
```

When the ngrok hostname changes, update both:

1. `SERVER_BASE`
2. The `@connect` metadata entry

Then increase the script version and push the update.

## Expected API Endpoints

The userscript expects the following server routes.

### Access Check

```http
GET /armory/api/access-check
```

Expected response:

```json
{
  "role": "leadership",
  "canWrite": true,
  "userId": 2605556,
  "name": "Dooby",
  "authenticated": true
}
```

### Read a Note

```http
GET /armory/api/torn-notes/:teamId/:itemKey
```

Example response:

```json
{
  "note": "Reserved for ranked war",
  "colour": "#ff5500",
  "owner": "Dooby"
}
```

### Save a Note

```http
PUT /armory/api/torn-notes/:teamId/:itemKey
```

Example body:

```json
{
  "note": "Reserved for ranked war",
  "colour": "#ff5500",
  "owner": "Dooby"
}
```

### Delete a Note

```http
DELETE /armory/api/torn-notes/:teamId/:itemKey
```

### Read Access Lists

```http
GET /armory/api/council
```

### Add or Remove Leadership

```http
POST /armory/api/leadership/add
POST /armory/api/leadership/remove
```

Example body:

```json
{
  "userId": 2605556
}
```

### Add or Remove Council

```http
POST /armory/api/council/add
POST /armory/api/council/remove
```

Example body:

```json
{
  "userId": 2605556
}
```

## Item Keys

Armory Notes attempts to identify an item using the most reliable available identifier.

Priority:

1. Armory ID
2. Item ID
3. Normalized item name

Examples:

```text
armoryid:123456
itemid:206
name:dual 92g berettas
```

Trade rows without a usable Armory ID or Item ID are skipped to reduce the chance of attaching a note to the wrong item.

## Caching

The script uses a stale-while-revalidate style cache.

- Cache lifetime: 30 seconds
- Cached data is displayed immediately
- Stale entries are refreshed from the server
- Concurrent requests for the same item are combined
- Up to eight note refreshes are processed in parallel

To manually remove cached data, use:

```text
🧹 Clear Notes Cache
```

## Tooltip Themes

Two tooltip themes are included:

- Torn Dark
- Torn Green

Use the userscript menu command to cycle between them:

```text
🎨 Theme: Torn Dark
```

The selected theme is saved locally for the current userscript installation.

## Troubleshooting

### The Edit Button Does Not Appear

Check the following:

1. A valid Public Only Torn API key is saved.
2. **My Access Level** shows `Write access: yes`.
3. Your Torn ID is listed under Council or Leadership.
4. The access-check endpoint is reachable.
5. The page is one of the supported item, faction, or trade pages.
6. Reload Torn after changing the API key or permissions.

### The Script Shows Read-only Access

Possible causes:

- No Torn API key is saved
- The key is invalid
- The key is not Public Only
- The server cannot validate the key
- Your Torn ID is not in the Council or Leadership list
- The server or ngrok tunnel is unavailable

Use:

```text
ℹ️ My Access Level
```

to see the current authenticated user and role.

### Torn PDA Does Not Show the Menu Command

Torn PDA may not expose `GM_registerMenuCommand` consistently.

Use the in-page fallback:

```text
Settings → Utilities → Armory Notes API Key
```

### The Settings Button Is Missing

1. Open Torn PDA Settings.
2. Select or reload the Utilities section.
3. Wait for Torn's settings interface to finish rendering.
4. Close and reopen Settings.
5. Reload Torn PDA.

The script observes dynamically rendered page content and attempts to insert the button whenever the Utilities section is mounted.

### Notes Are Not Updating

1. Clear the local cache.
2. Reload the page.
3. Confirm the ngrok tunnel is online.
4. Test `/armory/api/access-check`.
5. Confirm the note endpoints return JSON.
6. Check the browser console for messages beginning with:

```text
[TornNotes]
```

To enable additional logging, change:

```javascript
const DEBUG = false;
```

to:

```javascript
const DEBUG = true;
```

### A GitHub Update Is Not Detected

Confirm:

1. The filename is exactly `Armory.user.js`.
2. The file is on the `main` branch.
3. The raw GitHub URL opens the newest script.
4. The `@version` value was increased.
5. The installed script uses the same `@updateURL`.
6. GitHub has finished serving the latest raw file.

Version comparison is numeric by segment. For example:

```text
3.5 > 3.4
3.4.1 > 3.4
4.0 > 3.9.9
```

## Security Notes

- Only use a **Public Only** Torn API key.
- Do not request or store Full Access Torn API keys.
- The user's key is stored through the userscript manager's value storage.
- The key is sent to the configured Armory Notes server for identity verification.
- Use HTTPS for the public server endpoint.
- Server-side authorization must be enforced for every write, delete, and access-management request.
- Client-side checks such as `USER_CAN_WRITE` improve the interface but must not be treated as security controls.
- Do not place server administrative credentials in the userscript.
- Rotate the shared application key if it is intended to function as a secret and has been exposed in a public repository.

## Development

### Main Configuration Values

```javascript
const SERVER_BASE = 'https://bunch-uphold-antennae.ngrok-free.dev/armory';
const TEAM_ID = 'tnl-faction';
const API_KEY = 'The-Next-Level';
const DEBUG = false;
```

### Local Storage Keys

The script uses userscript-manager storage for:

```text
torn-notes-torn-api-key
torn-notes-api-key-prompted-v1
torn-notes-tooltip-theme
torn-notes-cache-v1
torn-notes-purged-local-v1
```

### Required Userscript Permissions

```javascript
// @grant        GM_registerMenuCommand
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_listValues
// @grant        GM_deleteValue
```

## Repository Structure

A basic repository layout may look like:

```text
TNL-Torn-Scripts/
├── Armory.user.js
└── README.md
```

## Authors

- DoobyDoo
- MonChoon

## License

No license is currently declared in the userscript metadata.

Add a license file and a `@license` metadata entry before allowing broad reuse or redistribution.
