"use strict";
(() => {
  // src/webview/toolbar.ts
  function createToolbar(container, postMessage2) {
    const state = {
      inspectActive: false,
      addElementActive: false
    };
    let stateChangeCallback;
    container.innerHTML = `
    <div class="toolbar-group left">
      <button class="toolbar-btn" id="btn-back" title="Back">
        <span class="material-symbols-outlined">arrow_back</span>
      </button>
      <button class="toolbar-btn" id="btn-forward" title="Forward">
        <span class="material-symbols-outlined">arrow_forward</span>
      </button>
      <button class="toolbar-btn" id="btn-reload" title="Reload">
        <span class="material-symbols-outlined">refresh</span>
      </button>
    </div>
    <div class="toolbar-group center">
      <input class="url-bar" id="url-bar" type="text" placeholder="Enter URL..." spellcheck="false" />
    </div>
    <div class="toolbar-group right">
      <button class="toolbar-btn" id="btn-inspect" title="Inspect Element">
        <span class="material-symbols-outlined">select</span>
      </button>
      <button class="toolbar-btn" id="btn-add-element" title="Add Element to Chat">
        <span class="material-symbols-outlined">add_comment</span>
      </button>
      <div class="toolbar-divider"></div>
      <button class="toolbar-btn" id="btn-add-logs" title="Add Logs to Chat">
        <span class="material-symbols-outlined">terminal</span>
      </button>
      <button class="toolbar-btn" id="btn-screenshot" title="Screenshot">
        <span class="material-symbols-outlined">screenshot_monitor</span>
      </button>
      <div class="toolbar-divider"></div>
      <div style="position: relative;">
        <button class="toolbar-btn" id="btn-overflow" title="More actions">
          <span class="material-symbols-outlined">more_vert</span>
        </button>
        <div class="overflow-menu" id="overflow-menu">
          <button class="overflow-menu-item" id="menu-settings">
            <span class="material-symbols-outlined">settings</span>
            Settings
          </button>
          <button class="overflow-menu-item" id="menu-copy-html">
            <span class="material-symbols-outlined">content_copy</span>
            Copy Page HTML
          </button>
          <button class="overflow-menu-item" id="menu-clear">
            <span class="material-symbols-outlined">deselect</span>
            Clear Selection
          </button>
        </div>
      </div>
    </div>
  `;
    const banner = document.createElement("div");
    banner.className = "instruction-banner";
    banner.id = "instruction-banner";
    banner.innerHTML = `Click any element to add it to chat &nbsp; <kbd>ESC</kbd> to cancel`;
    container.parentElement?.insertBefore(banner, container.nextSibling);
    const urlBar = container.querySelector("#url-bar");
    const btnBack = container.querySelector("#btn-back");
    const btnForward = container.querySelector("#btn-forward");
    const btnReload = container.querySelector("#btn-reload");
    const btnInspect = container.querySelector("#btn-inspect");
    const btnAddElement = container.querySelector("#btn-add-element");
    const btnAddLogs = container.querySelector("#btn-add-logs");
    const btnScreenshot = container.querySelector("#btn-screenshot");
    const btnOverflow = container.querySelector("#btn-overflow");
    const overflowMenu = container.querySelector("#overflow-menu");
    const elements = { urlBar, btnInspect, btnAddElement, banner };
    btnBack.addEventListener("click", () => {
      postMessage2({ type: "nav:back", payload: {} });
    });
    btnForward.addEventListener("click", () => {
      postMessage2({ type: "nav:forward", payload: {} });
    });
    btnReload.addEventListener("click", () => {
      postMessage2({ type: "nav:reload", payload: {} });
    });
    urlBar.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        const url = urlBar.value.trim();
        if (url) {
          postMessage2({ type: "navigate", payload: { url } });
        }
      }
    });
    btnInspect.addEventListener("click", () => {
      state.inspectActive = !state.inspectActive;
      if (state.inspectActive) {
        state.addElementActive = false;
      }
      updateModeUI();
      stateChangeCallback?.({ ...state });
    });
    btnAddElement.addEventListener("click", () => {
      state.addElementActive = !state.addElementActive;
      if (state.addElementActive) {
        state.inspectActive = false;
      }
      updateModeUI();
      stateChangeCallback?.({ ...state });
    });
    btnAddLogs.addEventListener("click", () => {
      postMessage2({ type: "action:addLogs", payload: { logs: [] } });
    });
    btnScreenshot.addEventListener("click", () => {
      postMessage2({ type: "action:screenshot", payload: { dataUrl: "" } });
    });
    btnOverflow.addEventListener("click", (e) => {
      e.stopPropagation();
      overflowMenu.classList.toggle("visible");
    });
    document.addEventListener("click", () => {
      overflowMenu.classList.remove("visible");
    });
    container.querySelector("#menu-settings").addEventListener("click", () => {
      postMessage2({ type: "menu:openSettings", payload: {} });
      overflowMenu.classList.remove("visible");
    });
    container.querySelector("#menu-copy-html").addEventListener("click", () => {
      const iframe2 = document.querySelector("#browser-iframe");
      let html = "";
      try {
        html = iframe2?.contentDocument?.documentElement?.outerHTML || "";
      } catch {
        html = "<!-- Cross-origin: cannot access page HTML -->";
      }
      postMessage2({ type: "menu:copyHtml", payload: { html } });
      overflowMenu.classList.remove("visible");
    });
    container.querySelector("#menu-clear").addEventListener("click", () => {
      postMessage2({ type: "menu:clearSelection", payload: {} });
      overflowMenu.classList.remove("visible");
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        state.inspectActive = false;
        state.addElementActive = false;
        updateModeUI();
        stateChangeCallback?.({ ...state });
      }
    });
    function updateModeUI() {
      elements.btnInspect.classList.toggle("active", state.inspectActive);
      elements.btnAddElement.classList.toggle("active", state.addElementActive);
      elements.banner.classList.toggle("visible", state.addElementActive);
      container.classList.toggle("mode-active", state.inspectActive || state.addElementActive);
    }
    return {
      setUrl(url) {
        elements.urlBar.value = url;
      },
      setInspectActive(active) {
        state.inspectActive = active;
        if (active) state.addElementActive = false;
        updateModeUI();
      },
      setAddElementActive(active) {
        state.addElementActive = active;
        if (active) state.inspectActive = false;
        updateModeUI();
      },
      onStateChange(cb) {
        stateChangeCallback = cb;
      }
    };
  }

  // src/webview/main.ts
  var vscode = acquireVsCodeApi();
  function postMessage(msg) {
    vscode.postMessage(msg);
  }
  var toolbarContainer = document.getElementById("toolbar");
  var toolbar = createToolbar(toolbarContainer, postMessage);
  var iframe = document.getElementById("browser-iframe");
  iframe.addEventListener("load", () => {
    let url = "";
    let title = "";
    let canInject = false;
    try {
      url = iframe.contentWindow?.location.href || "";
      title = iframe.contentDocument?.title || "";
      canInject = true;
    } catch {
      url = iframe.src;
      canInject = false;
    }
    if (url && url !== "about:blank") {
      toolbar.setUrl(url);
      postMessage({
        type: "iframe:loaded",
        payload: { url, title, canInject }
      });
    }
  });
  iframe.addEventListener("error", () => {
    postMessage({
      type: "iframe:error",
      payload: { url: iframe.src, error: "Failed to load page" }
    });
  });
  window.addEventListener("message", (event) => {
    const message = event.data;
    if (!message || !message.type) return;
    switch (message.type) {
      case "navigate:url":
        iframe.src = message.payload.url;
        toolbar.setUrl(message.payload.url);
        break;
      case "mode:inspect":
        toolbar.setInspectActive(message.payload.enabled);
        break;
      case "mode:addElement":
        toolbar.setAddElementActive(message.payload.enabled);
        break;
      case "screenshot:request":
        break;
      case "config:update":
        break;
      case "toast":
        showToast(message.payload.message, message.payload.toastType);
        break;
    }
  });
  function showToast(message, toastType) {
    const toast = document.createElement("div");
    toast.className = `toast ${toastType}`;
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 2600);
  }
})();
//# sourceMappingURL=main.js.map
