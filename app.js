function updateAuthUi() {
  if (session) {
    els.authToggle.textContent = "退出";
    els.authPanel.hidden = true;
    els.sessionState.textContent = "已登录。生成后会保存到你的私密档案。";
    // --- 新增：显示所有登录后才可用的元素 ---
    // 假设你想在登录后显示结果区、聊天区、档案区等，它们原本可能被隐藏或禁用
    // 根据你的 HTML，这些区域本来就没有 hidden 属性，但如果之前被隐藏了，可以取消隐藏
    // 下面只做安全的显示操作
    if (els.result) els.result.hidden = false;
    if (els.archiveList) els.archiveList.style.display = "";
    if (els.clearDataBtn) els.clearDataBtn.hidden = false;
    // 确保输入框和按钮可用
    if (els.thoughtInput) els.thoughtInput.disabled = false;
    if (els.reflectBtn) els.reflectBtn.disabled = false;
    if (els.chatInput) els.chatInput.disabled = false;
    if (els.chatForm) els.chatForm.style.display = "flex";
  } else {
    els.authToggle.textContent = "登录保存";
    els.authPanel.hidden = true;      // 未登录时保持隐藏，点击按钮才显示
    els.sessionState.textContent = "未登录时仅生成当次回应。";
    // --- 新增：隐藏需要登录才能看的内容（可选）---
    if (els.result) els.result.hidden = true;
    // 注意：不清空档案列表，只显示提示文字（loadEntries 已经做了）
    if (els.clearDataBtn) els.clearDataBtn.hidden = true;
  }
}