// DOM 修复脚本 - 在 Console 中运行以立即修正 tab-rolemanage 的位置
// 运行方式：复制全部内容，粘贴到 Console，按回车

(function() {
    console.log('[DOM Fix] 开始修复...');

    // 1. 找到 tab-rolemanage
    var rolemanage = document.getElementById('tab-rolemanage');
    if (!rolemanage) {
        console.error('[DOM Fix] 找不到 tab-rolemanage!');
        return;
    }

    // 2. 找到 mainApp
    var mainApp = document.getElementById('mainApp');
    if (!mainApp) {
        console.error('[DOM Fix] 找不到 mainApp!');
        return;
    }

    // 3. 检查当前状态
    var parent = rolemanage.parentNode;
    console.log('[DOM Fix] tab-rolemanage 当前父元素:', parent.id || parent.tagName);

    if (parent.id === 'mainApp') {
        console.log('[DOM Fix] 结构已经正确，无需修复');
        return;
    }

    // 4. 移动 tab-rolemanage 到 mainApp 的末尾（在 loginOverlay 之前）
    // 先关闭 tab-datamgmt（在 tab-rolemanage 之前添加关闭标签）
    var tabDatamgmt = document.getElementById('tab-datamgmt');
    if (tabDatamgmt) {
        // 关闭 tab-datamgmt
        var closeDiv = document.createElement('div');
        // 实际上直接在 rolemanage 之前插入一个关闭 div
        var closeTag = document.createElement('div');
        closeTag.style.display = 'none';
        closeTag.id = '__temp_close_datamgmt';
        tabDatamgmt.parentNode.insertBefore(closeTag, rolemanage);
    }

    // 5. 将 tab-rolemanage 从当前位置移到 mainApp 末尾
    rolemanage.parentNode.removeChild(rolemanage);
    mainApp.appendChild(rolemanage);

    // 6. 验证
    var newParent = rolemanage.parentNode;
    console.log('[DOM Fix] 修复后 tab-rolemanage 父元素:', newParent.id || newParent.tagName);

    if (newParent.id === 'mainApp') {
        console.log('[DOM Fix] 修复成功! tab-rolemanage 现在是 mainApp 的子元素');
    } else {
        console.error('[DOM Fix] 修复失败，父元素仍然是:', newParent.id);
    }

    // 7. 清理临时元素
    var temp = document.getElementById('__temp_close_datamgmt');
    if (temp) temp.remove();
})();
