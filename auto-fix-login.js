/* 自动修复脚本 - 登录后自动从云端刷新项目列表 */
(function autoFixLoginRefresh() {
  console.log('[AutoFix] 检测到修复脚本加载');

  // 立即刷新（如果已登录）
  if (typeof currentUser !== 'undefined' && currentUser && currentUser.phone) {
    console.log('[AutoFix] 用户已登录，立即刷新项目列表');
    setTimeout(() => {
      if (typeof renderProjectManage === 'function') {
        renderProjectManage({ cacheOnly: false }).then(() => {
          console.log('[AutoFix] 项目列表已从云端刷新');
        });
      }
    }, 2000);
  }

  // 覆盖 onLoginSuccess 函数
  if (typeof window.onLoginSuccess === 'function') {
    const originalOnLoginSuccess = window.onLoginSuccess;

    window.onLoginSuccess = async function() {
      await originalOnLoginSuccess();

      // 后台同步后，强制从云端刷新
      setTimeout(async () => {
        console.log('[AutoFix] 登录后从云端刷新项目列表');
        if (typeof renderProjectManage === 'function') {
          await renderProjectManage({ cacheOnly: false });
        }
      }, 2000);
    };

    console.log('[AutoFix] onLoginSuccess 已修复');
  }
})();
