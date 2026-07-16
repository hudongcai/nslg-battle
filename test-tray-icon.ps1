Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$icon = New-Object System.Windows.Forms.NotifyIcon
$icon.Icon = [System.Drawing.SystemIcons]::Information
$icon.Text = '测试托盘图标'
$icon.Visible = $true

$menu = New-Object System.Windows.Forms.ContextMenuStrip
$menuItem = $menu.Items.Add('测试菜单')
$menuItem.Add_Click({
    [System.Windows.Forms.MessageBox]::Show('右键菜单点击成功！', '测试')
})

$icon.ContextMenuStrip = $menu

$icon.Add_Click({
    param($sender, $e)
    if ($e.Button -eq [System.Windows.Forms.MouseButtons]::Left) {
        [System.Windows.Forms.MessageBox]::Show('左键点击成功！', '测试')
    }
})

$icon.Add_DoubleClick({
    [System.Windows.Forms.MessageBox]::Show('双击成功！', '测试')
})

Write-Host "托盘图标已创建，请测试点击功能..."
Write-Host "按任意键退出..."
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")

$icon.Dispose()
