let extpay = null;
try {
  importScripts('lib/ExtPay.js');
  extpay = ExtPay('blurscreen');
  extpay.startBackground();
  extpay.onPaid.addListener(() => {
    chrome.tabs.query({}, (tabs) => {
      tabs.forEach(tab => {
        chrome.tabs.sendMessage(tab.id, { type: 'payment-updated', paid: true }).catch(() => {});
      });
    });
  });
} catch (e) {
  console.warn('BlurScreen: ExtPay init failed, payment disabled', e);
}

async function ensureAndSend(tabId, msgType) {
  try {
    await chrome.tabs.sendMessage(tabId, { type: msgType });
  } catch {
    try {
      await chrome.scripting.insertCSS({ target: { tabId }, files: ['content-scripts/blurscreen.css'] });
      await chrome.scripting.executeScript({ target: { tabId }, files: ['lib/ExtPay.js'] });
      await chrome.scripting.executeScript({ target: { tabId }, files: ['content-scripts/detector.js'] });
      await chrome.scripting.executeScript({ target: { tabId }, files: ['content-scripts/blurscreen.js'] });
      setTimeout(() => { chrome.tabs.sendMessage(tabId, { type: msgType }).catch(() => {}); }, 200);
    } catch (e) { console.warn('BlurScreen: Cannot inject', e); }
  }
}

chrome.commands.onCommand.addListener(async (command) => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  const msgMap = { 'toggle-blur': 'toggle', 'auto-detect': 'auto-detect', 'clear-all': 'clear-all' };
  if (msgMap[command]) ensureAndSend(tab.id, msgMap[command]);
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id) return false;

  if (msg?.type === 'update-badge') {
    const opts = sender.tab?.id ? { tabId: sender.tab.id } : {};
    chrome.action.setBadgeText({ text: msg.count || '', ...opts });
    chrome.action.setBadgeBackgroundColor({ color: msg.active ? '#6366f1' : '#9ca3af', ...opts });
    return false;
  }

  if (msg?.type === 'get-payment-status') {
    if (extpay) {
      extpay.getUser().then(user => sendResponse({ paid: user.paid })).catch(() => sendResponse({ paid: false }));
    } else {
      sendResponse({ paid: false });
    }
    return true;
  }

  if (msg?.type === 'open-payment') {
    if (extpay) {
      extpay.openPaymentPage();
    }
    return false;
  }

  return false;
});
