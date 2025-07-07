chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "askWithMistAI",
    title: "Ask with Mist.AI",
    contexts: ["selection"]
  });
});

chrome.contextMenus.onClicked.addListener((info) => {
  if (info.menuItemId === "askWithMistAI" && info.selectionText) {
    const query = encodeURIComponent(info.selectionText);
    chrome.tabs.create({
      url: `https://mistai.org/?q=${query}` 
    });
  }
});
