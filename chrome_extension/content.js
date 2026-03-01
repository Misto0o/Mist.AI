// ─────────────────────────────────────────
// Mist.AI Content Script v3.2
// + ❓ Answer Question in tooltip + context menu
// ─────────────────────────────────────────

let sidebarEl = null;
let resultEl = null;
let titleEl = null;
let activeRewriteTarget = null;
let lastFocusedField = null;

// ─────────────────────────────────────────
// Track last focused field
// ─────────────────────────────────────────
document.addEventListener("focusin", (e) => {
    const el = e.target;
    if (isEditableField(el)) {
        lastFocusedField = el;
        maybeShowAutoSuggest(el);
    }
}, true);

document.addEventListener("focusout", () => {
    setTimeout(() => {
        if (!document.activeElement || !isEditableField(document.activeElement)) {
            removeAutoSuggest();
        }
    }, 150);
}, true);

function isEditableField(el) {
    if (!el) return false;
    const tag = el.tagName?.toLowerCase();
    if (tag === "input") {
        const type = (el.type || "text").toLowerCase();
        return ["text", "email", "search", "url", "tel", "number"].includes(type);
    }
    if (tag === "textarea") return true;
    if (el.isContentEditable) return true;
    return false;
}

// ─────────────────────────────────────────
// Auto-suggest bubble
// ─────────────────────────────────────────
let autoSuggestEl = null;

function maybeShowAutoSuggest(field) {
    removeAutoSuggest();
    const currentVal = field.value || field.innerText || "";
    if (currentVal.trim().length > 0) return;
    const rect = field.getBoundingClientRect();
    autoSuggestEl = document.createElement("div");
    autoSuggestEl.id = "mistai-autosuggest";
    autoSuggestEl.innerHTML = `<span>✨</span><span>Fill with Mist.AI</span>`;
    document.body.appendChild(autoSuggestEl);
    autoSuggestEl.style.top = `${rect.bottom + window.scrollY + 4}px`;
    autoSuggestEl.style.left = `${rect.left + window.scrollX}px`;
    autoSuggestEl.addEventListener("mousedown", (e) => {
        e.preventDefault();
        removeAutoSuggest();
        fillFieldWithAI(field);
    });
}

function removeAutoSuggest() {
    if (autoSuggestEl) { autoSuggestEl.remove(); autoSuggestEl = null; }
}

// ─────────────────────────────────────────
// Describe a single field
// ─────────────────────────────────────────
function describeField(field) {
    if (field.id) {
        const label = document.querySelector(`label[for="${field.id}"]`);
        if (label) return label.innerText.trim();
    }
    if (field.getAttribute("aria-label")) return field.getAttribute("aria-label");
    if (field.placeholder) return field.placeholder;
    if (field.name) return field.name.replace(/[_\-]/g, " ");
    const parentLabel = field.closest("label");
    if (parentLabel) return parentLabel.innerText.replace(field.value || "", "").trim();
    return "this field";
}

// ─────────────────────────────────────────
// ❓ Find nearby radio/checkbox options
// ─────────────────────────────────────────
function findNearbyOptions(anchorEl) {
    const containers = [
        anchorEl?.closest("fieldset"),
        anchorEl?.closest('[class*="question"]'),
        anchorEl?.closest('[class*="quiz"]'),
        anchorEl?.closest('[class*="form-group"]'),
        anchorEl?.closest('[class*="choice"]'),
        anchorEl?.closest('[class*="option"]'),
        anchorEl?.closest("li"),
        anchorEl?.parentElement?.parentElement?.parentElement,
        anchorEl?.parentElement?.parentElement,
        anchorEl?.parentElement,
    ].filter(Boolean);

    for (const container of containers) {
        const inputs = Array.from(container.querySelectorAll('input[type="radio"], input[type="checkbox"]'));
        if (inputs.length > 0) return inputs;
    }

    // Last resort — find ALL radio/checkbox inputs on the page
    return Array.from(document.querySelectorAll('input[type="radio"], input[type="checkbox"]'));
}

function getRadioLabel(radio) {
    if (radio.id) {
        const lbl = document.querySelector(`label[for="${radio.id}"]`);
        if (lbl) return lbl.innerText.trim();
    }
    const pLbl = radio.closest("label");
    if (pLbl) return pLbl.innerText.trim();
    return radio.value || "";
}

