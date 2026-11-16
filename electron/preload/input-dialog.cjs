// 预加载世界可复用的输入弹窗，避免隔离世界反向读取 main world bridge。
function showWanjuanInputDialog(options = {}) {
  return new Promise((resolve) => {
    const title = String(options.title || "请输入").trim() || "请输入";
    const message = String(options.message || "").trim();
    const password = options.password === true;
    const defaultValue = password ? "" : String(options.defaultValue || "");
    const multiline = !password && options.multiline === true;
    const overlay = document.createElement("div");
    overlay.className = "wanjuan-native-input-overlay";
    overlay.innerHTML = `
      <div class="wanjuan-native-input-dialog" role="dialog" aria-modal="true">
        <div class="wanjuan-native-input-title"></div>
        <div class="wanjuan-native-input-message"></div>
        ${multiline ? `<textarea class="wanjuan-native-input-control" rows="8"></textarea>` : `<input class="wanjuan-native-input-control" />`}
        <div class="wanjuan-native-input-actions">
          <button type="button" data-action="cancel">取消</button>
          <button type="button" data-action="ok">确定</button>
        </div>
      </div>
    `;
    const titleEl = overlay.querySelector(".wanjuan-native-input-title");
    const messageEl = overlay.querySelector(".wanjuan-native-input-message");
    const input = overlay.querySelector(".wanjuan-native-input-control");
    if (titleEl) titleEl.textContent = title;
    if (messageEl) {
      messageEl.textContent = message;
      messageEl.style.display = message ? "" : "none";
    }
    if (input) {
      if (password) {input.type = "password";input.autocomplete = "off";input.spellcheck = false;}
      input.value = defaultValue;
    }
    const cancelButton = overlay.querySelector('[data-action="cancel"]');
    const confirmButton = overlay.querySelector('[data-action="ok"]');
    if (cancelButton && typeof options.cancelLabel === "string") cancelButton.textContent = options.cancelLabel;
    if (confirmButton && typeof options.confirmLabel === "string") confirmButton.textContent = options.confirmLabel;
    const finish = (value) => {
      if (input && password) input.value = "";
      overlay.remove();
      resolve(value);
    };
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) finish(null);
      const action = event.target?.dataset?.action;
      if (action === "cancel") finish(null);
      if (action === "ok") finish(input ? input.value : "");
    });
    overlay.addEventListener("keydown", (event) => {
      if (event.key === "Escape") finish(null);
      if (event.key === "Enter" && (!multiline || event.metaKey || event.ctrlKey)) finish(input ? input.value : "");
    });
    document.body.appendChild(overlay);
    window.setTimeout(() => {
      input?.focus();
      input?.select?.();
    }, 0);
  });
}

module.exports = { showWanjuanInputDialog };
