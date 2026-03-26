async function sendMsg(type) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return window.close();

  // Try sending message to existing content script
  try {
    await chrome.tabs.sendMessage(tab.id, { type });
  } catch (e) {
    // Content script not injected yet — inject it first, then send
    try {
      await chrome.scripting.insertCSS({ target: { tabId: tab.id }, files: ['content-scripts/blurscreen.css'] });
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content-scripts/detector.js'] });
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content-scripts/blurscreen.js'] });
      // Wait a moment for init, then send
      await new Promise(r => setTimeout(r, 200));
      await chrome.tabs.sendMessage(tab.id, { type });
    } catch (e2) {
      // Can't inject on this page (chrome://, edge://, etc.)
      console.warn('BlurScreen: Cannot run on this page', e2);
    }
  }
  window.close();
}

document.getElementById('toggle').addEventListener('click', () => sendMsg('toggle'));
document.getElementById('detect').addEventListener('click', () => sendMsg('auto-detect'));
document.getElementById('clear').addEventListener('click', () => sendMsg('clear-all'));

// Show usage & payment status
chrome.storage.local.get(['blurscreen_usage', 'blurscreen_paid'], (result) => {
  const usage = result.blurscreen_usage || 0;
  const paid = result.blurscreen_paid || false;
  const el = document.getElementById('usage');
  if (paid) {
    el.textContent = 'Pro \u2014 Unlimited';
    el.style.color = '#22c55e';
  } else {
    const left = Math.max(0, 3 - usage);
    el.innerHTML = `Free: <strong>${left}</strong> session${left !== 1 ? 's' : ''} remaining`;
  }
});