// ─────────────────────────────────────────
// ❓ ANSWER A QUESTION
// ─────────────────────────────────────────
async function answerQuestion(questionText, optionInputs) {
    if (!questionText) { showToast("⚠️ No question text found."); return; }
    if (!optionInputs || optionInputs.length === 0) { showToast("⚠️ No answer options found near the question."); return; }

    const options = optionInputs.map((inp, i) => ({ inp, label: getRadioLabel(inp) || `Option ${i + 1}` }));
    const optionsText = options.map((o, i) => `${i + 1}. ${o.label}`).join("\n");

    const prompt = `You are a knowledgeable assistant answering a quiz/homework question.

Question: "${questionText}"

Answer options:
${optionsText}

Pick the BEST correct answer. Return ONLY a JSON object like:
{"index": 1, "answer": "exact option text", "explanation": "why this is correct (1-2 sentences)"}

No markdown, no extra text. Just the JSON.`;

    showSidebar("❓ Answering…", true);

    const response = await chrome.runtime.sendMessage({ type: "API_CALL", prompt });
    const raw = response?.result?.trim() || "";

    let parsed;
    try {
        parsed = JSON.parse(raw.replace(/```json|```/g, "").trim());
    } catch (e) {
        setResult(`⚠️ Couldn't parse answer. Raw:\n${raw.slice(0, 200)}`);
        return;
    }

    const chosenIndex = Math.max(0, (parsed.index || 1) - 1);
    const chosenOption = options[chosenIndex] || options[0];
    const explanation = parsed.explanation || "";

    showSidebar("❓ Answer", false);
    resultEl.style.display = "block";
    document.getElementById("mistai-loading").style.display = "none";
    resultEl.innerHTML = `
    <div class="mistai-fill-result">
      <p class="mistai-fill-label">Question</p>
      <div class="mistai-fill-value" style="font-style:italic;color:#94a3b8;font-size:12px;">
        ${escapeHtml(questionText.slice(0, 140))}${questionText.length > 140 ? "…" : ""}
      </div>

      <p class="mistai-fill-label" style="margin-top:10px;">Answer</p>
      <div class="mistai-fill-value" style="color:#7dd3fc;font-weight:600;">
        ✅ ${escapeHtml(chosenOption.label)}
      </div>

      <p class="mistai-fill-label" style="margin-top:10px;">Why</p>
      <div class="mistai-fill-value">${escapeHtml(explanation)}</div>

      <div class="mistai-fill-actions" style="margin-top:12px;">
        <button class="mistai-action-btn" id="mistai-apply-answer">✅ Select this answer</button>
        <button class="mistai-action-btn mistai-secondary" id="mistai-cancel-answer">Cancel</button>
      </div>
    </div>
  `;

    document.getElementById("mistai-apply-answer")?.addEventListener("click", () => {
        chosenOption.inp.scrollIntoView({ behavior: "smooth", block: "center" });
        setTimeout(() => {
            chosenOption.inp.click();
            chosenOption.inp.dispatchEvent(new Event("change", { bubbles: true }));
            chosenOption.inp.style.outline = "3px solid #7dd3fc";
            setTimeout(() => { chosenOption.inp.style.outline = ""; }, 1500);
            showToast(`✅ Selected: "${chosenOption.label}"`);
            hideSidebar();
        }, 300);
    });

    document.getElementById("mistai-cancel-answer")?.addEventListener("click", () => hideSidebar());
}

// ─────────────────────────────────────────
// Scrape ALL form fields
// ─────────────────────────────────────────
function scrapeFormFields() {
    const fields = [];
    const seen = new Set();

    document.querySelectorAll("input, textarea, select").forEach((el) => {
        const type = (el.type || el.tagName).toLowerCase();
        if (["hidden", "submit", "button", "reset", "image", "file"].includes(type)) return;

        let label = "";
        if (el.id) {
            const lbl = document.querySelector(`label[for="${el.id}"]`);
            if (lbl) label = lbl.innerText.trim();
        }
        if (!label && el.getAttribute("aria-label")) label = el.getAttribute("aria-label");
        if (!label && el.placeholder) label = el.placeholder;
        if (!label && el.name) label = el.name.replace(/[_\-]/g, " ");
        if (!label) {
            const pLbl = el.closest("label");
            if (pLbl) label = pLbl.innerText.trim();
        }
        if (!label) label = type;

        const dedupeKey = `${type}:${el.name || label}`;
        if (seen.has(dedupeKey) && type === "radio") return;

        const fieldInfo = { el, type, label, name: el.name || "", id: el.id || "" };

        if (type === "select") {
            fieldInfo.options = Array.from(el.options).filter(o => o.value !== "").map(o => o.text.trim());
        }

        if (type === "radio" || type === "checkbox") {
            seen.add(dedupeKey);
            const groupName = el.name;
            if (groupName) {
                const group = Array.from(document.querySelectorAll(`input[name="${groupName}"]`));
                fieldInfo.options = group.map(r => getRadioLabel(r) || r.value);
                fieldInfo.groupEls = group;
            }
        }

        fields.push(fieldInfo);
    });

    return fields;
}

