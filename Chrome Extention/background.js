chrome.runtime.onInstalled.addListener(() => {
    chrome.contextMenus.create({
      id: "ask-mistai",
      title: "Ask with Mist.AI",
      contexts: ["selection"]
    });
  });
  
  chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId === "ask-mistai") {
      const query = encodeURIComponent(info.selectionText);
      chrome.tabs.create({
        url: `https://mistai.org/chat?q=${query}`
      });
    }
  });
  