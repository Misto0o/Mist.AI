chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "explainWithMistAI",
    title: "🧠 Explain with Mist.AI",
    contexts: ["selection"]
  });

  chrome.contextMenus.create({
    id: "summarizeWithMistAI",
    title: "📝 Summarize with Mist.AI",
    contexts: ["selection"]
  });

  chrome.contextMenus.create({
    id: "rephraseWithMistAI",
    title: "🔁 Rephrase with Mist.AI",
    contexts: ["selection"]
  });

  chrome.contextMenus.create({
    id: "translateWithMistAI",
    title: "🌐 Translate with Mist.AI",
    contexts: ["selection"]
  });

  chrome.contextMenus.create({
    id: "askWithMistAI",
    title: "🚨 Ask Your Own Question with Mist.AI",
    contexts: ["selection"]
  });
});

chrome.contextMenus.onClicked.addListener((info) => {
  if (!info.selectionText) return;

  let prompt = info.selectionText;

  switch (info.menuItemId) {
    case "askWithMistAI":
      prompt = info.selectionText;
      chrome.tabs.create({
        url: `https://mistai.org/?q=${encodeURIComponent(prompt)}&draft=true`
      });
      return; // exit early so we don't double-redirect
    case "explainWithMistAI":
      prompt = `Explain this in simple terms:\n\n"${info.selectionText}"`;
      break;
    case "summarizeWithMistAI":
      prompt = `Summarize this:\n\n"${info.selectionText}"`;
      break;
    case "rephraseWithMistAI":
      prompt = `Rephrase this more clearly:\n\n"${info.selectionText}"`;
      break;
    case "translateWithMistAI":
      prompt = `Translate this to English:\n\n"${info.selectionText}"`;
      break;
    default:
      break;
  }

  const query = encodeURIComponent(prompt);
  chrome.tabs.create({
    url: `https://mistai.org/?q=${query}`
  });
});