function buildFormSummary(fields) {
    return fields.map((f, i) => {
        let line = `${i + 1}. [${f.type.toUpperCase()}] "${f.label}"`;
        if (f.options?.length > 0) line += ` — options: ${f.options.map(o => `"${o}"`).join(", ")}`;
        return line;
    }).join("\n");
}

// ─────────────────────────────────────────
// AUTO-FILL AGENT
// ─────────────────────────────────────────
function startAutoFill() {
    ensureSidebar();
    sidebarEl.classList.add("mistai-visible");
    if (titleEl) titleEl.textContent = "🤖 Auto-fill Form";
    document.getElementById("mistai-loading").style.display = "none";
    resultEl.style.display = "block";

    const fields = scrapeFormFields();
    if (fields.length === 0) {
        resultEl.innerHTML = `<p style="color:#94a3b8;font-size:13px;">No form fields found on this page.</p>`;
        return;
    }

    resultEl.innerHTML = `
    <div class="mistai-autofill-setup">
      <p class="mistai-fill-label">🤖 Found <strong style="color:#7dd3fc">${fields.length} field(s)</strong>.</p>
      <p class="mistai-fill-label" style="margin-top:10px;">Tell me about yourself:</p>
      <div class="mistai-qa-list">
        <div class="mistai-qa-item">
          <label class="mistai-qa-label">Your name?</label>
          <input class="mistai-qa-input" data-key="name" type="text" placeholder="e.g. John Smith" />
        </div>
        <div class="mistai-qa-item">
          <label class="mistai-qa-label">Your email?</label>
          <input class="mistai-qa-input" data-key="email" type="text" placeholder="e.g. john@email.com" />
        </div>
        <div class="mistai-qa-item">
          <label class="mistai-qa-label">Anything else?</label>
          <textarea class="mistai-qa-input mistai-qa-textarea" data-key="extra" placeholder="e.g. student, prefer personal use…"></textarea>
        </div>
      </div>
      <button class="mistai-action-btn" id="mistai-autofill-go" style="margin-top:14px;">🚀 Fill the form now</button>
      <button class="mistai-action-btn mistai-secondary" id="mistai-autofill-cancel" style="margin-top:6px;">Cancel</button>
    </div>
  `;

    document.getElementById("mistai-autofill-go").addEventListener("click", () => {
        const inputs = resultEl.querySelectorAll(".mistai-qa-input");
        const context = {};
        inputs.forEach(inp => { context[inp.dataset.key] = inp.value.trim(); });
        runAutoFill(fields, context);
    });
    document.getElementById("mistai-autofill-cancel").addEventListener("click", () => hideSidebar());
}

async function runAutoFill(fields, userContext) {
    showSidebar("🤖 Filling form…", true);

    const formSummary = buildFormSummary(fields);
    const pageTitle = document.title || window.location.hostname;
    const contextStr = [
        userContext.name ? `Name: ${userContext.name}` : "",
        userContext.email ? `Email: ${userContext.email}` : "",
        userContext.extra ? `Extra: ${userContext.extra}` : "",
    ].filter(Boolean).join("\n");

    const prompt = `You are an AI form-filling assistant filling out a form on "${pageTitle}".

User info:
${contextStr || "No info — use realistic placeholder data."}

Form fields:
${formSummary}

Return a JSON array. Each item:
- "index": field number (1-based)
- "value": value to fill (for radio/checkbox/select use EXACTLY one of the listed options)

Return ONLY valid JSON array, no markdown.
Example: [{"index":1,"value":"John"},{"index":2,"value":"Business"}]`;

    const response = await chrome.runtime.sendMessage({ type: "API_CALL", prompt });
    const raw = response?.result?.trim() || "";

    let instructions = [];
    try {
        instructions = JSON.parse(raw.replace(/```json|```/g, "").trim());
    } catch (e) {
        setResult(`⚠️ Unexpected response.\n\n${raw.slice(0, 200)}`);
        return;
    }

    let filled = 0, skipped = 0;
    for (const inst of instructions) {
        const field = fields[inst.index - 1];
        if (!field || inst.value === undefined) { skipped++; continue; }
        try { await applyFieldValue(field, String(inst.value)); filled++; }
        catch (e) { skipped++; }
        await sleep(80);
    }

    showSidebar("✅ Form filled!", false);
    resultEl.style.display = "block";
    document.getElementById("mistai-loading").style.display = "none";
    resultEl.innerHTML = `
    <div class="mistai-fill-result">
      <p class="mistai-fill-label">Done!</p>
      <div class="mistai-fill-value">
        ✅ Filled <strong style="color:#7dd3fc">${filled}</strong> field(s)
        ${skipped > 0 ? `<br>⚠️ Skipped ${skipped}` : ""}
      </div>
      <div class="mistai-fill-actions">
        <button class="mistai-action-btn" id="mistai-do-submit-auto">🚀 Submit Form</button>
        <button class="mistai-action-btn mistai-secondary" id="mistai-do-close-auto">Close</button>
      </div>
    </div>
  `;
    document.getElementById("mistai-do-submit-auto")?.addEventListener("click", () => submitParentForm(null));
    document.getElementById("mistai-do-close-auto")?.addEventListener("click", () => hideSidebar());
}

