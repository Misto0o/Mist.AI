const REPO = "Misto0o/Mist.AI";
let activeFilter = "all";
let versions = [];

const VERSION_RANGES = {
    legacy: { label: "v1–v2.5", test: v => /^v[12](\.[0-5])?/i.test(v) },
    v2: { label: "v2.6–v4", test: v => /^v(2\.[6-9]|3|4)/i.test(v) },
    v5: { label: "v5–v7", test: v => /^v[567]/i.test(v) },
    v8: { label: "v8–v10", test: v => /^v(8|9|10)/i.test(v) },
};

async function loadReadmeHistory() {
    const [res1, res2] = await Promise.all([
        fetch(`https://api.github.com/repos/${REPO}/commits?path=README.md&per_page=100&page=1`),
        fetch(`https://api.github.com/repos/${REPO}/commits?path=README.md&per_page=100&page=2`)
    ]);

    const commits = [...await res1.json(), ...await res2.json()];

    function extractVersion(msg) {
        const match = msg.match(/\bv?(\d+(\.\d+){0,2})\b/i);
        if (!match) return null;
        const raw = match[0].toLowerCase();
        const normalized = raw.startsWith("v") ? raw : "v" + raw;
        const major = parseInt(normalized.slice(1));
        if (major < 1 || major > 20) return null;
        return normalized;
    }

    function guessEra(ver) {
        if (!ver) return null;
        for (const [era, range] of Object.entries(VERSION_RANGES)) {
            if (range.test(ver)) return era;
        }
        return null;
    }

    versions = commits
        .map(c => {
            const msgFirstLine = c.commit.message.split("\n")[0];
            const ver = extractVersion(msgFirstLine);
            const era = guessEra(ver);
            return { version: ver, label: msgFirstLine, era, commit: c.sha };
        })
        .filter(v => v.version && v.era)
        .filter((v, i, arr) => arr.findIndex(x => x.version === v.version) === i);

    buildCards();
}

function buildCards() {
    const list = document.getElementById("versionList");
    const filtered = versions.filter(v => activeFilter === "all" || v.era === activeFilter);

    list.innerHTML = filtered.map((v, i) => `
        <div class="version-card era-${v.era}" style="animation-delay:${i * 0.04}s"
             data-era="${v.era}" data-commit="${v.commit}">
            <div class="card-header" onclick="toggleCard(this)">
                <span class="version-num">${v.version}</span>
                <span class="card-title">${v.label}</span>
                <span class="toggle-arrow">▾</span>
            </div>
            <div class="card-body">
                <div class="card-body-inner"></div>
            </div>
        </div>
    `).join("");

    // Pin static origin card at the bottom for pre-README era
    if (activeFilter === "all" || activeFilter === "legacy") {
        list.innerHTML += `
            <div class="version-card era-legacy" style="animation-delay:${filtered.length * 0.04}s">
                <div class="card-header" onclick="toggleCard(this)">
                    <span class="version-num">v1–v2.5</span>
                    <span class="card-title">The beginning. Before readmes.</span>
                    <span class="toggle-arrow">▾</span>
                </div>
                <div class="card-body">
                    <div class="card-body-inner" data-loaded="true">
                        <div class="readme-content">
                            <h2>Origin</h2>
                            <p>MistAI started as a single-model experiment — a fun joke, a class project at most. Just Gemini 2.0 Flash, no README, no .gitignore, commits named "pls work" and "something? idfk". The entire thing was maybe 5 files and 800 lines of code total.</p>
                            <p>The backend was ~50 lines of Flask. One route, one model, one input box. The frontend was a plain HTML file with a div called "chat-box". That was it.</p>
                            <p>The backend ran on Render, which was a constant battle — the server would spin down after inactivity and cold starts were painful. Not willing to pay to keep it alive, Zapier cron jobs became the workaround, pinging it every few hours just to keep it warm. Then people started spamming it, the free API limits got hit, and that turned into a rotating keys function just to stay online.</p>
                            <p>V2 brought a sidebar, fun facts, and GSAP animations. V2.5 added mobile support. No polish. Just figuring it out.</p>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }
}

async function toggleCard(header) {
    const card = header.parentElement;
    const isOpen = card.classList.contains("open");
    card.classList.toggle("open");
    if (isOpen) return;

    const bodyEl = card.querySelector(".card-body-inner");
    if (bodyEl.dataset.loaded) return;
    bodyEl.dataset.loaded = "true";

    const commit = card.dataset.commit;
    bodyEl.innerHTML = `<div class="readme-loading"><div class="spinner"></div>Fetching README…</div>`;

    try {
        const res = await fetch(`https://raw.githubusercontent.com/${REPO}/${commit}/README.md`);
        if (!res.ok) throw new Error(res.status);
        const text = await res.text();
        bodyEl.innerHTML = `
                    <div class="readme-content">${marked.parse(text)}</div>
                    <a class="github-link" href="https://github.com/${REPO}/blob/${commit}/README.md" target="_blank">View on GitHub</a>
                `;
    } catch (err) {
        bodyEl.innerHTML = `<p class="readme-error">Failed to load README</p>`;
    }
}

document.getElementById("filterBar").addEventListener("click", e => {
    if (!e.target.matches(".filter-btn")) return;
    document.querySelectorAll(".filter-btn").forEach(b => b.classList.remove("active"));
    e.target.classList.add("active");
    activeFilter = e.target.dataset.filter;
    buildCards();
});

loadReadmeHistory();