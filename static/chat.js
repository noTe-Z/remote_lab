(function () {
  "use strict";

  console.log("hello!");

  // ---- Elements ----
  const menuBtn = document.getElementById("menuBtn");
  const sidebarOverlay = document.getElementById("sidebarOverlay");
  const closeSidebar = document.getElementById("closeSidebar");
  const collapseBtn = document.getElementById("collapseBtn");
  const sessionList = document.getElementById("sessionList");
  const newSessionBtn = document.getElementById("newSessionBtn");
  const newSessionModal = document.getElementById("newSessionModal");
  const folderInput = document.getElementById("folderInput");
  const folderSuggestions = document.getElementById("folderSuggestions");
  const toolSelect = document.getElementById("toolSelect");
  const cancelModal = document.getElementById("cancelModal");
  const createSessionBtn = document.getElementById("createSession");
  const messagesEl = document.getElementById("messages");
  const messagesInner = document.getElementById("messagesInner");
  const emptyState = document.getElementById("emptyState");
  const msgInput = document.getElementById("msgInput");
  const sendBtn = document.getElementById("sendBtn");
  const headerTitle = document.getElementById("headerTitle");
  const statusDot = document.getElementById("statusDot");
  const statusText = document.getElementById("statusText");
  const imgBtn = document.getElementById("imgBtn");
  const imgFileInput = document.getElementById("imgFileInput");
  const imgPreviewStrip = document.getElementById("imgPreviewStrip");
  const voiceBtn = document.getElementById("voiceBtn");
  const inlineToolSelect = document.getElementById("inlineToolSelect");
  const thinkingToggle = document.getElementById("thinkingToggle");
  const cancelBtn = document.getElementById("cancelBtn");
  const contextTokens = document.getElementById("contextTokens");
  const compactBtn = document.getElementById("compactBtn");
  const tabSessions = document.getElementById("tabSessions");
  const tabProgress = document.getElementById("tabProgress");
  const tabFiles = document.getElementById("tabFiles");
  const progressPanel = document.getElementById("progressPanel");
  const filesPanel = document.getElementById("filesPanel");
  const inputArea = document.getElementById("inputArea");
  const inputResizeHandle = document.getElementById("inputResizeHandle");
  const fileViewerModal = document.getElementById("fileViewerModal");
  const fileViewerTitle = document.getElementById("fileViewerTitle");
  const fileViewerContent = document.getElementById("fileViewerContent");
  const fileViewerClose = document.getElementById("fileViewerClose");
  const skillSuggestions = document.getElementById("skillSuggestions");

  // Inbox elements
  const inboxContainer = document.getElementById("inboxContainer");
  const inboxList = document.getElementById("inboxList");
  const inboxCount = document.getElementById("inboxCount");
  const inboxActionModal = document.getElementById("inboxActionModal");
  const inboxActionContent = document.getElementById("inboxActionContent");
  const inboxFolderSelect = document.getElementById("inboxFolderSelect");
  const inboxToolSelect = document.getElementById("inboxToolSelect");
  const inboxActionCancel = document.getElementById("inboxActionCancel");
  const inboxActionCreate = document.getElementById("inboxActionCreate");

  let ws = null;
  let pendingImages = [];
  let currentSessionId = null;
  let sessionStatus = "idle";
  let reconnectTimer = null;
  let sessions = [];
  let pendingSummary = new Set(); // sessionIds awaiting summary generation
  let finishedUnread = new Set(); // sessionIds finished but not yet opened
  let lastSidebarUpdatedAt = {}; // sessionId -> last known updatedAt
  let messageQueue = []; // messages queued while disconnected

  let currentTokens = 0;

  let selectedTool = localStorage.getItem("selectedTool") || null;
  // Default thinking to enabled; only disable if explicitly set to 'false'
  let thinkingEnabled = localStorage.getItem("thinkingEnabled") !== "false";
  let sidebarCollapsed = localStorage.getItem("sidebarCollapsed") === "true";
  let toolsList = [];
  let skillsList = [];
  let isDesktop = window.matchMedia("(min-width: 768px)").matches;
  let collapsedFolders = JSON.parse(
    localStorage.getItem("collapsedFolders") || "{}",
  );

  // Inbox state
  let inboxItems = [];
  let selectedInboxItem = null;

  // Assistant directory for observer/reflector inbox items
  let ASSISTANT_DIR = null;
  fetch('/api/config')
    .then(r => r.json())
    .then(cfg => { if (cfg.assistantDir) ASSISTANT_DIR = cfg.assistantDir; })
    .catch(() => {});

  // Thinking block state
  let currentThinkingBlock = null; // { el, body, tools: Set }
  let inThinkingBlock = false;

  // ---- Browser Notifications + Web Push ----
  if ("Notification" in window && Notification.permission === "default") {
    Notification.requestPermission().then((perm) => {
      if (perm === "granted") setupPushNotifications();
    });
  } else if ("Notification" in window && Notification.permission === "granted") {
    setupPushNotifications();
  }

  function notifyCompletion(session) {
    if (!("Notification" in window) || Notification.permission !== "granted")
      return;
    if (document.visibilityState === "visible") return;
    const folder = (session?.folder || "").split("/").pop() || "Session";
    const name = session?.name || folder;
    const n = new Notification("RemoteLab", {
      body: `${name} — task completed`,
      tag: "remotelab-done",
    });
    n.onclick = () => {
      window.focus();
      n.close();
    };
  }

  function urlBase64ToUint8Array(base64String) {
    const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding)
      .replace(/-/g, "+")
      .replace(/_/g, "/");
    const rawData = atob(base64);
    const outputArray = new Uint8Array(rawData.length);
    for (let i = 0; i < rawData.length; i++)
      outputArray[i] = rawData.charCodeAt(i);
    return outputArray;
  }

  async function setupPushNotifications() {
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) return;
    try {
      const reg = await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;
      const existing = await reg.pushManager.getSubscription();
      if (existing) return; // already subscribed
      const res = await fetch("/api/push/vapid-public-key");
      if (!res.ok) return;
      const { publicKey } = await res.json();
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });
      await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(sub.toJSON()),
      });
      console.log("[push] Subscribed to web push");
    } catch (err) {
      console.warn("[push] Setup failed:", err.message);
    }
  }

  // ---- Responsive layout ----
  function initResponsiveLayout() {
    const mq = window.matchMedia("(min-width: 768px)");
    function onBreakpointChange(e) {
      isDesktop = e.matches;
      if (isDesktop) {
        sidebarOverlay.classList.remove("open");
        if (sidebarCollapsed) sidebarOverlay.classList.add("collapsed");
      } else {
        sidebarOverlay.classList.remove("collapsed");
      }
    }
    mq.addEventListener("change", onBreakpointChange);
    onBreakpointChange(mq);
  }

  // ---- Thinking toggle ----
  function updateThinkingUI() {
    thinkingToggle.classList.toggle("active", thinkingEnabled);
  }
  updateThinkingUI();

  thinkingToggle.addEventListener("click", () => {
    thinkingEnabled = !thinkingEnabled;
    localStorage.setItem("thinkingEnabled", thinkingEnabled);
    updateThinkingUI();
  });

  // ---- Sidebar collapse (desktop) ----
  collapseBtn.addEventListener("click", () => {
    sidebarCollapsed = !sidebarCollapsed;
    localStorage.setItem("sidebarCollapsed", sidebarCollapsed);
    sidebarOverlay.classList.toggle("collapsed", sidebarCollapsed);
  });

  // ---- Inline tool select ----
  async function loadInlineTools() {
    try {
      const res = await fetch("/api/tools");
      const data = await res.json();
      toolsList = (data.tools || []).filter((t) => t.available);
      inlineToolSelect.innerHTML = "";
      for (const t of toolsList) {
        const opt = document.createElement("option");
        opt.value = t.id;
        opt.textContent = t.name;
        inlineToolSelect.appendChild(opt);
      }
      if (selectedTool && toolsList.some((t) => t.id === selectedTool)) {
        inlineToolSelect.value = selectedTool;
      } else if (toolsList.length > 0) {
        selectedTool = toolsList[0].id;
      }
    } catch {}
  }

  inlineToolSelect.addEventListener("change", () => {
    selectedTool = inlineToolSelect.value;
    localStorage.setItem("selectedTool", selectedTool);
  });

  // ---- Skills autocomplete ----
  async function loadSkills() {
    try {
      const res = await fetch("/api/skills");
      const data = await res.json();
      skillsList = data.skills || [];
    } catch {}
  }

  function showSkillSuggestions(query) {
    // query is the text after "/", e.g. "sim" for "/sim"
    const filtered = skillsList.filter(s =>
      s.name.toLowerCase().startsWith(query.toLowerCase())
    );
    if (filtered.length === 0) {
      skillSuggestions.classList.remove("visible");
      return;
    }
    skillSuggestions.innerHTML = filtered.map(s => `
      <button class="skill-suggestion" data-skill="${s.name}">
        <div class="skill-name">/${s.name}</div>
        <div class="skill-desc">${s.description}</div>
      </button>
    `).join("");
    skillSuggestions.classList.add("visible");
  }

  function hideSkillSuggestions() {
    skillSuggestions.classList.remove("visible");
  }

  // Handle skill suggestion click
  skillSuggestions.addEventListener("click", (e) => {
    const btn = e.target.closest(".skill-suggestion");
    if (!btn) return;
    const skillName = btn.dataset.skill;
    const text = msgInput.value;
    // Replace the "/" and partial skill name with the full skill name
    const slashIndex = text.lastIndexOf("/");
    if (slashIndex !== -1) {
      const before = text.slice(0, slashIndex);
      const after = text.slice(slashIndex).split(/\s/).slice(1).join(" ");
      msgInput.value = `${before}/${skillName} ${after}`;
      msgInput.focus();
      // Move cursor to end
      msgInput.selectionStart = msgInput.selectionEnd = msgInput.value.length;
    }
    hideSkillSuggestions();
  });

  // Check for skill command on input
  let skillQueryStart = -1;
  msgInput.addEventListener("input", () => {
    const text = msgInput.value;
    const cursorPos = msgInput.selectionStart;
    // Find if cursor is after a "/" that starts a skill command
    const beforeCursor = text.slice(0, cursorPos);
    const slashIndex = beforeCursor.lastIndexOf("/");
    // Check if "/" is at start of line or preceded by whitespace
    if (slashIndex !== -1 && (slashIndex === 0 || /\s/.test(text[slashIndex - 1]))) {
      const afterSlash = beforeCursor.slice(slashIndex + 1);
      // If no space after slash, it's a skill query
      if (!afterSlash.includes(" ") && afterSlash.length < 20) {
        skillQueryStart = slashIndex;
        showSkillSuggestions(afterSlash);
      } else {
        hideSkillSuggestions();
      }
    } else {
      hideSkillSuggestions();
    }
  });

  // Hide suggestions on blur (with delay to allow click)
  msgInput.addEventListener("blur", () => {
    setTimeout(hideSkillSuggestions, 150);
  });

  // ---- WebSocket ----
  function connect() {
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    ws = new WebSocket(`${proto}//${location.host}/ws`);

    ws.onopen = () => {
      updateStatus("connected", "idle");
      ws.send(JSON.stringify({ action: "list" }));
      if (currentSessionId) {
        ws.send(
          JSON.stringify({ action: "attach", sessionId: currentSessionId }),
        );
      }
      // Flush messages queued while disconnected
      for (const m of messageQueue) {
        ws.send(JSON.stringify(m));
      }
      messageQueue = [];
    };

    ws.onmessage = (e) => {
      let msg;
      try {
        msg = JSON.parse(e.data);
      } catch {
        return;
      }
      handleWsMessage(msg);
    };

    ws.onclose = () => {
      updateStatus("disconnected", "idle");
      scheduleReconnect();
    };

    ws.onerror = (err) => {
      console.error("WebSocket error:", err);
      // Try to reconnect after a short delay
      setTimeout(() => {
        if (ws && ws.readyState !== WebSocket.OPEN) {
          ws.close();
        }
      }, 1000);
    };
  }

  function scheduleReconnect() {
    if (reconnectTimer) return;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, 3000);
  }

  function wsSend(msg) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  }

  function handleWsMessage(msg) {
    switch (msg.type) {
      case "sessions":
        sessions = msg.sessions || [];
        renderSessionList();
        break;

      case "session":
        if (msg.session) {
          const prevStatus = sessionStatus;
          sessionStatus = msg.session.status || "idle";
          updateStatus("connected", sessionStatus);
          const prevEntry = sessions.find((s) => s.id === msg.session.id);
          const wasRunning = prevEntry?.status === "running";
          if (
            msg.session.id === currentSessionId &&
            prevStatus === "running" &&
            sessionStatus === "idle"
          ) {
            notifyCompletion(msg.session);
          }
          // Mark finished-unread for sessions that completed without being viewed
          if (wasRunning && msg.session.status === "idle") {
            const isActiveAndVisible =
              msg.session.id === currentSessionId &&
              document.visibilityState === "visible";
            if (!isActiveAndVisible) {
              finishedUnread.add(msg.session.id);
            }
          }
          // Mark as pending summary when any session goes running → idle
          if (wasRunning && msg.session.status === "idle") {
            pendingSummary.add(msg.session.id);
            if (activeTab === "progress") renderProgressPanel(lastProgressState);
          }
          const idx = sessions.findIndex((s) => s.id === msg.session.id);
          if (idx >= 0) sessions[idx] = msg.session;
          else sessions.push(msg.session);
          renderSessionList();
        }
        break;

      case "history":
        clearMessages();
        if (msg.events && msg.events.length > 0) {
          for (const evt of msg.events) renderEvent(evt, false);
          scrollToBottom();
        }
        break;

      case "event":
        if (msg.event) renderEvent(msg.event, true);
        break;

      case "deleted":
        sessions = sessions.filter((s) => s.id !== msg.sessionId);
        localStorage.removeItem(`draft_${msg.sessionId}`);
        if (currentSessionId === msg.sessionId) {
          messageQueue = [];
          currentSessionId = null;
          clearMessages();
          showEmpty();
        }
        renderSessionList();
        break;

      case "error":
        console.error("WS error:", msg.message);
        break;
    }
  }

  // ---- Status ----
  function updateStatus(connState, sessState) {
    if (connState === "disconnected") {
      statusDot.className = "status-dot";
      statusText.textContent = "reconnecting…";
      // Keep input usable if we have a session — messages will be queued
      if (!currentSessionId) {
        msgInput.disabled = true;
        sendBtn.style.display = "";
        sendBtn.disabled = true;
      }
      cancelBtn.style.display = "none";
      return;
    }
    sessionStatus = sessState;
    const isRunning = sessState === "running";
    if (isRunning) {
      statusDot.className = "status-dot running";
      statusText.textContent = "running";
    } else {
      statusDot.className = "status-dot";
      statusText.textContent = currentSessionId ? "idle" : "connected";
    }
    const hasSession = !!currentSessionId;
    // Keep msgInput and sendBtn enabled even without session (for inbox)
    msgInput.disabled = false;
    sendBtn.style.display = isRunning ? "none" : "";
    sendBtn.disabled = false;
    cancelBtn.style.display = isRunning && hasSession ? "flex" : "none";
    imgBtn.disabled = false;  // Allow image upload for inbox
    voiceBtn.disabled = false;  // Allow voice input for inbox
    inlineToolSelect.disabled = !hasSession;
    thinkingToggle.disabled = !hasSession;
    // Update placeholder based on session state
    if (!hasSession) {
      msgInput.placeholder = "Add to inbox...";
    } else {
      msgInput.placeholder = "Message...";
    }
  }

  // ---- Message rendering ----
  function clearMessages() {
    messagesInner.innerHTML = "";
    // Reset thinking block state
    inThinkingBlock = false;
    currentThinkingBlock = null;
  }

  function showEmpty() {
    // Re-query emptyState in case it was modified
    let emptyEl = document.getElementById("emptyState");
    if (!emptyEl) {
      // Recreate emptyState if it doesn't exist
      emptyEl = document.createElement("div");
      emptyEl.className = "empty-state";
      emptyEl.id = "emptyState";
      emptyEl.innerHTML = `
        <div class="inbox-container" id="inboxContainer">
          <div class="inbox-header">
            <h2>Inbox</h2>
            <span class="inbox-count" id="inboxCount">0 items</span>
          </div>
          <div class="inbox-list" id="inboxList">
            <div class="inbox-empty">No items yet. Type below to add something.</div>
          </div>
        </div>
      `;
    }

    // Force show the element
    emptyEl.style.display = "flex";

    // Clear and re-add - use remove() instead of innerHTML for better mobile compatibility
    while (messagesInner.firstChild) {
      messagesInner.removeChild(messagesInner.firstChild);
    }
    messagesInner.appendChild(emptyEl);
    inThinkingBlock = false;
    currentThinkingBlock = null;
  }

  function scrollToBottom() {
    requestAnimationFrame(() => {
      messagesEl.scrollTop = messagesEl.scrollHeight;
    });
  }

  function renderEvent(evt, autoScroll) {
    // Remove empty state if present (re-query in case it was recreated)
    const currentEmptyState = document.getElementById("emptyState");
    if (currentEmptyState && currentEmptyState.parentNode === messagesInner) {
      currentEmptyState.remove();
    }

    const shouldScroll =
      autoScroll &&
      messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight <
        120;

    switch (evt.type) {
      case "message":
        renderMessage(evt);
        break;
      case "tool_use":
        renderToolUse(evt);
        break;
      case "tool_result":
        renderToolResult(evt);
        break;
      case "file_change":
        renderFileChange(evt);
        break;
      case "reasoning":
        renderReasoning(evt);
        break;
      case "status":
        renderStatusMsg(evt);
        break;
      case "usage":
        renderUsage(evt);
        break;
    }

    if (shouldScroll) scrollToBottom();
  }

  // ---- Thinking block helpers ----
  function openThinkingBlock() {
    const block = document.createElement("div");
    block.className = "thinking-block collapsed"; // collapsed by default

    const header = document.createElement("div");
    header.className = "thinking-header";
    header.innerHTML = `<span class="thinking-icon">&#9881;</span>
      <span class="thinking-label">Thinking…</span>
      <span class="thinking-chevron">&#9660;</span>`;

    const body = document.createElement("div");
    body.className = "thinking-body";

    header.addEventListener("click", () => {
      block.classList.toggle("collapsed");
    });

    block.appendChild(header);
    block.appendChild(body);
    messagesInner.appendChild(block);

    currentThinkingBlock = {
      el: block,
      header,
      body,
      label: header.querySelector(".thinking-label"),
      tools: new Set(),
    };
    inThinkingBlock = true;
  }

  function finalizeThinkingBlock() {
    if (!currentThinkingBlock) return;
    const { label, tools } = currentThinkingBlock;
    const toolList = [...tools];
    if (toolList.length > 0) {
      label.textContent = `Thought · used ${toolList.join(", ")}`;
    } else {
      label.textContent = "Thought";
    }
    inThinkingBlock = false;
    currentThinkingBlock = null;
  }

  function getThinkingBody() {
    if (!inThinkingBlock) openThinkingBlock();
    return currentThinkingBlock.body;
  }

  // ---- Render functions ----
  function renderMessage(evt) {
    const role = evt.role || "assistant";

    if (role === "assistant" && inThinkingBlock) {
      finalizeThinkingBlock();
    }

    if (role === "user") {
      const wrap = document.createElement("div");
      wrap.className = "msg-user";
      const bubble = document.createElement("div");
      bubble.className = "msg-user-bubble";
      if (evt.images && evt.images.length > 0) {
        const imgWrap = document.createElement("div");
        imgWrap.className = "msg-images";
        for (const img of evt.images) {
          const imgEl = document.createElement("img");
          imgEl.src = `/api/images/${img.filename}`;
          imgEl.alt = "attached image";
          imgEl.loading = "lazy";
          imgEl.onclick = () => window.open(imgEl.src, "_blank");
          imgWrap.appendChild(imgEl);
        }
        bubble.appendChild(imgWrap);
      }
      if (evt.content) {
        const span = document.createElement("span");
        span.textContent = evt.content;
        bubble.appendChild(span);
      }
      wrap.appendChild(bubble);
      messagesInner.appendChild(wrap);
    } else {
      const div = document.createElement("div");
      div.className = "msg-assistant md-content";
      if (evt.content) div.innerHTML = marked.parse(evt.content);
      messagesInner.appendChild(div);
    }
  }

  function renderToolUse(evt) {
    const container = getThinkingBody();
    if (currentThinkingBlock && evt.toolName) {
      currentThinkingBlock.tools.add(evt.toolName);
    }

    const card = document.createElement("div");
    card.className = "tool-card";

    const header = document.createElement("div");
    header.className = "tool-header";
    header.innerHTML = `<span class="tool-name">${esc(evt.toolName || "tool")}</span>
      <span class="tool-toggle">&#9654;</span>`;

    const body = document.createElement("div");
    body.className = "tool-body";
    body.id = "tool_" + evt.id;
    const pre = document.createElement("pre");
    pre.textContent = evt.toolInput || "";
    body.appendChild(pre);

    header.addEventListener("click", () => {
      header.classList.toggle("expanded");
      body.classList.toggle("expanded");
    });

    card.appendChild(header);
    card.appendChild(body);
    card.dataset.toolId = evt.id;
    container.appendChild(card);
  }

  function renderToolResult(evt) {
    // Search in current thinking block body, or fall back to messagesInner
    const searchRoot =
      inThinkingBlock && currentThinkingBlock
        ? currentThinkingBlock.body
        : messagesInner;

    const cards = searchRoot.querySelectorAll(".tool-card");
    let targetCard = null;
    for (let i = cards.length - 1; i >= 0; i--) {
      if (!cards[i].querySelector(".tool-result")) {
        targetCard = cards[i];
        break;
      }
    }

    if (targetCard) {
      const body = targetCard.querySelector(".tool-body");
      const label = document.createElement("div");
      label.className = "tool-result-label";
      label.innerHTML =
        "Result" +
        (evt.exitCode !== undefined
          ? `<span class="exit-code ${evt.exitCode === 0 ? "ok" : "fail"}">${evt.exitCode === 0 ? "exit 0" : "exit " + evt.exitCode}</span>`
          : "");
      const pre = document.createElement("pre");
      pre.className = "tool-result";
      pre.textContent = evt.output || "";
      body.appendChild(label);
      body.appendChild(pre);
      if (evt.exitCode && evt.exitCode !== 0) {
        targetCard.querySelector(".tool-header").classList.add("expanded");
        body.classList.add("expanded");
      }
    }
  }

  function renderFileChange(evt) {
    const container = getThinkingBody();
    const div = document.createElement("div");
    div.className = "file-card";
    const kind = evt.changeType || "edit";
    div.innerHTML = `<span class="file-path">${esc(evt.filePath || "")}</span>
      <span class="change-type ${kind}">${kind}</span>`;
    container.appendChild(div);
  }

  function renderReasoning(evt) {
    const container = getThinkingBody();
    const div = document.createElement("div");
    div.className = "reasoning";
    div.textContent = evt.content || "";
    container.appendChild(div);
  }

  function renderStatusMsg(evt) {
    if (
      !evt.content ||
      evt.content === "completed" ||
      evt.content === "thinking"
    )
      return;
    const div = document.createElement("div");
    div.className = "msg-system";
    div.textContent = evt.content;
    messagesInner.appendChild(div);
  }

  function formatTokens(n) {
    if (n < 500) return "< 1K";
    return "~" + Math.round(n / 1000) + "K";
  }

  function updateContextDisplay(inputTokens) {
    currentTokens = inputTokens;
    if (inputTokens > 0 && currentSessionId) {
      contextTokens.textContent = formatTokens(inputTokens);
      contextTokens.style.display = "";
      compactBtn.style.display = "";
    }
  }

  function renderUsage(evt) {
    const div = document.createElement("div");
    div.className = "usage-info";
    const input = evt.inputTokens || 0;
    const output = evt.outputTokens || 0;
    div.textContent = `${input.toLocaleString()} in · ${output.toLocaleString()} out`;
    messagesInner.appendChild(div);
    updateContextDisplay(input);
  }

  function esc(s) {
    const el = document.createElement("span");
    el.textContent = s;
    return el.innerHTML;
  }

  // ---- Session list ----
  function renderSessionList() {
    sessionList.innerHTML = "";

    const groups = new Map();
    for (const s of sessions) {
      const folder = s.folder || "?";
      if (!groups.has(folder)) groups.set(folder, []);
      groups.get(folder).push(s);
    }

    for (const [folder, folderSessions] of groups) {
      const group = document.createElement("div");
      group.className = "folder-group";

      const shortFolder = folder.replace(/^\/Users\/[^/]+/, "~");
      const folderName = shortFolder.split("/").pop() || shortFolder;

      const header = document.createElement("div");
      header.className =
        "folder-group-header" + (collapsedFolders[folder] ? " collapsed" : "");
      header.innerHTML = `<span class="folder-chevron">&#9660;</span>
        <span class="folder-name" title="${esc(shortFolder)}">${esc(folderName)}</span>
        <span class="folder-count">${folderSessions.length}</span>
        <button class="folder-add-btn" title="New session">+</button>`;
      header.addEventListener("click", (e) => {
        if (e.target.classList.contains("folder-add-btn")) return;
        header.classList.toggle("collapsed");
        collapsedFolders[folder] = header.classList.contains("collapsed");
        localStorage.setItem(
          "collapsedFolders",
          JSON.stringify(collapsedFolders),
        );
      });
      header.querySelector(".folder-add-btn").addEventListener("click", (e) => {
        e.stopPropagation();
        const tool = selectedTool || toolsList[0]?.id;
        if (!tool) {
          // No tool loaded yet — fallback to modal
          if (!isDesktop) closeSidebarFn();
          newSessionModal.classList.add("open");
          loadTools();
          folderInput.value = folder;
          folderSuggestions.innerHTML = "";
          return;
        }
        if (!isDesktop) closeSidebarFn();
        wsSend({ action: "create", folder, tool });
        const handler = (evt) => {
          let msg;
          try { msg = JSON.parse(evt.data); } catch { return; }
          if (msg.type === "session" && msg.session) {
            ws.removeEventListener("message", handler);
            attachSession(msg.session.id, msg.session);
            wsSend({ action: "list" });
          }
        };
        ws.addEventListener("message", handler);
      });

      const items = document.createElement("div");
      items.className = "folder-group-items";

      // Sort sessions by creation time, newest first
      const sortedSessions = [...folderSessions].sort((a, b) => {
        const aTime = a.created ? new Date(a.created).getTime() : 0;
        const bTime = b.created ? new Date(b.created).getTime() : 0;
        return bTime - aTime;
      });

      for (const s of sortedSessions) {
        const div = document.createElement("div");
        div.className =
          "session-item" + (s.id === currentSessionId ? " active" : "");

        const displayName = s.name || s.tool || "session";
        const metaParts = [];
        if (s.name && s.tool) metaParts.push(s.tool);
        if (s.status === "running") metaParts.push("●&nbsp;running");

        const metaHtml = finishedUnread.has(s.id)
          ? `<span class="status-done">● done</span>`
          : s.status === "running"
            ? `<span class="status-running">● running</span>`
            : s.tool && s.name
              ? `<span>${esc(s.tool)}</span>`
              : "";

        div.innerHTML = `
          <div class="session-item-info">
            <div class="session-item-name">${esc(displayName)}</div>
            <div class="session-item-meta">${metaHtml}</div>
          </div>
          <div class="session-item-actions">
            <button class="session-action-btn rename" title="Rename" data-id="${s.id}">&#9998;</button>
            <button class="session-action-btn del" title="Delete" data-id="${s.id}">&times;</button>
          </div>`;

        div.addEventListener("click", (e) => {
          if (
            e.target.classList.contains("rename") ||
            e.target.classList.contains("del")
          )
            return;
          attachSession(s.id, s);
          if (!isDesktop) closeSidebarFn();
        });

        div.querySelector(".rename").addEventListener("click", (e) => {
          e.stopPropagation();
          startRename(div, s);
        });

        div.querySelector(".del").addEventListener("click", (e) => {
          e.stopPropagation();
          if (confirm("Delete this session?")) {
            wsSend({ action: "delete", sessionId: s.id });
          }
        });

        items.appendChild(div);
      }

      group.appendChild(header);
      group.appendChild(items);
      sessionList.appendChild(group);
    }
  }

  function startRename(itemEl, session) {
    const nameEl = itemEl.querySelector(".session-item-name");
    const current = session.name || session.tool || "";
    const input = document.createElement("input");
    input.className = "session-rename-input";
    input.value = current;
    nameEl.replaceWith(input);
    input.focus();
    input.select();

    function commit() {
      const newName = input.value.trim();
      if (newName && newName !== current) {
        wsSend({ action: "rename", sessionId: session.id, name: newName });
      } else {
        renderSessionList(); // revert
      }
    }

    input.addEventListener("blur", commit);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        input.blur();
      }
      if (e.key === "Escape") {
        input.removeEventListener("blur", commit);
        renderSessionList();
      }
    });
  }

  function attachSession(id, session) {
    currentSessionId = id;
    currentTokens = 0;
    contextTokens.style.display = "none";
    compactBtn.style.display = "none";
    finishedUnread.delete(id);
    clearMessages();
    wsSend({ action: "attach", sessionId: id });

    // Hide inbox, show normal chat (re-query in case it was recreated)
    const currentEmptyState = document.getElementById("emptyState");
    if (currentEmptyState) currentEmptyState.style.display = "none";
    msgInput.placeholder = "Message...";

    const displayName =
      session?.name || session?.folder?.split("/").pop() || "Session";
    headerTitle.textContent = displayName;
    msgInput.disabled = false;
    sendBtn.disabled = false;
    imgBtn.disabled = false;
    voiceBtn.disabled = false;
    inlineToolSelect.disabled = false;
    thinkingToggle.disabled = false;

    if (session?.tool && toolsList.some((t) => t.id === session.tool)) {
      inlineToolSelect.value = session.tool;
      selectedTool = session.tool;
      localStorage.setItem("selectedTool", selectedTool);
    }

    restoreDraft();
    msgInput.focus();
    renderSessionList();
  }

  // Click header title to go back to inbox/landing page
  headerTitle.addEventListener("click", () => {
    // Always detach from current session and show inbox
    if (currentSessionId) {
      wsSend({ action: "detach" });
    }
    currentSessionId = null;
    showEmpty();
    msgInput.placeholder = "Add to inbox...";
    headerTitle.textContent = "RemoteLab Chat";
    imgBtn.disabled = false;  // Allow image upload for inbox
    voiceBtn.disabled = false;  // Allow voice input for inbox
    inlineToolSelect.disabled = true;
    thinkingToggle.disabled = true;
    compactBtn.style.display = "none";
    contextTokens.style.display = "none";
    renderSessionList();
    loadInbox();
  });
  headerTitle.style.cursor = "pointer";

  // ---- Sidebar ----
  function openSidebar() {
    sidebarOverlay.classList.add("open");
  }
  function closeSidebarFn() {
    sidebarOverlay.classList.remove("open");
  }

  menuBtn.addEventListener("click", openSidebar);
  closeSidebar.addEventListener("click", closeSidebarFn);
  sidebarOverlay.addEventListener("click", (e) => {
    if (e.target === sidebarOverlay && !isDesktop) closeSidebarFn();
  });

  // ---- New Session Modal ----
  newSessionBtn.addEventListener("click", () => {
    if (!isDesktop) closeSidebarFn();
    newSessionModal.classList.add("open");
    loadTools();
    folderInput.value = "";
    folderSuggestions.innerHTML = "";
    folderInput.focus();
  });

  cancelModal.addEventListener("click", () =>
    newSessionModal.classList.remove("open"),
  );
  newSessionModal.addEventListener("click", (e) => {
    if (e.target === newSessionModal) newSessionModal.classList.remove("open");
  });

  createSessionBtn.addEventListener("click", () => {
    const folder = folderInput.value.trim();
    const tool = toolSelect.value;
    if (!folder) {
      folderInput.focus();
      return;
    }
    wsSend({ action: "create", folder, tool });
    newSessionModal.classList.remove("open");

    const handler = (e) => {
      let msg;
      try {
        msg = JSON.parse(e.data);
      } catch {
        return;
      }
      if (msg.type === "session" && msg.session) {
        ws.removeEventListener("message", handler);
        attachSession(msg.session.id, msg.session);
        wsSend({ action: "list" });
      }
    };
    ws.addEventListener("message", handler);
  });

  async function loadTools() {
    try {
      const res = await fetch("/api/tools");
      const data = await res.json();
      toolSelect.innerHTML = "";
      for (const t of data.tools || []) {
        if (!t.available) continue;
        const opt = document.createElement("option");
        opt.value = t.id;
        opt.textContent = t.name;
        toolSelect.appendChild(opt);
      }
    } catch {}
  }

  // Folder autocomplete
  let acTimer = null;
  folderInput.addEventListener("input", () => {
    clearTimeout(acTimer);
    acTimer = setTimeout(async () => {
      const q = folderInput.value.trim();
      if (q.length < 2) {
        folderSuggestions.innerHTML = "";
        return;
      }
      try {
        const res = await fetch(`/api/autocomplete?q=${encodeURIComponent(q)}`);
        const data = await res.json();
        folderSuggestions.innerHTML = "";
        for (const s of (data.suggestions || []).slice(0, 5)) {
          const btn = document.createElement("button");
          btn.type = "button";
          btn.textContent = s.replace(/^\/Users\/[^/]+/, "~");
          btn.onclick = () => {
            folderInput.value = s;
            folderSuggestions.innerHTML = "";
          };
          folderSuggestions.appendChild(btn);
        }
      } catch {}
    }, 200);
  });

  // ---- Image handling ----
  function fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const base64 = reader.result.split(",")[1];
        resolve({
          data: base64,
          mimeType: file.type || "image/png",
          objectUrl: URL.createObjectURL(file),
        });
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  async function addImageFiles(files) {
    for (const file of files) {
      if (!file.type.startsWith("image/")) continue;
      if (pendingImages.length >= 4) break;
      pendingImages.push(await fileToBase64(file));
    }
    renderImagePreviews();
  }

  function renderImagePreviews() {
    imgPreviewStrip.innerHTML = "";
    if (pendingImages.length === 0) {
      imgPreviewStrip.classList.remove("has-images");
      return;
    }
    imgPreviewStrip.classList.add("has-images");
    pendingImages.forEach((img, i) => {
      const item = document.createElement("div");
      item.className = "img-preview-item";
      const imgEl = document.createElement("img");
      imgEl.src = img.objectUrl;
      const removeBtn = document.createElement("button");
      removeBtn.className = "remove-img";
      removeBtn.innerHTML = "&times;";
      removeBtn.onclick = () => {
        URL.revokeObjectURL(img.objectUrl);
        pendingImages.splice(i, 1);
        renderImagePreviews();
      };
      item.appendChild(imgEl);
      item.appendChild(removeBtn);
      imgPreviewStrip.appendChild(item);
    });
  }

  imgBtn.addEventListener("click", () => imgFileInput.click());
  imgFileInput.addEventListener("change", () => {
    if (imgFileInput.files.length > 0) addImageFiles(imgFileInput.files);
    imgFileInput.value = "";
  });

  msgInput.addEventListener("paste", (e) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    const imageFiles = [];
    for (const item of items) {
      if (item.type.startsWith("image/")) {
        const file = item.getAsFile();
        if (file) imageFiles.push(file);
      }
    }
    if (imageFiles.length > 0) {
      e.preventDefault();
      addImageFiles(imageFiles);
    }
  });

  // ---- Voice Recording ----
  let mediaRecorder = null;
  let audioChunks = [];
  let isRecording = false;
  let pendingRetryBlob = null;  // Cached audio for retry on failure

  voiceBtn.addEventListener("click", async () => {
    // Allow voice input in inbox mode (no session) - transcription just fills the input

    // If in retry state, retry transcription
    if (pendingRetryBlob) {
      const blob = pendingRetryBlob;
      pendingRetryBlob = null;
      await transcribeAudio(blob);
      return;
    }

    if (isRecording) {
      // Stop recording
      mediaRecorder.stop();
      voiceBtn.classList.remove("recording");
      voiceBtn.textContent = "🎙";
      isRecording = false;
    } else {
      // Start recording - clear any pending retry first
      if (voiceBtn.classList.contains("retry")) {
        voiceBtn.classList.remove("retry");
        voiceBtn.textContent = "🎙";
        voiceBtn.title = "Voice input";
        pendingRetryBlob = null;
      }

      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
        audioChunks = [];

        mediaRecorder.ondataavailable = (e) => {
          if (e.data.size > 0) audioChunks.push(e.data);
        };

        mediaRecorder.onstop = async () => {
          const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
          stream.getTracks().forEach(t => t.stop());
          await transcribeAudio(audioBlob);
          audioChunks = [];
        };

        mediaRecorder.start();
        voiceBtn.classList.add("recording");
        voiceBtn.textContent = "⏹";
        isRecording = true;
      } catch (err) {
        console.error("Microphone access denied:", err);
        alert("Please allow microphone access to use voice input");
      }
    }
  });

  async function transcribeAudio(blob) {
    const formData = new FormData();
    formData.append("audio", blob, "recording.webm");

    // Show processing state (remove retry class if present)
    voiceBtn.classList.remove("retry");
    voiceBtn.classList.add("processing");
    voiceBtn.textContent = "";

    try {
      const res = await fetch("/api/transcribe", {
        method: "POST",
        body: formData
      });
      const data = await res.json();

      // Check HTTP status first
      if (!res.ok) {
        throw new Error(data.error || `Server error: ${res.status}`);
      }

      if (data.text) {
        // Clear any cached retry blob on success
        pendingRetryBlob = null;

        msgInput.value += (msgInput.value ? " " : "") + data.text;
        autoResizeInput();
        saveDraft();
        msgInput.focus();

        // Show success
        voiceBtn.classList.remove("processing");
        voiceBtn.classList.add("success");
        voiceBtn.textContent = "✓";
        voiceBtn.title = "Voice input";
        setTimeout(() => {
          voiceBtn.classList.remove("success");
          voiceBtn.textContent = "🎙";
        }, 800);
      } else {
        throw new Error("No text returned");
      }
    } catch (err) {
      console.error("Transcription failed:", err);

      // Cache blob for retry
      pendingRetryBlob = blob;

      // Show retry state
      voiceBtn.classList.remove("processing", "success");
      voiceBtn.classList.add("retry");
      voiceBtn.textContent = "↻";
      voiceBtn.title = "Tap to retry";
    }
  }

  // ---- Send message ----
  function sendMessage() {
    const text = msgInput.value.trim();
    if (!text && pendingImages.length === 0) return;

    // If no session attached, send to inbox instead
    if (!currentSessionId) {
      sendToInbox(text);
      return;
    }

    const msg = { action: "send", text: text || "(image)" };
    if (selectedTool) msg.tool = selectedTool;
    msg.thinking = thinkingEnabled;
    if (pendingImages.length > 0) {
      msg.images = pendingImages.map((img) => ({
        data: img.data,
        mimeType: img.mimeType,
      }));
      pendingImages.forEach((img) => URL.revokeObjectURL(img.objectUrl));
      pendingImages = [];
      renderImagePreviews();
    }
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    } else {
      messageQueue.push(msg);
    }
    msgInput.value = "";
    clearDraft();
    autoResizeInput();
  }

  cancelBtn.addEventListener("click", () => wsSend({ action: "cancel" }));

  compactBtn.addEventListener("click", () => {
    if (!currentSessionId) return;
    wsSend({ action: "compact" });
  });

  sendBtn.addEventListener("click", sendMessage);
  msgInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      sendMessage();
    }
  });

  // Auto-resize textarea: 3 lines default, 10 lines max
  function autoResizeInput() {
    if (inputArea.classList.contains("is-resized")) return;
    msgInput.style.height = "auto";
    const lineH = parseFloat(getComputedStyle(msgInput).lineHeight) || 24;
    const minH = lineH * 3;
    const maxH = lineH * 10;
    const newH = Math.min(Math.max(msgInput.scrollHeight, minH), maxH);
    msgInput.style.height = newH + "px";
  }
  // ---- Draft persistence ----
  function saveDraft() {
    if (!currentSessionId) return;
    localStorage.setItem(`draft_${currentSessionId}`, msgInput.value);
  }
  function restoreDraft() {
    if (!currentSessionId) return;
    const draft = localStorage.getItem(`draft_${currentSessionId}`);
    if (draft) {
      msgInput.value = draft;
      autoResizeInput();
    }
  }
  function clearDraft() {
    if (!currentSessionId) return;
    localStorage.removeItem(`draft_${currentSessionId}`);
  }

  msgInput.addEventListener("input", () => {
    autoResizeInput();
    saveDraft();
  });
  // Set initial height
  requestAnimationFrame(() => autoResizeInput());

  // ---- Progress sidebar ----
  let activeTab = "sessions"; // "sessions" | "progress" | "files"
  let progressPollTimer = null;
  let lastProgressState = { sessions: {} };

  function switchTab(tab) {
    activeTab = tab;
    tabSessions.classList.toggle("active", tab === "sessions");
    tabProgress.classList.toggle("active", tab === "progress");
    tabFiles.classList.toggle("active", tab === "files");
    sessionList.style.display = tab === "sessions" ? "" : "none";
    progressPanel.classList.toggle("visible", tab === "progress");
    filesPanel.classList.toggle("visible", tab === "files");
    newSessionBtn.classList.toggle("hidden", tab !== "sessions");
    if (tab === "progress") {
      fetchSidebarState();
      if (!progressPollTimer) {
        progressPollTimer = setInterval(fetchSidebarState, 30_000);
      }
    } else {
      clearInterval(progressPollTimer);
      progressPollTimer = null;
    }
    if (tab === "files") {
      loadFilesPanel();
    }
  }

  tabSessions.addEventListener("click", () => switchTab("sessions"));
  tabProgress.addEventListener("click", () => switchTab("progress"));
  tabFiles.addEventListener("click", () => switchTab("files"));

  // ---- Files Panel ----
  async function loadFilesPanel() {
    try {
      const res = await fetch("/api/files");
      const data = await res.json();

      if (!data.exists) {
        filesPanel.innerHTML = `
          <div class="files-empty">
            <p>Assistant directory not initialized.</p>
            <button class="files-init-btn" id="initAssistantBtn">Initialize</button>
          </div>
        `;
        document.getElementById("initAssistantBtn").addEventListener("click", initAssistant);
        return;
      }

      let html = "";

      // Observations
      html += `<div class="files-section">`;
      html += `<div class="files-section-header">Observations</div>`;
      if (data.observations?.exists) {
        html += `<div class="files-item" data-file="OBSERVATIONS.md">
          <span class="files-item-icon">&#128065;</span>
          <span class="files-item-name">OBSERVATIONS.md</span>
        </div>`;
      } else {
        html += `<div class="files-item" style="opacity:0.5;cursor:default">
          <span class="files-item-icon">&#128065;</span>
          <span class="files-item-name">No observations yet</span>
        </div>`;
      }
      html += `</div>`;

      // Axioms
      html += `<div class="files-section">`;
      html += `<div class="files-section-header">Axioms (${data.axioms.length})</div>`;
      for (const axiom of data.axioms) {
        html += `<div class="files-item" data-file="${axiom.name}">
          <span class="files-item-icon">&#9881;</span>
          <span class="files-item-name">${axiom.name.replace(".md", "")}</span>
        </div>`;
      }
      if (data.axioms.length === 0) {
        html += `<div class="files-item" style="opacity:0.5;cursor:default">
          <span class="files-item-name">No axioms yet</span>
        </div>`;
      }
      html += `</div>`;

      // Skills
      html += `<div class="files-section">`;
      html += `<div class="files-section-header">Skills (${data.skills.length})</div>`;
      for (const skill of data.skills) {
        html += `<div class="files-item" data-file="${skill.name}">
          <span class="files-item-icon">&#128736;</span>
          <span class="files-item-name">${skill.name.replace(".md", "")}</span>
        </div>`;
      }
      if (data.skills.length === 0) {
        html += `<div class="files-item" style="opacity:0.5;cursor:default">
          <span class="files-item-name">No skills yet</span>
        </div>`;
      }
      html += `</div>`;

      filesPanel.innerHTML = html;

      // Add click handlers
      filesPanel.querySelectorAll(".files-item[data-file]").forEach((item) => {
        item.addEventListener("click", () => openFileViewer(item.dataset.file));
      });
    } catch (err) {
      console.error("Failed to load files panel:", err);
      filesPanel.innerHTML = `<div class="files-empty"><p>Failed to load files</p></div>`;
    }
  }

  async function initAssistant() {
    try {
      const res = await fetch("/api/files/init", { method: "POST" });
      if (res.ok) {
        loadFilesPanel();
      }
    } catch (err) {
      console.error("Failed to initialize:", err);
    }
  }

  async function openFileViewer(filename) {
    try {
      const res = await fetch(`/api/files/content?f=${encodeURIComponent(filename)}`);
      if (!res.ok) {
        alert("Failed to load file");
        return;
      }
      const data = await res.json();
      fileViewerTitle.textContent = filename;
      fileViewerContent.innerHTML = `<div class="md-content">${marked.parse(data.content || "")}</div>`;
      fileViewerModal.classList.add("open");
    } catch (err) {
      console.error("Failed to open file:", err);
    }
  }

  fileViewerClose.addEventListener("click", () => {
    fileViewerModal.classList.remove("open");
  });

  fileViewerModal.addEventListener("click", (e) => {
    if (e.target === fileViewerModal) {
      fileViewerModal.classList.remove("open");
    }
  });
  tabFiles.addEventListener("click", () => switchTab("files"));

  function relativeTime(ts) {
    const diff = Date.now() - ts;
    if (diff < 60_000) return "just now";
    if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
    if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
    return `${Math.floor(diff / 86_400_000)}d ago`;
  }

  function renderProgressPanel(state) {
    progressPanel.innerHTML = "";
    const stateEntries = Object.entries(state.sessions || {});

    // Collect all session IDs to render: those with data + those pending without data yet
    const pendingOnly = [...pendingSummary].filter(id => !state.sessions[id]);
    const allEntries = [
      ...stateEntries,
      ...pendingOnly.map(id => {
        const s = sessions.find(sess => sess.id === id);
        return [id, { folder: s?.folder || "", name: s?.name || "", _pendingOnly: true }];
      }),
    ];

    if (allEntries.length === 0) {
      const empty = document.createElement("div");
      empty.className = "progress-empty";
      empty.textContent = "No summaries yet. Send a message in any session to generate one.";
      progressPanel.appendChild(empty);
      return;
    }

    // Sort by most recently updated; pending-only entries sort to top
    allEntries.sort((a, b) => {
      const aPending = pendingSummary.has(a[0]);
      const bPending = pendingSummary.has(b[0]);
      if (aPending !== bPending) return aPending ? -1 : 1;
      return (b[1].updatedAt || 0) - (a[1].updatedAt || 0);
    });

    for (const [sessionId, entry] of allEntries) {
      const isRunning = sessions.some(s => s.id === sessionId && s.status === "running");
      const isSummarizing = pendingSummary.has(sessionId);
      const card = document.createElement("div");
      card.className = "progress-card";

      const folderName = (entry.folder || "").split("/").pop() || entry.folder || "unknown";
      const displayName = entry.name || folderName;

      const summaryIndicator = isSummarizing
        ? '<div class="progress-summarizing">Summarizing...</div>'
        : "";

      if (entry._pendingOnly) {
        card.innerHTML = `
          <div class="progress-card-header">
            <div class="progress-card-name">${escapeHtml(displayName)}</div>
          </div>
          <div class="progress-card-folder">${escapeHtml(entry.folder || "")}</div>
          <div class="progress-summarizing">Summarizing...</div>
        `;
      } else {
        card.innerHTML = `
          <div class="progress-card-header">
            ${isRunning ? '<div class="progress-running-dot"></div>' : ''}
            <div class="progress-card-name">${escapeHtml(displayName)}</div>
          </div>
          <div class="progress-card-folder">${escapeHtml(entry.folder || "")}</div>
          <div class="progress-card-bg">${escapeHtml(entry.background || "")}</div>
          <div class="progress-card-action">↳ ${escapeHtml(entry.lastAction || "")}</div>
          <div class="progress-card-footer">
            ${entry.updatedAt ? `<span class="progress-card-time">${relativeTime(entry.updatedAt)}</span>` : ""}
            ${summaryIndicator}
          </div>
        `;
      }

      // Click card to switch to that session
      card.addEventListener("click", () => {
        const session = sessions.find(s => s.id === sessionId);
        if (session) {
          switchTab("sessions");
          attachSession(session.id, session);
          if (!isDesktop) closeSidebarFn();
        }
      });
      card.style.cursor = "pointer";

      progressPanel.appendChild(card);
    }
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  async function fetchSidebarState() {
    try {
      const res = await fetch("/api/sidebar");
      if (!res.ok) return;
      const state = await res.json();
      // Clear pending flag for sessions whose summary just arrived or updated
      for (const [sessionId, entry] of Object.entries(state.sessions || {})) {
        if (pendingSummary.has(sessionId)) {
          const prev = lastSidebarUpdatedAt[sessionId] || 0;
          if ((entry.updatedAt || 0) > prev) {
            pendingSummary.delete(sessionId);
          }
        }
        lastSidebarUpdatedAt[sessionId] = entry.updatedAt || 0;
      }
      lastProgressState = state;
      renderProgressPanel(state);
    } catch {}
  }

  // ---- Input area resize ----
  const INPUT_MIN_H = 100;
  let isResizingInput = false;
  let resizeStartY = 0;
  let resizeStartH = 0;

  function getInputMaxH() {
    return Math.floor(window.innerHeight * 0.72);
  }

  function onInputResizeStart(e) {
    isResizingInput = true;
    resizeStartY = e.touches ? e.touches[0].clientY : e.clientY;
    resizeStartH = inputArea.getBoundingClientRect().height;
    document.addEventListener("mousemove", onInputResizeMove);
    document.addEventListener("touchmove", onInputResizeMove, { passive: false });
    document.addEventListener("mouseup", onInputResizeEnd);
    document.addEventListener("touchend", onInputResizeEnd);
    e.preventDefault();
  }

  function onInputResizeMove(e) {
    if (!isResizingInput) return;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    const dy = resizeStartY - clientY; // drag up = positive dy = bigger height
    const newH = Math.max(INPUT_MIN_H, Math.min(getInputMaxH(), resizeStartH + dy));
    inputArea.style.height = newH + "px";
    inputArea.classList.add("is-resized");
    localStorage.setItem("inputAreaHeight", newH);
    e.preventDefault();
  }

  function onInputResizeEnd() {
    isResizingInput = false;
    document.removeEventListener("mousemove", onInputResizeMove);
    document.removeEventListener("touchmove", onInputResizeMove);
    document.removeEventListener("mouseup", onInputResizeEnd);
    document.removeEventListener("touchend", onInputResizeEnd);
  }

  inputResizeHandle.addEventListener("mousedown", onInputResizeStart);
  inputResizeHandle.addEventListener("touchstart", onInputResizeStart, { passive: false });

  // Restore saved height
  const savedInputH = localStorage.getItem("inputAreaHeight");
  if (savedInputH) {
    const h = parseInt(savedInputH, 10);
    if (h >= INPUT_MIN_H && h <= getInputMaxH()) {
      inputArea.style.height = h + "px";
      inputArea.classList.add("is-resized");
    }
  }

  // ---- Inbox functions ----
  async function loadInbox() {
    try {
      const res = await fetch("/api/inbox");
      const data = await res.json();
      inboxItems = data.items || [];
    } catch (err) {
      console.error("Failed to load inbox:", err);
      inboxItems = [];
    }
    // Always render inbox, even on error (will show empty state)
    renderInbox();
  }

  function renderInbox() {
    // Re-query inboxList in case emptyState was re-attached to DOM
    const listEl = document.getElementById("inboxList");
    const countEl = document.getElementById("inboxCount");
    if (!listEl) {
      console.error("inboxList not found in DOM");
      return;
    }

    listEl.innerHTML = "";

    if (inboxItems.length === 0) {
      listEl.innerHTML = '<div class="inbox-empty">No items yet. Type below to add something.</div>';
      if (countEl) countEl.textContent = "0 items";
      return;
    }

    if (countEl) countEl.textContent = `${inboxItems.length} item${inboxItems.length === 1 ? "" : "s"}`;

    for (const item of inboxItems) {
      const div = document.createElement("div");
      // Add type class for Observer/Reflector
      const typeClass = item.type || "user";
      div.className = `inbox-item ${typeClass}`;
      div.dataset.id = item.id;
      div.dataset.type = typeClass;

      const timeStr = new Date(item.created).toLocaleTimeString("en-US", {
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
      });

      // Preview: first 60 chars of content
      const preview = item.content.slice(0, 60) + (item.content.length > 60 ? "..." : "");

      // Type label for Observer/Reflector
      const typeLabel = (item.type === "observer" || item.type === "reflector")
        ? `<span class="inbox-item-type">${item.type}</span>`
        : "";

      div.innerHTML = `
        <div class="inbox-item-content">
          <div class="inbox-item-title">${escapeHtml(item.title)}${typeLabel}</div>
          <div class="inbox-item-preview">${escapeHtml(preview)}</div>
        </div>
        <span class="inbox-item-time">${timeStr}</span>
        <button class="inbox-item-delete" title="Delete">&times;</button>
      `;

      // Click to start session
      div.addEventListener("click", (e) => {
        if (e.target.classList.contains("inbox-item-delete")) return;
        openInboxActionModal(item);
      });

      // Delete button
      div.querySelector(".inbox-item-delete").addEventListener("click", async (e) => {
        e.stopPropagation();
        if (confirm("Delete this item?")) {
          try {
            await fetch(`/api/inbox/${item.id}`, { method: "DELETE" });
            inboxItems = inboxItems.filter(i => i.id !== item.id);
            renderInbox();
          } catch (err) {
            console.error("Failed to delete inbox item:", err);
          }
        }
      });

      listEl.appendChild(div);
    }
  }

  async function sendToInbox(text) {
    if (!text) return;
    try {
      const res = await fetch("/api/inbox", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: text }),
      });
      const data = await res.json();
      if (data.item) {
        inboxItems.unshift(data.item);
        renderInbox();
        msgInput.value = "";
        autoResizeInput();
      }
    } catch (err) {
      console.error("Failed to add to inbox:", err);
      alert("Failed to add to inbox");
    }
  }

  async function openInboxActionModal(item) {
    selectedInboxItem = item;

    // Get modal elements
    const titleEl = document.getElementById("inboxActionTitle");
    const contentEl = document.getElementById("inboxActionContent");
    const aiContentEl = document.getElementById("inboxAIContent");
    const folderSectionEl = document.getElementById("inboxFolderSection");

    const itemType = item.type || "user";
    const isAIInitiated = itemType === "observer" || itemType === "reflector";

    // Set title based on type
    if (isAIInitiated) {
      titleEl.textContent = itemType === "observer" ? "Observer Report" : "Reflector Report";
    } else {
      titleEl.textContent = "Start Session from Inbox";
    }

    // Show content
    contentEl.textContent = item.title;

    // Show AI content for Observer/Reflector
    if (isAIInitiated) {
      aiContentEl.style.display = "block";
      aiContentEl.textContent = item.content;
      folderSectionEl.style.display = "none";
    } else {
      aiContentEl.style.display = "none";
      folderSectionEl.style.display = "block";
    }

    // Load folders from sessions (for user type)
    const folders = [...new Set(sessions.map(s => s.folder).filter(Boolean))];

    inboxFolderSelect.innerHTML = "";
    if (folders.length === 0) {
      // No sessions yet, show a placeholder message
      const opt = document.createElement("option");
      opt.value = "";
      opt.textContent = "Create a session first";
      inboxFolderSelect.appendChild(opt);
    } else {
      for (const folder of folders) {
        const opt = document.createElement("option");
        opt.value = folder;
        opt.textContent = folder.split("/").pop();
        inboxFolderSelect.appendChild(opt);
      }
    }

    // Load tools
    inboxToolSelect.innerHTML = "";
    for (const t of toolsList) {
      const opt = document.createElement("option");
      opt.value = t.id;
      opt.textContent = t.name;
      inboxToolSelect.appendChild(opt);
    }

    inboxActionModal.classList.add("open");
  }

  inboxActionCancel.addEventListener("click", () => {
    inboxActionModal.classList.remove("open");
    selectedInboxItem = null;
  });

  inboxActionModal.addEventListener("click", (e) => {
    if (e.target === inboxActionModal) {
      inboxActionModal.classList.remove("open");
      selectedInboxItem = null;
    }
  });

  inboxActionCreate.addEventListener("click", async () => {
    if (!selectedInboxItem) return;

    const itemType = selectedInboxItem.type || "user";
    const isAIInitiated = itemType === "observer" || itemType === "reflector";

    // For Observer/Reflector, use assistant directory
    let folder, tool;
    if (isAIInitiated) {
      if (!ASSISTANT_DIR) {
        alert("Assistant directory not configured");
        return;
      }
      folder = ASSISTANT_DIR;
      tool = "claude";
    } else {
      folder = inboxFolderSelect.value;
      tool = inboxToolSelect.value || "claude";
      if (!folder) {
        alert("Please select a folder");
        return;
      }
    }

    // Create session via WebSocket
    wsSend({ action: "create", folder, tool });
    inboxActionModal.classList.remove("open");

    // Wait for session to be created
    const handler = (e) => {
      let msg;
      try {
        msg = JSON.parse(e.data);
      } catch {
        return;
      }
      if (msg.type === "session" && msg.session) {
        ws.removeEventListener("message", handler);

        // Attach to session
        attachSession(msg.session.id, msg.session);
        wsSend({ action: "list" });

        // Send the inbox item content as a message
        setTimeout(() => {
          // Build prompt based on type
          let textToSend;
          if (isAIInitiated) {
            // AI-initiated session: generate appropriate prompt
            if (itemType === "observer") {
              textToSend = `我刚刚完成了今天的观察提取。以下是我从对话中提取的观察：

${selectedInboxItem.content}

请帮我：
1. 检查这些观察是否准确反映了今天的活动
2. 是否有遗漏的重要内容
3. 这些观察中哪些值得长期保留`;
            } else if (itemType === "reflector") {
              textToSend = `我刚刚完成了每周反思。以下是分析结果：

${selectedInboxItem.content}

请帮我：
1. 检查 draft/ 目录下的 skill 候选是否合理
2. 是否需要调整或合并某些 skill
3. 有什么遗漏或需要补充的`;
            }
          } else {
            textToSend = selectedInboxItem.content;
          }

          const sendMsg = { action: "send", text: textToSend };
          if (selectedTool) sendMsg.tool = selectedTool;
          sendMsg.thinking = thinkingEnabled;
          wsSend(sendMsg);

          // Delete the inbox item after sending
          fetch(`/api/inbox/${selectedInboxItem.id}`, { method: "DELETE" });
          inboxItems = inboxItems.filter(i => i.id !== selectedInboxItem.id);
          renderInbox();
          selectedInboxItem = null;
        }, 500);
      }
    };
    ws.addEventListener("message", handler);
  });

  // ---- Init ----
  // First check if server is ready
  async function checkServerReady() {
    try {
      const res = await fetch("/health");
      if (res.ok) {
        return true;
      }
    } catch {}
    return false;
  }

  // Show loading state if server not ready
  async function initApp() {
    const ready = await checkServerReady();
    if (!ready) {
      // Server not ready, show message and retry
      messagesInner.innerHTML = `
        <div class="empty-state">
          <div class="inbox-container">
            <div class="inbox-header">
              <h2>Starting up...</h2>
            </div>
            <p style="color: var(--text-secondary); font-size: 14px; margin-top: 12px;">
              The server is starting. This may take a few seconds.
            </p>
            <button id="retryBtn" style="margin-top: 16px; padding: 10px 20px; background: var(--text); color: var(--bg); border: none; border-radius: 8px; font-size: 14px; cursor: pointer;">
              Retry Now
            </button>
          </div>
        </div>
      `;
      document.getElementById("retryBtn").addEventListener("click", () => location.reload());
      // Auto-retry after 3 seconds
      setTimeout(() => {
        if (!ws || ws.readyState !== WebSocket.OPEN) {
          location.reload();
        }
      }, 3000);
      return false;
    }
    return true;
  }

  initResponsiveLayout();
  loadInlineTools();
  loadSkills();

  // Wait for server ready before connecting
  initApp().then((ready) => {
    if (ready) {
      connect();
    }
  });

  // Enable input in empty state for inbox
  msgInput.disabled = false;
  sendBtn.disabled = false;
  msgInput.placeholder = "Add to inbox...";
  imgBtn.disabled = false;  // Allow image upload for inbox
  voiceBtn.disabled = false;  // Allow voice input for inbox
  inlineToolSelect.disabled = true;
  thinkingToggle.disabled = true;
  loadInbox();
})();
