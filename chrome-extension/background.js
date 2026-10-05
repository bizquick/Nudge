// Right-click "Send to Addly" on a page or a link: remember what was clicked, then
// open the Addly panel (or, if Chrome won't open it from here, badge the icon).
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({ id: 'addly-page', title: 'Send this page to Addly', contexts: ['page'] });
  chrome.contextMenus.create({ id: 'addly-link', title: 'Send this link to Addly', contexts: ['link'] });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  const pending = info.menuItemId === 'addly-link'
    ? { url: info.linkUrl, title: info.selectionText || '' }
    : { url: info.pageUrl || tab?.url, title: tab?.title || '' };
  await chrome.storage.local.set({ pending });
  try {
    await chrome.action.openPopup();
  } catch {
    chrome.action.setBadgeBackgroundColor({ color: '#1F5C3F' });
    chrome.action.setBadgeText({ text: '1' });
  }
});
