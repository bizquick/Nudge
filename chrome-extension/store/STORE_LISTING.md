# Addly — Chrome Web Store listing

Copy each part into the matching box at https://chrome.google.com/webstore/devconsole

---

## Package
Upload: `chrome-extension/addly-chrome.zip`

## Store listing tab

**Item name** (comes from the package): Addly

**Summary** (shown in search results; 132 characters max):
Send any page to friends on Addly in two clicks, and check off the nudges waiting for you — right from Chrome.

**Description:**
Because "I'll check it out later" is a lie.

Addly is for the links, videos, songs, and ideas you want to share with the people you know. Instead of a text that gets buried, you send a nudge that waits in their queue until they've actually checked it out.

The Addly add-on brings it to Chrome:

• Send the page you're on — click the Addly icon, pick who it's for, add a note, and send. The page's title and picture come along automatically.
• Right-click any link or page and choose "Send to Addly."
• See your inbox — the nudges friends sent you, with a count on the icon. Open one in a new tab and check it off when you're done.
• Works with your existing Addly account (you'll need the Addly app to sign up).

Private by design: the add-on only sends a page when you press Send, never reads your other browsing, and keeps a private send-key instead of your password.

Works in Chrome, Edge, Brave, and other Chromium browsers on Mac, Windows, and Chromebook.

**Category:** Social & Communication  (Productivity also fits)
**Language:** English

**Graphic assets:**
- Store icon (128×128): `store/store-icon-128.png`
- Screenshots (1280×800): `store/screenshot-1.png`, `store/screenshot-2.png`, `store/screenshot-3.png`
- Small promo tile (440×280): `store/promo-tile-440x280.png`

**Additional fields:**
- Official URL / Homepage: https://addlyapp.com
- Support URL: https://addlyapp.com/support

---

## Privacy practices tab

**Single purpose description:**
Addly lets you send the web page you're on to friends on Addly, and see and check off the nudges (shared links) friends have sent you.

**Permission justifications:**
- **activeTab** — When you click the Addly icon, reads the current tab's address and title so you can send that page.
- **scripting** — When you click the Addly icon, reads the current page's preview picture and title (its og:image / og:title tags) to show what you're about to send. Runs only on the tab you're on, only when you open Addly.
- **storage** — Keeps you signed in: stores your private Addly send-key, your sign-in session, and your list of friends on your computer.
- **contextMenus** — Adds "Send this page to Addly" and "Send this link to Addly" to the right-click menu.
- **alarms** — Checks every 15 minutes how many nudges are waiting for you, to show the count on the Addly icon.
- **Host permission (eygojfpgisswyndusron.supabase.co)** — This is Addly's own server. The add-on talks only to it, to sign you in, send nudges, and load your inbox.

**Remote code:** No, I am not using remote code. (All code is in the package.)

**Data usage — what the add-on collects** (check these boxes):
- ☑ Personally identifiable information — your account email (only to sign you in) and your Addly username
- ☑ Authentication information — the sign-in session and private send-key, stored on your computer
- ☑ Personal communications — the nudges and notes you send and receive
- ☑ Website content — the address, title, and picture of a page, only when you choose to send it
- ☐ Health, financial, location, web history, user activity — not collected

**Certify all three:**
- ☑ I do not sell or transfer user data to third parties, outside of the approved use cases
- ☑ I do not use or transfer user data for purposes that are unrelated to my item's single purpose
- ☑ I do not use or transfer user data to determine creditworthiness or for lending purposes

**Privacy policy URL:** https://addlyapp.com/privacy

---

## Distribution tab
- **Visibility:** Public (anyone can find it), or **Unlisted** (only people with the link can install it — good while you're testing with friends)
- **Regions:** All regions