async function applyFieldValue(field, value) {
    const { el, type, groupEls } = field;

    if (type === "radio") {
        const group = groupEls || [el];
        for (const radio of group) {
            const optLabel = getRadioLabel(radio);
            if (optLabel.toLowerCase() === value.toLowerCase() || radio.value.toLowerCase() === value.toLowerCase()) {
                radio.click(); radio.dispatchEvent(new Event("change", { bubbles: true })); return;
            }
        }
        for (const radio of group) {
            const optLabel = getRadioLabel(radio);
            if (optLabel.toLowerCase().includes(value.toLowerCase()) || value.toLowerCase().includes(optLabel.toLowerCase())) {
                radio.click(); radio.dispatchEvent(new Event("change", { bubbles: true })); return;
            }
        }
    } else if (type === "checkbox") {
        const shouldCheck = ["yes", "true", "checked", "1"].includes(value.toLowerCase());
        if (el.checked !== shouldCheck) { el.click(); el.dispatchEvent(new Event("change", { bubbles: true })); }
    } else if (type === "select") {
        const opts = Array.from(el.options);
        let match = opts.find(o => o.text.trim().toLowerCase() === value.toLowerCase());
        if (!match) match = opts.find(o => o.text.trim().toLowerCase().includes(value.toLowerCase()) || value.toLowerCase().includes(o.text.trim().toLowerCase()));
        if (match) {
            el.value = match.value;
            el.dispatchEvent(new Event("change", { bubbles: true }));
            el.dispatchEvent(new Event("input", { bubbles: true }));
        }
    } else {
        writeToField(el, value);
    }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ─────────────────────────────────────────
// Fill / improve single field
// ─────────────────────────────────────────
async function fillFieldWithAI(field) {
    if (!field) return;
    const prompt = `You are filling out a web form on "${document.title || window.location.hostname}".
The field is labeled: "${describeField(field)}".
Write a short, realistic, helpful value. Return ONLY the value — no explanation, no quotes.`;
    showSidebar("✨ Filling field…", true);
    const response = await chrome.runtime.sendMessage({ type: "API_CALL", prompt });
    const result = response?.result?.trim() || "";
    if (!result || result.startsWith("⚠️")) { setResult("⚠️ Couldn't generate a value."); return; }
    writeToField(field, result);
    showSidebar("✨ Field filled!", false);
    showFillResult(result, field);
}

function showFillResult(filledValue, field) {
    ensureSidebar();
    document.getElementById("mistai-loading").style.display = "none";
    resultEl.style.display = "block";
    resultEl.innerHTML = `
    <div class="mistai-fill-result">
      <p class="mistai-fill-label">Filled with:</p>
      <div class="mistai-fill-value">${escapeHtml(filledValue)}</div>
      <div class="mistai-fill-actions">
        <button class="mistai-action-btn" id="mistai-do-submit">🚀 Submit Form</button>
        <button class="mistai-action-btn mistai-secondary" id="mistai-do-clickpanel">🖱️ Click a Button</button>
      </div>
    </div>
  `;
    document.getElementById("mistai-do-submit")?.addEventListener("click", () => submitParentForm(field));
    document.getElementById("mistai-do-clickpanel")?.addEventListener("click", () => showButtonClickerPanel());
}

async function improveFieldWithAI(field) {
    if (!field) return;
    const current = field.value || field.innerText || "";
    if (!current.trim()) { showToast("⚠️ Field is empty."); return; }
    const prompt = `Improve this text for a form field labeled "${describeField(field)}". Return ONLY improved text.\n\nText: "${current}"`;
    showSidebar("✏️ Improving…", true);
    const response = await chrome.runtime.sendMessage({ type: "API_CALL", prompt });
    const result = response?.result?.trim() || "";
    if (!result || result.startsWith("⚠️")) { setResult("⚠️ Couldn't improve."); return; }
    writeToField(field, result);
    showSidebar("✏️ Improved!", false);
    showFillResult(result, field);
}

function writeToField(field, value) {
    const tag = field.tagName?.toLowerCase();
    if (tag === "input" || tag === "textarea") {
        field.focus();
        const proto = tag === "input" ? window.HTMLInputElement.prototype : window.HTMLTextAreaElement.prototype;
        const nativeSetter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
        if (nativeSetter) nativeSetter.call(field, value);
        else field.value = value;
        field.dispatchEvent(new Event("input", { bubbles: true }));
        field.dispatchEvent(new Event("change", { bubbles: true }));
    } else if (field.isContentEditable) {
        field.focus();
        document.execCommand("selectAll", false, null);
        document.execCommand("insertText", false, value);
    }
}

function submitParentForm(field) {
    const form = (field || lastFocusedField)?.closest("form") || document.querySelector("form");
    if (form) {
        const btn = form.querySelector('[type="submit"], button:not([type="button"]):not([type="reset"])');
        if (btn) { btn.click(); showToast("🚀 Submitted!"); hideSidebar(); return; }
        form.submit(); showToast("🚀 Submitted!"); hideSidebar(); return;
    }
    const fallback = document.querySelector('[type="submit"]');
    if (fallback) { fallback.click(); showToast("🚀 Submitted!"); hideSidebar(); return; }
    showToast("⚠️ No form found.");
}

// ─────────────────────────────────────────
// Button Clicker Panel
// ─────────────────────────────────────────
function showButtonClickerPanel() {
    ensureSidebar();
    sidebarEl.classList.add("mistai-visible");
    if (titleEl) titleEl.textContent = "🖱️ Click a Button";
    document.getElementById("mistai-loading").style.display = "none";
    resultEl.style.display = "block";

    const clickables = getClickableElements();
    if (clickables.length === 0) {
        resultEl.innerHTML = `<p style="color:#94a3b8;font-size:13px;">No buttons found.</p>`;
        return;
    }

    resultEl.innerHTML = `<p class="mistai-panel-hint">Tap to click on the page:</p><div class="mistai-btn-list" id="mistai-btn-list"></div>`;
    const list = document.getElementById("mistai-btn-list");
    clickables.forEach((item) => {
        const btn = document.createElement("button");
        btn.className = "mistai-clickable-item";
        btn.textContent = item.label;
        btn.addEventListener("click", (e) => {
            e.preventDefault(); e.stopPropagation();
            item.el.style.outline = "2px solid #7dd3fc";
            setTimeout(() => { item.el.style.outline = ""; }, 1000);
            item.el.scrollIntoView({ behavior: "smooth", block: "center" });
            setTimeout(() => {
                item.el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
                showToast(`🖱️ Clicked: "${item.label}"`);
                hideSidebar();
            }, 350);
        });
        list.appendChild(btn);
    });
}

function getClickableElements() {
    const results = [], seen = new Set();
    document.querySelectorAll([
        'button:not([disabled])',
        'input[type="submit"]:not([disabled])',
        'input[type="button"]:not([disabled])',
        '[role="button"]:not([disabled]):not(a)',
    ].join(",")).forEach((el) => {
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return;
        const style = window.getComputedStyle(el);
        if (style.display === "none" || style.visibility === "hidden") return;
        if (el.closest("#mistai-sidebar") || el.closest("#mistai-tooltip") || el.closest("#mistai-autosuggest")) return;
        const rawLabel = (el.innerText?.trim() || el.getAttribute("aria-label") || el.getAttribute("value") || el.id || "button").replace(/\s+/g, " ").trim().slice(0, 60);
        if (!rawLabel || seen.has(rawLabel.toLowerCase())) return;
        seen.add(rawLabel.toLowerCase());
        results.push({ el, label: rawLabel });
        if (results.length >= 25) return;
    });
    return results;
}

function escapeHtml(str) {
    return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// ─────────────────────────────────────────
// Sidebar core
// ─────────────────────────────────────────
function ensureSidebar() {
    if (sidebarEl) return;
    sidebarEl = document.createElement("div");
    sidebarEl.id = "mistai-sidebar";
    sidebarEl.innerHTML = `
    <div class="mistai-header">
      <span class="mistai-logo">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <circle cx="12" cy="12" r="10" stroke="#7dd3fc" stroke-width="2"/>
          <path d="M8 12 Q12 6 16 12 Q12 18 8 12Z" fill="#7dd3fc" opacity="0.8"/>
        </svg>
        Mist.AI
      </span>
      <span class="mistai-title" id="mistai-title">Result</span>
      <button class="mistai-close" id="mistai-close">✕</button>
    </div>
    <div class="mistai-body">
      <div class="mistai-loading" id="mistai-loading">
        <div class="mistai-dots"><span></span><span></span><span></span></div>
        <p>Thinking...</p>
      </div>
      <div class="mistai-text" id="mistai-text" style="display:none;"></div>
    </div>
    <div class="mistai-footer">
      <button class="mistai-replace" id="mistai-replace" style="display:none;">↩ Replace Text</button>
      <button class="mistai-copy" id="mistai-copy">Copy</button>
      <a class="mistai-open" href="https://mistai.org" target="_blank">Open Mist.AI ↗</a>
    </div>
  `;
    document.body.appendChild(sidebarEl);
    document.getElementById("mistai-close").addEventListener("click", () => { hideSidebar(); removeTooltip(); });
    document.getElementById("mistai-copy").addEventListener("click", () => {
        const text = document.getElementById("mistai-text").innerText;
        navigator.clipboard.writeText(text).then(() => {
            const btn = document.getElementById("mistai-copy");
            btn.textContent = "Copied!";
            setTimeout(() => btn.textContent = "Copy", 1500);
        });
    });
    document.getElementById("mistai-replace").addEventListener("click", () => {
        const newText = document.getElementById("mistai-text").innerText;
        if (activeRewriteTarget) {
            replaceSelectedText(activeRewriteTarget, newText);
            activeRewriteTarget = null;
            document.getElementById("mistai-replace").style.display = "none";
            hideSidebar(); removeTooltip();
        }
    });
    titleEl = document.getElementById("mistai-title");
    resultEl = document.getElementById("mistai-text");
}

function showSidebar(title, loading = false, showReplace = false) {
    ensureSidebar();
    sidebarEl.classList.add("mistai-visible");
    if (titleEl) titleEl.textContent = title;
    const loadingEl = document.getElementById("mistai-loading");
    const replaceBtn = document.getElementById("mistai-replace");
    if (loading) {
        loadingEl.style.display = "flex";
        if (resultEl) resultEl.style.display = "none";
    } else {
        loadingEl.style.display = "none";
        if (resultEl) resultEl.style.display = "block";
    }
    if (replaceBtn) replaceBtn.style.display = showReplace ? "inline-flex" : "none";
}

function setResult(text, showReplace = false) {
    ensureSidebar();
    document.getElementById("mistai-loading").style.display = "none";
    if (resultEl) {
        resultEl.style.display = "block";
        resultEl.innerHTML = text
            .replace(/```([\s\S]*?)```/g, "<pre><code>$1</code></pre>")
            .replace(/`([^`]+)`/g, "<code>$1</code>")
            .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
            .replace(/\n/g, "<br>");
    }
    const replaceBtn = document.getElementById("mistai-replace");
    if (replaceBtn) replaceBtn.style.display = showReplace ? "inline-flex" : "none";
}

function hideSidebar() {
    if (sidebarEl) sidebarEl.classList.remove("mistai-visible");
}

// ─────────────────────────────────────────
// Tooltip
// ─────────────────────────────────────────
let tooltipEl = null;

function showTooltip(x, y, actions) {
    removeTooltip();
    tooltipEl = document.createElement("div");
    tooltipEl.id = "mistai-tooltip";
    tooltipEl.innerHTML = actions.map(a =>
        `<button class="mistai-tip-btn" data-action="${a.action}">${a.label}</button>`
    ).join("");
    document.body.appendChild(tooltipEl);
    const left = Math.min(x, window.innerWidth - 310);
    tooltipEl.style.left = `${Math.max(left, 10)}px`;
    tooltipEl.style.top = `${y - 48}px`;
    tooltipEl.querySelectorAll(".mistai-tip-btn").forEach(btn => {
        btn.addEventListener("click", (e) => {
            e.stopPropagation();
            const action = btn.dataset.action;
            removeTooltip();
            handleTooltipAction(action);
        });
    });
    setTimeout(() => {
        document.addEventListener("mousedown", removeTooltipOnOutside, { once: true });
    }, 100);
}

function removeTooltipOnOutside(e) {
    if (tooltipEl && !tooltipEl.contains(e.target)) removeTooltip();
}

function removeTooltip() {
    if (tooltipEl) { tooltipEl.remove(); tooltipEl = null; }
    document.removeEventListener("mousedown", removeTooltipOnOutside);
}

function captureSelection() {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) return null;
    const text = sel.toString().trim();
    if (!text) return null;
    const anchorEl = sel.anchorNode?.parentElement;
    if (!anchorEl) return { text, editable: false, anchorEl: null };
    const tag = anchorEl.tagName?.toLowerCase();
    if (tag === "input" || tag === "textarea") {
        return { text, editable: true, el: anchorEl, anchorEl, start: anchorEl.selectionStart, end: anchorEl.selectionEnd, isContentEditable: false };
    }
    const editable = anchorEl.closest("[contenteditable='true']");
    if (editable) return { text, editable: true, el: editable, anchorEl, range: sel.getRangeAt(0).cloneRange(), isContentEditable: true };
    return { text, editable: false, anchorEl };
}

function replaceSelectedText(target, newText) {
    if (!target.editable) { navigator.clipboard.writeText(newText); showToast("Copied to clipboard"); return; }
    if (!target.isContentEditable) {
        const el = target.el;
        el.value = el.value.slice(0, target.start) + newText + el.value.slice(target.end);
        el.selectionStart = target.start; el.selectionEnd = target.start + newText.length;
        el.focus();
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
    } else {
        const range = target.range;
        range.deleteContents();
        range.insertNode(document.createTextNode(newText));
        range.collapse(false);
        const sel = window.getSelection();
        sel.removeAllRanges(); sel.addRange(range);
        target.el.dispatchEvent(new Event("input", { bubbles: true }));
    }
    showToast("✓ Text replaced!");
}

function showToast(msg) {
    const existing = document.getElementById("mistai-toast");
    if (existing) existing.remove();
    const el = document.createElement("div");
    el.id = "mistai-toast"; el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(() => el.classList.add("mistai-toast-show"), 10);
    setTimeout(() => { el.classList.remove("mistai-toast-show"); setTimeout(() => el.remove(), 300); }, 2500);
}

// ─────────────────────────────────────────
// Mouseup → show tooltip with ❓ Answer
// ─────────────────────────────────────────
document.addEventListener("mouseup", (e) => {
    if (e.target.closest("#mistai-sidebar") || e.target.closest("#mistai-tooltip") || e.target.closest("#mistai-autosuggest")) return;
    setTimeout(() => {
        const sel = window.getSelection();
        if (!sel || sel.isCollapsed || !sel.toString().trim()) return;
        const captured = captureSelection();
        if (!captured) return;

        const range = sel.getRangeAt(0);
        const rect = range.getBoundingClientRect();
        const x = rect.left + window.scrollX + rect.width / 2 - 150;
        const y = rect.top + window.scrollY;

        // Check for nearby radio/checkbox options
        const nearbyOpts = findNearbyOptions(captured.anchorEl || sel.anchorNode?.parentElement);
        const hasOptions = nearbyOpts.length > 0;

        let actions;
        if (captured.editable) {
            actions = [
                { label: "✏️ Improve", action: "improve" },
                { label: "🔁 Rephrase", action: "rephrase" },
                { label: "📝 Summarize", action: "summarize_sel" },
                { label: "🌐 Translate", action: "translate" },
            ];
        } else {
            actions = [
                { label: "🧠 Explain", action: "explain_sel" },
                { label: "📝 Summarize", action: "summarize_sel" },
                { label: "🌐 Translate", action: "translate" },
            ];
        }

        // ❓ Always show Answer when options are nearby
        if (hasOptions) {
            actions = [{ label: "❓ Answer", action: "answer_question" }, ...actions];
        }

        showTooltip(x, y, actions);
    }, 10);
});

// ─────────────────────────────────────────
// Tooltip action handler
// ─────────────────────────────────────────
async function handleTooltipAction(action) {
    const captured = captureSelection();
    if (!captured?.text) return;

    if (action === "answer_question") {
        const anchorEl = captured.anchorEl || window.getSelection()?.anchorNode?.parentElement;
        const nearbyOpts = findNearbyOptions(anchorEl);
        await answerQuestion(captured.text, nearbyOpts);
        return;
    }

    const isRewrite = ["improve", "rephrase"].includes(action);
    activeRewriteTarget = isRewrite && captured.editable ? captured : null;

    const titleMap = { improve: "✏️ Improved", rephrase: "🔁 Rephrased", summarize_sel: "📝 Summary", explain_sel: "🧠 Explanation", translate: "🌐 Translation" };
    const promptMap = {
        improve: `Improve the writing of this text. Return ONLY improved text:\n\n"${captured.text}"`,
        rephrase: `Rephrase this more clearly. Return ONLY rephrased text:\n\n"${captured.text}"`,
        summarize_sel: `Summarize this:\n\n"${captured.text}"`,
        explain_sel: `Explain this in simple terms:\n\n"${captured.text}"`,
        translate: `Translate this to English:\n\n"${captured.text}"`,
    };

    showSidebar(titleMap[action] || "Mist.AI", true, false);
    const response = await chrome.runtime.sendMessage({ type: "API_CALL", prompt: promptMap[action] });
    setResult(response?.result || "⚠️ No response.", isRewrite && captured.editable);
}

// ─────────────────────────────────────────
// Messages from background.js
// ─────────────────────────────────────────
const ACTION_TITLES = {
    explainWithMistAI: "🧠 Explanation", summarizeWithMistAI: "📝 Summary",
    rephraseWithMistAI: "🔁 Rephrased", translateWithMistAI: "🌐 Translation",
    summarize: "📄 Page Summary", explain: "🧠 Page Explanation",
};

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type === "SHOW_SIDEBAR") showSidebar(ACTION_TITLES[msg.action] || "Mist.AI", true);
    if (msg.type === "SIDEBAR_RESULT") setResult(msg.result);
    if (msg.type === "FORM_FILL_FIELD") fillFieldWithAI(lastFocusedField);
    if (msg.type === "FORM_IMPROVE_FIELD") improveFieldWithAI(lastFocusedField);
    if (msg.type === "FORM_SUBMIT") submitParentForm(lastFocusedField);
    if (msg.type === "SHOW_BUTTON_PANEL") showButtonClickerPanel();
    if (msg.type === "AUTO_FILL_PAGE") startAutoFill();

    // ❓ Right-click → Answer this Question (selected text passed from background)
    if (msg.type === "ANSWER_SELECTION") {
        const questionText = msg.questionText || "";
        const sel = window.getSelection();
        const anchorEl = sel?.anchorNode?.parentElement || document.body;
        let inputs = findNearbyOptions(anchorEl);
        // If no inputs near selection, fall back to all on page
        if (inputs.length === 0) {
            inputs = Array.from(document.querySelectorAll('input[type="radio"], input[type="checkbox"]'));
        }
        answerQuestion(questionText, inputs);
    }

    if (msg.type === "PAGE_ACTION") {
        showSidebar(ACTION_TITLES[msg.action] || "Mist.AI", true);
        const pageText = document.body.innerText.replace(/\s+/g, " ").trim();
        chrome.runtime.sendMessage(
            { type: "SCRAPE_AND_ASK", pageText, action: msg.action },
            (response) => setResult(response?.result || "⚠️ No response.")
        );
    }
});

// ─────────────────────────────────────────
// ⌨️  Keyboard Shortcuts (permanent)
//
//  Alt + M  →  Open Mist.AI sidebar (home/shortcut menu)
//  Alt + B  →  Button clicker panel
//  Alt + F  →  Auto-fill form
// ─────────────────────────────────────────
document.addEventListener("keydown", (e) => {
    if (!e.altKey) return;

    if (e.key === "m" || e.key === "M") {
        e.preventDefault();
        openHome();
    }

    if (e.key === "b" || e.key === "B") {
        e.preventDefault();
        showButtonClickerPanel();
    }

    if (e.key === "f" || e.key === "F") {
        e.preventDefault();
        startAutoFill();
    }
});

// ─────────────────────────────────────────
// 🏠 Home panel — shown when Alt+M pressed
// Lists all shortcuts so users know what's available
// ─────────────────────────────────────────
function openHome() {
    ensureSidebar();
    sidebarEl.classList.add("mistai-visible");
    if (titleEl) titleEl.textContent = "Mist.AI";
    document.getElementById("mistai-loading").style.display = "none";
    resultEl.style.display = "block";

    resultEl.innerHTML = `
    <div class="mistai-fill-result">
      <p class="mistai-fill-label">Quick Actions</p>
      <div class="mistai-fill-actions">
        <button class="mistai-action-btn" id="mh-autofill">🤖 Auto-fill This Form</button>
        <button class="mistai-action-btn mistai-secondary" id="mh-buttons">🖱️ Click a Button</button>
      </div>

      <p class="mistai-fill-label" style="margin-top:16px;">Keyboard Shortcuts</p>
      <div class="mistai-shortcut-grid">
        <div class="mistai-shortcut-row">
          <span>Open this menu</span>
          <span class="mistai-kbd"><kbd>Alt</kbd><kbd>M</kbd></span>
        </div>
        <div class="mistai-shortcut-row">
          <span>Auto-fill form</span>
          <span class="mistai-kbd"><kbd>Alt</kbd><kbd>F</kbd></span>
        </div>
        <div class="mistai-shortcut-row">
          <span>Click a button</span>
          <span class="mistai-kbd"><kbd>Alt</kbd><kbd>B</kbd></span>
        </div>
      </div>

      <p class="mistai-fill-label" style="margin-top:16px;">Tips</p>
      <div class="mistai-fill-value" style="font-size:12.5px;line-height:1.6;">
        📌 <strong>Select any text</strong> on the page to see the Mist.AI tooltip<br><br>
        ❓ <strong>Select a quiz question</strong> — the tooltip shows an Answer button if choices are nearby<br><br>
        ✨ <strong>Click an empty input field</strong> to see the auto-fill bubble
      </div>
    </div>
  `;

    document.getElementById("mh-autofill")?.addEventListener("click", () => startAutoFill());
    document.getElementById("mh-buttons")?.addEventListener("click", () => showButtonClickerPanel());
}