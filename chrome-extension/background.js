import { loadInbox, updateBadge } from './session.js';

// Right-click "Send to Addly" on a page or a link: remember what was clicked, then
// open the Addly panel. Also keeps the inbox count on the toolbar icon up to date.
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({ id: 'addly-page', title: 'Send this page to Addly', contexts: ['page'] });
  chrome.contextMenus.create({ id: 'addly-link', title: 'Send this link to Addly', contexts: ['link'] });
  chrome.alarms.create('addly-inbox', { periodInMinutes: 15 });
  refreshBadge();
});
chrome.runtime.onStartup.addListener(refreshBadge);
chrome.alarms.onAlarm.addListener((alarm) => { if (alarm.name === 'addly-inbox') refreshBadge(); });

async function refreshBadge() {
  try {
    const inbox = await loadInbox();
    if (inbox) updateBadge(inbox.length);
  } catch { /* offline: try again next time */ }
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  const pending = info.menuItemId === 'addly-link'
    ? { url: info.linkUrl, title: info.selectionText || '' }
    : { url: info.pageUrl || tab?.url, title: tab?.title || '' };
  await chrome.storage.local.set({ pending, tab: 'send' });
  try {
    await chrome.action.openPopup();
  } catch {
    chrome.action.setBadgeBackgroundColor({ color: '#1F5C3F' });
    chrome.action.setBadgeText({ text: '↑' });
  }
});
