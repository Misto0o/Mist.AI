const MISTAI_API = "https://mist-ai.fly.dev/chat";

function sendToTab(tabId, message) {
  chrome.tabs.get(tabId, (tab) => {
    if (chrome.runtime.lastError) return;
    if (!tab.url || tab.url.startsWith("chrome://") || tab.url.startsWith("chrome-extension://")) return;
    chrome.tabs.sendMessage(tabId, message, () => { if (chrome.runtime.lastError) { } });
  });
}

chrome.runtime.onInstalled.addListener(() => {

  // ── Root ──────────────────────────────────────────────────
  chrome.contextMenus.create({
    id: "mistai-root",
    title: "Mist.AI",
    contexts: ["selection", "page", "editable"]
  });

  // ── Selected Text ─────────────────────────────────────────
  chrome.contextMenus.create({ id: "label-text", title: "── Selected Text ──", parentId: "mistai-root", contexts: ["selection"], enabled: false });
  chrome.contextMenus.create({ id: "explainWithMistAI", title: "🧠 Explain", parentId: "mistai-root", contexts: ["selection"] });
  chrome.contextMenus.create({ id: "summarizeWithMistAI", title: "📝 Summarize", parentId: "mistai-root", contexts: ["selection"] });
  chrome.contextMenus.create({ id: "rephraseWithMistAI", title: "🔁 Rephrase", parentId: "mistai-root", contexts: ["selection"] });
  chrome.contextMenus.create({ id: "translateWithMistAI", title: "🌐 Translate", parentId: "mistai-root", contexts: ["selection"] });
  chrome.contextMenus.create({ id: "askWithMistAI", title: "🚨 Ask a Question", parentId: "mistai-root", contexts: ["selection"] });
  chrome.contextMenus.create({ id: "answerQuestion", title: "❓ Answer this Question", parentId: "mistai-root", contexts: ["selection"] });

  // ── Page ──────────────────────────────────────────────────
  chrome.contextMenus.create({ id: "sep-page", type: "separator", parentId: "mistai-root", contexts: ["page", "selection"] });
  chrome.contextMenus.create({ id: "label-page", title: "── Page ──", parentId: "mistai-root", contexts: ["page", "selection"], enabled: false });
  chrome.contextMenus.create({ id: "summarizePage", title: "📄 Summarize Page", parentId: "mistai-root", contexts: ["page", "selection"] });
  chrome.contextMenus.create({ id: "explainPage", title: "🧠 Explain Page", parentId: "mistai-root", contexts: ["page", "selection"] });
  chrome.contextMenus.create({ id: "autoFillPage", title: "🤖 Auto-fill Form", parentId: "mistai-root", contexts: ["page", "selection", "editable"] });
  chrome.contextMenus.create({ id: "buttonPanel", title: "🖱️ Click a Button", parentId: "mistai-root", contexts: ["page", "selection", "editable"] });

  // ── Editable Field ────────────────────────────────────────
  chrome.contextMenus.create({ id: "sep-field", type: "separator", parentId: "mistai-root", contexts: ["editable"] });
  chrome.contextMenus.create({ id: "label-field", title: "── Field ──", parentId: "mistai-root", contexts: ["editable"], enabled: false });
  chrome.contextMenus.create({ id: "fillFieldAI", title: "✨ Fill this field", parentId: "mistai-root", contexts: ["editable"] });
  chrome.contextMenus.create({ id: "improveFieldAI", title: "✏️ Improve my text", parentId: "mistai-root", contexts: ["editable"] });
  chrome.contextMenus.create({ id: "submitFormAI", title: "🚀 Submit this form", parentId: "mistai-root", contexts: ["editable"] });

});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === "fillFieldAI") { sendToTab(tab.id, { type: "FORM_FILL_FIELD" }); return; }
  if (info.menuItemId === "improveFieldAI") { sendToTab(tab.id, { type: "FORM_IMPROVE_FIELD" }); return; }
  if (info.menuItemId === "submitFormAI") { sendToTab(tab.id, { type: "FORM_SUBMIT" }); return; }
  if (info.menuItemId === "buttonPanel") { sendToTab(tab.id, { type: "SHOW_BUTTON_PANEL" }); return; }
  if (info.menuItemId === "autoFillPage") { sendToTab(tab.id, { type: "AUTO_FILL_PAGE" }); return; }

  if (info.menuItemId === "answerQuestion") {
    sendToTab(tab.id, { type: "ANSWER_SELECTION", questionText: info.selectionText });
    return;
  }

  if (info.menuItemId === "summarizePage" || info.menuItemId === "explainPage") {
    sendToTab(tab.id, { type: "PAGE_ACTION", action: info.menuItemId === "summarizePage" ? "summarize" : "explain" });
    return;
  }

  const prompts = {
    explainWithMistAI: `Explain this in simple terms:\n\n"${info.selectionText}"`,
    summarizeWithMistAI: `Summarize this:\n\n"${info.selectionText}"`,
    rephraseWithMistAI: `Rephrase this more clearly:\n\n"${info.selectionText}"`,
    translateWithMistAI: `Translate this to English:\n\n"${info.selectionText}"`,
  };

  const prompt = prompts[info.menuItemId];
  if (!prompt) return;

  sendToTab(tab.id, { type: "SHOW_SIDEBAR", loading: true, prompt: info.selectionText, action: info.menuItemId });

  try {
    const response = await fetch(MISTAI_API, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: prompt, model: "cohere" })
    });
    const data = await response.json();
    sendToTab(tab.id, { type: "SIDEBAR_RESULT", result: data.response || data.error || "No response." });
  } catch (err) {
    sendToTab(tab.id, { type: "SIDEBAR_RESULT", result: "⚠️ Failed to reach Mist.AI." });
  }
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "SCRAPE_AND_ASK") {
    const truncated = msg.pageText.slice(0, 3000);
    const prompt = msg.action === "summarize"
      ? `Summarize this web page content concisely:\n\n${truncated}`
      : `Explain what this web page is about:\n\n${truncated}`;
    fetch(MISTAI_API, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message: prompt, model: "gemini" }) })
      .then(r => r.json()).then(data => sendResponse({ result: data.response || data.error }))
      .catch(() => sendResponse({ result: "⚠️ Failed." }));
    return true;
  }

  if (msg.type === "API_CALL") {
    fetch(MISTAI_API, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message: msg.prompt, model: "gemini" }) })
      .then(r => r.json()).then(data => sendResponse({ result: data.response || data.error }))
      .catch(() => sendResponse({ result: "⚠️ Failed." }));
    return true;
  }
});

